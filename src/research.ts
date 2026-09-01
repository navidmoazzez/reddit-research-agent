/**
 * The research pipeline.
 *
 * Reddit's API gives you endpoints. Research needs a sequence: work out where
 * the conversation actually happens, find the threads with real discussion in
 * them, pull the comments, and hand back evidence. Doing that sequence in one
 * server call instead of fifteen model turns is the point of this package.
 *
 * Ranking is transparent on purpose. Every thread comes back with the numbers
 * that put it where it is, so the model can disagree with the order rather than
 * inherit it.
 */

import { Forbidden, NotFound, RedditClient, RedditError } from "./client.js";
import {
  REDDIT,
  flattenComments,
  listingChildren,
  post,
  subreddit,
  type Comment,
  type Post,
  type Subreddit,
} from "./models.js";

const POST_ID = /\/comments\/([a-z0-9]+)/i;
const BARE_ID = /^(?:t3_)?([a-z0-9]{5,10})$/i;

export const SORTS = ["relevance", "hot", "top", "new", "comments"] as const;
export const TIMES = ["hour", "day", "week", "month", "year", "all"] as const;
export const LISTINGS = ["hot", "new", "top", "rising", "controversial"] as const;

/** Accept a full URL, a permalink, t3_abc123, or a bare id. */
export function postId(reference: string): string {
  const value = (reference ?? "").trim();
  const fromUrl = POST_ID.exec(value);
  if (fromUrl?.[1]) return fromUrl[1];
  const bare = BARE_ID.exec(value);
  if (bare?.[1]) return bare[1];
  throw new Error(
    `Could not read a Reddit post id out of ${JSON.stringify(reference)}. ` +
      "Pass a post URL, a permalink, or the id itself.",
  );
}

export function cleanSubreddit(name: string): string {
  return (name ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^r\//i, "")
    .replace(/\/+$/, "");
}

export type DiscoveredSubreddit = Subreddit & {
  foundVia: string[];
  matchingPosts: number;
};

/**
 * Where does this topic actually get discussed?
 *
 * Two signals, merged. Reddit's own subreddit search knows what communities
 * call themselves. The posts matching the topic know where the conversation is
 * really happening, which is often somewhere that never mentions the topic in
 * its name.
 */
export async function findSubreddits(
  client: RedditClient,
  topic: string,
  limit = 10,
): Promise<DiscoveredSubreddit[]> {
  const byName = new Map<string, DiscoveredSubreddit>();

  try {
    const payload = await client.get("/subreddits/search", {
      q: topic,
      limit: Math.min(limit * 2, 50),
    });
    for (const child of listingChildren(payload, "t5")) {
      const sub = subreddit(child);
      if (!sub.name) continue;
      byName.set(sub.name.toLowerCase(), {
        ...sub,
        foundVia: ["subreddit search"],
        matchingPosts: 0,
      });
    }
  } catch (error) {
    // Subreddit search is the less important of the two signals. If it is
    // unavailable, post inference alone still answers the question.
    if (!(error instanceof RedditError)) throw error;
  }

  try {
    const payload = await client.get("/search", {
      q: topic,
      sort: "relevance",
      t: "year",
      limit: 100,
    });
    const counts = new Map<string, number>();
    for (const child of listingChildren(payload, "t3")) {
      const name = post(child).subreddit;
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const [name, count] of counts) {
      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        existing.matchingPosts = count;
        existing.foundVia.push("posts about the topic");
      } else {
        byName.set(key, {
          name,
          title: null,
          subscribers: 0,
          activeUsers: null,
          createdAt: null,
          over18: false,
          description: "",
          url: `${REDDIT}/r/${name}/`,
          foundVia: ["posts about the topic"],
          matchingPosts: count,
        });
      }
    }
  } catch (error) {
    if (!(error instanceof RedditError)) throw error;
  }

  // A community actively posting about the topic beats a bigger one that merely
  // matched the word in its name.
  return [...byName.values()]
    .sort(
      (a, b) =>
        b.matchingPosts * 1000 +
        Math.min(b.subscribers, 5_000_000) / 1000 -
        (a.matchingPosts * 1000 + Math.min(a.subscribers, 5_000_000) / 1000),
    )
    .slice(0, limit);
}

export async function searchPosts(
  client: RedditClient,
  query: string,
  options: {
    subreddit?: string | undefined;
    sort?: string;
    timeFilter?: string;
    limit?: number;
  } = {},
): Promise<Post[]> {
  const sort = (SORTS as readonly string[]).includes(options.sort ?? "")
    ? options.sort!
    : "relevance";
  const t = (TIMES as readonly string[]).includes(options.timeFilter ?? "")
    ? options.timeFilter!
    : "year";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  const sub = options.subreddit ? cleanSubreddit(options.subreddit) : "";
  const path = sub ? `/r/${sub}/search` : "/search";
  const params: Record<string, string | number> = { q: query, sort, t, limit };
  if (sub) params["restrict_sr"] = "true";

  const payload = await client.get(path, params);
  return listingChildren(payload, "t3").map(post);
}

export async function browse(
  client: RedditClient,
  name: string,
  options: { listing?: string; timeFilter?: string; limit?: number } = {},
): Promise<Post[]> {
  const listing = (LISTINGS as readonly string[]).includes(options.listing ?? "")
    ? options.listing!
    : "hot";
  const params: Record<string, string | number> = {
    limit: Math.min(Math.max(options.limit ?? 25, 1), 100),
  };
  if (listing === "top" || listing === "controversial") {
    params["t"] = (TIMES as readonly string[]).includes(options.timeFilter ?? "")
      ? options.timeFilter!
      : "week";
  }
  const payload = await client.get(`/r/${cleanSubreddit(name)}/${listing}`, params);
  return listingChildren(payload, "t3").map(post);
}

export type Thread = Post & {
  comments: Comment[];
  commentsRetrieved: number;
  rank?: number;
  discussionRankScore?: number;
  rankInputs?: RankInputs;
};

/** A post plus its comments, flattened and scored. */
export async function getThread(
  client: RedditClient,
  reference: string,
  options: { commentLimit?: number; sort?: string } = {},
): Promise<Thread> {
  const commentLimit = Math.min(Math.max(options.commentLimit ?? 200, 1), 500);
  const payload = await client.get(`/comments/${postId(reference)}`, {
    limit: commentLimit,
    sort: options.sort ?? "top",
    depth: 6,
  });

  if (!Array.isArray(payload) || payload.length < 2) {
    throw new RedditError(
      `Reddit returned an unexpected shape for thread ${JSON.stringify(reference)}.`,
    );
  }

  const posts = listingChildren(payload[0], "t3");
  if (posts.length === 0 || !posts[0]) {
    throw new NotFound(`No post found for ${JSON.stringify(reference)}.`);
  }

  const thread = post(posts[0]);
  const comments = flattenComments(payload[1], { limit: commentLimit });
  comments.sort((a, b) => b.score - a.score);

  // Carry thread context onto each comment so a quote stays attributable after
  // it is lifted out of the thread it came from.
  for (const item of comments) {
    item.subreddit = thread.subreddit;
    item.threadTitle = thread.title;
    item.threadUrl = thread.permalink;
  }

  return { ...thread, comments, commentsRetrieved: comments.length };
}

// ------------------------------------------------------------------ ranking

export type RankInputs = {
  numComments: number;
  score: number;
  ageDays: number | null;
  recencyMultiplier: number;
};

export type RankedPost = Post & {
  discussionRankScore: number;
  rankInputs: RankInputs;
  rank: number;
};

/**
 * Rank by how much conversation a thread holds, not by how popular it is.
 *
 * A link post with 4,000 upvotes and 6 comments teaches you nothing about how
 * people talk. A 60 upvote thread with 300 comments is the whole point.
 *
 * So comment count drives the ranking outright and upvotes only break ties.
 * They are log scaled deliberately: upvote counts run an order of magnitude
 * above comment counts, so any linear weight on them, however small, quietly
 * turns this back into a popularity sort. Old threads are discounted a little
 * because the way people describe a problem moves.
 */
export function rankThreads(posts: Post[], limit = 8): RankedPost[] {
  const seen = new Set<string>();
  const ranked: Omit<RankedPost, "rank">[] = [];

  for (const item of posts) {
    const key = item.id ?? item.permalink ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const numComments = item.numComments ?? 0;
    const score = item.score ?? 0;
    const age = item.ageDays;

    let recency = 1.0;
    if (age !== null) {
      if (age > 1095) recency = 0.55;
      else if (age > 365) recency = 0.7;
      else if (age > 180) recency = 0.85;
    }

    const value = (numComments + 5 * Math.log10(Math.max(score, 0) + 1)) * recency;
    ranked.push({
      ...item,
      discussionRankScore: Math.round(value * 10) / 10,
      rankInputs: {
        numComments,
        score,
        ageDays: age === null ? null : Math.round(age * 10) / 10,
        recencyMultiplier: recency,
      },
    });
  }

  ranked.sort((a, b) => b.discussionRankScore - a.discussionRankScore);
  return ranked.slice(0, limit).map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// ----------------------------------------------------------------- pipeline

export type SearchedSubreddit = {
  subreddit: string;
  postsFound: number;
  skipped: string | null;
};

export type ResearchBundle = {
  topic: string;
  subredditsRequested: string[];
  subredditsDiscovered: DiscoveredSubreddit[];
  subredditsSearched: SearchedSubreddit[];
  sort: string;
  timeFilter: string;
  uniqueThreadsConsidered: number;
  threadsAnalyzed: number;
  commentsAnalyzed: number;
  failures: { title: string | null; url: string | null; error: string }[];
  threads: Thread[];
};

function describeFailure(error: unknown): string {
  if (error instanceof Forbidden) return "private or restricted";
  if (error instanceof NotFound) return "does not exist";
  return error instanceof Error ? error.message : String(error);
}

/**
 * Discover, search, rank, and harvest in one pass.
 *
 * Returns an evidence bundle: which communities were searched, which threads
 * won and why, and every comment from those threads with a permalink on it.
 */
export async function research(
  client: RedditClient,
  topic: string,
  options: {
    subreddits?: string[] | undefined;
    threads?: number;
    sort?: string;
    timeFilter?: string;
    commentLimit?: number;
    discoverLimit?: number;
  } = {},
): Promise<ResearchBundle> {
  const cleanTopic = (topic ?? "").trim();
  if (!cleanTopic) throw new Error("A topic is required.");

  const {
    threads = 8,
    sort = "relevance",
    timeFilter = "year",
    commentLimit = 200,
    discoverLimit = 5,
  } = options;

  let discovered: DiscoveredSubreddit[] = [];
  let targets = (options.subreddits ?? []).map(cleanSubreddit).filter(Boolean);
  if (targets.length === 0) {
    discovered = await findSubreddits(client, cleanTopic, discoverLimit);
    targets = discovered.map((s) => s.name).filter((n): n is string => Boolean(n));
  }

  const searched: SearchedSubreddit[] = [];
  let candidates: Post[] = [];

  if (targets.length > 0) {
    const results = await Promise.allSettled(
      targets.map((name) =>
        searchPosts(client, cleanTopic, { subreddit: name, sort, timeFilter, limit: 100 }),
      ),
    );
    results.forEach((result, index) => {
      const name = targets[index] ?? "unknown";
      if (result.status === "rejected") {
        searched.push({ subreddit: name, postsFound: 0, skipped: describeFailure(result.reason) });
        return;
      }
      searched.push({ subreddit: name, postsFound: result.value.length, skipped: null });
      candidates.push(...result.value);
    });
  } else {
    // Nothing to scope to, so search Reddit as a whole rather than fail.
    candidates = await searchPosts(client, cleanTopic, { sort, timeFilter, limit: 100 });
    searched.push({
      subreddit: "all of Reddit",
      postsFound: candidates.length,
      skipped: null,
    });
  }

  const selected = rankThreads(candidates, threads);
  const fetched = await Promise.allSettled(
    selected
      .filter((item) => item.id)
      .map((item) => getThread(client, item.id!, { commentLimit })),
  );

  const bundle: Thread[] = [];
  const failures: ResearchBundle["failures"] = [];
  fetched.forEach((result, index) => {
    const item = selected[index];
    if (result.status === "rejected") {
      failures.push({
        title: item?.title ?? null,
        url: item?.permalink ?? null,
        error: describeFailure(result.reason),
      });
      return;
    }
    bundle.push({
      ...result.value,
      rank: item?.rank,
      discussionRankScore: item?.discussionRankScore,
      rankInputs: item?.rankInputs,
    });
  });

  return {
    topic: cleanTopic,
    subredditsRequested: options.subreddits ?? [],
    subredditsDiscovered: discovered,
    subredditsSearched: searched,
    sort,
    timeFilter,
    uniqueThreadsConsidered: new Set(candidates.map((c) => c.id).filter(Boolean)).size,
    threadsAnalyzed: bundle.length,
    commentsAnalyzed: bundle.reduce((total, t) => total + t.commentsRetrieved, 0),
    failures,
    threads: bundle,
  };
}

/** Every comment in a research bundle as one flat list. */
export function allComments(bundle: ResearchBundle): Comment[] {
  return bundle.threads.flatMap((thread) => thread.comments);
}
