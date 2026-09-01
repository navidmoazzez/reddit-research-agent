# Working on this repo

For agents editing this repo, not for people installing it. Installation is the
README.

## Commands

```bash
npm install
npm run build        # tsc to dist/
npm test             # vitest, no network, no credentials
npm run typecheck    # tsc --noEmit
npm run inspect      # build, then the MCP Inspector
node dist/index.js doctor   # one real request to Reddit, reports what came back
```

`doctor` is the first thing to run when anything looks broken. It distinguishes
"no credentials", "credentials rejected" and "Reddit is down", which look
identical from a tool response.

## Decisions already made

Do not re-litigate these.

**This server is read-only, and that is structural.** There are no write tools
and `RedditClient` exposes no method that issues anything but a GET. Everything
this server reads is text written by strangers, and a server that can both read
untrusted content and post to Reddit is one prompt injection away from posting
on the user's behalf. Do not add a write tool.

**App-only auth only.** `client_credentials`, never the password grant. App-only
has no user context, so a leaked token cannot act as anyone. Nothing in here
should ever accept a Reddit username or password.

**Ranking weights comments, not upvotes.** `rankThreads` is
`(numComments + 5 * log10(score + 1)) * recency`. The log is not decoration:
upvote counts run an order of magnitude above comment counts, so any linear
weight on them turns this back into a popularity sort, and a viral link post
with six comments is worthless for research. There is a test for exactly this.

**The quote miner does not interpret.** `quotes.ts` matches literal phrasings
people type and sorts by upvote count alone. Deciding what a quote means is the
model's job. Anything smarter here becomes an opinion baked into a tool that
presents itself as evidence.

**Every item carries a permalink.** `models.ts` exists to enforce this. A quote
without a link back is an unverifiable claim. Never return an item without one,
and never construct a Reddit URL by hand.

**Anonymous mode is a diagnostic, not a feature.** Reddit blocks it. It exists
so the error message can say so.

## Adding a tool

One `server.registerTool` call in `src/server.ts`, with a zod `inputSchema` and
the `READ_ONLY` annotations spread in. MCP defaults `destructiveHint` and
`openWorldHint` to true when omitted, so an unannotated read shows up in a
client as dangerous.

Put constraints in the tool description, where they stay in context, not only in
the README. Then update the tool count in the README table and in `VERSIONS.md`.

## Tests

vitest against pure functions and a stubbed `fetch`. Never the network, never a
real token. A test that needs credentials is a test nobody runs.

`tests/pipeline.test.ts` carries the most weight: it proves discovery, ranking,
comment harvesting and quote extraction compose into a bundle where every quote
still points at a real comment.

Note that a `Response` body is single use. A mock serving more than one call
must build a fresh `Response` per invocation or the second read fails.

## Commit identity

Commits are authored `navidmoazzez <n@navid.me>`. The repo's local git config is
already set, so a plain `git commit` does the right thing.

Do not pass `-c user.email=` on the commit. That override is how commits end up
attributed to a dead profile with the contributors panel reading zero.

```bash
git config user.email   # must print n@navid.me
```
