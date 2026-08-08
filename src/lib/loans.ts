// Loan-level aggregation for the Loan Details report.
// All values for Bucket / City / EMI Amount / POS / Foreclosure come from the
// Google Sheet as-is (already-calculated values) — nothing is derived here.

export type CollectionRow = {
  executive: string;
  loanId: string;
  amount: number;
  date: string;
  entryType?: string;
  settlement?: boolean;
  bucket?: string;
  city?: string;
  emiAmount?: number | null;
  pos?: number | null;
  foreclosure?: number | null;
};

export type LoanSummary = {
  loanId: string;
  executives: string[];
  executive: string;
  bucket: string;
  city: string;
  emiAmount: number | null;
  pos: number | null;
  foreclosure: number | null;
  applicableEmiCount: number | null;
  totalEmiRequired: number | null;
  totalPaid: number;
  payments: number;
  shortAmount: number | null;
  settlement: boolean;
  emiPaid: boolean;
  posPaid: boolean;
  foreclosurePaid: boolean;
  status: string;
  lastDate: string;
};

// Fixed bucket-wise EMI limits: Bucket 1 -> 2 EMI ... Bucket 5 -> 6 EMI.
export function emiCountForBucket(bucket: string): number | null {
  const m = String(bucket ?? "").match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1 && n <= 5 ? n + 1 : null;
}

function pick(current: string, next: string | undefined) {
  const v = (next ?? "").trim();
  return v !== "" ? v : current;
}

function pickNum(current: number | null, next: number | null | undefined) {
  return next === null || next === undefined ? current : next;
}

export function summariseLoans(rows: CollectionRow[]): LoanSummary[] {
  const map = new Map<string, LoanSummary>();

  for (const r of rows) {
    const id = (r.loanId ?? "").trim();
    if (!id) continue;
    const cur =
      map.get(id) ??
      ({
        loanId: id,
        executives: [],
        executive: "",
        bucket: "",
        city: "",
        emiAmount: null,
        pos: null,
        foreclosure: null,
        applicableEmiCount: null,
        totalEmiRequired: null,
        totalPaid: 0,
        payments: 0,
        shortAmount: null,
        settlement: false,
        emiPaid: false,
        posPaid: false,
        foreclosurePaid: false,
        status: "",
        lastDate: "",
      } satisfies LoanSummary);

    // All confirmed payments for the same Loan ID are added together.
    cur.totalPaid += r.amount;
    cur.payments += 1;
    if (r.executive && !cur.executives.includes(r.executive)) cur.executives.push(r.executive);
    cur.bucket = pick(cur.bucket, r.bucket);
    cur.city = pick(cur.city, r.city);
    cur.emiAmount = pickNum(cur.emiAmount, r.emiAmount);
    cur.pos = pickNum(cur.pos, r.pos);
    cur.foreclosure = pickNum(cur.foreclosure, r.foreclosure);
    if (r.settlement) cur.settlement = true;
    if (r.date > cur.lastDate) cur.lastDate = r.date;
    map.set(id, cur);
  }

  return [...map.values()]
    .map((l) => {
      l.executive = l.executives.join(", ");
      l.applicableEmiCount = emiCountForBucket(l.bucket);
      l.totalEmiRequired =
        l.emiAmount !== null && l.applicableEmiCount !== null
          ? l.emiAmount * l.applicableEmiCount
          : null;
      l.emiPaid = l.totalEmiRequired !== null && l.totalPaid >= l.totalEmiRequired;
      l.posPaid = l.pos !== null && l.pos > 0 && l.totalPaid >= l.pos;
      l.foreclosurePaid =
        l.foreclosure !== null && l.foreclosure > 0 && l.totalPaid >= l.foreclosure;
      l.shortAmount =
        l.totalEmiRequired !== null && !l.emiPaid && !l.settlement
          ? l.totalEmiRequired - l.totalPaid
          : null;

      // Settlement always wins; it can never show as short or unpaid.
      if (l.settlement) l.status = "Settlement Paid";
      else if (l.emiPaid) l.status = "EMI Paid";
      else if (l.posPaid) l.status = "POS Paid";
      else if (l.foreclosurePaid) l.status = "Foreclosure Paid";
      else if (l.shortAmount !== null) l.status = "EMI Short Amount";
      else l.status = "—";
      return l;
    })
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
}

export function toCsv(loans: LoanSummary[]) {
  const head = [
    "Loan ID",
    "Executive",
    "Bucket",
    "City",
    "Applicable EMI Count",
    "EMI Amount",
    "Total EMI Required",
    "Total Amount Paid",
    "Payments",
    "Short Amount",
    "Principal Outstanding",
    "Approx. Foreclosure Amount",
    "Settlement",
    "Payment Status",
    "Last Payment Date",
  ];
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = loans.map((l) =>
    [
      l.loanId,
      l.executive,
      l.bucket,
      l.city,
      l.applicableEmiCount,
      l.emiAmount,
      l.totalEmiRequired,
      l.totalPaid,
      l.payments,
      l.shortAmount,
      l.pos,
      l.foreclosure,
      l.settlement ? "Yes" : "No",
      l.status,
      l.lastDate,
    ]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}
