import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useNotificationReads } from "@/hooks/useNotificationReads";
import { toDirectDriveUrl } from "@/components/NotificationPanel";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Mahavtaar Daily Collection" },
      {
        name: "description",
        content: "Notification history and executive read status for Mahavtaar Daily Collection.",
      },
    ],
  }),
  component: NotificationsPage,
});

type NotificationTab = "unseen" | "seen" | "all";

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: iso, time: "" };
  return {
    date: date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }),
    time: date.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }),
  };
}

function NotificationsPage() {
  const { notifications, isLoading: configLoading } = useAppConfig();
  const {
    currentUser,
    role,
    reads,
    executives,
    markSeen,
    isLoading: readsLoading,
  } = useNotificationReads();
  const [tab, setTab] = useState<NotificationTab>("unseen");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const activeNotifications = useMemo(
    () =>
      [...notifications]
        .filter((notification) => notification.status.toLowerCase() !== "removed")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notifications],
  );
  const currentReadIds = useMemo(
    () =>
      new Set(
        reads
          .filter((read) => read.executive.toLowerCase() === currentUser.toLowerCase())
          .map((read) => read.notificationId),
      ),
    [reads, currentUser],
  );
  const selected = activeNotifications.find((notification) => notification.id === selectedId);
  const unseenCount = activeNotifications.filter((notification) => !currentReadIds.has(notification.id)).length;
  const seenCount = activeNotifications.length - unseenCount;
  const visibleNotifications = activeNotifications.filter((notification) => {
    if (tab === "unseen") return !currentReadIds.has(notification.id);
    if (tab === "seen") return currentReadIds.has(notification.id);
    return true;
  });

  async function handleMarkSeen(id: string) {
    setSavingId(id);
    try {
      await markSeen(id);
      toast.success("Notification marked as seen");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update read status");
    } finally {
      setSavingId(null);
    }
  }

  const adminReadSummary =
    role === "Admin"
      ? executives.map((executive) => {
          const executiveReads = new Set(
            reads
              .filter((read) => read.executive.toLowerCase() === executive.toLowerCase())
              .map((read) => read.notificationId),
          );
          return {
            executive,
            seen: activeNotifications.filter((notification) => executiveReads.has(notification.id)).length,
          };
        })
      : [];

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 md:py-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#292820]">Notifications</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentUser ? `Signed in as ${currentUser}` : "Your notification inbox"}
          </p>
        </div>
        <div className="rounded-xl border border-[#ead17a] bg-[#fff8dc] px-4 py-2 text-sm font-bold text-[#51451d]">
          {unseenCount} Unseen
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-3">
          <p className="text-2xl font-extrabold text-[#292820]">{activeNotifications.length}</p>
          <p className="text-xs text-muted-foreground">Active notifications</p>
        </div>
        <div className="rounded-xl border border-[#ead17a] bg-[#fffdf3] p-3">
          <p className="text-2xl font-extrabold text-[#8a6b00]">{unseenCount}</p>
          <p className="text-xs text-muted-foreground">Unseen by you</p>
        </div>
        <div className="col-span-2 rounded-xl border bg-white p-3 sm:col-span-1">
          <p className="text-2xl font-extrabold text-[#18743a]">{seenCount}</p>
          <p className="text-xs text-muted-foreground">Seen by you</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="flex gap-1 border-b bg-[#fafaf8] p-2">
          {([
            ["unseen", `Unseen · ${unseenCount}`],
            ["seen", `Seen · ${seenCount}`],
            ["all", "All"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`flex-1 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors ${tab === value ? "bg-[#facc15] text-[#292820]" : "text-[#6b6b63] hover:bg-white"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {(configLoading || readsLoading) && (
          <p className="p-4 text-sm text-muted-foreground">Loading notifications…</p>
        )}
        {!configLoading && !readsLoading && visibleNotifications.length === 0 && (
          <div className="p-9 text-center">
            <p className="text-base font-bold text-[#292820]">
              {tab === "unseen" ? "You're all caught up!" : "No notifications here"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tab === "unseen" ? "New notifications will appear here." : "Try another tab to view notifications."}
            </p>
          </div>
        )}

        <div className="divide-y">
          {visibleNotifications.map((notification) => {
            const isSeen = currentReadIds.has(notification.id);
            const { date, time } = formatDateTime(notification.createdAt);
            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => setSelectedId(notification.id)}
                className={`flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-[#fffdf4] ${selectedId === notification.id ? "bg-[#fffdf4]" : "bg-white"}`}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#fff5ce] text-lg">🔔</span>
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-pre-wrap break-words text-sm font-semibold text-[#292820]">
                    {notification.text || "Notification"}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {date}{time ? ` · ${time}` : ""} · {notification.id}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-extrabold ${isSeen ? "bg-[#e8f5eb] text-[#18743a]" : "bg-[#fff1bf] text-[#765b00]"}`}>
                  {isSeen ? "SEEN" : "UNSEEN"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selected && (
        <section className="rounded-xl border border-[#ead17a] bg-[#fffdf4] p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold tracking-wider text-[#8a6b00]">NOTIFICATION DETAILS</p>
              <h2 className="mt-1 whitespace-pre-wrap break-words text-base font-bold text-[#292820]">
                {selected.text || "Notification"}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold"
            >
              Close
            </button>
          </div>
          {selected.imageUrl !== "" && (
            <a href={selected.imageUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block max-w-full">
              <img
                src={toDirectDriveUrl(selected.imageUrl)}
                alt="Notification attachment"
                loading="lazy"
                decoding="async"
                className="max-h-72 max-w-full rounded-lg border object-contain"
                onError={(event) => { event.currentTarget.style.display = "none"; }}
              />
              <span className="mt-1 block text-xs font-semibold underline">View attachment</span>
            </a>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            {formatDateTime(selected.createdAt).date} · {formatDateTime(selected.createdAt).time}
          </p>
          {currentReadIds.has(selected.id) ? (
            <p className="mt-4 inline-flex rounded-lg bg-[#e8f5eb] px-3 py-2 text-xs font-bold text-[#18743a]">
              ✓ Seen by you
            </p>
          ) : (
            <button
              type="button"
              disabled={savingId === selected.id}
              onClick={() => void handleMarkSeen(selected.id)}
              className="mt-4 rounded-lg bg-[#facc15] px-4 py-2.5 text-xs font-extrabold text-[#292820] disabled:opacity-60"
            >
              {savingId === selected.id ? "Saving…" : "Mark as Seen"}
            </button>
          )}
        </section>
      )}

      {role === "Admin" && (
        <section className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[#292820]">Executive-wise Seen Status</h2>
            <span className="rounded-full bg-[#fff5ce] px-2.5 py-1 text-[10px] font-bold">Admin</span>
          </div>
          {adminReadSummary.map((item) => (
            <div key={item.executive} className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0">
              <span className="text-sm font-semibold">{item.executive}</span>
              <span className="text-xs text-muted-foreground">
                {item.seen} / {activeNotifications.length} seen
              </span>
            </div>
          ))}
          {adminReadSummary.length === 0 && (
            <p className="text-xs text-muted-foreground">No executive accounts found in the login configuration.</p>
          )}
        </section>
      )}
    </main>
  );
}
