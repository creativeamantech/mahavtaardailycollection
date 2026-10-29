import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections } from "../data";
import { summariseLoans, executiveSections, type CollectionRow } from "../../loans";
import { monthKey } from "../../months";
import { categoryMatches } from "../../../components/AllocationFilters";
import { getExcludedLoanNumbers } from "../../excluded-loans.functions";

export default defineTool({
  name: "detailed_report",
  title: "Comprehensive Daily and Monthly Collection Report",
  description:
    "Produces full analytical collection report matching the application's Reports tab: date-wise collection totals, executive breakdown (including Normal vs Previous Paid case counts, Main Paid cases, Paid EMIs, POS*), bucket-wise totals, and city/bucket sections. Already Paid cases are excluded.",
  inputSchema: {
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("Optional month filter (YYYY-MM)."),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Optional start payment date (YYYY-MM-DD)."),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Optional end payment date (YYYY-MM-DD)."),
    category: z.string().optional().describe("Optional Allocation Category filter."),
    bucket: z.string().optional().describe("Optional Bucket filter."),
    executive: z.string().optional().describe("Optional executive filter."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ month, dateFrom, dateTo, category, bucket, executive }) => {
    const raw = await loadCollections();
    const excludedRecords = await getExcludedLoanNumbers();
    const excludedLoanIds = new Set(excludedRecords.filter((r) => r.status.toLowerCase() === "active").map((r) => r.loanNumber.trim().toUpperCase()));
    let rows = raw.filter((r) => !r.alreadyPaid && !excludedLoanIds.has(r.loanId.trim().toUpperCase()));

    if (month) {
      rows = rows.filter((r) => monthKey(r.date) === month);
    }

    if (dateFrom) {
      rows = rows.filter((r) => r.date >= dateFrom);
    }

    if (dateTo) {
      rows = rows.filter((r) => r.date <= dateTo);
    }

    if (category) {
      rows = rows.filter((r) => categoryMatches(r.allocationCategory, category));
    }

    if (bucket) {
      const b = bucket.toLowerCase().trim();
      rows = rows.filter((r) => (r.bucket ?? "").toLowerCase().includes(b));
    }

    if (executive) {
      const ex = executive.toLowerCase().trim();
      rows = rows.filter((r) => r.executive.toLowerCase().includes(ex));
    }

    // 1. Executive aggregates (Normal vs Previous Paid, etc.)
    const execMap = new Map<
      string,
      {
        total: number;
        count: number;
        normalCount: number;
        previousCount: number;
        loans: Set<string>;
      }
    >();

    for (const r of rows) {
      const e = execMap.get(r.executive) ?? {
        total: 0,
        count: 0,
        normalCount: 0,
        previousCount: 0,
        loans: new Set<string>(),
      };
      e.total += r.amount;
      e.count += 1;
      if (r.entryType === "Previous Paid File") {
        e.previousCount += 1;
      } else {
        e.normalCount += 1;
      }
      e.loans.add(r.loanId);
      execMap.set(r.executive, e);
    }

    // 2. Date-wise aggregates
    const dateMap = new Map<string, { total: number; count: number; uniqueLoans: Set<string> }>();
    for (const r of rows) {
      const d = dateMap.get(r.date) ?? { total: 0, count: 0, uniqueLoans: new Set<string>() };
      d.total += r.amount;
      d.count += 1;
      d.uniqueLoans.add(r.loanId);
      dateMap.set(r.date, d);
    }

    const dateBreakdown = [...dateMap.entries()]
      .map(([date, d]) => ({
        date,
        totalAmount: d.total,
        caseCount: d.count,
        uniqueLoansCount: d.uniqueLoans.size,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    // 3. Loan-level summaries for Main Paid, Paid EMI, and POS
    const loanRows: CollectionRow[] = rows.map((r) => ({
      executive: r.executive,
      loanId: r.loanId,
      amount: r.amount,
      date: r.date,
      entryType: r.entryType,
      settlement: r.settlement,
      settlementType: r.settlementType,
      foreclosureEntry: r.foreclosureEntry,
      bucket: r.bucket,
      city: r.city,
      emiAmount: r.emiAmount,
      pos: r.pos,
      foreclosure: r.foreclosure,
    }));

    const loanSummaries = summariseLoans(loanRows);

    // Merge loan metrics per executive
    const execMetricsMap = new Map<
      string,
      { mainPaid: number; paidEmi: number; posPaidNotMain: number; paidPos: number }
    >();

    for (const l of loanSummaries) {
      for (const e of l.executives) {
        const m = execMetricsMap.get(e) ?? {
          mainPaid: 0,
          paidEmi: 0,
          posPaidNotMain: 0,
          paidPos: 0,
        };
        if (l.mainPaid) {
          m.mainPaid += 1;
          m.paidEmi += l.paidEmiCount;
          m.paidPos += l.pos ?? 0;
        } else if (l.posPaid) {
          m.posPaidNotMain += 1;
        }
        execMetricsMap.set(e, m);
      }
    }

    const executiveBreakdown = [...execMap.entries()]
      .map(([executive, stats]) => {
        const m = execMetricsMap.get(executive) ?? {
          mainPaid: 0,
          paidEmi: 0,
          posPaidNotMain: 0,
          paidPos: 0,
        };
        return {
          executive,
          totalAmount: stats.total,
          caseCount: stats.count,
          uniqueLoansCount: stats.loans.size,
          normalCount: stats.normalCount,
          previousPaidCount: stats.previousCount,
          mainPaidCases: m.mainPaid,
          paidEmiCount: m.paidEmi,
          posPaidNotMainCases: m.posPaidNotMain,
          paidPosAmount: m.paidPos,
        };
      })
      .sort((a, b) => b.totalAmount - a.totalAmount);

    // 4. Bucket aggregates
    const bucketMap = new Map<string, { total: number; count: number }>();
    for (const r of rows) {
      const b = r.bucket || "Unassigned";
      const cur = bucketMap.get(b) ?? { total: 0, count: 0 };
      cur.total += r.amount;
      cur.count += 1;
      bucketMap.set(b, cur);
    }

    const bucketBreakdown = [...bucketMap.entries()]
      .map(([bucket, b]) => ({ bucket, totalAmount: b.total, caseCount: b.count }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    // 5. City & Bucket Sections
    const citySections = executiveSections(loanSummaries);

    const overallTotal = rows.reduce((s, r) => s + r.amount, 0);
    const overallCases = rows.length;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: {
              totalCollection: overallTotal,
              totalEntries: overallCases,
              uniqueLoansCount: loanSummaries.length,
              mainPaidCases: loanSummaries.filter((l) => l.mainPaid).length,
              totalPaidEmi: loanSummaries.reduce((sum, l) => sum + l.paidEmiCount, 0),
            },
            executiveBreakdown,
            dateBreakdown,
            bucketBreakdown,
            citySectionsCount: citySections.length,
          }),
        },
      ],
      structuredContent: {
        summary: {
          totalCollection: overallTotal,
          totalEntries: overallCases,
          uniqueLoansCount: loanSummaries.length,
          mainPaidCases: loanSummaries.filter((l) => l.mainPaid).length,
          totalPaidEmi: loanSummaries.reduce((sum, l) => sum + l.paidEmiCount, 0),
        },
        executiveBreakdown,
        dateBreakdown,
        bucketBreakdown,
        citySections,
      },
    };
  },
});
