import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections } from "../data";
import { monthKey } from "../../months";
import { categoryMatches } from "../../../components/AllocationFilters";

export default defineTool({
  name: "list_already_paid",
  title: "List Already Paid Cases",
  description:
    "Lists payment entries made prior to their Allocation Date (Already Paid cases). These are kept for reference and excluded from all official collection totals.",
  inputSchema: {
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("Optional month filter (YYYY-MM)."),
    category: z.string().optional().describe("Optional Allocation Category filter."),
    executive: z.string().optional().describe("Optional executive filter."),
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
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ month, category, executive, dateFrom, dateTo }) => {
    const raw = await loadCollections();
    let alreadyPaidRows = raw.filter((r) => r.alreadyPaid);

    if (month) {
      alreadyPaidRows = alreadyPaidRows.filter((r) => monthKey(r.date) === month);
    }

    if (category) {
      alreadyPaidRows = alreadyPaidRows.filter((r) =>
        categoryMatches(r.allocationCategory, category),
      );
    }

    if (executive) {
      const ex = executive.toLowerCase().trim();
      alreadyPaidRows = alreadyPaidRows.filter((r) => r.executive.toLowerCase().includes(ex));
    }

    if (dateFrom) {
      alreadyPaidRows = alreadyPaidRows.filter((r) => r.date >= dateFrom);
    }

    if (dateTo) {
      alreadyPaidRows = alreadyPaidRows.filter((r) => r.date <= dateTo);
    }

    const totalAmount = alreadyPaidRows.reduce((sum, r) => sum + r.amount, 0);

    const formatted = alreadyPaidRows.map((r) => ({
      rowNumber: r.row,
      executive: r.executive,
      loanId: r.loanId,
      amount: r.amount,
      paymentDate: r.date,
      time: r.time,
      entryDate: r.entryDate,
      entryType: r.entryType,
      allocationCategory: r.allocationCategory,
      allocationDate: r.allocationDate,
      receiptLinks: r.receiptLinks,
      remark: r.remark,
      amansRemarks: r.amansRemarks,
      city: r.city,
      bucket: r.bucket,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            count: formatted.length,
            totalAmount,
            cases: formatted,
          }),
        },
      ],
      structuredContent: {
        count: formatted.length,
        totalAmount,
        cases: formatted,
      },
    };
  },
});
