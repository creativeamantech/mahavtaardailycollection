import * as XLSX from "xlsx";

export function norm(v: unknown): string {
  return String(v ?? "").trim().toUpperCase().replace(/^['`]+/,"").replace(/[^A-Z0-9]/g,"");
}
export function headerIndex(row: string[], aliases: string[]): number {
  const set = new Set(aliases.map(norm));
  return row.findIndex(v => set.has(norm(v)));
}
export function amount(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim().replace(/[₹,\s]/g,"").replace(/^\((.*)\)$/,"-$1");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function computePaidFileDac(paid: string[][]): { values: string[][]; dacIndex: number } {
  if (!paid.length) throw new Error("Paid File is empty.");
  const header = paid[0] ?? [];
  const sfdcIndex = headerIndex(header, ["SFDC"]), onlineIndex = headerIndex(header, ["Online"]);
  if (sfdcIndex < 0 || onlineIndex < 0) throw new Error("Paid File must contain both SFDC and Online columns so DAC can be calculated.");
  const existingDac = headerIndex(header, ["DAC"]);
  const dacIndex = existingDac >= 0 ? existingDac : header.length;
  const values = paid.map((row, index) => {
    const copy = [...(row ?? [])];
    if (index === 0) { copy[dacIndex] = "DAC"; return copy; }
    const rawSfdc = copy[sfdcIndex], rawOnline = copy[onlineIndex];
    const sfdc = rawSfdc === undefined || String(rawSfdc).trim() === "" ? 0 : amount(rawSfdc);
    const online = rawOnline === undefined || String(rawOnline).trim() === "" ? 0 : amount(rawOnline);
    copy[dacIndex] = sfdc === null || online === null ? "INVALID" : String(sfdc + online);
    return copy;
  });
  return { values, dacIndex };
}


/**
 * Tracks data-generation changes without treating an Admin decision as a new
 * payment-data generation. An approval must remain valid for the exact values
 * it reviewed; the decision's own timeline event must not invalidate it.
 */
export function paidFileHistoryGeneration(eventTypes: string[]): number {
  const transitions = eventTypes.filter(type => type === "REAPPEARED" || type === "AMOUNT_CHANGED").length;
  return transitions + (["MISSING", "REVERSAL_AUTHORIZED", "REVERSAL_APPROVED"].includes(eventTypes.at(-1) ?? "") ? 1 : 0);
}

/** Canonical server-side CSV conversion shared by upload validation and tests. */
export function normalizePaidFileSource(sourceBytes: Uint8Array, extension: string): string {
  if (!["xlsx", "xls", "xlsb", "csv"].includes(extension.toLowerCase())) {
    throw new Error("Unsupported Paid File format.");
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(sourceBytes, { type: "array", cellDates: true });
  } catch {
    throw new Error("Original Paid File could not be parsed.");
  }
  const firstSheet = workbook.SheetNames[0];
  const worksheet = firstSheet ? workbook.Sheets[firstSheet] : undefined;
  if (!worksheet) throw new Error("Paid File has no worksheet.");
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  if (!csv.trim()) throw new Error("Paid File worksheet is empty.");
  return csv;
}

const APPLY_ELIGIBLE_STATUSES = new Set([
  "Ready",
  "Resolved – Admin New Total preserved",
  "Resolved – Admin authorized reversal",
  "Resolved – Admin approved correction",
]);

/** Only explicitly ready or Admin-resolved rows may be written to Master Data. */
export function isPaidFileRowApplyEligible(status: string): boolean {
  return APPLY_ELIGIBLE_STATUSES.has(status);
}
