// Shared helpers for the web tests: a fresh QueryClient, a MemoryRouter and a mock fetch.
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import type { ReactNode } from "react";
import { App } from "../App";
import type { Me } from "./api";

export const ANN: Me = {
  role: "user",
  id: "6f1c1a52-3d4e-4c55-9a0b-1b2c3d4e5f60",
  email: "ann@mail.com",
  name: "Ann",
};

export const OLGA: Me = {
  role: "organizer",
  id: "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d",
  email: "olga@mail.com",
  name: "Olga",
};

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

export function json(status: number, body?: unknown): Response {
  if (body === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function keyOf(input: unknown, init: RequestInit | undefined): string {
  return `${init?.method ?? "GET"} ${String(input)}`;
}

// Replaces fetch. Keys are "METHOD /path"; an unknown route fails the call loudly.
export function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = keyOf(input, init);
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected fetch: ${key}`);
    return handler(init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function callsTo(fn: ReturnType<typeof mockFetch>, key: string): number {
  return fn.mock.calls.filter(([input, init]) => keyOf(input, init) === key).length;
}

export function bodyOf(fn: ReturnType<typeof mockFetch>, key: string): unknown {
  const call = fn.mock.calls.find(([input, init]) => keyOf(input, init) === key);
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

export function renderWith(ui: ReactNode, path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

export function renderApp(path: string) {
  return renderWith(<App />, path);
}
