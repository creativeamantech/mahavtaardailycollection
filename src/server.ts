import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (process.env["NODE_ENV"] === "production") {
    const missing = ["LOVABLE_API_KEY", "GOOGLE_SHEETS_API_KEY", "GOOGLE_DRIVE_API_KEY"].filter(
      (key) => !process.env[key],
    );
    if (missing.length)
      throw new Error("Missing production connector configuration: " + missing.join(", "));
  }
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors *",
    "form-action 'self'",
    "img-src 'self' data: blob: https: *",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self' https: wss: ws: *",
    "frame-src 'self' https: https://drive.google.com",
    "font-src 'self' data: https:",
  ].join("; ");
  headers.set("Content-Security-Policy", csp);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const hasSessionCookie = (request.headers.get("cookie") ?? "").includes("mahavtaar_auth=");
      if (hasSessionCookie && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        const origin = request.headers.get("origin");
        if (origin) {
          const originUrl = new URL(origin);
          const requestUrl = new URL(request.url);
          const forwardedHost =
            request.headers.get("x-forwarded-host") ?? request.headers.get("host");
          const isSameOrigin =
            originUrl.origin === requestUrl.origin ||
            (forwardedHost &&
              (originUrl.host === forwardedHost || forwardedHost.startsWith(originUrl.host)));
          const isAllowedDomain =
            originUrl.hostname === "localhost" ||
            originUrl.hostname === "127.0.0.1" ||
            originUrl.hostname.endsWith(".run.app") ||
            originUrl.hostname.endsWith(".lovable.app");
          if (!isSameOrigin && !isAllowedDomain) {
            return applySecurityHeaders(new Response("Forbidden", { status: 403 }));
          }
        }
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return applySecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return applySecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
