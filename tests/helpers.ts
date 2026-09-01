/**
 * Shared fixtures. Every test runs against mocked Reddit responses.
 *
 * Reddit blocks unauthenticated API traffic, so a suite that hit the live API
 * would only pass on a machine holding credentials. Mocking keeps the whole
 * pipeline verifiable anywhere, CI included.
 */

export function makePost(
  id: string,
  overrides: {
    title?: string;
    subreddit?: string;
    score?: number;
    numComments?: number;
    ageDays?: number;
    selftext?: string;
  } = {},
): Record<string, unknown> {
  const {
    title = "A thread",
    subreddit = "testsub",
    score = 10,
    numComments = 20,
    ageDays = 5,
    selftext = "",
  } = overrides;
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title,
      subreddit,
      author: "someone",
      score,
      num_comments: numComments,
      upvote_ratio: 0.9,
      created_utc: Date.now() / 1000 - ageDays * 86400,
      selftext,
      is_self: true,
      over_18: false,
      permalink: `/r/${subreddit}/comments/${id}/a_thread/`,
      url: `https://www.reddit.com/r/${subreddit}/comments/${id}/a_thread/`,
    },
  };
}

export function makeComment(
  id: string,
  body: string,
  overrides: { score?: number; subreddit?: string; author?: string; replies?: unknown } = {},
): Record<string, unknown> {
  const { score = 5, subreddit = "testsub", author = "redditor", replies = "" } = overrides;
  return {
    kind: "t1",
    data: {
      id,
      author,
      body,
      score,
      created_utc: Date.now() / 1000 - 86400,
      is_submitter: false,
      permalink: `/r/${subreddit}/comments/abc123/a_thread/${id}/`,
      replies,
    },
  };
}

export function listing(children: unknown[], after: string | null = null): Record<string, unknown> {
  return { kind: "Listing", data: { children, after } };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
