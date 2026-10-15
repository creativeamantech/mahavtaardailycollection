import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections, normId } from "../data";

export default defineTool({
  name: "loadCollectionData",
  title: "Load Collection Data",
  description:
    "Fetches and parses all rows from the primary Collections sheet, ensuring the data is structured correctly for display in the application (including normalized dates, times, amounts, receipts, remarks, Aman's remarks, allocation categories, Already Paid flags, and conflict status).",
  inputSchema: {
    category: z
      .string()
      .optional()
      .describe("Optional allocation category filter (e.g. '1&2', 'Standard')."),
    executive: z.string().optional().describe("Optional executive filter."),
    loanId: z.string().optional().describe("Optional loan ID filter."),
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
    limit: z
      .number()
      .int()
      .min(0)
      .max(20000)
      .default(0)
      .describe("Max number of rows to return (0 = all rows)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ category, executive, loanId, dateFrom, dateTo, limit }) => {
    let rows = await loadCollections();

    if (category) {
      const catLower = category.toLowerCase().trim();
      rows = rows.filter((r) => (r.allocationCategory ?? "").toLowerCase() === catLower);
    }

    if (executive) {
      const execLower = executive.toLowerCase().trim();
      rows = rows.filter((r) => r.executive.toLowerCase().includes(execLower));
    }

    if (loanId) {
      const targetId = normId(loanId).toLowerCase();
      rows = rows.filter((r) => r.loanId.toLowerCase() === targetId);
    }

    if (dateFrom) {
      rows = rows.filter((r) => r.date >= dateFrom);
    }

    if (dateTo) {
      rows = rows.filter((r) => r.date <= dateTo);
    }

    const totalCount = rows.length;
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);

    const data = limit > 0 ? rows.slice(0, limit) : rows;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            totalCount,
            totalAmount,
            returnedCount: data.length,
            collections: data,
          }),
        },
      ],
      structuredContent: {
        totalCount,
        totalAmount,
        returnedCount: data.length,
        collections: data,
      },
    };
  },
});
