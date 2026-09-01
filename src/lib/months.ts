import { todayISO } from "./executives";

// Month keys are "YYYY-MM", derived from the payment date (r.date).
export function monthKey(dateISO: string) {
  return (dateISO ?? "").slice(0, 7);
}

export function currentMonthKey() {
  return todayISO().slice(0, 7);
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-");
  if (!y || !m) return key;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// Options built dynamically from the dataset, newest first. The current month
// is always present so a fresh month starts with its own (empty) period.
export function monthOptions(dates: string[]) {
  const set = new Set<string>();
  for (const d of dates) {
    const k = monthKey(d);
    if (/^\d{4}-\d{2}$/.test(k)) set.add(k);
  }
  set.add(currentMonthKey());
  return [...set].sort().reverse();
}
