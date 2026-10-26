import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authSupabase } from "@/lib/mcp/auth-client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Every app page requires sign-in. Unauthenticated visitors are sent to the
  // sign-in page with the originally requested path preserved.
  beforeLoad: async ({ location }) => {
    const { data } = await authSupabase.auth.getSession();
    if (!data.session) {
      // location.href is the pathname plus query string as a plain string.
      throw redirect({ to: "/login", search: { next: location.href } });
    }
  },
  component: () => <Outlet />,
});
