/**
 * Normalize Reddit's raw JSON into flat shapes with a real URL on every item.
 *
 * The single rule this module exists to enforce: nothing leaves here without a
 * `permalink` that resolves to the exact post or comment on reddit.com. A quote
 * without a link back is an unverifiable claim, and an agent producing those at
 * scale is worse than no research at all.
 */

export const REDDIT = "https://www.reddit.com";

const DELETED = new Set(["[deleted]", "[removed]", ""]);
/** AutoModerator posts boilerplate on almost every thread. It is never evidence. */
const BOTS = new Set(["AutoModerator"]);

export type Post = {
  id: string | null;
  fullname: string | null;
  title: string | null;
  subreddit: string | null;
  author: string | null;
  score: number;
  upvoteRatio: number | null;
  numComments: number;
  createdAt: string | null;
  ageDays: number | null;
  flair: string | null;
  isSelf: boolean;
  over18: boolean;
  selftext: string;
  linkUrl: string | null;
  permalink: string | null;
};

export type Comment = {
  id: string | null;
  author: string | null;
  body: string;
  score: number;
  depth: number;
  createdAt: string | null;
  isOp: boolean;
  permalink: string | null;
  subreddit?: string | null;
  threadTitle?: string | null;
  threadUrl?: string | null;
};

export type Subreddit = {
  name: string | null;
  title: string | null;
  subscribers: number;
  activeUsers: number | null;
  createdAt: string | null;
  over18: boolean;
  description: string;
  url: string | null;
};

type Raw = Record<string, unknown>;

function data(raw: Raw): Raw {
  const inner = raw["data"];
  return (inner && typeof inner === "object" ? inner : raw) as Raw;
}

function s(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function n(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Turn Reddit's relative permalink into a URL a person can click. */
export function absolute(permalink: unknown): string | null {
  const value = s(permalink);
  if (!value) return null;
  return value.startsWith("http") ? value : `${REDDIT}${value}`;
}

export function iso(createdUtc: unknown): string | null {
  const seconds = typeof createdUtc === "number" ? createdUtc : Number(createdUtc);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export function ageDays(createdUtc: unknown, now = Date.now()): number | null {
  const seconds = typeof createdUtc === "number" ? createdUtc : Number(createdUtc);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return (now - seconds * 1000) / 86_400_000;
}

/** One t3 (submission) as a flat object. */
export function post(raw: Raw): Post {
  const d = data(raw);
  return {
    id: s(d["id"]),
    fullname: s(d["name"]),
    title: s(d["title"]),
    subreddit: s(d["subreddit"]),
    author: s(d["author"]),
    score: n(d["score"]),
    upvoteRatio: typeof d["upvote_ratio"] === "number" ? d["upvote_ratio"] : null,
    numComments: n(d["num_comments"]),
    createdAt: iso(d["created_utc"]),
    ageDays: ageDays(d["created_utc"]),
    flair: s(d["link_flair_text"]),
    isSelf: Boolean(d["is_self"]),
    over18: Boolean(d["over_18"]),
    selftext: (s(d["selftext"]) ?? "").trim(),
    linkUrl: s(d["url_overridden_by_dest"]) ?? s(d["url"]),
    permalink: absolute(d["permalink"]),
  };
}

/** One t1 (comment) as a flat object, or null if it carries no usable text. */
export function comment(raw: Raw, depth = 0): Comment | null {
  const d = data(raw);
  const body = (s(d["body"]) ?? "").trim();
  if (DELETED.has(body)) return null;
  const author = s(d["author"]);
  if (author && BOTS.has(author)) return null;
  return {
    id: s(d["id"]),
    author,
    body,
    score: n(d["score"]),
    depth: n(d["depth"], depth),
    createdAt: iso(d["created_utc"]),
    isOp: Boolean(d["is_submitter"]),
    permalink: absolute(d["permalink"]),
  };
}

/**
 * Walk a comment tree into one flat, scored list.
 *
 * Nesting matters to a reader and not to a researcher. What matters is the
 * text, its score, and where it came from, so replies are flattened with their
 * depth recorded rather than kept as a tree the caller has to walk.
 */
export function flattenComments(
  listing: unknown,
  options: { depth?: number; limit?: number; out?: Comment[] } = {},
): Comment[] {
  const { depth = 0, limit = 400 } = options;
  const out = options.out ?? [];
  if (out.length >= limit) return out;

  let children: unknown[] = [];
  if (Array.isArray(listing)) {
    children = listing;
  } else if (listing && typeof listing === "object") {
    const inner = data(listing as Raw)["children"];
    if (Array.isArray(inner)) children = inner;
  }

  for (const child of children) {
    if (out.length >= limit) break;
    if (!child || typeof child !== "object") continue;
    const node = child as Raw;
    // "more" nodes are Reddit's continuation markers, not content.
    if (node["kind"] === "more") continue;

    const parsed = comment(node, depth);
    if (parsed) out.push(parsed);

    const replies = data(node)["replies"];
    if (replies && typeof replies === "object") {
      flattenComments(replies, { depth: depth + 1, limit, out });
    }
  }
  return out;
}

export function subreddit(raw: Raw): Subreddit {
  const d = data(raw);
  return {
    name: s(d["display_name"]),
    title: s(d["title"]),
    subscribers: n(d["subscribers"]),
    activeUsers: typeof d["active_user_count"] === "number" ? d["active_user_count"] : null,
    createdAt: iso(d["created_utc"]),
    over18: Boolean(d["over18"]),
    description: (s(d["public_description"]) ?? "").trim(),
    url: absolute(d["url"]),
  };
}

/** Pull the children out of a Listing, optionally filtered by kind. */
export function listingChildren(payload: unknown, kind?: string): Raw[] {
  if (!payload || typeof payload !== "object") return [];
  const children = data(payload as Raw)["children"];
  if (!Array.isArray(children)) return [];
  const objects = children.filter((c): c is Raw => Boolean(c) && typeof c === "object");
  return kind ? objects.filter((c) => c["kind"] === kind) : objects;
}
