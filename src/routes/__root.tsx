import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LogOut, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { useAppConfig } from "@/hooks/useAppConfig";
import { FEATURES } from "@/lib/app-config.functions";
import { getCurrentSession, logoutCurrentSession } from "@/lib/auth.functions";
import { LoginScreen } from "@/components/LoginScreen";
import { DraggableMobileNavButton } from "@/components/DraggableMobileNavButton";
import { MahavtaarLogoMark } from "@/components/MahavtaarLogo3D";
import { ADMIN_NAV_ITEMS, WORKSPACE_NAV_ITEMS } from "@/components/navRegistry";
import { QuickCommandSearch, QuickSearchTriggerButton } from "@/components/QuickCommandSearch";

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
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
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
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=JetBrains+Mono:wght@400..700&family=Plus+Jakarta+Sans:wght@500..800&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/Favicon.ico", type: "image/x-icon" },
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

const SIDEBAR_STORAGE_KEY = "mahavtaar-sidebar-collapsed";

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved === "1") setSidebarCollapsed(true);
    } catch {
      // Ignore storage access restrictions.
    }
  }, []);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage write restrictions.
      }
      return next;
    });
  }

  const visibleNav = WORKSPACE_NAV_ITEMS.filter((n) => flags[n.key] !== false);
  const visibleAdminNav =
    session?.role === "Admin" ? ADMIN_NAV_ITEMS.filter((n) => flags[n.key] !== false) : [];

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
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
      toast.error("Could not securely sign out. Please try again.");
      await qc.invalidateQueries({ queryKey: ["auth-session"] });
    }
  }

  const activeRouteLabel =
    [...WORKSPACE_NAV_ITEMS, ...ADMIN_NAV_ITEMS].find((n) => n.to === pathname)?.label ??
    "Collection workspace";

  const linkClass = (active: boolean, collapsed = false) =>
    `group flex min-h-10 items-center rounded-xl text-[13px] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2"
    } ${
      active
        ? "border border-[#edd068] bg-[#fef8e2] font-bold text-[#28145e] shadow-[0_2px_8px_rgba(93,33,114,0.06)]"
        : "border border-transparent font-medium text-[#5a556a] hover:bg-[#f4f0f9] hover:text-[#242236]"
    }`;

  return (
    <div
      data-app-shell
      className="min-h-screen min-h-[100dvh] w-full min-w-0 max-w-full overflow-x-clip bg-background text-foreground"
    >
      {/* Desktop Collapsible CRM Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-card text-foreground shadow-[1px_0_14px_rgba(40,20,94,0.03)] transition-[width] duration-200 ease-out md:flex print:hidden ${
          sidebarCollapsed ? "w-[76px]" : "w-[256px]"
        }`}
      >
        <div className="mahavtaar-spectrum-bar h-[3px] w-full shrink-0" aria-hidden="true" />
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5">
          <Link
            to="/"
            title="Mahavtaar Daily Collection"
            className={`flex items-center ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-2"}`}
          >
            <MahavtaarLogoMark
              alt="Mahavtaar Enterprises"
              className="size-10 shrink-0 object-contain"
            />
            {!sidebarCollapsed && (
              <span className="min-w-0">
                <span className="font-display block truncate text-sm font-extrabold tracking-tight text-[#28145e]">
                  Mahavtaar
                </span>
                <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">
                  Daily Collection CRM
                </span>
              </span>
            )}
          </Link>

          <div>
            {!sidebarCollapsed && (
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Workspace
              </p>
            )}
            <nav aria-label="Main navigation" className="grid gap-1">
              {visibleNav.map((n) => {
                const Icon = n.icon;
                const active = pathname === n.to;
                return (
                  <Link
                    key={n.to}
                    to={n.to as never}
                    preload="intent"
                    activeOptions={{ exact: n.to === "/" }}
                    title={sidebarCollapsed ? n.label : undefined}
                    aria-label={sidebarCollapsed ? n.label : undefined}
                    className={linkClass(active, sidebarCollapsed)}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active ? "text-[#5d2172]" : "text-[#746e87] group-hover:text-[#28145e]"
                      }`}
                      aria-hidden="true"
                    />
                    {!sidebarCollapsed && <span className="truncate">{n.label}</span>}
                  </Link>
                );
              })}
            </nav>
          </div>

          {visibleAdminNav.length > 0 && (
            <div>
              {!sidebarCollapsed && (
                <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Administration
                </p>
              )}
              <nav aria-label="Administration navigation" className="grid gap-1">
                {visibleAdminNav.map((n) => {
                  const Icon = n.icon;
                  const active = pathname === n.to;
                  return (
                    <Link
                      key={n.to}
                      to={n.to as never}
                      preload="intent"
                      title={sidebarCollapsed ? n.label : undefined}
                      aria-label={sidebarCollapsed ? n.label : undefined}
                      className={linkClass(active, sidebarCollapsed)}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          active ? "text-[#5d2172]" : "text-[#746e87] group-hover:text-[#28145e]"
                        }`}
                        aria-hidden="true"
                      />
                      {!sidebarCollapsed && <span className="truncate">{n.label}</span>}
                    </Link>
                  );
                })}
              </nav>
            </div>
          )}

          <div className="mt-auto border-t border-border px-1.5 pt-4">
            {!sidebarCollapsed && (
              <div className="mb-3 px-1.5">
                <p className="truncate text-xs font-bold text-foreground">{session.name}</p>
                <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                  {session.role}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={signOut}
              title={sidebarCollapsed ? "Log out" : undefined}
              aria-label="Log out"
              className={`flex min-h-10 w-full items-center rounded-lg border border-border text-xs font-semibold text-[#5a556a] transition-colors hover:border-[#edd068] hover:bg-[#fef8e2] hover:text-[#28145e] ${
                sidebarCollapsed ? "justify-center px-0" : "gap-2.5 px-3"
              }`}
            >
              <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {!sidebarCollapsed && <span>Log out</span>}
            </button>
          </div>
        </div>
      </aside>

      <div
        className={`min-w-0 transition-[padding-left] duration-200 ease-out ${
          sidebarCollapsed ? "md:pl-[76px]" : "md:pl-[256px]"
        }`}
      >
        {/* Clean 3-Zone Sticky CRM Top Bar */}
        <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur print:hidden">
          <div className="flex min-h-[58px] items-center justify-between gap-4 px-4 sm:px-6 md:min-h-[64px] md:px-8">
            {/* Zone 1: Collapse Toggle + Context Breadcrumb (Desktop) / Compact Brand (Mobile) */}
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-[#c9b3dc] hover:bg-card hover:text-[#28145e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              <div className="flex min-w-0 items-center gap-2.5 md:hidden">
                <MahavtaarLogoMark
                  alt="Mahavtaar Enterprises"
                  className="size-8 shrink-0 object-contain"
                />
                <span className="font-display truncate text-sm font-extrabold tracking-tight text-[#28145e]">
                  Mahavtaar CRM
                </span>
              </div>

              <div className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground md:flex">
                <span className="whitespace-nowrap">Workspace</span>
                <span aria-hidden="true">/</span>
                <span className="font-display truncate font-bold text-[#28145e]">
                  {activeRouteLabel}
                </span>
              </div>
            </div>

            {/* Zone 2: Quick Command Search (Cmd+K) */}
            <div className="flex items-center justify-center">
              <QuickSearchTriggerButton onClick={() => setCommandOpen(true)} />
            </div>

            {/* Zone 3: Account Identity & Mobile Sign Out */}
            <div className="flex shrink-0 items-center gap-2.5">
              <div className="hidden text-right sm:block">
                <p className="text-xs font-bold text-foreground">{session.name}</p>
                <p className="text-[10px] font-medium text-muted-foreground">{session.role}</p>
              </div>
              <span
                className="grid size-9 place-items-center rounded-full border border-[#edd068] bg-[#fef8e2] font-display text-xs font-extrabold text-[#5d2172]"
                aria-hidden="true"
              >
                {session.name.slice(0, 1).toUpperCase()}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-[#5a556a] transition-colors hover:border-[#edd068] hover:bg-[#fef8e2] hover:text-[#28145e] whitespace-nowrap shrink-0 md:hidden"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {disabled ? (
          <main className="mx-auto w-full max-w-xl px-4 py-16 text-center">
            <p className="text-lg font-semibold">This page is currently turned off.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Please contact the admin or open Settings.
            </p>
          </main>
        ) : (
          <div className="min-w-0 pb-[calc(9rem+env(safe-area-inset-bottom))] md:pb-0">
            <Outlet />
          </div>
        )}
      </div>

      {/* Global Quick Command Search Modal */}
      <QuickCommandSearch
        open={commandOpen}
        onOpenChange={setCommandOpen}
        workspaceItems={visibleNav}
        adminItems={visibleAdminNav}
        currentPathname={pathname}
        onSignOut={() => void signOut()}
      />

      {/* Global Mobile Navigation Trigger & Drawer */}
      <DraggableMobileNavButton
        open={mobileNavOpen}
        onToggle={() => setMobileNavOpen((open) => !open)}
      />

      {mobileNavOpen && (
        <div className="fixed inset-0 z-[9999] md:hidden print:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-[#1a1033]/45 backdrop-blur-[1px]"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside
            id="global-mobile-navigation"
            aria-label="Mobile navigation"
            className="absolute inset-y-0 left-0 flex w-[min(84vw,320px)] flex-col overflow-hidden border-r border-border bg-card text-foreground shadow-2xl"
          >
            <div className="mahavtaar-spectrum-bar h-[3px] w-full shrink-0" aria-hidden="true" />
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
              <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
                <Link
                  to="/"
                  onClick={() => setMobileNavOpen(false)}
                  className="flex min-w-0 items-center gap-3"
                >
                  <MahavtaarLogoMark
                    alt="Mahavtaar Enterprises"
                    className="size-10 shrink-0 object-contain"
                  />
                  <span className="min-w-0">
                    <span className="font-display block text-sm font-extrabold tracking-tight text-[#28145e]">
                      Mahavtaar
                    </span>
                    <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground">
                      Daily Collection CRM
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation"
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <div>
                <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Workspace
                </p>
                <nav aria-label="Workspace navigation" className="grid gap-1">
                  {visibleNav.map((n) => {
                    const Icon = n.icon;
                    const active = pathname === n.to;
                    return (
                      <Link
                        key={n.to}
                        to={n.to as never}
                        preload="intent"
                        activeOptions={{ exact: n.to === "/" }}
                        onClick={() => setMobileNavOpen(false)}
                        className={linkClass(active)}
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 ${
                            active ? "text-[#5d2172]" : "text-[#746e87]"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{n.label}</span>
                      </Link>
                    );
                  })}
                </nav>
              </div>
              {visibleAdminNav.length > 0 && (
                <div>
                  <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Administration
                  </p>
                  <nav aria-label="Administration navigation" className="grid gap-1">
                    {visibleAdminNav.map((n) => {
                      const Icon = n.icon;
                      const active = pathname === n.to;
                      return (
                        <Link
                          key={n.to}
                          to={n.to as never}
                          preload="intent"
                          onClick={() => setMobileNavOpen(false)}
                          className={linkClass(active)}
                        >
                          <Icon
                            className={`h-4 w-4 shrink-0 ${
                              active ? "text-[#5d2172]" : "text-[#746e87]"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="truncate">{n.label}</span>
                        </Link>
                      );
                    })}
                  </nav>
                </div>
              )}
              <div className="mt-auto border-t border-border px-2 pt-4">
                <p className="truncate text-xs font-bold text-foreground">{session.name}</p>
                <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                  {session.role}
                </p>
                <button
                  type="button"
                  onClick={signOut}
                  className="mt-4 flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-border px-3 text-left text-xs font-semibold text-[#5a556a] transition hover:border-[#edd068] hover:bg-[#fef8e2] hover:text-[#28145e]"
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Log out</span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
