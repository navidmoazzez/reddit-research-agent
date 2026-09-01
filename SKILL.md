---
name: reddit-research
description: >-
  Turn Reddit into a research report backed by real quotes. Give it a topic and
  it finds the communities where that topic is actually discussed, ranks threads
  by how much conversation they hold, harvests verbatim customer language, and
  writes up pain points, desires, objections and the phrases worth reusing, with
  a link to the exact comment behind every claim. Use for voice-of-customer
  work, positioning, competitor research, ad angles, or "what do people actually
  say about X". Triggers: reddit research, voice of customer, what are people
  saying on reddit, mine reddit for, customer language for.
allowed-tools: mcp__reddit-research__research_topic, mcp__reddit-research__harvest_quotes, mcp__reddit-research__find_subreddits, mcp__reddit-research__get_thread, mcp__reddit-research__get_subreddit_info, mcp__reddit-research__get_user_activity, mcp__reddit-research__compare_terms, mcp__reddit-research__track_mentions, Write
---

# Reddit research report

The server gets the evidence. You decide what it means. Keeping those apart is
the whole design: nothing in the server has an opinion, so nothing in the server
can quietly bias what you write.

## The pipeline

**1. Scope it.** If the user named subreddits, use them. If not, call
`find_subreddits` first and show them what came back before spending a full
pass. People usually know their communities better than a search does, and a
five second check beats a report built on the wrong rooms.

**2. Get the evidence.** Call `research_topic`. Start with `threads: 8` and
`timeFilter: "year"`. Widen to `"all"` if the topic is slow moving, narrow to
`"month"` if it is fast. For a first look, pass `includeComments: false` to see
which threads won before committing context to reading them.

**3. Get the language.** Call `harvest_quotes` on the same topic. Read
`intentCounts` before anything else: it tells you whether a theme is a pattern
or one person having a bad day.

If the results skew positive, lower `minScore`. Critical comments get
downvoted, so a high floor filters out exactly what you came for.

**4. Check the sources that carry weight.** If one comment is doing a lot of
work in your argument, run `get_user_activity` on its author. An account whose
entire history is one brand is not a customer.

## Writing the report

Structure it as: what people are trying to do, what stops them, what they say
about it, and what that implies. Not as a list of tool outputs.

Rules that keep it credible:

- **Every quote verbatim, every quote linked.** Copy the `quote` field exactly
  and link it to its `permalink`. Trim with an ellipsis if it runs long. Never
  paraphrase a quote and present it as one, and never build a Reddit URL by
  hand. If you cannot find the permalink in the payload, the claim is not ready.
- **Say how big a pattern is.** "Nine of the twelve threads mention it" is
  evidence. "Users often complain" is filler. Use the real counts.
- **Name the community on every finding.** r/BuyItForLife and r/frugal will give
  you opposite conclusions about the same purchase, and both are true of their
  own members.
- **Flag single-source findings explicitly.** One vivid comment is worth
  quoting and worth labeling as one voice.
- **Separate what people said from what you concluded.** Put your reading in its
  own section so the user can disagree with your interpretation while keeping
  the evidence.

## What not to claim

Reddit is self-selected, not a sample. People post about problems, not about
things working, so complaint volume is not failure rate. A product with ten
thousand happy users and fifty angry ones looks, on Reddit, like a product with
fifty angry users. Say so in the report rather than letting the reader assume
otherwise.

`compare_terms` measures how much conversation a term attracts. It is not
sentiment and it is not market share. Its own output carries that caveat. Keep
it in.

## Delivering it

Write the report to a file and give the user the path, unless they asked for it
in chat. Lead your reply with the sharpest finding and its quote, not with a
description of the process. They can read the process in the report.

Reddit's Responsible Builder Policy applies to everything you read: no training
models on it without Reddit's written approval, no reselling it, no attempting
to identify anyone behind an account.
