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

export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function nowTime() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function formatAmount(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
