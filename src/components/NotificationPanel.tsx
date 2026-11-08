import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useNotificationReads } from "@/hooks/useNotificationReads";

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

// Shared all-page ticker. Passing through a message never marks it as read;
// each executive's ticker only clears after they mark the full notice as seen.
export function NotificationPanel({ className = "" }: { className?: string }) {
  const { notifications } = useAppConfig();
  const { currentUser, reads } = useNotificationReads();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const seenIds = useMemo(
    () =>
      new Set(
        reads
          .filter((read) => read.executive.toLowerCase() === currentUser.toLowerCase())
          .map((read) => read.notificationId),
      ),
    [reads, currentUser],
  );
  const unread = useMemo(
    () =>
      [...notifications]
        .filter((notification) => notification.status.toLowerCase() !== "removed")
        .filter((notification) => !seenIds.has(notification.id))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [notifications, seenIds],
  );

  useEffect(() => {
    if (paused || unread.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % unread.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [paused, unread.length]);

  if (unread.length === 0) return null;
  const active = unread[index % unread.length];
  if (!active) return null;

  return (
    <section
      aria-label="Unread notifications"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={`print:hidden rounded-xl border border-[#ead17a] bg-[#fff9e5] p-3 shadow-sm ${className}`}
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 rounded-md bg-[#facc15] px-2 py-1 text-[10px] font-extrabold tracking-wide text-[#292820]">
          NEW · {unread.length}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#292820]">
            {active.text || "New notification"}
          </p>
          <p className="mt-0.5 text-[11px] text-[#786a3c]">
            {formatNotificationTime(active.createdAt)} · {index + 1}/{unread.length} unread
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {unread.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous notification"
                onClick={() => setIndex((current) => (current - 1 + unread.length) % unread.length)}
                className="rounded-lg border border-[#e8d98f] bg-white px-2.5 py-1.5 text-sm font-bold text-[#51451d]"
              >
                ‹
              </button>
              <button
                type="button"
                aria-label={paused ? "Resume notification slider" : "Pause notification slider"}
                onClick={() => setPaused((value) => !value)}
                className="rounded-lg border border-[#e8d98f] bg-white px-2.5 py-1.5 text-xs font-bold text-[#51451d]"
              >
                {paused ? "▶" : "Ⅱ"}
              </button>
              <button
                type="button"
                aria-label="Next notification"
                onClick={() => setIndex((current) => (current + 1) % unread.length)}
                className="rounded-lg border border-[#e8d98f] bg-white px-2.5 py-1.5 text-sm font-bold text-[#51451d]"
              >
                ›
              </button>
            </>
          )}
          <Link
            to="/notifications"
            className="ml-1 whitespace-nowrap rounded-lg bg-[#292820] px-3 py-2 text-[11px] font-semibold text-white"
          >
            View
          </Link>
        </div>
      </div>
    </section>
  );
}

export function toDirectDriveUrl(url: string) {
  const id = /\/d\/([A-Za-z0-9_-]+)/.exec(url)?.[1];
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w600` : url;
}
