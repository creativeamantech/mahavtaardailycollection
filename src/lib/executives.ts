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

export function formatAmount(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "₹0";
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// Google Sheets can store dates/times as serial numbers. Normalise both back
// to the plain strings the report filters on.
const SHEET_EPOCH = Date.UTC(1899, 11, 30);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function normalizeSheetDate(value: string): string {
  const v = (value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const d = new Date(SHEET_EPOCH + Math.floor(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // d/m/yyyy
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  // d-Mon-yy / d-Mon-yyyy / d Mon yyyy (e.g. 1-Oct-26)
  const mm = v.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2}|\d{4})$/);
  if (mm) {
    const mon = MONTHS.indexOf(mm[2]!.toLowerCase());
    if (mon >= 0) {
      const y = mm[3]!.length === 2 ? `20${mm[3]}` : mm[3]!;
      return `${y}-${String(mon + 1).padStart(2, "0")}-${mm[1]!.padStart(2, "0")}`;
    }
  }
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? v : todayISO(parsed);
}

export function normalizeSheetTime(value: string): string {
  const v = (value ?? "").trim();
  if (/^\d*\.\d+$/.test(v) || v === "0") {
    const secs = Math.round(Number(v) * 86400);
    const h = Math.floor(secs / 3600);
    const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0");
    return `${h12}:${mm}:${ss} ${suffix}`;
  }
  return v;
}
