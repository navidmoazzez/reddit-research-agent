/**
 * One command that answers "why is this not working".
 *
 * Everything a person can get wrong here is invisible from the outside: a
 * client id pasted from the wrong field, an auth mode that demands credentials
 * nobody set, or anonymous access that Reddit refuses. So the check makes one
 * real request and reports what actually came back.
 */

import type { RedditClient } from "./client.js";
import { VERSION, hasCredentials, type Config } from "./config.js";

export type Check = { check: string; ok: boolean; detail: string };

export type Report = {
  version: string;
  ok: boolean;
  writeAccess: false;
  writeAccessNote: string;
  client: Record<string, unknown>;
  checks: Check[];
};

export async function run(config: Config, client: RedditClient): Promise<Report> {
  const checks: Check[] = [];
  const credentials = hasCredentials(config);

  checks.push({
    check: "credentials",
    ok: credentials,
    detail: credentials
      ? "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are set."
      : "No credentials set. Reddit refuses almost all unauthenticated API " +
        "traffic, so expect every request to fail with a 403. Create a free " +
        "script app at https://www.reddit.com/prefs/apps to fix it.",
  });

  const badMode = config.authMode === "authenticated" && !credentials;
  checks.push({
    check: "auth mode",
    ok: !badMode,
    detail:
      `REDDIT_AUTH_MODE=${config.authMode}.` +
      (badMode
        ? " This mode requires credentials and none are set, so every request will fail."
        : ""),
  });

  checks.push({
    check: "user agent",
    ok: Boolean(config.userAgent),
    detail: config.userAgent,
  });

  const live: Check = { check: "live request", ok: false, detail: "" };
  try {
    // r/announcements is public, tiny to fetch, and always exists.
    const payload = (await client.get("/r/announcements/about", {}, { useCache: false })) as {
      data?: { display_name?: string };
    };
    const name = payload?.data?.display_name;
    live.ok = Boolean(name);
    live.detail = name
      ? `Reddit answered as ${client.authState}.`
      : "Reddit answered but the response had no subreddit in it.";
  } catch (error) {
    live.detail = error instanceof Error ? error.message : String(error);
  }
  checks.push(live);

  return {
    version: VERSION,
    ok: checks.every((c) => c.ok),
    writeAccess: false,
    writeAccessNote: "This server is read-only. It has no write tools.",
    client: client.status,
    checks,
  };
}
