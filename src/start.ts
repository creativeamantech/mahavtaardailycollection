import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { captureAuthHeader } from "./lib/app-auth-request.server";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Attaches the signed-in user's Supabase bearer token to every server-fn
// RPC so the server can verify it with requireAppAuth.
const attachAppAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  try {
    const { authSupabase } = await import("@/lib/mcp/auth-client");
    const { data } = await authSupabase.auth.getSession();
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    return next({ headers: {} });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachAppAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware, captureAuthHeader],
}));
