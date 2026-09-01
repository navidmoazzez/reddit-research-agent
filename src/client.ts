/**
 * HTTP layer: OAuth, rate limiting, retries, and a small response cache.
 *
 * Two transports sit behind one interface.
 *
 *   app-only OAuth   POST client_credentials, then oauth.reddit.com with a
 *                    bearer token. 100 requests a minute. This is what you want.
 *   anonymous        www.reddit.com/<path>.json with no token. Reddit now
 *                    returns 403 to nearly all of these, so this path exists to
 *                    fail with an explanation rather than to be a usable mode.
 *
 * Nothing here writes to Reddit. There is no code path that can post, vote,
 * comment, or delete, which is a property of the package rather than a setting.
 */

import {
  OAUTH_BASE,
  PUBLIC_BASE,
  TOKEN_URL,
  hasCredentials,
  loadConfig,
  wantsAppAuth,
  type Config,
} from "./config.js";

export class RedditError extends Error {
  override name = "RedditError";
}
export class RateLimited extends RedditError {
  override name = "RateLimited";
}
export class NotFound extends RedditError {
  override name = "NotFound";
}
/** Private, quarantined, banned, gated behind login, or the caller is blocked. */
export class Forbidden extends RedditError {
  override name = "Forbidden";
}

type CacheEntry = { storedAt: number; value: unknown };

/**
 * Tiny TTL + LRU cache.
 *
 * Research runs re-read the same subreddit listing several times while the
 * model narrows a topic. Caching those is the difference between one run and
 * three inside the same rate-limit window.
 */
export class ResponseCache {
  private readonly store = new Map<string, CacheEntry>();
  hits = 0;
  misses = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize: number,
  ) {}

  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Refresh recency for the LRU eviction below.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: unknown): void {
    if (this.ttlMs <= 0) return;
    this.store.delete(key);
    this.store.set(key, { storedAt: Date.now(), value });
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get stats(): { entries: number; hits: number; misses: number } {
    return { entries: this.store.size, hits: this.hits, misses: this.misses };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type AuthState = "unauthenticated" | "anonymous" | "app-only" | "rejected";

export class RedditClient {
  readonly config: Config;
  readonly cache: ResponseCache;
  requestsMade = 0;
  authState: AuthState = "unauthenticated";

  private token: string | null = null;
  private tokenExpiresAt = 0;
  private tokenPromise: Promise<string | null> | null = null;
  private lastRequestAt = 0;
  private pacing: Promise<void> = Promise.resolve();

  constructor(config: Config = loadConfig()) {
    this.config = config;
    this.cache = new ResponseCache(config.cacheTtlMs, config.cacheSize);
  }

  // --------------------------------------------------------------- auth

  private async accessToken(): Promise<string | null> {
    if (!wantsAppAuth(this.config)) return null;
    if (!hasCredentials(this.config)) {
      if (this.config.authMode === "authenticated") {
        throw new RedditError(
          "REDDIT_AUTH_MODE=authenticated but REDDIT_CLIENT_ID and " +
            "REDDIT_CLIENT_SECRET are not set. Create a script app at " +
            "https://www.reddit.com/prefs/apps and set both.",
        );
      }
      return null;
    }
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    // Collapse concurrent refreshes. A research pass fans out immediately, and
    // without this every parallel request would mint its own token.
    this.tokenPromise ??= this.fetchToken().finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  private async fetchToken(): Promise<string | null> {
    const basic = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString("base64");

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.config.userAgent,
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (response.status === 401) {
      this.authState = "rejected";
      throw new RedditError(
        "Reddit rejected the client id and secret. Check them at " +
          "https://www.reddit.com/prefs/apps. The id is the short string under " +
          "the app name, not the app name itself.",
      );
    }
    if (!response.ok) {
      this.authState = "rejected";
      throw new RedditError(
        `Token request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as { access_token: string; expires_in?: number };
    this.token = payload.access_token;
    // Renew a minute early so a long research run never trips over expiry.
    this.tokenExpiresAt = Date.now() + ((payload.expires_in ?? 3600) - 60) * 1000;
    this.authState = "app-only";
    return this.token;
  }

  // ------------------------------------------------------------ request

  /** Space requests out. Anonymous traffic gets a wider gap on purpose. */
  private pace(anonymous: boolean): Promise<void> {
    const interval = anonymous
      ? Math.max(this.config.minRequestIntervalMs, 1100)
      : this.config.minRequestIntervalMs;
    if (interval <= 0) return Promise.resolve();
    // Chain onto the previous wait so concurrent callers queue rather than all
    // measuring the same stale timestamp and firing at once.
    this.pacing = this.pacing.then(async () => {
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < interval) await sleep(interval - elapsed);
      this.lastRequestAt = Date.now();
    });
    return this.pacing;
  }

  /** GET a Reddit endpoint by path, e.g. /r/python/hot. */
  async get(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
    options: { useCache?: boolean } = {},
  ): Promise<unknown> {
    const useCache = options.useCache ?? true;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    // raw_json=1 stops Reddit HTML-escaping &, < and > inside comment bodies,
    // which would otherwise end up in quotes handed to the user.
    if (!query.has("raw_json")) query.set("raw_json", "1");
    query.sort();

    const cacheKey = `${path}?${query.toString()}`;
    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) return cached;
    }

    let token = await this.accessToken();
    const anonymous = token === null;
    if (anonymous && this.authState === "unauthenticated") this.authState = "anonymous";

    const url = anonymous
      ? `${PUBLIC_BASE}${path}.json?${query.toString()}`
      : `${OAUTH_BASE}${path}?${query.toString()}`;

    let lastError = "";
    for (let attempt = 0; attempt < this.config.maxRetries; attempt += 1) {
      await this.pace(anonymous);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": this.config.userAgent,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
      } catch (error) {
        lastError = `could not reach Reddit: ${(error as Error).message}`;
        if (attempt + 1 < this.config.maxRetries) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        throw new RedditError(lastError);
      }

      this.requestsMade += 1;
      const status = response.status;

      if (status === 200) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          // Reddit serves an HTML interstitial instead of JSON when it decides
          // an anonymous caller looks like a scraper.
          throw new RedditError(
            "Reddit returned a non-JSON response. This usually means anonymous " +
              "access was blocked. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET " +
              "to use the authenticated API.",
          );
        }
        if (useCache) this.cache.set(cacheKey, payload);
        return payload;
      }

      if (status === 404) {
        throw new NotFound(`Reddit has nothing at ${path}. Check the spelling.`);
      }

      if (status === 403 || status === 451) {
        // A 403 means two completely different things depending on who is
        // asking. Anonymously it almost always means Reddit blocked the caller,
        // not that the subreddit is restricted, and telling a new user to check
        // the subreddit sends them the wrong way.
        if (anonymous) {
          throw new Forbidden(
            "Reddit blocked this anonymous request. Reddit now refuses most " +
              "unauthenticated traffic, so this is expected without credentials " +
              "rather than a problem with the subreddit. Create a free script app " +
              "at https://www.reddit.com/prefs/apps and set REDDIT_CLIENT_ID and " +
              "REDDIT_CLIENT_SECRET.",
          );
        }
        throw new Forbidden(
          `Reddit refused ${path} with HTTP ${status}. The subreddit is likely ` +
            "private, quarantined, banned, or restricted to logged-in users.",
        );
      }

      if (status === 401) {
        // The token went stale mid-run. Drop it and let the retry re-auth.
        this.token = null;
        this.tokenExpiresAt = 0;
        token = await this.accessToken();
        lastError = "Reddit returned HTTP 401";
        continue;
      }

      if (status === 429 || status >= 500) {
        lastError = `Reddit returned HTTP ${status}`;
        if (attempt + 1 < this.config.maxRetries) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
          await sleep(Math.min(delay, 30_000));
          continue;
        }
        if (status === 429) {
          throw new RateLimited(
            "Reddit rate limited this run. Authenticated apps get 100 requests a " +
              "minute and anonymous access gets far less, so set REDDIT_CLIENT_ID " +
              "and REDDIT_CLIENT_SECRET, or ask for fewer threads.",
          );
        }
        throw new RedditError(lastError);
      }

      throw new RedditError(
        `Reddit returned HTTP ${status} for ${path}: ${(await response.text()).slice(0, 200)}`,
      );
    }

    throw new RedditError(lastError || `${path} failed after ${this.config.maxRetries} attempts`);
  }

  get status(): Record<string, unknown> {
    return {
      authState: this.authState,
      authMode: this.config.authMode,
      credentialsPresent: hasCredentials(this.config),
      requestsMade: this.requestsMade,
      cache: this.cache.stats,
      userAgent: this.config.userAgent,
      writeAccess: false,
    };
  }
}
