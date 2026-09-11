import { useAppConfig } from "@/hooks/useAppConfig";

// Compact banner showing the latest active notification. Uses the shared
// app-config query, so no extra API call per page.
export function NotificationPanel({ className = "" }: { className?: string }) {
  const { activeNotification } = useAppConfig();
  if (!activeNotification) return null;

  return (
    <div
      className={`rounded-lg border border-primary/30 bg-primary/5 p-3 print:hidden ${className}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">
        Notification
      </p>
      {activeNotification.text !== "" && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug">
          {activeNotification.text}
        </p>
      )}
      {activeNotification.imageUrl !== "" && (
        <a
          href={activeNotification.imageUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block max-w-full text-sm font-medium underline"
        >
          <img
            src={toDirectDriveUrl(activeNotification.imageUrl)}
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
    </div>
  );
}

function toDirectDriveUrl(url: string) {
  const id = /\/d\/([A-Za-z0-9_-]+)/.exec(url)?.[1];
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w600` : url;
}
