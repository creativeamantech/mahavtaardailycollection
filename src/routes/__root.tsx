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
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
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
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Try again
          </button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
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
      { name: "description", content: "Record daily loan collections by executive with instant confirmation and printable receipts." },
      { property: "og:title", content: "Mahavtaar Daily Collection" },
      { property: "og:description", content: "Record daily loan collections by executive with instant confirmation and printable receipts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Mahavtaar Daily Collection" },
      { name: "twitter:description", content: "Record daily loan collections by executive with instant confirmation and printable receipts." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/73fef374-77d5-45a2-854c-ca14f657137a" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/73fef374-77d5-45a2-854c-ca14f657137a" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
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
      <head><HeadContent /></head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const NAV = [
  { to: "/", label: "Collection Entry", short: "Entry", icon: "＋", key: "entry" },
  { to: "/collection-sheet", label: "Collection Sheet", short: "Sheet", icon: "▤", key: "report" },
  { to: "/report", label: "Reports", short: "Reports", icon: "▥", key: "report" },
  { to: "/loans", label: "Loan Details", short: "Loans", icon: "▣", key: "loans" },
  { to: "/executive-cities", label: "Executive Cities", short: "Cities", icon: "⌖", key: "execCities" },
  { to: "/pending", label: "Pending", short: "Pending", icon: "◷", key: "pending" },
  { to: "/ecs", label: "ECS / Special", short: "ECS", icon: "₹", key: "ecs" },
  { to: "/notifications", label: "Notifications", short: "Alerts", icon: "♧", key: "notifications" },
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
  const [moreOpen, setMoreOpen] = useState(false);
  const visibleNav = NAV.filter((n) => flags[n.key] !== false);
  const visibleAdminNav = ADMIN_NAV.filter((n) => flags[n.key] !== false);
  const primaryMobile = visibleNav.filter((n) => ["/", "/collection-sheet", "/report"].includes(n.to));
  const secondaryMobile = visibleNav.filter((n) => !["/", "/collection-sheet", "/report"].includes(n.to));
  const isSecondaryActive = secondaryMobile.some((n) => n.to === pathname) ||
    (session?.role === "Admin" && visibleAdminNav.some((n) => n.to === pathname));

  if (isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Verifying authentication...</main>;
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

  const linkClass = (active: boolean) =>
    active
      ? "flex min-h-11 items-center gap-3 rounded-xl bg-[#f0c44e] px-3 py-2.5 text-sm font-bold text-[#253329] shadow-sm"
      : "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#d7e5dc] transition hover:bg-white/10 hover:text-white";

  return (
    <div className="min-h-screen bg-[#f3f6f3] text-[#17211d]">
      {/* Desktop navigation follows the approved prototype: a readable fixed-width sidebar. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[238px] flex-col gap-8 overflow-y-auto bg-[#123d30] px-4 py-6 text-[#eaf2ed] md:flex print:hidden">
        <Link to="/" className="flex items-center gap-3 px-2">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#efc34c] text-lg font-black text-[#263329]">M</span>
          <span className="min-w-0"><span className="block text-sm font-extrabold tracking-tight">Mahavtaar</span><span className="mt-0.5 block text-[11px] text-[#b9c9c0]">Daily Collection</span></span>
        </Link>
        <div>
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.17em] text-[#9db5a8]">Workspace</p>
          <nav aria-label="Main navigation" className="grid gap-1">
            {visibleNav.map((n) => (
              <Link key={n.to} to={n.to as never} preload="intent" activeOptions={{ exact: n.to === "/" }} className={linkClass(pathname === n.to)}>
                <span className="grid w-5 shrink-0 place-items-center text-base" aria-hidden="true">{n.icon}</span>
                <span>{n.label}</span>
              </Link>
            ))}
          </nav>
        </div>
        {session.role === "Admin" && visibleAdminNav.length > 0 && (
          <div>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.17em] text-[#9db5a8]">Administration</p>
            <nav aria-label="Administration navigation" className="grid gap-1">
              {visibleAdminNav.map((n) => (
                <Link key={n.to} to={n.to as never} preload="intent" className={linkClass(pathname === n.to)}>
                  <span className="grid w-5 shrink-0 place-items-center text-base" aria-hidden="true">⚙</span>
                  <span>{n.label}</span>
                </Link>
              ))}
            </nav>
          </div>
        )}
        <div className="mt-auto border-t border-white/15 px-2 pt-4">
          <p className="truncate text-xs font-semibold text-white">{session.name}</p>
          <p className="mt-1 text-[11px] text-[#b9c9c0]"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-[#65d49b]" />{session.role} · Online</p>
          <button type="button" onClick={signOut} className="mt-4 min-h-10 w-full rounded-lg border border-white/20 px-3 text-left text-xs font-semibold text-[#eaf2ed] transition hover:bg-white/10">↪ Log out</button>
        </div>
      </aside>

      <div className="min-w-0 md:pl-[238px]">
        {/* Mobile header is intentionally limited to brand and identity. */}
        <header className="sticky top-0 z-30 border-b border-[#e4eae5] bg-white/95 shadow-sm backdrop-blur print:hidden">
          <div className="flex min-h-[62px] items-center justify-between gap-3 px-4 sm:px-6 md:min-h-[68px] md:px-8">
            <div className="flex min-w-0 items-center gap-3 md:hidden">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#123d30] text-sm font-black text-[#efc34c]">M</span>
              <span className="min-w-0"><span className="block truncate text-sm font-extrabold text-[#17211d]">Mahavtaar Daily Collection</span><span className="block text-[10px] text-[#718078]">Collection workspace</span></span>
            </div>
            <div className="hidden min-w-0 items-center gap-2 text-xs text-[#718078] md:flex">
              <span>Workspace</span><span aria-hidden="true">/</span><span className="truncate font-bold text-[#17211d]">{[...NAV, ...ADMIN_NAV].find((n) => n.to === pathname)?.label ?? "Collection workspace"}</span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-3">
              <div className="hidden text-right sm:block"><p className="text-xs font-bold text-[#17211d]">{session.name}</p><p className="text-[10px] text-[#718078]">{session.role}</p></div>
              <span className="grid size-9 place-items-center rounded-full bg-[#e6efe8] text-xs font-extrabold text-[#174d3b]" aria-hidden="true">{session.name.slice(0, 1).toUpperCase()}</span>
              <button type="button" onClick={signOut} className="rounded-lg border border-[#e4eae5] px-3 py-2 text-xs font-semibold text-[#45564b] hover:bg-[#fff8e8] md:hidden">Logout</button>
            </div>
          </div>
        </header>

        {disabled ? (
          <main className="mx-auto w-full max-w-xl px-4 py-16 text-center">
            <p className="text-lg font-semibold">This page is currently turned off.</p>
            <p className="mt-2 text-sm text-muted-foreground">Please contact the admin or open Settings.</p>
          </main>
        ) : (
          <div className="min-w-0 pb-24 md:pb-0"><Outlet /></div>
        )}
      </div>

      {/* Mobile uses the prototype's compact bottom navigation; secondary links live in More. */}
      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-[100] isolate grid grid-cols-4 border-t border-[#dfe7e1] bg-white px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 shadow-[0_-5px_20px_rgba(25,48,37,0.08)] md:hidden print:hidden">
        {primaryMobile.map((n) => (
          <Link key={n.to} to={n.to as never} preload="intent" activeOptions={{ exact: n.to === "/" }} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-semibold ${pathname === n.to ? "text-[#174d3b]" : "text-[#718078]"}`}>
            <span className={`grid size-7 place-items-center rounded-lg text-base ${pathname === n.to ? "bg-[#fff2c9] text-[#174d3b]" : ""}`} aria-hidden="true">{n.icon}</span>
            <span>{n.short}</span>
          </Link>
        ))}
        <button type="button" aria-expanded={moreOpen} aria-controls="mobile-more-menu" onClick={() => setMoreOpen((v) => !v)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-semibold ${moreOpen || isSecondaryActive ? "text-[#174d3b]" : "text-[#718078]"}`}>
          <span className={`grid size-7 place-items-center rounded-lg text-base ${moreOpen || isSecondaryActive ? "bg-[#fff2c9]" : ""}`} aria-hidden="true">☰</span>
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden print:hidden">
          <button type="button" aria-label="Close more menu" className="absolute inset-0 bg-[#10291f]/35" onClick={() => setMoreOpen(false)} />
          <section id="mobile-more-menu" className="absolute inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto rounded-2xl border border-[#e4eae5] bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-extrabold text-[#17211d]">More sections</h2><button type="button" onClick={() => setMoreOpen(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#718078] hover:bg-[#f3f6f3]">Close ✕</button></div>
            <div className="grid grid-cols-2 gap-2">
              {secondaryMobile.map((n) => (
                <Link key={n.to} to={n.to as never} preload="intent" onClick={() => setMoreOpen(false)} className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${pathname === n.to ? "border-[#d6b64d] bg-[#fff8e8] text-[#174d3b]" : "border-[#e4eae5] text-[#45564b] hover:bg-[#f8faf8]"}`}>
                  <span className="text-base" aria-hidden="true">{n.icon}</span>{n.label}
                </Link>
              ))}
              {session.role === "Admin" && visibleAdminNav.map((n) => (
                <Link key={n.to} to={n.to as never} preload="intent" onClick={() => setMoreOpen(false)} className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${pathname === n.to ? "border-[#d6b64d] bg-[#fff8e8] text-[#174d3b]" : "border-[#e4eae5] text-[#45564b] hover:bg-[#f8faf8]"}`}>
                  <span className="text-base" aria-hidden="true">⚙</span>{n.label}
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
