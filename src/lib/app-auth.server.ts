import { createMiddleware } from "@tanstack/react-start";

// Server-side authentication for app server functions. Every direct HTTP
// server-fn call must present a valid Supabase access token; the token is
// verified against Supabase Auth with the admin client.
export const requireAppAuth = createMiddleware({ type: "function" }).server(
  async ({ next, request }) => {
    const header = request?.headers?.get("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

    if (!token) {
      // Direct HTTP calls always carry a request object: reject them.
      // Headerless internal calls (e.g. MCP tool handlers inside the
      // OAuth-verified /mcp request) have no HTTP request of their own here.
      if (request) {
        throw new Response("Unauthorized", { status: 401 });
      }
      return next();
    }

    const { createAdminClient } = await import("./supabase-admin.server");
    const { data, error } = await createAdminClient().auth.getUser(token);
    if (error || !data.user) {
      throw new Response("Unauthorized", { status: 401 });
    }
    return next({ context: { userId: data.user.id } });
  },
);
