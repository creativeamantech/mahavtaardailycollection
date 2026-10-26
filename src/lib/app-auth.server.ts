import { createMiddleware } from "@tanstack/react-start";

// Server-side authentication for app server functions. Direct HTTP calls run
// through the request middleware chain, which records the Authorization
// header in context; a present-but-invalid or missing bearer is rejected.
// Headerless in-process calls (e.g. MCP tool handlers inside the
// OAuth-verified /mcp request) carry no authHeader context at all and are
// allowed through — they are never reachable by anonymous HTTP callers.
export const requireAppAuth = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    const authHeader = (context as { authHeader?: string } | undefined)?.authHeader;

    if (authHeader === undefined) {
      return next();
    }

    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!token) {
      throw new Response("Unauthorized", { status: 401 });
    }

    const { createAdminClient } = await import("./supabase-admin.server");
    const { data, error } = await createAdminClient().auth.getUser(token);
    if (error || !data.user) {
      throw new Response("Unauthorized", { status: 401 });
    }
    return next({ context: { userId: data.user.id } });
  },
);
