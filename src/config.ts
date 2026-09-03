/**
 * Configuration, read once from the environment.
 *
 * Everything here has a working default except the credentials. With none set
 * the server falls back to Reddit's public JSON endpoints, which Reddit now
 * blocks for almost every caller, so that fallback exists to produce a clear
 * diagnosis rather than to be a usable mode.
 */

export const VERSION = "0.1.0";

export const OAUTH_BASE = "https://oauth.reddit.com";
export const PUBLIC_BASE = "https://www.reddit.com";
export const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

/**
 * Reddit asks for a descriptive User-Agent in the documented shape
 * `<platform>:<app id>:<version> (by /u/<username>)`. Sending a generic one is
 * the fastest way to get rate limited into uselessness.
 */
export const DEFAULT_USER_AGENT = `node:reddit-research-agent:v${VERSION} (by /u/thenavidm)`;

export type AuthMode = "auto" | "authenticated" | "anonymous";

export type Config = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly userAgent: string;
  readonly authMode: AuthMode;
  readonly requestTimeoutMs: number;
  readonly minRequestIntervalMs: number;
  readonly maxRetries: number;
  readonly cacheTtlMs: number;
  readonly cacheSize: number;
  readonly maxThreads: number;
  readonly maxCommentsPerThread: number;
};

function num(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback = ""): string {
  return (process.env[name] ?? "").trim() || fallback;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const mode = str("REDDIT_AUTH_MODE", "auto").toLowerCase();
  const authMode: AuthMode =
    mode === "authenticated" || mode === "anonymous" ? mode : "auto";

  return {
    clientId: str("REDDIT_CLIENT_ID"),
    clientSecret: str("REDDIT_CLIENT_SECRET"),
    userAgent: str("REDDIT_USER_AGENT", DEFAULT_USER_AGENT),
    authMode,
    requestTimeoutMs: num("REDDIT_REQUEST_TIMEOUT_MS", 30_000),
    minRequestIntervalMs: num("REDDIT_MIN_REQUEST_INTERVAL_MS", 0),
    maxRetries: num("REDDIT_MAX_RETRIES", 3),
    cacheTtlMs: num("REDDIT_CACHE_TTL_MS", 300_000),
    cacheSize: num("REDDIT_CACHE_SIZE", 512),
    maxThreads: num("REDDIT_MAX_THREADS", 25),
    maxCommentsPerThread: num("REDDIT_MAX_COMMENTS", 400),
    ...overrides,
  };
}

export function hasCredentials(config: Config): boolean {
  return Boolean(config.clientId && config.clientSecret);
}

/** True when we should try the OAuth client-credentials flow. */
export function wantsAppAuth(config: Config): boolean {
  if (config.authMode === "anonymous") return false;
  if (config.authMode === "authenticated") return true;
  return hasCredentials(config);
}
