import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections } from "../data";
import { getExcludedLoanNumbers } from "../../excluded-loans.functions";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export default defineTool({
  name: "collection_summary",
  title: "Collection summary by executive",
  description:
    "Total collection amount and case count per executive for a payment date range (Already Paid cases excluded).",
  inputSchema: {
    from: iso.describe("Start payment date, YYYY-MM-DD."),
    to: iso.describe("End payment date, YYYY-MM-DD (inclusive)."),
    category: z.string().max(80).optional().describe("Optional Allocation Category filter."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, category }) => {
    const excludedRecords = await getExcludedLoanNumbers();
    const excludedIds = new Set(excludedRecords.filter((r) => r.status.toLowerCase() === "active").map((r) => r.loanNumber.trim().toUpperCase()));
    const rows = (await loadCollections()).filter(
      (r) =>
        !r.alreadyPaid &&
        !excludedIds.has(r.loanId.trim().toUpperCase()) &&
        r.date >= from &&
        r.date <= to &&
        (!category || r.allocationCategory === category),
    );
    const map = new Map<string, { amount: number; loans: Set<string> }>();
    for (const r of rows) {
      const e = map.get(r.executive) ?? { amount: 0, loans: new Set<string>() };
      e.amount += r.amount;
      e.loans.add(r.loanId);
      map.set(r.executive, e);
    }
    const executives = [...map.entries()]
      .map(([executive, e]) => ({ executive, totalAmount: e.amount, cases: e.loans.size }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
    const totalAmount = executives.reduce((s, e) => s + e.totalAmount, 0);
    return {
      content: [{ type: "text", text: JSON.stringify({ from, to, totalAmount, executives }) }],
      structuredContent: { from, to, totalAmount, executives },
    };
  },
});
