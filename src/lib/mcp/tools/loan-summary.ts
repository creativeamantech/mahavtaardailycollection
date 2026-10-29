import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections, normId } from "../data";
import { getExcludedLoanNumbers } from "../../excluded-loans.functions";
import { summariseLoans, type CollectionRow } from "../../loans";
import { monthKey } from "../../months";
import { categoryMatches } from "../../../components/AllocationFilters";

export default defineTool({
  name: "loan_summary",
  title: "Loan Summary & Sequential EMI Tracking",
  description:
    "Calculates loan-level metrics across collection history: total paid, sequential EMI counts, short EMI amounts, foreclosure/settlement status, POS paid, and Main Paid status. Excludes Already Paid records by default.",
  inputSchema: {
    loanId: z.string().optional().describe("Optional Loan ID to inspect."),
    executive: z.string().optional().describe("Optional executive filter."),
    city: z.string().optional().describe("Optional city filter."),
    bucket: z.string().optional().describe("Optional bucket filter (e.g. 'Bucket 1', 'Bucket 2')."),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("Optional month filter (YYYY-MM)."),
    category: z.string().optional().describe("Optional Allocation Category filter."),
    status: z
      .string()
      .optional()
      .describe(
        "Optional status filter (e.g. 'EMI Paid', 'Settlement Paid', 'Foreclosure Paid', 'EMI Short Amount', 'POS Paid — Not Main Paid').",
      ),
    mainPaidOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, only returns Main Paid cases."),
    limit: z.number().int().min(0).max(1000).default(100).describe("Max records to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({
    loanId,
    executive,
    city,
    bucket,
    month,
    category,
    status,
    mainPaidOnly,
    limit,
  }) => {
    const raw = await loadCollections();
    const excludedRecords = await getExcludedLoanNumbers();
    const excludedIds = new Set(excludedRecords.filter((r) => r.status.toLowerCase() === "active").map((r) => r.loanNumber.trim().toUpperCase()));
    let filtered = raw.filter((r) => !r.alreadyPaid && !excludedIds.has(r.loanId.trim().toUpperCase()));

    if (month) {
      filtered = filtered.filter((r) => monthKey(r.date) === month);
    }

    if (category) {
      filtered = filtered.filter((r) => categoryMatches(r.allocationCategory, category));
    }

    const rows: CollectionRow[] = filtered.map((r) => ({
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

    let loans = summariseLoans(rows);

    if (loanId) {
      const target = normId(loanId).toLowerCase();
      loans = loans.filter((l) => l.loanId.toLowerCase().includes(target));
    }

    if (executive) {
      const ex = executive.toLowerCase().trim();
      loans = loans.filter((l) => l.executives.some((e) => e.toLowerCase().includes(ex)));
    }

    if (city) {
      const c = city.toLowerCase().trim();
      loans = loans.filter((l) => l.city.toLowerCase().includes(c));
    }

    if (bucket) {
      const b = bucket.toLowerCase().trim();
      loans = loans.filter((l) => l.bucket.toLowerCase().includes(b));
    }

    if (status) {
      const s = status.toLowerCase().trim();
      loans = loans.filter((l) => l.status.toLowerCase().includes(s));
    }

    if (mainPaidOnly) {
      loans = loans.filter((l) => l.mainPaid);
    }

    let totalCollection = 0;
    let mainPaidCount = 0;
    let totalEmiPaid = 0;
    let posPaidNotMainCount = 0;

    for (const l of loans) {
      totalCollection += l.totalPaid;
      if (l.mainPaid) {
        mainPaidCount += 1;
        totalEmiPaid += l.paidEmiCount;
      } else if (l.posPaid) {
        posPaidNotMainCount += 1;
      }
    }

    const totalLoans = loans.length;
    const paginated = limit > 0 ? loans.slice(0, limit) : loans;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            totalLoans,
            totalCollection,
            mainPaidCount,
            totalEmiPaid,
            posPaidNotMainCount,
            returnedLoans: paginated.length,
            loans: paginated,
          }),
        },
      ],
      structuredContent: {
        totalLoans,
        totalCollection,
        mainPaidCount,
        totalEmiPaid,
        posPaidNotMainCount,
        returnedLoans: paginated.length,
        loans: paginated,
      },
    };
  },
});
