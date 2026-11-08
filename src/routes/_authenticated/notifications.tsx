import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAppConfig } from "@/hooks/useAppConfig";
import { markNotificationsViewed, toDirectDriveUrl } from "@/components/NotificationPanel";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Mahavtaar Daily Collection" },
      { name: "description", content: "View notifications for Mahavtaar Daily Collection." },
    ],
  }),
  component: NotificationsPage,
});

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

function NotificationsPage() {
  const { notifications, isLoading, session } = useAppConfig();\n  const executiveName = session?.role === "Executive" ? session.name : "";\n  const isPriorityForCurrentExecutive = (text: string) => {\n    if (!executiveName) return false;\n    const escapedName = executiveName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\  const { notifications, isLoading } = useAppConfig();");\n    return new RegExp(`(^|[^\\\\p{L}\\\\p{N}])${escapedName}(?=$|[^\\\\p{L}\\\\p{N}])`, "iu").test(text);\n  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeNotifications = useMemo(
    () => [...notifications]
      .filter((item) => item.status.toLowerCase() !== "removed")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notifications],
  );

  // Only mark a notification as viewed after the executive opens its details.
  const selected = activeNotifications.find((item) => item.id === selectedId);

  function openNotification(id: string) {
    setSelectedId(id);
    markNotificationsViewed([id]);
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 md:py-7">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[#292820]">Notifications</h1>
        <p className="mt-1 text-xs text-muted-foreground">All current and previous notifications</p>
      </div>

      <section className="overflow-hidden rounded-xl border bg-white">
        {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading notifications…</p>}
        {!isLoading && activeNotifications.length === 0 && (
          <div className="p-9 text-center">
            <p className="text-base font-bold text-[#292820]">No notifications</p>
            <p className="mt-1 text-xs text-muted-foreground">New notifications will appear here.</p>
          </div>
        )}
        <div className="divide-y">
          {activeNotifications.map((item) => (
            <button key={item.id} type="button" onClick={() => openNotification(item.id)}
              className={`flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-[#fffdf4] ${selectedId === item.id ? "bg-[#fffdf4]" : "bg-white"}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#fff5ce] text-lg">🔔</span>
              <span className="min-w-0 flex-1">
                <span className="block whitespace-pre-wrap break-words text-sm font-semibold text-[#292820]">
                  {item.text || "Notification"}
                </span>
                {isPriorityForCurrentExecutive(item.text) && (\n                  <span className="mt-2 inline-flex rounded-md bg-red-100 px-2 py-1 text-[10px] font-extrabold tracking-wide text-red-800">YOUR PRIORITY</span>\n                )}\n                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {formatDateTime(item.createdAt)}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-[#8a6b00]">View ›</span>
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <section className="rounded-xl border border-[#ead17a] bg-[#fffdf4] p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold tracking-wider text-[#8a6b00]">NOTIFICATION</p>
              <h2 className="mt-1 whitespace-pre-wrap break-words text-base font-bold text-[#292820]">
                {selected.text || "Notification"}
              </h2>
            </div>
            <button type="button" onClick={() => setSelectedId(null)}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold">Close</button>
          </div>
          {selected.imageUrl !== "" && (
            <a href={selected.imageUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block max-w-full">
              <img src={toDirectDriveUrl(selected.imageUrl)} alt="Notification attachment"
                loading="lazy" decoding="async"
                className="max-h-72 max-w-full rounded-lg border object-contain"
                onError={(event) => { event.currentTarget.style.display = "none"; }} />
              <span className="mt-1 block text-xs font-semibold underline">View attachment</span>
            </a>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">{formatDateTime(selected.createdAt)}</p>
        </section>
      )}
    </main>
  );
}
