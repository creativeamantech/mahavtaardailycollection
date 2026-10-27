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
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { useAppConfig } from "@/hooks/useAppConfig";
import { FEATURES } from "@/lib/app-config.functions";
import { useRouterState } from "@tanstack/react-router";
import { SheetAuthProvider, useSheetAuth } from "@/hooks/useSheetAuth";
import { LogOut, UserCheck } from "lucide-react";

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
        content: "/assets/aistudio/a_clean_high_resolution_vector_graphic_logo_on_a_b1529b1e.png",
      },
      {
        name: "twitter:image",
        content: "/assets/aistudio/a_clean_high_resolution_vector_graphic_logo_on_a_b1529b1e.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        href: "/assets/aistudio/a_clean_high_resolution_vector_graphic_logo_on_a_b1529b1e.png",
        type: "image/png",
      },
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
  { to: "/conflicts", label: "Conflicts", key: "conflicts" },
  { to: "/ecs", label: "ECS / Special", key: "ecs" },
  { to: "/notifications", label: "Notifications", key: "notifications" },
  { to: "/already-paid", label: "Already Paid", key: "alreadyPaid" },
  { to: "/bank-portal", label: "Bank Portal", key: "bankPortal" },
  { to: "/users", label: "Users", key: "users" },
  { to: "/settings", label: "Settings", key: "settings" },
] as const;

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <SheetAuthProvider>
        <AppShell />
        <Toaster position="top-center" />
      </SheetAuthProvider>
    </QueryClientProvider>
  );
}

function AppShell() {
  const { flags } = useAppConfig();
  const { user, logout } = useSheetAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = FEATURES.find((f) => f.path === pathname);
  const disabled = current ? flags[current.key] === false : false;

  const isLoginPage = pathname === "/login";

  return (
    <>
      <div className="min-h-screen bg-background">
        <header className="border-b print:hidden">
          <div className="mx-auto w-full max-w-3xl px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Link to="/" className="flex items-center gap-2.5 group">
                <img
                  src="/assets/aistudio/a_clean_high_resolution_vector_graphic_logo_on_a_b1529b1e.png"
                  alt="Mahavtaar Daily Collection Logo"
                  className="h-9 w-9 sm:h-10 sm:w-10 object-contain group-hover:scale-105 transition-transform shrink-0"
                />
                <div className="flex flex-col">
                  <span className="text-base sm:text-lg font-extrabold tracking-tight bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-700 dark:from-amber-400 dark:via-yellow-300 dark:to-amber-500 bg-clip-text text-transparent leading-none">
                    MAHAVTAAR
                  </span>
                  <span className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-wider mt-0.5">
                    Daily Collection
                  </span>
                </div>
              </Link>
              {!isLoginPage && (
                <div className="flex items-center gap-2">
                  {user ? (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 py-1 text-xs font-medium">
                        <UserCheck className="h-3.5 w-3.5 text-primary" />
                        <span>{user.executiveName}</span>
                        {user.role === "Admin" && (
                          <span className="rounded bg-amber-500/15 px-1 py-0.2 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                            Admin
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          logout();
                          window.location.href = "/login";
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        title="Sign Out"
                      >
                        <LogOut className="h-3 w-3" />
                        <span className="hidden sm:inline">Sign Out</span>
                      </button>
                    </div>
                  ) : (
                    <Link
                      to="/login"
                      search={{ next: "" }}
                      className="rounded-md border border-primary bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      Sign In
                    </Link>
                  )}
                </div>
              )}
            </div>
            {!isLoginPage && (
              <nav className="mt-2 flex flex-wrap gap-2">
                {NAV.filter((n) => flags[n.key] !== false).map((n) => (
                  <Link
                    key={n.to}
                    to={n.to}
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
              </nav>
            )}
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
