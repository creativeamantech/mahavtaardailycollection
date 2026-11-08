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
  { to: "/collection-sheet", label: "Collection Sheet", key: "report" },
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
        <header className="sticky top-0 z-40 border-b border-[#e8e2d4] bg-white/95 shadow-sm backdrop-blur print:hidden">
          <div className="mx-auto w-full max-w-7xl px-3 py-3 sm:px-5 lg:px-8">
            <div className="flex items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#29271f] text-sm font-black text-[#f4c542]">M</div><div><p className="text-base font-extrabold tracking-tight text-[#29271f] sm:text-lg">Mahavtaar Daily Collection</p><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a47a12]">Collection workspace</p></div></div>
            <nav className="mt-3 flex flex-wrap items-center gap-2">
              {NAV.filter((n) => flags[n.key] !== false).map((n) => (
                <Link
                  key={n.to}
                  to={n.to as never}
                  preload="intent"
                  className="rounded-xl border border-[#e8e2d4] bg-white px-3 py-2 text-sm font-semibold text-[#555248] transition hover:border-[#d6b64d] hover:bg-[#fffaf0]"
                  activeOptions={{ exact: n.to === "/" }}
                  activeProps={{
                    className:
                      "rounded-xl border border-[#29271f] bg-[#29271f] px-3 py-2 text-sm font-semibold text-white shadow-sm",
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
                            preload="intent"
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
              <div className="ml-auto flex w-full items-center justify-between gap-2 border-t border-[#eee9dd] pt-2 text-xs sm:w-auto sm:justify-end sm:border-0 sm:pt-0 sm:text-sm">
                <span className="font-medium">
                  {session.name} · {session.role}
                </span>
                <button type="button" onClick={signOut} className="rounded-xl border border-[#e8e2d4] px-3 py-2 text-xs font-semibold transition hover:bg-[#fff7df] sm:text-sm">
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
