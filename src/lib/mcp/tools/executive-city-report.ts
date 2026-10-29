import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections } from "../data";
import { getExcludedLoanNumbers } from "../../excluded-loans.functions";
import {
  summariseLoans,
  executiveCitySections,
  type CollectionRow,
  type ExecutiveCityRow,
} from "../../loans";
import { monthKey } from "../../months";
import { categoryMatches } from "../../../components/AllocationFilters";

export default defineTool({
  name: "executive_city_report",
  title: "Executive City Report & Performance Breakdown",
  description:
    "Generates executive-wise city breakdown tables showing collection amount, case count, Main Paid cases, paid EMI count, POS* cases, and paid POS amount per executive and city, along with summary totals.",
  inputSchema: {
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Optional single date filter (YYYY-MM-DD)."),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("Optional month filter (YYYY-MM)."),
    category: z.string().optional().describe("Optional Allocation Category filter."),
    bucket: z.string().optional().describe("Optional Bucket filter (e.g. 'Bucket 1')."),
    executive: z.string().optional().describe("Optional executive filter."),
    includeBucket: z
      .boolean()
      .default(false)
      .describe("If true, breaks down rows by City + Bucket instead of City only."),
    excludeAlreadyPaid: z
      .boolean()
      .default(true)
      .describe("If true, excludes Already Paid cases (default true)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({
    date,
    month,
    category,
    bucket,
    executive,
    includeBucket,
    excludeAlreadyPaid,
  }) => {
    const raw = await loadCollections();
    const excludedRecords = await getExcludedLoanNumbers();
    const excludedIds = new Set(excludedRecords.filter((r) => r.status.toLowerCase() === "active").map((r) => r.loanNumber.trim().toUpperCase()));
    let filtered = raw.filter((r) => !excludedIds.has(r.loanId.trim().toUpperCase()));

    if (excludeAlreadyPaid) {
      filtered = filtered.filter((r) => !r.alreadyPaid);
    }

    if (date) {
      filtered = filtered.filter((r) => r.date === date);
    } else if (month) {
      filtered = filtered.filter((r) => monthKey(r.date) === month);
    }

    if (category) {
      filtered = filtered.filter((r) => categoryMatches(r.allocationCategory, category));
    }

    if (bucket) {
      const b = bucket.toLowerCase().trim();
      filtered = filtered.filter((r) => (r.bucket ?? "").toLowerCase().includes(b));
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

    const loanSummaries = summariseLoans(rows);
    let sections = executiveCitySections(loanSummaries, { includeBucket });

    if (executive) {
      const ex = executive.toLowerCase().trim();
      sections = sections.filter((s) => s.executive.toLowerCase().includes(ex));
    }

    let totalCollection = 0;
    let totalCases = 0;
    let totalMainPaid = 0;
    let totalPaidEmi = 0;
    let totalPosPaidNotMain = 0;
    let totalPaidPos = 0;
    const activeCities = new Set<string>();

    for (const s of sections) {
      totalCollection += s.total.collection;
      totalCases += s.total.cases;
      totalMainPaid += s.total.mainPaid;
      totalPaidEmi += s.total.paidEmi;
      totalPosPaidNotMain += s.total.posPaidNotMain;
      totalPaidPos += s.total.paidPos;
      for (const r of s.rows) {
        activeCities.add((r.city.split(" (")[0] ?? "").trim());
      }
    }

    const executiveComparison = sections.map((s) => ({
      executive: s.executive,
      citiesCount: s.rows.length,
      collection: s.total.collection,
      cases: s.total.cases,
      mainPaid: s.total.mainPaid,
      paidEmi: s.total.paidEmi,
      posPaidNotMain: s.total.posPaidNotMain,
      paidPos: s.total.paidPos,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            overall: {
              totalCollection,
              totalCases,
              totalMainPaid,
              totalPaidEmi,
              totalPosPaidNotMain,
              totalPaidPos,
              activeCitiesCount: activeCities.size,
            },
            executiveComparison,
            sections,
          }),
        },
      ],
      structuredContent: {
        overall: {
          totalCollection,
          totalCases,
          totalMainPaid,
          totalPaidEmi,
          totalPosPaidNotMain,
          totalPaidPos,
          activeCitiesCount: activeCities.size,
        },
        executiveComparison,
        sections,
      },
    };
  },
});
