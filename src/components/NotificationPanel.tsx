import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAppConfig } from "@/hooks/useAppConfig";

const VIEWED_KEY = "mdc-notifications-viewed-v1";
const VIEWED_EVENT = "mdc-notifications-viewed";

function readViewedIds(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(VIEWED_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function markNotificationsViewed(ids: string[]) {
  try {
    const viewed = new Set(readViewedIds());
    ids.forEach((id) => viewed.add(id));
    window.localStorage.setItem(VIEWED_KEY, JSON.stringify([...viewed]));
    window.dispatchEvent(new Event(VIEWED_EVENT));
  } catch {
    // The inbox remains usable when browser storage is unavailable.
  }
}

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

// Previews rotate until the executive opens the full Notifications inbox.
export function NotificationPanel({ className = "" }: { className?: string }) {
  const { notifications, session } = useAppConfig();
  const executiveName = session?.role === "Executive" ? session.name : "";
  const isPriorityForCurrentExecutive = (text: string) => {
    if (!executiveName) return false;
    const normalizedText = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    const normalizedName = executiveName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return normalizedName.length > 0 && normalizedText.includes(` ${normalizedName} `);
  };
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewedIds, setViewedIds] = useState<string[] | null>(null);

  useEffect(() => {
    const sync = () => setViewedIds(readViewedIds());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(VIEWED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(VIEWED_EVENT, sync);
    };
  }, []);

  const previews = useMemo(
    () =>
      [...notifications]
        .filter((item) => item.status.toLowerCase() !== "removed")
        .filter((item) => !viewedIds?.includes(item.id))
        .sort((a, b) => {
          const priorityDifference = Number(isPriorityForCurrentExecutive(b.text)) - Number(isPriorityForCurrentExecutive(a.text));
          return priorityDifference || a.createdAt.localeCompare(b.createdAt);
        }),
    [notifications, viewedIds, executiveName],
  );

  useEffect(() => {
    setIndex(0);
  }, [previews.length]);

  useEffect(() => {
    if (paused || previews.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % previews.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [paused, previews.length]);

  if (viewedIds === null || previews.length === 0) return null;
  const active = previews[index % previews.length];
  if (!active) return null;

  return (
    <section
      aria-label="Notification previews"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={`print:hidden rounded-xl border border-[#ead17a] bg-[#fff9e5] p-3 shadow-sm ${className}`}
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 rounded-md bg-[#facc15] px-2 py-1 text-[10px] font-extrabold tracking-wide text-[#292820]">
          NOTICE
        </span>
        {isPriorityForCurrentExecutive(active.text) && (
          <span className="shrink-0 rounded-md bg-red-100 px-2 py-1 text-[10px] font-extrabold tracking-wide text-red-800">
            YOUR PRIORITY
          </span>
        )}
        {active.imageUrl !== "" && (
          <a
            href={active.imageUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open notification image"
            className="block shrink-0"
          >
            <img
              src={toDirectDriveUrl(active.imageUrl)}
              alt="Notification image preview"
              loading="lazy"
              decoding="async"
              className="h-16 w-16 rounded-lg border border-[#e8d98f] bg-white object-cover"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          </a>
        )}
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-sm font-bold leading-relaxed text-[#292820]">
            {active.text || "New notification"}
          </p>
          <p className="mt-1 text-[11px] text-[#786a3c]">
            {formatNotificationTime(active.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {previews.length > 1 && (
            <>
              <button type="button" aria-label="Previous notification preview"
                onClick={() => setIndex((current) => (current - 1 + previews.length) % previews.length)}
                className="rounded-lg border border-[#e8d98f] bg-white px-2.5 py-1.5 text-sm font-bold text-[#51451d]">‹</button>
              <button type="button" aria-label={paused ? "Resume previews" : "Pause previews"}
                onClick={() => setPaused((value) => !value)}
                className="rounded-lg border border-[#e8d98f] bg-white px-2.5 py-1.5 text-xs font-bold text-[#51451d]">
                {paused ? "▶" : "Ⅱ"}
              </button>
              <button type="button" aria-label="Next notification preview"
                onClick={() => setIndex((current) => (current + 1) % previews.length)}
                className="rounded-lg border border-[#e8d98f] bg-white px-2.5 py-1.5 text-sm font-bold text-[#51451d]">›</button>
            </>
          )}
          <Link to="/notifications"
            className="ml-1 whitespace-nowrap rounded-lg bg-[#292820] px-3 py-2 text-[11px] font-semibold text-white">
            View all
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
