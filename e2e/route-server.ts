/**
 * In-process stand-in for the Next.js router, for e2e tests that render components.
 * A request is routed by URL path to the route module Next.js would serve it from
 * (src/app/<path>/route.ts, [param] directories as dynamic segments). A request to a path
 * no route serves answers 404 and is recorded in `unserved`.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const APP_DIR = resolve(process.cwd(), "src/app");

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

/** The route module and params Next.js would serve `pathname` from, or null when none does. */
export function routeFor(pathname: string): { file: string; params: Record<string, string> } | null {
  let dir = APP_DIR;
  const params: Record<string, string> = {};
  for (const segment of pathname.split("/").filter(Boolean)) {
    if (existsSync(join(dir, segment))) {
      dir = join(dir, segment);
      continue;
    }
    const dynamic = readdirSync(dir).find((name) => /^\[[^.\]]+\]$/.test(name));
    if (!dynamic) {
      return null;
    }
    params[dynamic.slice(1, -1)] = decodeURIComponent(segment);
    dir = join(dir, dynamic);
  }
  const file = join(dir, "route.ts");
  return existsSync(file) ? { file, params } : null;
}

export type RouteServer = {
  /** A `fetch` that answers from the route handlers, sending and keeping the current cookies. */
  serve: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** `METHOD /path?query` for every request, in order. */
  requested: string[];
  /** `METHOD /path` for every request no route handler serves. */
  unserved: string[];
  /** The cookies the next requests send (`name=value; ...`). */
  cookies: () => string;
  /** Act as someone else: replace the cookies the next requests send. */
  useCookies: (cookies: string) => void;
};

export function createRouteServer(): RouteServer {
  const requested: string[] = [];
  const unserved: string[] = [];
  const jar = new Map<string, string>();

  async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    requested.push(`${method} ${url.pathname}${url.search}`);
    const route = routeFor(url.pathname);
    const handler = route
      ? ((await import(route.file)) as Record<string, Handler>)[method]
      : undefined;
    if (!route || !handler) {
      unserved.push(`${method} ${url.pathname}`);
      return new Response("not found", { status: 404 });
    }
    const headers = new Headers(init?.headers);
    if (jar.size > 0) {
      headers.set("cookie", cookies());
    }
    const response = await handler(
      new Request(url, { method, headers, body: init?.body ?? undefined }),
      { params: Promise.resolve(route.params) },
    );
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const pair = line.split(";", 1)[0] ?? "";
      const at = pair.indexOf("=");
      if (at > 0) {
        jar.set(pair.slice(0, at), pair.slice(at + 1));
      }
    }
    return response;
  }

  function cookies(): string {
    return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  function useCookies(next: string): void {
    jar.clear();
    for (const pair of next.split(";").map((part) => part.trim()).filter(Boolean)) {
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  }

  return { serve, requested, unserved, cookies, useCookies };
}
