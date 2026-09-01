/** The intent miner. This is where a research tool earns or loses trust. */

import { describe, expect, it } from "vitest";

import type { Comment } from "../src/models.js";
import { classify, harvest, intentCounts, sentences } from "../src/quotes.js";

function comment(body: string, score = 10, extra: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    author: "redditor",
    body,
    score,
    depth: 0,
    createdAt: null,
    isOp: false,
    permalink: "https://www.reddit.com/r/testsub/comments/a/b/c/",
    subreddit: "testsub",
    ...extra,
  };
}

describe("sentences", () => {
  it("splits on line breaks as well as punctuation", () => {
    // Reddit comments are full of lines that are sentences without a period.
    expect(sentences("I hate the wobble\nI wish it had a crossbar")).toHaveLength(2);
  });

  it("drops lines quoting someone else", () => {
    // Lifting a > line would attribute a stranger's words to the quoter.
    const found = sentences("> I wish it were cheaper\nHonestly it is too expensive for what it is");
    expect(found.some((s) => s.includes("I wish it were cheaper"))).toBe(false);
    expect(found.some((s) => s.includes("too expensive"))).toBe(true);
  });

  it("strips bare URLs but keeps the sentence", () => {
    const [first] = sentences("This is a total waste of money see https://example.com/proof ok");
    expect(first).not.toContain("https://example.com");
    expect(first).toContain("waste of money");
  });
});

describe("classify", () => {
  it("recognizes each intent", () => {
    expect(classify("I really hate how it wobbles")).toContain("pain");
    expect(classify("I wish there was a cheaper version")).toContain("desire");
    expect(classify("Way too expensive for what you get")).toContain("objection");
    expect(classify("I switched from the other brand last year")).toContain("comparison");
    expect(classify("Honestly it worked great for me")).toContain("recommendation");
    expect(classify("Does anyone know if this fits a standard desk")).toContain("question");
  });

  it("returns nothing for ordinary text", () => {
    expect(classify("The weather in Portland was fine that week")).toEqual([]);
  });
});

describe("harvest", () => {
  const PAIN = "I really hate how much it wobbles at standing height";

  it("returns quotes verbatim", () => {
    expect(harvest([comment(PAIN)])[0]?.quote).toBe(PAIN);
  });

  it("deduplicates near-identical quotes", () => {
    const found = harvest([comment(PAIN), comment(`${PAIN}!`), comment(PAIN.toUpperCase())]);
    expect(found).toHaveLength(1);
  });

  it("respects the score floor", () => {
    expect(harvest([comment(PAIN, 1)], { minScore: 5 })).toEqual([]);
    expect(harvest([comment(PAIN, 9)], { minScore: 5 })).toHaveLength(1);
  });

  it("filters by intent", () => {
    const found = harvest(
      [comment(PAIN), comment("I wish there was a version with a proper crossbar on it")],
      { intents: ["desire"] },
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.intents).toEqual(["desire"]);
  });

  it("filters by keyword", () => {
    const found = harvest(
      [
        comment("I really hate how much the desk wobbles at standing height"),
        comment("I really hate how much the chair squeaks when I lean back"),
      ],
      { keyword: "desk" },
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.quote).toContain("desk");
  });

  it("carries a permalink on every quote", () => {
    expect(harvest([comment(PAIN)])[0]?.permalink).toMatch(/^https:\/\/www\.reddit\.com\//);
  });

  it("ranks by upvotes alone", () => {
    // Anything cleverer would be the tool deciding what the findings are.
    const found = harvest([
      comment(PAIN, 3),
      comment("I really hate that the motor died after eight months of use", 99),
    ]);
    expect(found[0]?.score).toBe(99);
  });

  it("ignores sentences that are too short or too long", () => {
    expect(harvest([comment("I wish")])).toEqual([]);
    expect(harvest([comment(`I wish ${"x".repeat(400)}`)])).toEqual([]);
  });

  it("counts only intents that appeared", () => {
    expect(intentCounts(harvest([comment(PAIN)]))).toEqual({ pain: 1 });
  });
});
