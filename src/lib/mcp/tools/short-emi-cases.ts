import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections } from "../data";
import { summariseLoans, shortEmiRows, type CollectionRow } from "../../loans";
import { monthKey } from "../../months";
import { categoryMatches } from "../../../components/AllocationFilters";

export default defineTool({
  name: "short_emi_cases",
  title: "List Short EMI Cases",
  description:
    "Lists collection cases that have an active EMI shortfall (where the borrower paid partially towards an EMI). Shows which EMI is short, remaining short amount, executive, and POS status.",
  inputSchema: {
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("Optional month filter (YYYY-MM)."),
    category: z.string().optional().describe("Optional Allocation Category filter."),
    executive: z.string().optional().describe("Optional executive filter."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ month, category, executive }) => {
    const raw = await loadCollections();
    let filtered = raw.filter((r) => !r.alreadyPaid);

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

    const loans = summariseLoans(rows);
    let shorts = shortEmiRows(loans);

    if (executive) {
      const ex = executive.toLowerCase().trim();
      shorts = shorts.filter((s) => s.executive.toLowerCase().includes(ex));
    }

    const totalShortAmount = shorts.reduce((sum, s) => sum + s.shortAmount, 0);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            count: shorts.length,
            totalShortAmount,
            shortEmiCases: shorts,
          }),
        },
      ],
      structuredContent: {
        count: shorts.length,
        totalShortAmount,
        shortEmiCases: shorts,
      },
    };
  },
});
