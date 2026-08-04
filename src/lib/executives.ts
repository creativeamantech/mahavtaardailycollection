export const EXECUTIVES = [
  "Aarti",
  "Ankita",
  "Bharti",
  "Julee",
  "Pooja",
  "Sunanda",
  "Vinita",
] as const;

export type Executive = (typeof EXECUTIVES)[number];

export const APP_TIME_ZONE = "Asia/Kolkata";

// Always resolve "today" in India time so server-rendered and client values match.
export function todayISO(date: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function nowTime(date: Date = new Date()) {
  return date.toLocaleTimeString("en-IN", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function formatAmount(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
