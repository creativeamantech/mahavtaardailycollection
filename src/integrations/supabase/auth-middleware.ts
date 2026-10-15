import { createMiddleware } from "@tanstack/react-start";

// No-op middleware - Supabase auth removed, no login required
export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    return next();
  },
);
