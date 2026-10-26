import { createMiddleware } from "@tanstack/react-start";

// Captures the Authorization header of every incoming request (server-fn RPCs
// included) into the global request context so function middleware can verify
// it server-side.
export const captureAuthHeader = createMiddleware({ type: "request" }).server(
  async ({ next, request }) => {
    const authHeader = request.headers.get("authorization") ?? "";
    return next({ context: { authHeader } });
  },
);
