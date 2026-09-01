/** Normalization. The permalink rule lives here, so it is tested here. */

import { describe, expect, it } from "vitest";

import { absolute, comment, flattenComments, listingChildren, post } from "../src/models.js";
import { listing, makeComment, makePost } from "./helpers.js";

describe("absolute", () => {
  it("expands a relative permalink", () => {
    expect(absolute("/r/x/comments/a/b/")).toBe("https://www.reddit.com/r/x/comments/a/b/");
  });

  it("leaves an absolute URL alone", () => {
    expect(absolute("https://www.reddit.com/r/x/")).toBe("https://www.reddit.com/r/x/");
  });

  it("returns null for nothing", () => {
    expect(absolute(null)).toBeNull();
    expect(absolute("")).toBeNull();
  });
});

describe("post", () => {
  it("always carries a clickable permalink", () => {
    expect(post(makePost("abc")).permalink).toMatch(/^https:\/\/www\.reddit\.com\//);
  });

  it("reports age in days", () => {
    const parsed = post(makePost("abc", { ageDays: 30 }));
    expect(parsed.ageDays).toBeGreaterThan(29);
    expect(parsed.ageDays).toBeLessThan(31);
  });
});

describe("comment", () => {
  it("drops deleted and removed bodies", () => {
    expect(comment(makeComment("c1", "[deleted]"))).toBeNull();
    expect(comment(makeComment("c1", "[removed]"))).toBeNull();
    expect(comment(makeComment("c1", "   "))).toBeNull();
  });

  it("drops AutoModerator, which is never evidence", () => {
    expect(comment(makeComment("c1", "Please read the rules", { author: "AutoModerator" }))).toBeNull();
  });

  it("keeps a real comment with its permalink", () => {
    const parsed = comment(makeComment("c1", "This is a real opinion"));
    expect(parsed?.body).toBe("This is a real opinion");
    expect(parsed?.permalink).toMatch(/^https:\/\/www\.reddit\.com\//);
  });
});

describe("flattenComments", () => {
  it("flattens nested replies and records depth", () => {
    const tree = listing([
      makeComment("top", "Top level opinion", {
        replies: listing([makeComment("reply", "A nested reply")]),
      }),
    ]);
    const flat = flattenComments(tree);
    expect(flat.map((c) => c.body)).toEqual(["Top level opinion", "A nested reply"]);
    expect(flat[1]?.depth).toBe(1);
  });

  it("skips 'more' continuation markers", () => {
    const tree = listing([{ kind: "more", data: { count: 42 } }, makeComment("c1", "Real text")]);
    expect(flattenComments(tree)).toHaveLength(1);
  });

  it("respects the limit", () => {
    const tree = listing([
      makeComment("a", "One"),
      makeComment("b", "Two"),
      makeComment("c", "Three"),
    ]);
    expect(flattenComments(tree, { limit: 2 })).toHaveLength(2);
  });

  it("returns nothing for junk input", () => {
    expect(flattenComments(null)).toEqual([]);
    expect(flattenComments("nope")).toEqual([]);
  });
});

describe("listingChildren", () => {
  it("filters by kind", () => {
    const payload = listing([makePost("a"), makeComment("c", "text")]);
    expect(listingChildren(payload, "t3")).toHaveLength(1);
    expect(listingChildren(payload)).toHaveLength(2);
  });
});
