/**
 * Turn a pile of comments into quotable evidence, sorted by intent.
 *
 * This is what separates a research tool from an API wrapper. Handing a model
 * 400 raw comments and asking for pain points burns context and produces
 * paraphrase. Handing it 40 verbatim sentences, each already tagged with the
 * intent it expresses and carrying the URL of the comment it came from,
 * produces citations.
 *
 * Pattern matching finds candidates. It never decides what they mean. Judging
 * significance is the model's job, and the ranking here is deliberately shallow
 * so it cannot quietly become an opinion.
 */

import type { Comment } from "./models.js";

export const INTENTS = [
  "pain",
  "desire",
  "objection",
  "comparison",
  "recommendation",
  "question",
] as const;

export type Intent = (typeof INTENTS)[number];

/**
 * Deliberately literal and boring: these are phrasings people actually type,
 * not a sentiment model. Each is matched case-insensitively against one
 * sentence.
 */
const PATTERNS: Record<Intent, RegExp[]> = {
  pain: [
    /\bi (?:really )?hate\b/i,
    /\bi can'?t (?:stand|get|figure|find)\b/i,
    /\bdoesn'?t (?:work|help|do anything)\b/i,
    /\bnever worked\b/i,
    /\bthe (?:worst|problem|issue) (?:is|with|part)\b/i,
    /\bso (?:frustrating|annoying|painful|tedious)\b/i,
    /\bstruggl(?:e|ing) with\b/i,
    /\bgave up on\b/i,
    /\bdrives me (?:crazy|nuts|insane)\b/i,
    /\bwaste of (?:time|my time)\b/i,
    /\bpain in the\b/i,
    /\bkeeps? (?:breaking|failing|crashing)\b/i,
  ],
  desire: [
    /\bi (?:really )?wish\b/i,
    /\bi just want\b/i,
    /\bwhat i(?:'m| am)? looking for\b/i,
    /\blooking for (?:a|an|something|someone)\b/i,
    /\bi'?d love\b/i,
    /\bif only (?:there|it|they)\b/i,
    /\bneed something that\b/i,
    /\bis there (?:a|an|any)\w*\s?\w* that\b/i,
    /\bwould be (?:amazing|great|perfect) if\b/i,
    /\bmy dream\b/i,
  ],
  objection: [
    /\btoo expensive\b/i,
    /\bnot worth (?:it|the)\b/i,
    /\b(?:i'?m |very |pretty )?skeptical\b/i,
    /\bsounds like a scam\b/i,
    /\bit'?s a scam\b/i,
    /\boverpriced\b/i,
    /\bdon'?t trust\b/i,
    /\bgot burned\b/i,
    /\bwaste of money\b/i,
    /\b(?:total |complete |pure )?gimmick\b/i,
    /\bsnake oil\b/i,
    /\bmarketing hype\b/i,
    /\bno evidence\b/i,
    /\bplacebo\b/i,
  ],
  comparison: [
    /\bbetter than\b/i,
    /\bworse than\b/i,
    /\bswitched (?:from|to)\b/i,
    /\bi used to use\b/i,
    /\bcompared to\b/i,
    /\binstead of\b/i,
    /\bvs\.? \w+/i,
    /\bmoved (?:from|off) \w+/i,
  ],
  recommendation: [
    /\b(?:highly |strongly |can'?t )?recommend\b/i,
    /\bworked (?:great |really well |wonders )?for me\b/i,
    /\bgame ?changer\b/i,
    /\bchanged my life\b/i,
    /\bcan'?t live without\b/i,
    /\bbest (?:decision|purchase|thing i)\b/i,
    /\bworth every (?:penny|cent|dollar)\b/i,
  ],
  question: [
    /^\s*(?:how (?:do|does|can|would) (?:i|you)|what'?s the best|anyone (?:know|else|tried)|does anyone|has anyone|which \w+ (?:should|do))\b/i,
    /\bam i the only one\b/i,
  ],
};

/**
 * Split on sentence enders and hard line breaks. Reddit comments are full of
 * single-line fragments that are sentences in every way except punctuation.
 */
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
const URL = /https?:\/\/\S+/g;
/** A line starting with > is someone else's words, quoted. */
const QUOTE_BLOCK = /^\s*(?:&gt;|>)/;
const WHITESPACE = /\s+/g;

export const MIN_QUOTE_CHARS = 25;
export const MAX_QUOTE_CHARS = 320;

export type Quote = {
  quote: string;
  intents: Intent[];
  score: number;
  author: string | null;
  subreddit: string | null;
  threadTitle: string | null;
  isOp: boolean;
  createdAt: string | null;
  permalink: string | null;
};

/**
 * Split a comment body into candidate sentences.
 *
 * Lines that are themselves Reddit quotes of someone else are dropped. Lifting
 * those attributes a stranger's words to the person who quoted them.
 */
export function sentences(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\n+/)) {
    if (QUOTE_BLOCK.test(line)) continue;
    for (const chunk of line.split(SENTENCE_SPLIT)) {
      const text = chunk.replace(URL, "").replace(WHITESPACE, " ").trim();
      if (text) out.push(text);
    }
  }
  return out;
}

/** Every intent this sentence expresses. Often none, sometimes several. */
export function classify(sentence: string): Intent[] {
  return INTENTS.filter((intent) =>
    PATTERNS[intent].some((pattern) => pattern.test(sentence)),
  );
}

function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(WHITESPACE, " ")
    .trim()
    .slice(0, 120);
}

export type HarvestOptions = {
  intents?: Intent[];
  keyword?: string;
  minScore?: number;
  limit?: number;
};

/**
 * Pull quotable sentences out of comments, tagged by intent.
 *
 * Each result is verbatim. Nothing is rewritten, summarized, or cleaned beyond
 * collapsing whitespace and stripping bare URLs, so anything returned here can
 * be pasted into a report and still match the source.
 */
export function harvest(comments: Comment[], options: HarvestOptions = {}): Quote[] {
  const { keyword, minScore = 1, limit = 60 } = options;
  const wanted = new Set<Intent>(options.intents?.length ? options.intents : INTENTS);
  const needle = keyword?.trim().toLowerCase();

  const found: Quote[] = [];
  const seen = new Set<string>();

  for (const item of comments) {
    if ((item.score ?? 0) < minScore) continue;
    for (const sentence of sentences(item.body ?? "")) {
      if (sentence.length < MIN_QUOTE_CHARS || sentence.length > MAX_QUOTE_CHARS) continue;
      if (needle && !sentence.toLowerCase().includes(needle)) continue;

      const matched = classify(sentence).filter((intent) => wanted.has(intent));
      if (matched.length === 0) continue;

      const key = fingerprint(sentence);
      if (seen.has(key)) continue;
      seen.add(key);

      found.push({
        quote: sentence,
        intents: matched,
        score: item.score ?? 0,
        author: item.author ?? null,
        subreddit: item.subreddit ?? null,
        threadTitle: item.threadTitle ?? null,
        isOp: item.isOp ?? false,
        createdAt: item.createdAt ?? null,
        permalink: item.permalink ?? null,
      });
    }
  }

  // Rank by community agreement only. Anything cleverer would be the tool
  // deciding what the findings are, which is exactly what it must not do.
  found.sort((a, b) => b.score - a.score);
  return found.slice(0, limit);
}

export function intentCounts(quotes: Quote[]): Partial<Record<Intent, number>> {
  const counts: Partial<Record<Intent, number>> = {};
  for (const quote of quotes) {
    for (const intent of quote.intents) {
      counts[intent] = (counts[intent] ?? 0) + 1;
    }
  }
  return counts;
}
