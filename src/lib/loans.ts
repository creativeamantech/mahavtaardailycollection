// Loan-level aggregation. Bucket / City / EMI Amount / POS / Foreclosure come
// from the Google Sheet as already-calculated values — nothing is derived here.
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
  mainPaid: boolean;
  paidCase: boolean;
  status: string;
  lastDate: string;
};

// Loan IDs are sometimes stored in the sheet with a leading apostrophe
// ('123456) to force text. Normalise for matching, grouping and display.
export function normaliseLoanId(id: string | undefined) {
  return String(id ?? "").replace(/^['`\u2018\u2019]+/, "").trim();
}

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
    const id = normaliseLoanId(r.loanId);
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
        mainPaid: false,
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
        if (!l.emiPaid) {
          const nextEmi = completed + 1;
          // First EMI: any shortfall counts. Second and later: only once at
          // least 50% of that EMI has been paid.
          const show = completed === 0 ? l.totalPaid > 0 : remainder >= emi * 0.5;
          if (show && remainder < emi) {
            l.currentShortEmi = nextEmi;
            l.shortAmount = emi - remainder;
          }
        }
        l.remainingEmiCount = Math.max(limit - l.paidEmiCount, 0);
      } else if (limit !== null) {
        l.remainingEmiCount = limit;
      }

      // SINGLE master rule: one complete EMI, valid settlement, or valid
      // foreclosure. POS alone never makes a loan Main Paid.
      l.mainPaid = l.paidEmiCount >= 1 || l.settlement || l.foreclosurePaid;
      l.paidCase = l.mainPaid;

      if (l.settlement) l.status = "Settlement Paid";
      else if (l.emiPaid) l.status = "EMI Paid";
      else if (l.foreclosurePaid) l.status = "Foreclosure Paid";
      else if (l.shortAmount !== null) l.status = "EMI Short Amount";
      else if (l.posPaid) l.status = "POS Paid — Not Main Paid";
      else l.status = "—";

      if (l.settlement || l.emiPaid) {
        l.currentShortEmi = null;
        l.shortAmount = null;
      }

      return l;
    })
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
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
    // Fully paid cases never appear here.
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
    if (!l.mainPaid) continue;
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

// Single source of truth for the loan-level figures shown in the reports.
export function loanStats(loans: LoanSummary[]) {
  let mainPaidCases = 0;
  let mainPaidEmiCount = 0;
  let posPaidNotMainPaid = 0;
  for (const l of loans) {
    if (l.mainPaid) {
      mainPaidCases += 1;
      mainPaidEmiCount += l.paidEmiCount;
    } else if (l.posPaid) {
      posPaidNotMainPaid += 1;
    }
  }
  return { mainPaidCases, mainPaidEmiCount, posPaidNotMainPaid };
}

export const BUCKETS = ["Bucket 1", "Bucket 2", "Bucket 3", "Bucket 4", "Bucket 5"] as const;

export function bucketMatches(bucket: string | undefined, filter: string) {
  if (filter === "__all__") return true;
  const a = String(bucket ?? "").match(/\d+/)?.[0];
  const b = filter.match(/\d+/)?.[0];
  return !!a && a === b;
}

// ---------------------------------------------------------------------------
// Presentation helpers only. These reuse the loan summaries produced above and
// never change any payment / EMI / Main Paid / POS calculation.
// ---------------------------------------------------------------------------

export type ExecutiveMetrics = {
  executive: string;
  collection: number;
  cases: number;
  mainPaid: number;
  paidEmi: number;
  posPaidNotMain: number;
  paidPos: number;
};

export type ReportSection = {
  key: string;
  city: string;
  bucket: string;
  rows: ExecutiveMetrics[];
  total: ExecutiveMetrics;
};

function emptyMetrics(executive: string): ExecutiveMetrics {
  return {
    executive,
    collection: 0,
    cases: 0,
    mainPaid: 0,
    paidEmi: 0,
    posPaidNotMain: 0,
    paidPos: 0,
  };
}

function addLoan(m: ExecutiveMetrics, l: LoanSummary) {
  m.collection += l.totalPaid;
  m.cases += 1;
  if (l.mainPaid) {
    m.mainPaid += 1;
    m.paidEmi += l.paidEmiCount;
    m.paidPos += l.pos ?? 0;
  } else if (l.posPaid) {
    m.posPaidNotMain += 1;
  }
}

// Groups loans into City + Bucket sections with one row per executive.
// A loan counts once per executive that touched it, exactly like the
// previous city matrix did.
export function executiveSections(loans: LoanSummary[]): ReportSection[] {
  const map = new Map<string, { city: string; bucket: string; execs: Map<string, ExecutiveMetrics> }>();
  for (const l of loans) {
    const city = l.city || "—";
    const bucket = l.bucket || "—";
    const key = `${city}||${bucket}`;
    const g = map.get(key) ?? { city, bucket, execs: new Map<string, ExecutiveMetrics>() };
    for (const e of l.executives) {
      const m = g.execs.get(e) ?? emptyMetrics(e);
      addLoan(m, l);
      g.execs.set(e, m);
    }
    map.set(key, g);
  }

  return [...map.entries()]
    .map(([key, g]) => {
      const rows = [...g.execs.values()].sort((a, b) => b.collection - a.collection);
      const total = emptyMetrics("Total");
      for (const r of rows) {
        total.collection += r.collection;
        total.cases += r.cases;
        total.mainPaid += r.mainPaid;
        total.paidEmi += r.paidEmi;
        total.posPaidNotMain += r.posPaidNotMain;
        total.paidPos += r.paidPos;
      }
      return { key, city: g.city, bucket: g.bucket, rows, total };
    })
    .filter((s) => s.rows.length > 0)
    .sort((a, b) => a.city.localeCompare(b.city) || a.bucket.localeCompare(b.bucket));
}
