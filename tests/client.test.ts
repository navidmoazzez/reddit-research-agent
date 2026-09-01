/** Auth, retries, caching, and the error messages people actually read. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { Forbidden, NotFound, RateLimited, RedditClient, RedditError } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { jsonResponse, listing, makePost } from "./helpers.js";

function config(overrides = {}) {
  return loadConfig({
    clientId: "",
    clientSecret: "",
    authMode: "auto",
    cacheTtlMs: 60_000,
    maxRetries: 2,
    minRequestIntervalMs: 0,
    ...overrides,
  });
}

function authed(overrides = {}) {
  return config({ clientId: "id", clientSecret: "secret", ...overrides });
}

/** Anonymous pacing waits 1.1s per request, which no test should sit through. */
const anonConfig = () => config({ minRequestIntervalMs: 0 });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("app-only auth", () => {
  it("fetches a token then uses it as a bearer", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(listing([makePost("a")])));

    const client = new RedditClient(authed());
    await client.get("/r/x/hot");

    expect(client.authState).toBe("app-only");
    const [, init] = fetchMock.mock.calls[1]!;
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });

  it("mints only one token for concurrent requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockImplementation(async () => jsonResponse(listing([])));

    const client = new RedditClient(authed());
    await Promise.all([client.get("/a"), client.get("/b"), client.get("/c")]);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("access_token"),
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it("explains a rejected client id in terms of the mistake people make", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}, 401));
    const client = new RedditClient(authed());
    await expect(client.get("/r/x/hot")).rejects.toThrow(/not the app name itself/);
    expect(client.authState).toBe("rejected");
  });

  it("fails loudly in authenticated mode with no credentials", async () => {
    const client = new RedditClient(config({ authMode: "authenticated" }));
    await expect(client.get("/r/x/hot")).rejects.toThrow(/REDDIT_CLIENT_ID/);
  });
});

describe("errors", () => {
  it("blames the caller, not the subreddit, for an anonymous 403", async () => {
    // Reddit blocks anonymous API traffic, so pointing a new user at the
    // subreddit would send them the wrong way entirely.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}, 403));
    const client = new RedditClient(anonConfig());
    await expect(client.get("/r/x/about")).rejects.toThrow(Forbidden);
    await expect(client.get("/r/y/about")).rejects.toThrow(/blocked this anonymous request/);
  });

  it("blames the subreddit for an authenticated 403", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockImplementation(async () => jsonResponse({}, 403));
    const client = new RedditClient(authed());
    await expect(client.get("/r/x/about")).rejects.toThrow(/private, quarantined, banned/);
  });

  it("raises NotFound on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}, 404));
    await expect(new RedditClient(anonConfig()).get("/r/nope/about")).rejects.toThrow(NotFound);
  });

  it("raises RateLimited after exhausting retries on 429", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("", { status: 429, headers: { "retry-after": "0" } }),
    );
    await expect(new RedditClient(anonConfig()).get("/r/x/hot")).rejects.toThrow(RateLimited);
  });

  it("explains an HTML block page rather than reporting a parse error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("<html>blocked</html>", { status: 200 }));
    await expect(new RedditClient(anonConfig()).get("/r/x/hot")).rejects.toThrow(
      /non-JSON response/,
    );
  });

  it("retries a 500 and succeeds on the second attempt", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(listing([makePost("a")])));
    const payload = await new RedditClient(anonConfig()).get("/r/x/hot");
    expect(payload).toBeTruthy();
  });

  it("surfaces a network failure as a RedditError", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("ECONNRESET"); });
    await expect(new RedditClient(anonConfig()).get("/r/x/hot")).rejects.toThrow(RedditError);
  });
});

describe("caching", () => {
  it("serves a repeated request from cache", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(listing([])));
    const client = new RedditClient(anonConfig());
    await client.get("/r/x/hot");
    await client.get("/r/x/hot");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.cache.stats.hits).toBe(1);
  });

  it("treats different params as different entries", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(listing([])));
    const client = new RedditClient(anonConfig());
    await client.get("/r/x/hot", { limit: 10 });
    await client.get("/r/x/hot", { limit: 25 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("can be bypassed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(listing([])));
    const client = new RedditClient(anonConfig());
    await client.get("/r/x/hot");
    await client.get("/r/x/hot", {}, { useCache: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("requests", () => {
  it("always sends raw_json=1 so comment bodies are not HTML escaped", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(listing([])));
    await new RedditClient(anonConfig()).get("/r/x/hot");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("raw_json=1");
  });

  it("never reports write access", () => {
    expect(new RedditClient(anonConfig()).status["writeAccess"]).toBe(false);
  });
});
