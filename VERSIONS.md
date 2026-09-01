# Reddit Research Agent Versions

| Component | Version | Last Updated |
|-----------|---------|--------------|
| reddit-research-agent | 0.1.0 | 2026-09-01 |

---

## 0.1.0

First release. Twelve read-only tools over Reddit's official API, built around a
research pipeline rather than a set of endpoint wrappers.

`research_topic` runs the whole pass in one call: discover the subreddits that
actually discuss a topic, search each one, rank threads by conversation volume,
then pull the comments. `harvest_quotes` turns that into verbatim sentences
tagged by intent, each carrying the permalink of the comment it came from.

Ranking weights comment count outright and log scales upvotes. An earlier draft
used a linear upvote weight, which let a 4,000 upvote link post with six
comments outrank a 300 comment discussion thread, the exact failure the ranking
exists to prevent. Old threads are discounted on a curve down to 0.55 past three
years. Every thread reports the numbers behind its position in `rankInputs`.

No write path, as a property of the package rather than a setting. There are no
create, reply, vote or delete tools and the client issues nothing but GETs.
App-only auth, so no Reddit password is ever used.

Anonymous access returns a specific error rather than a generic 403. Reddit now
blocks nearly all unauthenticated API traffic, and a message blaming the
subreddit sent people looking in the wrong place.

58 tests, all against mocked responses so the suite needs no credentials and no
network.
