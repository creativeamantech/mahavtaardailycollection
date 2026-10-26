import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authSupabase } from "@/lib/mcp/auth-client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Every app page requires sign-in. Unauthenticated visitors are sent to the
  // sign-in page with the originally requested path preserved.
  beforeLoad: async ({ location }) => {
    const { data } = await authSupabase.auth.getSession();
    if (!data.session) {
      // Build the return target from plain string fields only, so the redirect
      // search can never receive a non-string value.
      const next =
        typeof location.href === "string"
          ? location.href
          : `${location.pathname ?? "/"}${location.searchStr ?? ""}`;
      throw redirect({ to: "/login", search: { next } });
    }
  },
  component: () => <Outlet />,
});
