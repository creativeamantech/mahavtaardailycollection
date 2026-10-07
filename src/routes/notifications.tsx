import { createFileRoute } from "@tanstack/react-router";
import { useAppConfig } from "@/hooks/useAppConfig";
import { NotificationPanel } from "@/components/NotificationPanel";
import { toDirectDriveUrl } from "@/components/NotificationPanel";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Mahavtaar Daily Collection" },
      {
        name: "description",
        content: "Full notification history for the Mahavtaar Daily Collection app.",
      },
      { property: "og:title", content: "Notifications — Mahavtaar Daily Collection" },
      {
        property: "og:description",
        content: "Full notification history for the Mahavtaar Daily Collection app.",
      },
    ],
  }),
  component: NotificationsPage,
});

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: "" };
  return {
    date: d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }),
    time: d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }),
  };
}

function NotificationsPage() {
  const { notifications, activeNotification, isLoading } = useAppConfig();

  // Newest first, excluding removed ones (same active/removed logic as the panel).
  const history = [...notifications]
    .filter((n) => n.status.toLowerCase() !== "removed")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const previous = history.filter((n) => n.id !== activeNotification?.id);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>

      {isLoading && <p className="text-sm text-muted-foreground">Loading notifications…</p>}

      {!isLoading && history.length === 0 && (
        <p className="text-sm text-muted-foreground">No notifications yet.</p>
      )}

      {activeNotification && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Latest Notification</h2>
          {/* Same panel style used across the app. */}
          <NotificationPanel />
        </section>
      )}

      {previous.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Previous Notifications</h2>
          <div className="space-y-3">
            {previous.map((n) => {
              const { date, time } = formatDateTime(n.createdAt);
              return (
                <article key={n.id} className="rounded-lg border p-3">
                  <p className="whitespace-pre-wrap break-words text-sm leading-snug">{n.text}</p>
                  {n.imageUrl !== "" && (
                    <a
                      href={n.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block max-w-full text-sm font-medium underline"
                    >
                      <img
                        src={toDirectDriveUrl(n.imageUrl)}
                        alt="Notification attachment"
                        loading="lazy"
                        className="max-h-48 w-full max-w-xs rounded-md border object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                      <span className="mt-1 inline-block">View attachment</span>
                    </a>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {date}
                    {time !== "" ? ` · ${time}` : ""}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
