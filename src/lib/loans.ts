// Loan-level aggregation for the Loan Details module.
// Bucket / City / EMI Amount / POS / Foreclosure come from the Google Sheet
// as already-calculated values — nothing is derived or looked up here.
// Only the confirmed Collection Amount is ever summed per Loan ID.

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
  paidEmiCount: number;
  remainingEmiCount: number;
  currentShortEmi: number | null;
  shortAmount: number | null;
  settlement: boolean;
  emiPaid: boolean;
  posPaid: boolean;
  foreclosurePaid: boolean;
  paidCase: boolean;
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
        paidEmiCount: 0,
        remainingEmiCount: 0,
        currentShortEmi: null,
        shortAmount: null,
        settlement: false,
        emiPaid: false,
        posPaid: false,
        foreclosurePaid: false,
        paidCase: false,
        status: "",
        lastDate: "",
      } satisfies LoanSummary);

    // ONLY the collection amount is summed. Loan-level values stay single.
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

      l.posPaid = l.pos !== null && l.pos > 0 && l.totalPaid >= l.pos;
      l.foreclosurePaid =
        l.foreclosure !== null && l.foreclosure > 0 && l.totalPaid >= l.foreclosure;

      const emi = l.emiAmount;
      const limit = l.applicableEmiCount;

      if (emi !== null && emi > 0 && limit !== null) {
        // Sequential EMI evaluation, one EMI at a time.
        const completed = Math.min(Math.floor(l.totalPaid / emi), limit);
        const remainder = l.totalPaid - completed * emi;

        if (l.settlement || l.foreclosurePaid) {
          // Amount based count, minimum one EMI, capped by the bucket limit.
          l.paidEmiCount = Math.min(Math.max(1, Math.floor(l.totalPaid / emi)), limit);
        } else {
          l.paidEmiCount = completed;
        }

        l.emiPaid = completed >= limit;
        if (!l.emiPaid && !l.settlement) {
          l.currentShortEmi = completed + 1;
          l.shortAmount = emi - remainder;
        }
        l.remainingEmiCount = Math.max(limit - l.paidEmiCount, 0);
      } else if (limit !== null) {
        l.remainingEmiCount = limit;
      }

      // Settlement always wins; it can never show as short or unpaid.
      if (l.settlement) l.status = "Settlement Paid";
      else if (l.emiPaid) l.status = "EMI Paid";
      else if (l.posPaid) l.status = "POS Paid";
      else if (l.foreclosurePaid) l.status = "Foreclosure Paid";
      else if (l.shortAmount !== null) l.status = "EMI Short Amount";
      else l.status = "—";

      if (l.settlement || l.emiPaid || l.posPaid || l.foreclosurePaid) {
        l.currentShortEmi = l.settlement || l.emiPaid ? null : l.currentShortEmi;
        l.shortAmount = l.settlement || l.emiPaid ? null : l.shortAmount;
      }

      l.paidCase =
        l.settlement || l.emiPaid || l.posPaid || l.foreclosurePaid || l.paidEmiCount >= 1;
      return l;
    })
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
}

export type EmiCountRow = {
  executive: string;
  totalEmi: number;
  paidEmi: number;
  remainingEmi: number;
};

// One loan can be worked by more than one executive; its EMI counts are
// attributed to each executive that collected on it, never duplicated per row.
export function emiCountSummary(loans: LoanSummary[], executives: readonly string[]): EmiCountRow[] {
  const base = new Map<string, EmiCountRow>(
    executives.map((e) => [e, { executive: e, totalEmi: 0, paidEmi: 0, remainingEmi: 0 }]),
  );
  for (const l of loans) {
    if (l.applicableEmiCount === null) continue;
    for (const e of l.executives) {
      const row = base.get(e);
      if (!row) continue;
      row.totalEmi += l.applicableEmiCount;
      row.paidEmi += l.paidEmiCount;
      row.remainingEmi += l.remainingEmiCount;
    }
  }
  return [...base.values()];
}

export type ShortEmiRow = {
  executive: string;
  loanId: string;
  shortEmi: string;
  shortAmount: number;
  posStatus: string;
};

export function shortEmiRows(loans: LoanSummary[]): ShortEmiRow[] {
  const out: ShortEmiRow[] = [];
  for (const l of loans) {
    if (l.settlement || l.emiPaid || l.foreclosurePaid) continue;
    if (l.shortAmount === null || l.currentShortEmi === null) continue;
    out.push({
      executive: l.executive,
      loanId: l.loanId,
      shortEmi: `EMI ${l.currentShortEmi}`,
      shortAmount: l.shortAmount,
      posStatus: l.posPaid ? "Paid" : "Not Paid",
    });
  }
  return out.sort((a, b) => a.executive.localeCompare(b.executive));
}

export type CityMatrix = {
  city: string;
  cases: Record<string, number>;
  pos: Record<string, number>;
};

// Paid cases / paid POS per city, comparing executives side by side.
// Each Loan ID counts once per executive and its POS is never added twice.
export function cityExecutiveMatrix(
  loans: LoanSummary[],
  executives: readonly string[],
): CityMatrix[] {
  const map = new Map<string, CityMatrix>();
  for (const l of loans) {
    if (!l.paidCase) continue;
    const city = l.city || "—";
    const cur =
      map.get(city) ??
      ({
        city,
        cases: Object.fromEntries(executives.map((e) => [e, 0])),
        pos: Object.fromEntries(executives.map((e) => [e, 0])),
      } satisfies CityMatrix);
    for (const e of l.executives) {
      if (!(e in cur.cases)) continue;
      cur.cases[e] = (cur.cases[e] ?? 0) + 1;
      cur.pos[e] = (cur.pos[e] ?? 0) + (l.pos ?? 0);
    }
    map.set(city, cur);
  }
  return [...map.values()].sort((a, b) => a.city.localeCompare(b.city));
}
