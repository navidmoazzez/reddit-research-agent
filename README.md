# Reddit Research Agent

[![npm](https://img.shields.io/npm/v/@thenavidm%2Freddit-research-agent?color=orange&label=npm)](https://www.npmjs.com/package/@thenavidm/reddit-research-agent)
[![License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)
[![YouTube](https://img.shields.io/badge/YouTube-@thenavidm-red?logo=youtube&logoColor=white)](https://youtube.com/@thenavidm?sub_confirmation=1)
[![X](https://img.shields.io/badge/X-@thenavidm-black?logo=x)](https://x.com/thenavidm)

Reddit research for any AI agent, read-only. It finds the communities where a topic is actually discussed, ranks threads by how much real conversation they hold, pulls the comments, and hands back verbatim quotes with a link to every single one.

There are no write tools. It cannot post, reply, vote, or delete.

Built and maintained by [Navid Moazzez](https://navid.me).

```
You: what do people actually complain about with standing desks?

Claude: Running a research pass on Reddit.

  Found the conversation in r/battlestations, r/ergonomics and
  r/homeoffice. Ranked 214 threads by discussion volume and pulled
  comments from the top 8. 1,143 comments, 47 quotable lines.

  The loudest complaint is not the desk. It is the wobble at
  standing height, and it comes up in every one of the eight
  threads:

  "Mine shakes so bad at standing height my second monitor
   wobbles every time I type." (r/ergonomics, 312 upvotes)

  Second is buyer's remorse about the motor, not the surface.
  Third is that people stop standing after about three weeks.

  Every quote links to the exact comment. Want the full report?
```

## Contents

| | Section | |
|---|---|---|
| 1 | [What you can ask it](#1-what-you-can-ask-it) | Real prompts, not features |
| 2 | [Quick install](#2-quick-install) | One command |
| 3 | [Reddit credentials](#3-reddit-credentials) | Two minutes, and required |
| 4 | [Connect your client](#4-connect-your-client) | Every client, step by step |
| 5 | [Check it worked](#5-check-it-worked) | `doctor` |
| 6 | [Tools](#6-tools) | All 12 |
| 7 | [How the ranking actually works](#7-how-the-ranking-actually-works) | The part that matters |
| 8 | [The bundled skill](#8-the-bundled-skill) | Evidence into a report |
| 9 | [Reading the results honestly](#9-reading-the-results-honestly) | Where this can mislead you |
| 10 | [Configuration](#10-configuration) | Every setting |
| 11 | [Troubleshooting](#11-troubleshooting) | When something breaks |
| 12 | [FAQ](#12-faq) | Start here if you are new |

---

## 1. What you can ask it

- What do people actually complain about with standing desks?
- Find me the exact words people use when they describe burnout.
- Which subreddits discuss home espresso, and how big are they?
- What are the objections to cold plunges, in people's own words?
- Is anyone talking about my product, and where?
- Compare how much discussion Notion, Obsidian and Roam get this year.
- Read this thread and tell me what the top comments actually say.
- Is this person a real user or an astroturfer? Check their history.

The first one is the point. The words a customer uses about their own problem are worth more than any summary of them, and Reddit is the largest pile of those words that exists. What has been missing is a way to get them out with the receipts attached.

## 2. Quick install

Node 20 or newer, plus free Reddit API credentials. Getting those is [section 3](#3-reddit-credentials) and takes two minutes.

```bash
npx -y @thenavidm/reddit-research-agent --version
```

> **Not on npm yet.** The package name above is reserved for the published release, so that command will not resolve today. Until it is published, install from source with the three lines below. Every client example in [section 4](#4-connect-your-client) gives both forms, and the source form works right now.

```bash
git clone https://github.com/navidmoazzez/reddit-research-agent.git
cd reddit-research-agent
npm install && npm run build
```

That produces `dist/index.js`. Note the absolute path to it, because that is what you point your client at:

```bash
pwd   # e.g. /Users/you/code/reddit-research-agent
```

## 3. Reddit credentials

You need these. Reddit now refuses almost all unauthenticated API traffic and returns HTTP 403 rather than data. The server still has an anonymous path and will use it if you have no credentials, but expect it to be blocked.

Registering an app takes two minutes, is free, and gives you 100 requests a minute.

1. Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) and sign in.
2. Scroll to the bottom and click **create another app**.
3. Fill in the form:
   - **name:** anything, for example `my-research-agent`
   - **type:** select **script**
   - **redirect uri:** `http://localhost:8080` (the form requires one, this server never uses it)
4. Click **create app**.
5. Read the two values off the result. This is where most people go wrong:
   - The **client id** is the short string directly **under the app name**, near the words "personal use script". It is not the app name.
   - The **client secret** is the value labeled **secret**.

Keep both out of version control. Pass them as environment variables in your client config, shown for each client below.

You do not need your Reddit username or password. This server only ever uses app-only authentication, which has no user context and is read-only by design.

## 4. Connect your client

### Claude Code

From npm, once published:

```bash
claude mcp add reddit-research -s user \
  -e REDDIT_CLIENT_ID=your_client_id \
  -e REDDIT_CLIENT_SECRET=your_client_secret \
  -- npx -y @thenavidm/reddit-research-agent
```

From your local build, which works today:

```bash
claude mcp add reddit-research -s user \
  -e REDDIT_CLIENT_ID=your_client_id \
  -e REDDIT_CLIENT_SECRET=your_client_secret \
  -- node /absolute/path/to/reddit-research-agent/dist/index.js
```

Check it registered:

```bash
claude mcp list
```

You should see `reddit-research` with a green check. Restart any open Claude Code session so it picks the server up.

### Claude Desktop

1. Open Claude Desktop.
2. Go to **Settings**, then **Developer**, then **Edit Config**. That opens the config file in your editor.

If you would rather open it directly:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

  ```bash
  open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
  ```

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

  ```powershell
  notepad $env:APPDATA\Claude\claude_desktop_config.json
  ```

- **Linux:** `~/.config/Claude/claude_desktop_config.json`

  ```bash
  xdg-open ~/.config/Claude/claude_desktop_config.json
  ```

3. **If the file is empty or brand new**, paste this whole thing. Replace the path with your own checkout:

```json
{
  "mcpServers": {
    "reddit-research": {
      "command": "node",
      "args": ["/absolute/path/to/reddit-research-agent/dist/index.js"],
      "env": {
        "REDDIT_CLIENT_ID": "your_client_id",
        "REDDIT_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Once the package is on npm, this becomes:

```json
{
  "mcpServers": {
    "reddit-research": {
      "command": "npx",
      "args": ["-y", "@thenavidm/reddit-research-agent"],
      "env": {
        "REDDIT_CLIENT_ID": "your_client_id",
        "REDDIT_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

4. **If the file already has other servers in it**, add only the `"reddit-research"` block inside the existing `"mcpServers"` object, and put a comma after the previous server's closing brace:

```json
{
  "mcpServers": {
    "some-server-you-already-had": {
      "command": "npx",
      "args": ["something"]
    },
    "reddit-research": {
      "command": "node",
      "args": ["/absolute/path/to/reddit-research-agent/dist/index.js"],
      "env": {
        "REDDIT_CLIENT_ID": "your_client_id",
        "REDDIT_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

That comma matters more than it looks. One missing or extra comma makes the whole file invalid, and Claude Desktop then silently loads **none** of your servers, not just this one. If every server disappears at once, the JSON is malformed. Paste the file into any JSON validator to find the spot.

5. **Fully quit and reopen Claude Desktop.** On macOS that is Cmd+Q, not just closing the window. On Windows, quit it from the system tray. The config is only read on a fresh launch.

6. Confirm it worked. Look for the tools icon in the bottom right of the message box, click it, and you should see `reddit-research` listed with its tools. Then ask:

   > Which subreddits discuss home espresso?

7. If it did not appear, read the log:

- **macOS:** `tail -n 100 ~/Library/Logs/Claude/mcp*.log`
- **Windows:** `Get-Content $env:APPDATA\Claude\Logs\mcp*.log -Tail 100`
- **Linux:** `tail -n 100 ~/.config/Claude/Logs/mcp*.log`

The two failures that account for almost everything:

- **Node not found.** Claude Desktop does not use your shell's PATH, so a Node installed through nvm or Homebrew is often invisible to it. Run `which node` in a terminal and put that absolute path in `"command"`, for example `/Users/you/.nvm/versions/node/v22.11.0/bin/node`.
- **Malformed JSON**, as described in step 4.

### Cursor

1. Open Cursor.
2. Go to **Settings**, then **Cursor Settings**, then **MCP**.
3. Click **Add new global MCP server**. That opens `~/.cursor/mcp.json`.
4. Add the same `"reddit-research"` block shown for Claude Desktop, inside `"mcpServers"`.
5. Save, then click the refresh icon next to the server in the MCP settings panel. Cursor picks up config changes without a full restart, but the refresh is required.

For one project only, put the same block in `.cursor/mcp.json` at the project root instead.

### VS Code

1. Open your user settings JSON: **Cmd+Shift+P** (Ctrl+Shift+P on Windows and Linux), then **Preferences: Open User Settings (JSON)**.
2. Add an `"mcp"` section:

```json
{
  "mcp": {
    "servers": {
      "reddit-research": {
        "command": "node",
        "args": ["/absolute/path/to/reddit-research-agent/dist/index.js"],
        "env": {
          "REDDIT_CLIENT_ID": "your_client_id",
          "REDDIT_CLIENT_SECRET": "your_client_secret"
        }
      }
    }
  }
}
```

3. Save, then run **MCP: List Servers** from the command palette and start `reddit-research`.

For one workspace only, use `.vscode/mcp.json` with the `"servers"` block at the top level.

### Windsurf

1. Open Windsurf.
2. Go to **Settings**, then **Windsurf Settings**, then **Cascade**, then **Model Context Protocol (MCP) Servers**.
3. Click **View raw config**. That opens `~/.codeium/windsurf/mcp_config.json`.
4. Add the same `"reddit-research"` block inside `"mcpServers"`.
5. Save, then click **Refresh** in that same panel.

### Codex CLI

Codex uses TOML, not JSON. Open `~/.codex/config.toml` and add:

```toml
[mcp_servers.reddit-research]
command = "node"
args = ["/absolute/path/to/reddit-research-agent/dist/index.js"]

[mcp_servers.reddit-research.env]
REDDIT_CLIENT_ID = "your_client_id"
REDDIT_CLIENT_SECRET = "your_client_secret"
```

Save and start a new `codex` session.

### Developing on it

If you want to change the ranking or add an intent pattern:

```bash
npm run dev        # tsc --watch
npm test           # vitest
npm run inspect    # build, then open the MCP Inspector
```

`npm run inspect` is the fastest way to call a tool by hand and see exactly what it returns.

## 5. Check it worked

From a terminal, with your credentials in the environment:

```bash
REDDIT_CLIENT_ID=xxx REDDIT_CLIENT_SECRET=yyy node dist/index.js doctor
```

It makes one real request to Reddit and tells you what came back:

```json
{
  "ok": true,
  "writeAccess": false,
  "client": { "authState": "app-only", "requestsMade": 1 },
  "checks": [
    { "check": "credentials", "ok": true },
    { "check": "live request", "ok": true, "detail": "Reddit answered as app-only." }
  ]
}
```

`"authState": "anonymous"` means your credentials were not picked up, and the live request almost certainly failed with a 403, because Reddit blocks unauthenticated callers. `"rejected"` means Reddit refused the credentials it was given, which is almost always the client id and the app name being confused for each other.

Inside a client, ask it to run `server_status` and you get the same report.

## 6. Tools

| Tool | What it does |
|---|---|
| `research_topic` | The whole pipeline in one call: discover subreddits, search, rank by discussion, pull comments. Start here. |
| `harvest_quotes` | Same pass, but returns only verbatim quotes tagged by intent: pain, desire, objection, comparison, recommendation, question. |
| `track_mentions` | Where a brand, product, or phrase is being mentioned, and in which communities. |
| `compare_terms` | How much discussion several terms attract, with each one's share. |
| `find_subreddits` | The communities where a topic is actually discussed. |
| `search_reddit` | Search posts, globally or inside one subreddit, re-ranked by discussion. |
| `browse_subreddit` | Hot, new, top, rising, or controversial for one community. |
| `get_thread` | One thread in full, comments flattened and scored. |
| `get_subreddit_info` | Size, age, activity, description. For weighing a finding. |
| `get_subreddit_rules` | The posting rules of a community. |
| `get_user_activity` | A redditor's public history. For weighing a source. |
| `server_status` | Config, auth mode, and one live request. Run when something breaks. |

Twelve tools, all read-only. There is deliberately no `create_post`, no `reply`, no `vote`, and no `delete`. A research tool that can also post is a research tool that can be talked into posting by something it read.

## 7. How the ranking actually works

This is the part that decides whether the output is any good.

The naive move is to sort search results by upvotes. That gives you the front page, which is the worst possible input for research. A link post with 4,000 upvotes and 6 comments tells you nothing about how anyone talks. A 60 upvote thread with 300 comments in it is the entire point.

So threads are ranked by conversation:

```
value = (numComments + 5 * log10(score + 1)) * recency
```

Comment count drives it outright. Upvotes are log scaled so they break ties without taking over, which matters because upvote counts run an order of magnitude above comment counts and any linear weight on them quietly turns this back into a popularity sort. Threads older than six months are discounted on a gentle curve, down to 0.55 past three years, because the way people describe a problem moves.

Every thread comes back with `rankInputs` showing the numbers that put it where it is, so the model can disagree with the order instead of inheriting it.

Quote harvesting is separate and deliberately dumb. It splits comments into sentences and matches them against literal phrasings people actually type: `i wish`, `too expensive`, `waste of money`, `switched from`, `worked for me`. Pattern matching finds candidates. It never decides what they mean. Interpretation is the model's job, and the ranking inside `harvest_quotes` is by upvote count alone so it cannot quietly become an opinion.

Quotes come back verbatim. Whitespace is collapsed and bare URLs are stripped, and that is the whole of it, so anything you paste into a report still matches the source. Deleted comments and AutoModerator are dropped, and so are lines that are themselves Reddit quotes of someone else, because lifting those attributes a stranger's words to the person who quoted them.

## 8. The bundled skill

[`SKILL.md`](./SKILL.md) turns an evidence bundle into a written report with the quotes threaded through it and every one linked back to its comment.

The server gets the evidence. The skill decides what it means. Keeping those apart is why the evidence stays trustworthy: nothing in the server has an opinion, so nothing in the server can quietly bias what you read.

To use it in Claude Code:

```bash
mkdir -p ~/.claude/skills/reddit-research
cp SKILL.md ~/.claude/skills/reddit-research/SKILL.md
```

Then ask for a Reddit research report and it will run the pipeline and write one.

## 9. Reading the results honestly

Reddit is a set of self-selected communities, not a survey panel. This matters more than any feature in this README.

- **People post about problems, not about things working.** Complaint volume is not failure rate. A product with ten thousand happy users and fifty angry ones looks, on Reddit, like a product with fifty angry users.
- **Every subreddit has a house opinion.** r/BuyItForLife and r/frugal will give you opposite conclusions about the same purchase, and both are real. Search more than one community, and say which one a finding came from.
- **One loud comment is not a pattern.** `harvest_quotes` returns intent counts so you can see whether a theme appears once or forty times. Say which.
- **Astroturfing is real.** `get_user_activity` exists for this. An account whose entire history is one brand is not a customer.
- **Search caps at 100 posts per query.** Counts from `compare_terms` are relative, not absolute, and the tool says so in its own output.

The tools carry these caveats in their responses so the model sees them too, not only you.

Everything this server returns was written by a stranger, and a comment can contain text shaped to look like an instruction to an AI agent. Treat it as data to reason about, never as instructions to follow.

Reddit's [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) applies to everything read through this server. Do not use it to train models without Reddit's written approval, do not resell the data, and do not try to re-identify anyone.

## 10. Configuration

Every setting is an environment variable, and every one has a working default except the credentials.

| Variable | Default | What it does |
|---|---|---|
| `REDDIT_CLIENT_ID` | | Client id from your Reddit script app |
| `REDDIT_CLIENT_SECRET` | | Client secret from the same app |
| `REDDIT_AUTH_MODE` | `auto` | `auto`, `authenticated`, or `anonymous` |
| `REDDIT_USER_AGENT` | package default | Override the User-Agent sent to Reddit |
| `REDDIT_REQUEST_TIMEOUT_MS` | `30000` | Per-request deadline |
| `REDDIT_MIN_REQUEST_INTERVAL_MS` | `0` | Minimum gap between requests |
| `REDDIT_MAX_RETRIES` | `3` | Retries on 429 and 5xx |
| `REDDIT_CACHE_TTL_MS` | `300000` | Response cache lifetime. `0` disables it |
| `REDDIT_CACHE_SIZE` | `512` | Maximum cached responses |
| `REDDIT_MAX_THREADS` | `25` | Ceiling on threads per research pass |
| `REDDIT_MAX_COMMENTS` | `400` | Ceiling on comments per thread |

`auto` uses credentials when they are present and falls back to anonymous when they are not. `authenticated` fails loudly instead of falling back, which is what you want on a server. `anonymous` ignores credentials entirely.

## 11. Troubleshooting

**"Reddit blocked this anonymous request."** You have no credentials set, and Reddit refuses nearly all unauthenticated API traffic. This is the expected result of running without credentials, not a bug and not a problem with the subreddit. Set `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` as described in [section 3](#3-reddit-credentials).

**"Reddit rejected the client id and secret."** The client id is the short string under the app name on the apps page, not the app name itself. This is the single most common setup mistake.

**Everything returns a rate limit error.** You are past 100 requests a minute. Ask for fewer threads, or wait a minute. The response cache means a repeated research pass on the same topic costs nothing.

**"Reddit returned a non-JSON response."** Reddit served an HTML block page instead of data, which it does to anonymous traffic it does not like. Credentials fix it.

**A subreddit comes back as skipped.** It is private, quarantined, banned, or restricted to logged-in users. `research_topic` records the reason per subreddit in `subredditsSearched` and carries on with the rest rather than failing the whole run.

**The server does not appear in my client at all.** It is almost never this package. Check that `node` is on the PATH your client sees, that the path to `dist/index.js` is absolute and correct, and that the config file is valid JSON. See the Claude Desktop steps in [section 4](#4-connect-your-client), which apply in spirit to every client.

**Results feel thin.** Widen `timeFilter` to `all`, raise `threads`, or name the subreddits yourself instead of letting discovery pick them. Discovery is good, but you often know the community better than a search does.

**Quotes are all recommendations and no complaints.** Drop `minScore` in `harvest_quotes`. Critical comments get downvoted, so a high score floor filters out exactly what you were looking for.

## 12. FAQ

**Do I need a Reddit account?** In practice yes, because you need a free app registration to get credentials and that requires an account. The server never logs in as you, never sees your password, and never touches your account. It only uses the app credentials, which have no user context at all.

**Does it use my Reddit password?** No. It only supports app-only authentication, which cannot act as anyone. There is no code path that accepts a password.

**Can it post for me?** No. There are no write tools, and this is a property of the package rather than a setting you could flip.

**Does it cost anything?** Not for personal or internal research. Reddit's Data API has a free tier at 100 queries a minute per client id, which is what this server uses, and there are no credits to buy and no third-party service in the path. Commercial use at scale is a separate paid agreement with Reddit, so read their terms before you build a product on top of it.

**How many requests does a research pass use?** Two for discovery, then one per subreddit searched and one per thread pulled. A default pass with five discovered subreddits and eight threads is about 15. Naming the subreddits yourself skips the two discovery calls. Authenticated apps get 100 a minute, and repeated passes on the same topic come from cache.

**Can I use this data commercially?** Read Reddit's Responsible Builder Policy, linked in [section 9](#9-reading-the-results-honestly). Reselling the data and training models on it are both restricted.

**Why is there no write support?** Because it is a research tool, and everything it reads is text written by strangers. A server that can both read untrusted content and post to Reddit is one prompt injection away from posting on your behalf.

## Dependencies

| Library | License | What it does |
|---|---|---|
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP server and stdio transport |
| [zod](https://github.com/colinhacks/zod) | MIT | Tool argument schemas and validation |

## Versions

See [VERSIONS.md](VERSIONS.md).

## About the author

Navid Moazzez is a leading AI business strategist, and the host of the AI Creator Summit, watched by 100,000+ creators. He helps creators and founders master AI and build their own AI Operating System (AI OS) to automate their business and life. This Reddit research server is one piece of that system.

**Links**

- Personal website: [navid.me](https://navid.me)
- YouTube: [@thenavidm](https://youtube.com/@thenavidm?sub_confirmation=1) and [@thenavidai](https://youtube.com/@thenavidai?sub_confirmation=1)
- X: [@thenavidm](https://x.com/thenavidm)
- Instagram: [@thenavidm](https://instagram.com/thenavidm)
- LinkedIn: [thenavidm](https://linkedin.com/in/thenavidm)

## Security

Found a vulnerability? [Report it privately](https://github.com/navidmoazzez/reddit-research-agent/security/advisories/new), not as a public issue. [SECURITY.md](SECURITY.md) covers what this server holds and why it has no write path.

## License

[MIT](./LICENSE). Free to use, modify, and share.

Not affiliated with, endorsed by, or connected to Reddit, Inc.

---

© 2026 [NM Media](https://navid.media). Made with ❤️ by [Navid Moazzez](https://navid.me).
