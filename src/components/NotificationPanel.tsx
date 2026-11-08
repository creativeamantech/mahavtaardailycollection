import { useAppConfig } from "@/hooks/useAppConfig";

function isPriorityForExecutive(text: string, name: string) {
  if (!name) return false;
  const normalizedText = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalizedName.length > 0 && normalizedText.includes(` ${normalizedName} `);
}

// Compact banner showing the latest active notification. Uses the shared
// app-config query, so no extra API call per page.
export function NotificationPanel({ className = "" }: { className?: string }) {
  const { activeNotification, session } = useAppConfig();
  if (!activeNotification) return null;
  const isPriority = session?.role === "Executive" && isPriorityForExecutive(activeNotification.text, session.name);

  return (
    <div
      className={`rounded-lg border border-primary/30 bg-primary/5 p-3 print:hidden ${className}`}
    >
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Notification</p>
        {isPriority && <span className="rounded-md bg-red-100 px-2 py-1 text-[10px] font-extrabold tracking-wide text-red-800">YOUR PRIORITY</span>}
      </div>
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
            decoding="async"
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

export function toDirectDriveUrl(url: string) {
  const id = /\/d\/([A-Za-z0-9_-]+)/.exec(url)?.[1];
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w600` : url;
}
