import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authSupabase } from "@/lib/mcp/auth-client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Every app page requires sign-in. Unauthenticated visitors are sent to the
  // sign-in page with the originally requested path preserved.
  beforeLoad: async ({ location }) => {
    const { data } = await authSupabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.search;
      throw redirect({ to: "/login", search: { next } });
    }
  },
  component: () => <Outlet />,
});
