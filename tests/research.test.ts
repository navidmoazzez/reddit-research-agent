/** Ranking and id parsing. The ranking is the tool's editorial judgment. */

import { describe, expect, it } from "vitest";

import type { Post } from "../src/models.js";
import { cleanSubreddit, postId, rankThreads } from "../src/research.js";

function post(id: string, numComments: number, score: number, ageDays = 10): Post {
  return {
    id,
    fullname: `t3_${id}`,
    title: id,
    subreddit: "testsub",
    author: "someone",
    score,
    upvoteRatio: 0.9,
    numComments,
    createdAt: new Date().toISOString(),
    ageDays,
    flair: null,
    isSelf: true,
    over18: false,
    selftext: "",
    linkUrl: null,
    permalink: `https://www.reddit.com/r/testsub/comments/${id}/x/`,
  };
}

describe("postId", () => {
  it("reads an id out of a full URL", () => {
    expect(postId("https://www.reddit.com/r/python/comments/1abc23/some_title/")).toBe("1abc23");
  });

  it("accepts a fullname or a bare id", () => {
    expect(postId("t3_1abc23")).toBe("1abc23");
    expect(postId("1abc23")).toBe("1abc23");
  });

  it("refuses something that is not a reference", () => {
    expect(() => postId("not a reddit link")).toThrow(/Could not read a Reddit post id/);
  });
});

describe("cleanSubreddit", () => {
  it("strips the r/ prefix and slashes", () => {
    expect(cleanSubreddit("r/python")).toBe("python");
    expect(cleanSubreddit("/r/python/")).toBe("python");
    expect(cleanSubreddit("python")).toBe("python");
  });
});

describe("rankThreads", () => {
  it("puts a discussion thread above a viral link post", () => {
    // The whole reason this ranking exists. A 4,000 upvote post with 6 comments
    // teaches you nothing about how people talk.
    const [first] = rankThreads([post("viral", 6, 4000), post("discussion", 300, 60)]);
    expect(first?.id).toBe("discussion");
  });

  it("uses upvotes only to break ties between similar comment counts", () => {
    const ranked = rankThreads([post("quiet", 300, 10), post("busy", 300, 5000)]);
    expect(ranked[0]?.id).toBe("busy");
    // The gap stays small because upvotes are log scaled.
    const gap = (ranked[0]?.discussionRankScore ?? 0) - (ranked[1]?.discussionRankScore ?? 0);
    expect(gap).toBeLessThan(15);
  });

  it("discounts old threads", () => {
    const ranked = rankThreads([post("fresh", 300, 60, 10), post("ancient", 300, 60, 2000)]);
    expect(ranked[0]?.id).toBe("fresh");
    expect(ranked[1]?.rankInputs.recencyMultiplier).toBe(0.55);
  });

  it("deduplicates by post id", () => {
    expect(rankThreads([post("a", 10, 10), post("a", 10, 10)])).toHaveLength(1);
  });

  it("shows the numbers behind every position", () => {
    const [first] = rankThreads([post("a", 42, 100)]);
    expect(first?.rank).toBe(1);
    expect(first?.rankInputs.numComments).toBe(42);
    expect(first?.rankInputs.score).toBe(100);
  });

  it("respects the limit", () => {
    expect(rankThreads([post("a", 1, 1), post("b", 2, 2), post("c", 3, 3)], 2)).toHaveLength(2);
  });
});
