import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { useSheetAuth, getStoredSheetToken } from "@/hooks/useSheetAuth";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    // Client-side quick check
    if (typeof window !== "undefined") {
      const token = getStoredSheetToken();
      if (!token) {
        throw redirect({
          to: "/login",
          search: {
            next: location.href,
          },
        });
      }
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, token, isLoading } = useSheetAuth();
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (s) => s.location.href });

  useEffect(() => {
    if (!isLoading && (!token || !user)) {
      navigate({
        to: "/login",
        search: {
          next: currentPath,
        },
      });
    }
  }, [isLoading, token, user, navigate, currentPath]);

  if (isLoading && !user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">
          Verifying Google Sheet session...
        </p>
      </div>
    );
  }

  return <Outlet />;
}
