// Client-side CSV export helpers. These only reformat data that is already
// loaded in the page — no API calls and no new calculations.

import { shortEmiRows, summariseLoans, type CollectionRow, type LoanSummary } from "@/lib/loans";

function cell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number)[][]) {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type ExportCollection = {
  executive: string;
  loanId?: string;
  amount: number;
  date: string;
  entryType?: string;
  settlement?: boolean;
  settlementType?: string;
  foreclosureEntry?: boolean;
  bucket?: string;
  city?: string;
  emiAmount?: number | null;
  pos?: number | null;
  foreclosure?: number | null;
  remark?: string;
};

function toCollectionRows(rows: ExportCollection[]): CollectionRow[] {
  return rows.map((r) => ({
    executive: r.executive,
    loanId: r.loanId ?? "",
    amount: r.amount,
    date: r.date,
    entryType: r.entryType ?? "",
    settlement: r.settlement ?? false,
    settlementType: r.settlementType,
    foreclosureEntry: r.foreclosureEntry,
    bucket: r.bucket ?? "",
    city: r.city ?? "",
    emiAmount: r.emiAmount ?? null,
    pos: r.pos ?? null,
    foreclosure: r.foreclosure ?? null,
  }));
}

export function collectionCsv(rows: ExportCollection[]) {
  return toCsv(
    [
      "Date",
      "Executive Name",
      "Loan ID",
      "Amount",
      "Entry Type",
      "Settlement",
      "Bucket",
      "City",
      "Remark",
    ],
    rows.map((r) => [
      r.date,
      r.executive,
      r.loanId ?? "",
      r.amount,
      r.entryType || "Normal",
      r.settlementType || (r.settlement ? "Settlement" : "No"),
      r.bucket ?? "",
      r.city ?? "",
      r.remark ?? "",
    ]),
  );
}

// Uses the existing short EMI logic exactly; Main Paid loans never appear.
export function shortEmiCsv(rows: ExportCollection[]) {
  const loans: LoanSummary[] = summariseLoans(toCollectionRows(rows));
  const byId = new Map(loans.map((l) => [l.loanId, l]));
  const shorts = shortEmiRows(loans.filter((l) => !l.mainPaid));
  return toCsv(
    [
      "Executive Name",
      "Loan ID",
      "EMI Number",
      "EMI Amount",
      "Paid Amount",
      "Short Amount",
      "POS Status",
    ],
    shorts.map((s) => {
      const l = byId.get(s.loanId);
      return [
        s.executive,
        s.loanId,
        s.shortEmi,
        l?.emiAmount ?? "",
        l?.totalPaid ?? "",
        s.shortAmount,
        s.posStatus,
      ];
    }),
  );
}

// One click, two files: the collection data and the short EMI sheet.
export function downloadCollectionExport(rows: ExportCollection[], label: string) {
  downloadCsv(`collection-${label}.csv`, collectionCsv(rows));
  downloadCsv(`short-emi-${label}.csv`, shortEmiCsv(rows));
}

export type ExportAlreadyPaid = {
  executive: string;
  loanId?: string;
  amount: number;
  date: string;
  allocationDate?: string;
  allocationCategory?: string;
  entryType?: string;
  settlement?: boolean;
  settlementType?: string;
  foreclosureEntry?: boolean;
  bucket?: string;
  city?: string;
  emiAmount?: number | null;
  pos?: number | null;
  foreclosure?: number | null;
  remark?: string;
  entryDate?: string;
  time?: string;
};

export function alreadyPaidCsv(rows: ExportAlreadyPaid[]) {
  const list = Array.isArray(rows) ? rows : [];
  return toCsv(
    [
      "Payment Date",
      "Allocation Date",
      "Loan ID",
      "Executive Name",
      "Amount",
      "Allocation Category",
      "Bucket",
      "City",
      "EMI Amount",
      "POS",
      "Settlement",
      "Entry Type",
      "Entry Date",
      "Time",
      "Remark",
    ],
    list.map((r) => [
      r.date,
      r.allocationDate ?? "",
      r.loanId ?? "",
      r.executive,
      r.amount,
      r.allocationCategory ?? "",
      r.bucket ?? "",
      r.city ?? "",
      r.emiAmount ?? "",
      r.pos ?? "",
      r.settlementType || (r.settlement ? "Settlement" : "No"),
      r.entryType || "Normal",
      r.entryDate ?? "",
      r.time ?? "",
      r.remark ?? "",
    ]),
  );
}

export function downloadAlreadyPaidCsv(rows: ExportAlreadyPaid[], label = "") {
  const fileSuffix = label ? `-${label}` : "";
  downloadCsv(`already-paid${fileSuffix}.csv`, alreadyPaidCsv(rows));
}
