import { ApiError, request } from "./api";

// api-base-url.md R7-R10: request() joins VITE_API_URL and the path, and sends
// the cookie cross-origin only when a base URL is set.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response(null, { status: 204 }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("R7: no base URL", () => {
  it("unset: calls the relative path with credentials same-origin", async () => {
    vi.stubEnv("VITE_API_URL", undefined);
    const fetch = stubFetch();
    await request("/auth/me");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/auth/me");
    expect(fetch.mock.calls[0][1]?.credentials).toBe("same-origin");
  });

  it("empty: calls the relative path with credentials same-origin", async () => {
    vi.stubEnv("VITE_API_URL", "");
    const fetch = stubFetch();
    await request("/auth/me");
    expect(fetch.mock.calls[0][0]).toBe("/auth/me");
    expect(fetch.mock.calls[0][1]?.credentials).toBe("same-origin");
  });
});

describe("R8: a base URL", () => {
  it("calls base + path with credentials include", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    const fetch = stubFetch();
    await request("/auth/me");
    expect(fetch.mock.calls[0][0]).toBe("https://api.example.com/auth/me");
    expect(fetch.mock.calls[0][1]?.credentials).toBe("include");
  });

  it("keeps the rest of the init and still turns a network error into ApiError(0)", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    const fetch = stubFetch();
    await request("/auth/users/login", { method: "POST", body: "{}" });
    expect(fetch.mock.calls[0][0]).toBe("https://api.example.com/auth/users/login");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", body: "{}", credentials: "include" });

    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const error = await request("/auth/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  it("reads the base on each call", async () => {
    const fetch = stubFetch();
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    await request("/auth/me");
    vi.stubEnv("VITE_API_URL", "");
    await request("/auth/me");
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["https://api.example.com/auth/me", "/auth/me"]);
  });
});

describe("R9: a base URL with a trailing slash", () => {
  it("gives the same URL as R8, with no double slash", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com/");
    const fetch = stubFetch();
    await request("/auth/me");
    expect(fetch.mock.calls[0][0]).toBe("https://api.example.com/auth/me");
    expect(fetch.mock.calls[0][1]?.credentials).toBe("include");
  });
});

describe("R10: a whitespace-only base", () => {
  it("counts as empty", async () => {
    vi.stubEnv("VITE_API_URL", "   ");
    const fetch = stubFetch();
    await request("/auth/me");
    expect(fetch.mock.calls[0][0]).toBe("/auth/me");
    expect(fetch.mock.calls[0][1]?.credentials).toBe("same-origin");
  });
});
