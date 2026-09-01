/**
 * The pipeline end to end, against a mocked Reddit.
 *
 * This is the test that matters most: it proves discovery, ranking, comment
 * harvesting and quote extraction compose into an evidence bundle where every
 * quote still points at a real comment.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { RedditClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { harvest } from "../src/quotes.js";
import { allComments, research } from "../src/research.js";
import { jsonResponse, listing, makeComment, makePost } from "./helpers.js";

function client() {
  return new RedditClient(
    loadConfig({
      clientId: "id",
      clientSecret: "secret",
      cacheTtlMs: 0,
      maxRetries: 1,
      minRequestIntervalMs: 0,
    }),
  );
}

/** Route a mocked fetch by URL, so the pipeline drives its own sequence. */
function route(url: string): Response {
  if (url.includes("access_token")) {
    return jsonResponse({ access_token: "tok", expires_in: 3600 });
  }
  if (url.includes("/subreddits/search")) {
    return jsonResponse(
      listing([
        { kind: "t5", data: { display_name: "ergonomics", subscribers: 50_000, url: "/r/ergonomics/" } },
      ]),
    );
  }
  if (url.includes("/r/ergonomics/search")) {
    return jsonResponse(
      listing([
        makePost("viral", { subreddit: "ergonomics", numComments: 4, score: 9000 }),
        makePost("talky", { subreddit: "ergonomics", numComments: 250, score: 80 }),
      ]),
    );
  }
  if (url.includes("/search")) {
    return jsonResponse(listing([makePost("p1", { subreddit: "ergonomics" })]));
  }
  if (url.includes("/comments/")) {
    return jsonResponse([
      listing([makePost("talky", { subreddit: "ergonomics", numComments: 250 })]),
      listing([
        makeComment("c1", "I really hate how much it wobbles at standing height", { score: 312 }),
        makeComment("c2", "Honestly it is too expensive for what you actually get", { score: 88 }),
        makeComment("c3", "[deleted]", { score: 5 }),
        makeComment("c4", "Reminder to read the sidebar", { score: 1, author: "AutoModerator" }),
      ]),
    ]);
  }
  return jsonResponse(listing([]));
}

afterEach(() => vi.restoreAllMocks());

describe("research pipeline", () => {
  it("discovers subreddits, ranks by discussion, and pulls comments", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => route(String(url)));

    const bundle = await research(client(), "standing desk wobble");

    expect(bundle.subredditsDiscovered.map((s) => s.name)).toContain("ergonomics");
    expect(bundle.subredditsSearched[0]?.skipped).toBeNull();
    // The 250-comment thread must outrank the 9,000 upvote link post.
    expect(bundle.threads[0]?.id).toBe("talky");
    expect(bundle.threads[0]?.rank).toBe(1);
    expect(bundle.commentsAnalyzed).toBeGreaterThan(0);
  });

  it("drops deleted comments and AutoModerator from the evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => route(String(url)));
    const bundle = await research(client(), "standing desk wobble");
    const bodies = allComments(bundle).map((c) => c.body);
    expect(bodies).not.toContain("[deleted]");
    expect(bodies.some((b) => b.includes("sidebar"))).toBe(false);
  });

  it("produces quotes that each point at a real comment", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => route(String(url)));
    const bundle = await research(client(), "standing desk wobble");
    const found = harvest(allComments(bundle), { minScore: 1 });

    expect(found.length).toBeGreaterThan(0);
    for (const quote of found) {
      expect(quote.permalink).toMatch(/^https:\/\/www\.reddit\.com\//);
      // Verbatim: the quote must appear in a comment we actually fetched.
      expect(allComments(bundle).some((c) => c.body.includes(quote.quote))).toBe(true);
    }
    expect(found.map((q) => q.intents.join())).toContain("pain");
  });

  it("records a skipped subreddit instead of failing the whole run", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("access_token")) return route(target);
      if (target.includes("/r/private/search")) return jsonResponse({}, 403);
      return route(target);
    });

    const bundle = await research(client(), "standing desk wobble", {
      subreddits: ["ergonomics", "private"],
    });

    const skipped = bundle.subredditsSearched.find((s) => s.subreddit === "private");
    expect(skipped?.skipped).toBe("private or restricted");
    // The healthy subreddit still produced results.
    expect(bundle.threadsAnalyzed).toBeGreaterThan(0);
  });

  it("refuses an empty topic", async () => {
    await expect(research(client(), "   ")).rejects.toThrow(/topic is required/);
  });
});
