/**
 * The MCP server: tool definitions and their wiring.
 *
 * The surface is small on purpose. Wrapping every Reddit endpoint produces a
 * long table and a confused model, because five similar tools all look
 * plausible for the same question. What is here instead is one tool that runs
 * the whole research pipeline, one that turns its output into quotable
 * evidence, and a handful of narrower tools for steering manually.
 *
 * Every tool is read-only. There is no create, reply, edit, vote, or delete,
 * and no code path in this package that could add one.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { RedditClient } from "./client.js";
import { VERSION, loadConfig, type Config } from "./config.js";
import * as doctor from "./doctor.js";
import { comment, listingChildren, post, subreddit } from "./models.js";
import * as quotes from "./quotes.js";
import * as research from "./research.js";

const INSTRUCTIONS = `Reddit research, read-only. Nothing here can post, reply, vote, or delete.

The short version: call \`research_topic\` first. It works out which subreddits discuss the topic, ranks threads by how much real conversation they hold, pulls the comments, and hands back one evidence bundle. That single call replaces a dozen manual search-and-fetch turns.

Then call \`harvest_quotes\` on the same topic to get verbatim sentences already sorted into pain, desire, objection, comparison, recommendation, and question.

Three things that keep the output honest:

* Every post and comment carries a \`permalink\`. Quote nothing without it, and never build a Reddit URL by hand. If a claim has no permalink in the payload, it is not evidence yet.
* Quotes come back verbatim. Trim for length with an ellipsis if you must, but never paraphrase a quote and present it as one.
* Ranking is by discussion volume, not popularity, and \`rankInputs\` shows the numbers behind every position. One loud comment is not a pattern. Say when a finding rests on a single voice.

Reddit is a set of communities, not a survey panel. Findings describe the people who posted, and skew by subreddit. Report it that way.

Reddit's Responsible Builder Policy applies to everything read here: do not use it to train models without Reddit's written approval, do not resell it, and do not try to re-identify anyone.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): Result {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): Result {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, errorType: name }, null, 2) }],
    isError: true,
  };
}

const sortSchema = z
  .enum(research.SORTS)
  .default("relevance")
  .describe("Result ordering from Reddit's search.");
const timeSchema = z
  .enum(research.TIMES)
  .default("year")
  .describe("How far back to look.");

export function buildServer(config: Config = loadConfig()): McpServer {
  const client = new RedditClient(config);
  const server = new McpServer(
    { name: "reddit-research", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  const clampThreads = (n: number): number => Math.min(Math.max(n, 1), config.maxThreads);
  const clampComments = (n: number): number =>
    Math.min(Math.max(n, 1), config.maxCommentsPerThread);

  // ------------------------------------------------------------- pipeline

  server.registerTool(
    "research_topic",
    {
      title: "Research a topic on Reddit",
      description:
        "Run a full Reddit research pass and return the evidence. This is the tool to reach for first. " +
        "It discovers the relevant subreddits when none are given, searches each one, ranks results by how " +
        "much discussion they actually hold rather than by upvotes, then pulls comments from the winners. " +
        "Every item comes back with a permalink. Set includeComments false for a cheap overview of which " +
        "threads matter before committing context to reading them.",
      inputSchema: {
        topic: z.string().min(1).describe("What to research, e.g. 'creatine timing'."),
        subreddits: z
          .array(z.string())
          .optional()
          .describe("Specific communities to search. Omit to discover them automatically."),
        threads: z.number().int().default(8).describe("How many threads to pull comments from."),
        sort: sortSchema,
        timeFilter: timeSchema,
        commentLimit: z.number().int().default(150).describe("Maximum comments per thread."),
        includeComments: z
          .boolean()
          .default(true)
          .describe("Set false to get thread rankings without the comment bodies."),
      },
      annotations: { title: "Research a topic on Reddit", ...READ_ONLY },
    },
    async (args) => {
      try {
        const bundle = await research.research(client, args.topic, {
          subreddits: args.subreddits,
          threads: clampThreads(args.threads),
          sort: args.sort,
          timeFilter: args.timeFilter,
          commentLimit: clampComments(args.commentLimit),
        });
        if (args.includeComments) return ok(bundle);
        return ok({
          ...bundle,
          threads: bundle.threads.map(({ comments: _comments, ...rest }) => rest),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "harvest_quotes",
    {
      title: "Harvest quotable customer language",
      description:
        "Research a topic and return only the quotable sentences, tagged by intent. Use this when the goal " +
        "is customer language: the exact words people use about a problem, a want, or an objection. Results " +
        "are verbatim and each carries the permalink of the comment it came from, so every line can be cited. " +
        "Intents are pain, desire, objection, comparison, recommendation, and question.",
      inputSchema: {
        topic: z.string().min(1).describe("What to research."),
        subreddits: z.array(z.string()).optional().describe("Specific communities. Omit to discover."),
        intents: z
          .array(z.enum(quotes.INTENTS))
          .optional()
          .describe("Only return these intents. Omit for all six."),
        keyword: z.string().optional().describe("Only keep quotes that also contain this word."),
        threads: z.number().int().default(8).describe("How many threads to mine."),
        timeFilter: timeSchema,
        minScore: z
          .number()
          .int()
          .default(2)
          .describe("Ignore comments below this upvote count. Lower it to surface criticism, which gets downvoted."),
        limit: z.number().int().default(60).describe("Maximum quotes to return."),
      },
      annotations: { title: "Harvest quotable customer language", ...READ_ONLY },
    },
    async (args) => {
      try {
        const bundle = await research.research(client, args.topic, {
          subreddits: args.subreddits,
          threads: clampThreads(args.threads),
          timeFilter: args.timeFilter,
          commentLimit: config.maxCommentsPerThread,
        });
        const found = quotes.harvest(research.allComments(bundle), {
          intents: args.intents,
          keyword: args.keyword,
          minScore: args.minScore,
          limit: args.limit,
        });
        return ok({
          topic: args.topic,
          subredditsSearched: bundle.subredditsSearched,
          threadsAnalyzed: bundle.threadsAnalyzed,
          commentsAnalyzed: bundle.commentsAnalyzed,
          quotesFound: found.length,
          intentCounts: quotes.intentCounts(found),
          note:
            "Quotes are verbatim and pattern-matched, not interpreted. Judge which " +
            "of these are real patterns and which are one loud voice.",
          quotes: found,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "track_mentions",
    {
      title: "Track mentions of a brand or product",
      description:
        "Find where and how a brand, product, or phrase is being mentioned. Returns matching posts with " +
        "permalinks, plus a breakdown of which communities they came from. Use it to see who is talking " +
        "about something and where, before deciding which threads to read in full.",
      inputSchema: {
        term: z.string().min(1).describe("The brand, product, or phrase to track."),
        subreddits: z
          .array(z.string())
          .optional()
          .describe("Limit to these communities. Omit to search all of Reddit."),
        timeFilter: timeSchema.default("month"),
        limit: z.number().int().default(50).describe("Maximum posts to return."),
      },
      annotations: { title: "Track mentions of a brand or product", ...READ_ONLY },
    },
    async (args) => {
      try {
        const targets = (args.subreddits ?? []).map(research.cleanSubreddit).filter(Boolean);
        let found: Awaited<ReturnType<typeof research.searchPosts>> = [];

        if (targets.length > 0) {
          const results = await Promise.allSettled(
            targets.map((name) =>
              research.searchPosts(client, args.term, {
                subreddit: name,
                sort: "new",
                timeFilter: args.timeFilter,
                limit: 100,
              }),
            ),
          );
          // One dead subreddit must not kill the run.
          for (const result of results) {
            if (result.status === "fulfilled") found.push(...result.value);
          }
        } else {
          found = await research.searchPosts(client, args.term, {
            sort: "new",
            timeFilter: args.timeFilter,
            limit: 100,
          });
        }

        const bySubreddit: Record<string, number> = {};
        for (const item of found) {
          const name = item.subreddit ?? "unknown";
          bySubreddit[name] = (bySubreddit[name] ?? 0) + 1;
        }

        found.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
        return ok({
          term: args.term,
          timeFilter: args.timeFilter,
          mentionsFound: found.length,
          bySubreddit: Object.fromEntries(
            Object.entries(bySubreddit).sort((a, b) => b[1] - a[1]),
          ),
          mentions: found.slice(0, args.limit),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "compare_terms",
    {
      title: "Compare discussion volume across terms",
      description:
        "Compare how much Reddit discussion several terms attract. Returns post counts, total comments and " +
        "total upvotes per term, plus each term's share of the group. This measures volume of conversation " +
        "and nothing else. It is not sentiment, and it is not market share.",
      inputSchema: {
        terms: z.array(z.string()).min(2).describe("Two or more terms to compare."),
        subreddit: z.string().optional().describe("Scope to one community. Omit for all of Reddit."),
        timeFilter: timeSchema,
      },
      annotations: { title: "Compare discussion volume across terms", ...READ_ONLY },
    },
    async (args) => {
      try {
        const rows = [];
        for (const term of args.terms) {
          const posts = await research.searchPosts(client, term, {
            subreddit: args.subreddit,
            sort: "relevance",
            timeFilter: args.timeFilter,
            limit: 100,
          });
          const topPost = posts.reduce<(typeof posts)[number] | null>(
            (best, p) => (best === null || p.numComments > best.numComments ? p : best),
            null,
          );
          rows.push({
            term,
            posts: posts.length,
            totalComments: posts.reduce((t, p) => t + p.numComments, 0),
            totalScore: posts.reduce((t, p) => t + p.score, 0),
            topPost: topPost?.permalink ?? null,
          });
        }
        const total = rows.reduce((t, r) => t + r.totalComments, 0) || 1;
        for (const row of rows) {
          Object.assign(row, {
            shareOfDiscussion: Math.round((1000 * row.totalComments) / total) / 10,
          });
        }
        rows.sort((a, b) => b.totalComments - a.totalComments);
        return ok({
          subreddit: args.subreddit ?? "all of Reddit",
          timeFilter: args.timeFilter,
          caveat:
            "Search returns at most 100 posts per term, so counts are capped and " +
            "read as relative, not absolute.",
          results: rows,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // --------------------------------------------------------------- pieces

  server.registerTool(
    "find_subreddits",
    {
      title: "Find relevant subreddits",
      description:
        "Find the communities where a topic is actually discussed. Merges Reddit's own subreddit search with " +
        "the communities that recent posts about the topic came from, which surfaces places that never " +
        "mention the topic in their name.",
      inputSchema: {
        topic: z.string().min(1).describe("The subject to find communities for."),
        limit: z.number().int().default(10).describe("Maximum subreddits to return."),
      },
      annotations: { title: "Find relevant subreddits", ...READ_ONLY },
    },
    async (args) => {
      try {
        return ok({
          topic: args.topic,
          subreddits: await research.findSubreddits(client, args.topic, args.limit),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "search_reddit",
    {
      title: "Search Reddit posts",
      description:
        "Search Reddit posts, optionally inside one subreddit. By default results are re-ranked so the most " +
        "discussed threads come first rather than the most upvoted, which is usually what research wants.",
      inputSchema: {
        query: z.string().min(1).describe("What to search for."),
        subreddit: z.string().optional().describe("Restrict to this community."),
        sort: sortSchema,
        timeFilter: timeSchema,
        limit: z.number().int().default(25).describe("Maximum posts to return."),
        rankByDiscussion: z
          .boolean()
          .default(true)
          .describe("Re-rank so the most discussed threads come first."),
      },
      annotations: { title: "Search Reddit posts", ...READ_ONLY },
    },
    async (args) => {
      try {
        const posts = await research.searchPosts(client, args.query, {
          subreddit: args.subreddit,
          sort: args.sort,
          timeFilter: args.timeFilter,
          limit: 100,
        });
        return ok({
          query: args.query,
          subreddit: args.subreddit ?? "all of Reddit",
          posts: args.rankByDiscussion
            ? research.rankThreads(posts, args.limit)
            : posts.slice(0, args.limit),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "browse_subreddit",
    {
      title: "Browse a subreddit",
      description: "List posts from one subreddit by hot, new, top, rising, or controversial.",
      inputSchema: {
        subreddit: z.string().min(1).describe("Community name, with or without the r/ prefix."),
        listing: z.enum(research.LISTINGS).default("hot").describe("Which listing to read."),
        timeFilter: timeSchema.default("week").describe("For top and controversial only."),
        limit: z.number().int().default(25).describe("Maximum posts to return."),
      },
      annotations: { title: "Browse a subreddit", ...READ_ONLY },
    },
    async (args) => {
      try {
        return ok({
          subreddit: args.subreddit,
          listing: args.listing,
          posts: await research.browse(client, args.subreddit, {
            listing: args.listing,
            timeFilter: args.timeFilter,
            limit: args.limit,
          }),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_thread",
    {
      title: "Read one thread in full",
      description:
        "Read one thread in full: the post and its comments, flattened and sorted by score, each with a " +
        "permalink. Accepts a Reddit URL, a permalink, or a post id.",
      inputSchema: {
        reference: z.string().min(1).describe("A Reddit post URL, permalink, or post id."),
        commentLimit: z.number().int().default(200).describe("Maximum comments to return."),
        sort: z
          .enum(["top", "best", "new", "controversial", "old", "qa"])
          .default("top")
          .describe("Comment ordering."),
      },
      annotations: { title: "Read one thread in full", ...READ_ONLY },
    },
    async (args) => {
      try {
        return ok(
          await research.getThread(client, args.reference, {
            commentLimit: clampComments(args.commentLimit),
            sort: args.sort,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_subreddit_info",
    {
      title: "Get subreddit info",
      description:
        "Size, age, activity, and description of one community. Use it to weigh a finding: ten complaints in " +
        "a 2,000 member subreddit mean something different from ten in a two million member one.",
      inputSchema: {
        subreddit: z.string().min(1).describe("Community name, with or without the r/ prefix."),
      },
      annotations: { title: "Get subreddit info", ...READ_ONLY },
    },
    async (args) => {
      try {
        const payload = await client.get(
          `/r/${research.cleanSubreddit(args.subreddit)}/about`,
        );
        return ok(subreddit(payload as Record<string, unknown>));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_subreddit_rules",
    {
      title: "Get subreddit rules",
      description:
        "The posting rules of a community. Read these before suggesting the user post anything anywhere. " +
        "Most subreddits ban self-promotion outright.",
      inputSchema: {
        subreddit: z.string().min(1).describe("Community name, with or without the r/ prefix."),
      },
      annotations: { title: "Get subreddit rules", ...READ_ONLY },
    },
    async (args) => {
      try {
        const payload = (await client.get(
          `/r/${research.cleanSubreddit(args.subreddit)}/about/rules`,
        )) as { rules?: Record<string, unknown>[] };
        return ok({
          subreddit: args.subreddit,
          rules: (payload.rules ?? []).map((rule) => ({
            shortName: rule["short_name"] ?? null,
            description: String(rule["description"] ?? "").trim(),
            appliesTo: rule["kind"] ?? null,
          })),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_user_activity",
    {
      title: "Get a redditor's public history",
      description:
        "A redditor's recent public posts and comments. Use it to weigh a source: someone who only ever " +
        "posts about one brand reads differently from someone with five years of unrelated history.",
      inputSchema: {
        username: z.string().min(1).describe("Reddit username, without the u/ prefix."),
        limit: z.number().int().default(25).describe("Maximum items to return."),
      },
      annotations: { title: "Get a redditor's public history", ...READ_ONLY },
    },
    async (args) => {
      try {
        const name = args.username.trim().replace(/^\/+/, "").replace(/^u\//i, "").replace(/\/+$/, "");
        const payload = await client.get(`/user/${name}/overview`, {
          limit: Math.min(Math.max(args.limit, 1), 100),
        });

        const items: Record<string, unknown>[] = [];
        for (const child of listingChildren(payload)) {
          if (child["kind"] === "t3") {
            items.push({ ...post(child), type: "post" });
          } else if (child["kind"] === "t1") {
            const parsed = comment(child);
            if (parsed) {
              const inner = child["data"] as Record<string, unknown> | undefined;
              items.push({ ...parsed, type: "comment", subreddit: inner?.["subreddit"] ?? null });
            }
          }
        }

        const activeIn: Record<string, number> = {};
        for (const item of items) {
          const sub = String(item["subreddit"] ?? "unknown");
          activeIn[sub] = (activeIn[sub] ?? 0) + 1;
        }
        return ok({ username: name, activeIn, items });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "server_status",
    {
      title: "Check server status",
      description:
        "Check configuration, auth mode, and whether Reddit is answering. Run this first when anything looks " +
        "broken. It reports which auth mode is in use, whether credentials were accepted, and the result of " +
        "one live request to Reddit.",
      inputSchema: {},
      annotations: { title: "Check server status", ...READ_ONLY },
    },
    async () => {
      try {
        return ok(await doctor.run(config, client));
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
