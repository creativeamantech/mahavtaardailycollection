import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { useAppConfig } from "@/hooks/useAppConfig";
import { FEATURES } from "@/lib/app-config.functions";
import { useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentSession, logoutCurrentSession } from "@/lib/auth.functions";
import { LoginScreen } from "@/components/LoginScreen";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { title: "Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Record daily loan collections by executive with instant confirmation and printable receipts.",
      },
      { property: "og:title", content: "Mahavtaar Daily Collection" },
      {
        property: "og:description",
        content:
          "Record daily loan collections by executive with instant confirmation and printable receipts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Mahavtaar Daily Collection" },
      {
        name: "twitter:description",
        content:
          "Record daily loan collections by executive with instant confirmation and printable receipts.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/73fef374-77d5-45a2-854c-ca14f657137a",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/73fef374-77d5-45a2-854c-ca14f657137a",
      },
    ],

    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const NAV = [
  { to: "/", label: "Entry", key: "entry" },
  { to: "/report", label: "Report", key: "report" },
  { to: "/loans", label: "Loan Details", key: "loans" },
  { to: "/executive-cities", label: "Exec Cities", key: "execCities" },
  { to: "/pending", label: "Pending", key: "pending" },
  { to: "/ecs", label: "ECS / Special", key: "ecs" },
  { to: "/notifications", label: "Notifications", key: "notifications" },
] as const;

const ADMIN_NAV = [
  { to: "/settings", label: "Settings", key: "settings" },
  { to: "/admin-loan-audit", label: "Productivity Desk", key: "adminLoanAudit" },
  { to: "/conflicts", label: "Conflicts", key: "conflicts" },
  { to: "/already-paid", label: "Already Paid", key: "alreadyPaid" },
  { to: "/excluded-loans", label: "Excluded Loans", key: "report" },
] as const;

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}

function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();
  const loadSession = useServerFn(getCurrentSession);
  const logout = useServerFn(logoutCurrentSession);
  const { data: session, isLoading } = useQuery({
    queryKey: ["auth-session"],
    queryFn: () => loadSession(),
    retry: false,
    staleTime: 30_000,
  });
  const { flags } = useAppConfig({ enabled: !isLoading && Boolean(session) });
  const current = FEATURES.find((f) => f.path === pathname);
  const disabled = current ? flags[current.key] === false : false;
  const [adminOpen, setAdminOpen] = useState(false);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Verifying authentication...
      </main>
    );
  }
  if (!session) return <LoginScreen />;

  async function signOut() {
    try {
      await logout();
      await qc.invalidateQueries();
    } catch {
      // The browser cookie is cleared by the server; stateless tokens expire automatically.
      await qc.invalidateQueries({ queryKey: ["auth-session"] });
    }
  }

  return (
    <>
      <div className="min-h-screen bg-background">
        <header className="border-b print:hidden">
          <div className="mx-auto w-full max-w-3xl px-4 py-3">
            <p className="text-lg font-bold tracking-tight">Mahavtaar Daily Collection</p>
            <nav className="mt-2 flex flex-wrap items-start gap-2">
              {NAV.filter((n) => flags[n.key] !== false).map((n) => (
                <Link
                  key={n.to}
                  to={n.to as never}
                  className="rounded-lg border px-4 py-2 text-base font-medium"
                  activeOptions={{ exact: n.to === "/" }}
                  activeProps={{
                    className:
                      "rounded-lg border border-primary bg-primary px-4 py-2 text-base font-medium text-primary-foreground",
                  }}
                >
                  {n.label}
                </Link>
              ))}
              {session.role === "Admin" && ADMIN_NAV.some((n) => flags[n.key] !== false) && (
                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  <button
                    type="button"
                    aria-expanded={adminOpen}
                    onClick={() => setAdminOpen((v) => !v)}
                    className="rounded-lg border px-4 py-2 text-base font-semibold"
                  >
                    Admin {adminOpen ? "▴" : "▾"}
                  </button>
                  {adminOpen && (
                    <div className="w-full basis-full rounded-lg border bg-background p-3 shadow-sm sm:w-auto sm:min-w-56 sm:basis-auto">
                      <div className="flex flex-col gap-1">
                        {ADMIN_NAV.filter((n) => flags[n.key] !== false).map((n) => (
                          <Link
                            key={n.label}
                            to={n.to as never}
                            onClick={() => setAdminOpen(false)}
                            className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                          >
                            {n.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="ml-auto flex items-center gap-2 text-sm">
                <span className="font-medium">
                  {session.name} · {session.role}
                </span>
                <button type="button" onClick={signOut} className="rounded-lg border px-3 py-2">
                  Logout
                </button>
              </div>
            </nav>
          </div>
        </header>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        {disabled ? (
          <main className="mx-auto w-full max-w-xl px-4 py-16 text-center">
            <p className="text-lg font-semibold">This page is currently turned off.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Please contact the admin or open Settings.
            </p>
          </main>
        ) : (
          <Outlet />
        )}
      </div>
    </>
  );
}
