import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections, normId } from "../data";

export default defineTool({
  name: "read_all_collections",
  title: "Read every row in complete Collections sheet",
  description:
    "Reads every row in the complete Collections sheet without limits or omissions. Includes executive, loanId, amount, payment date, time, entryDate, entryType, settlement, receipts, remark, actualId, Aman's Remarks (Column S), case category, allocation date, and Already Paid flags.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .default(5000)
      .describe("Max rows to return (0 for no limit)."),
    offset: z.number().int().min(0).default(0).describe("Number of rows to skip."),
    executive: z.string().optional().describe("Optional filter by executive name."),
    loanId: z.string().optional().describe("Optional filter by Loan ID."),
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
    search: z
      .string()
      .optional()
      .describe("Optional search term across loanId, remark, amansRemarks, or executive."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, offset, executive, loanId, dateFrom, dateTo, search }) => {
    let rows = await loadCollections();

    if (executive) {
      const eLower = executive.toLowerCase().trim();
      rows = rows.filter((r) => r.executive.toLowerCase().includes(eLower));
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

    if (search) {
      const q = search.toLowerCase().trim();
      rows = rows.filter(
        (r) =>
          r.loanId.toLowerCase().includes(q) ||
          r.executive.toLowerCase().includes(q) ||
          (r.remark ?? "").toLowerCase().includes(q) ||
          (r.amansRemarks ?? "").toLowerCase().includes(q) ||
          (r.city ?? "").toLowerCase().includes(q),
      );
    }

    const totalCount = rows.length;
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);

    const paginated = limit > 0 ? rows.slice(offset, offset + limit) : rows.slice(offset);

    const formattedRows = paginated.map((r) => ({
      rowNumber: r.row,
      executive: r.executive,
      loanId: r.loanId,
      amount: r.amount,
      paymentDate: r.date,
      time: r.time,
      entryDate: r.entryDate,
      entryType: r.entryType,
      settlement: r.settlement,
      settlementType: r.settlementType,
      receiptLinks: r.receiptLinks,
      remark: r.remark,
      actualId: r.actualId ?? "",
      amansRemarks: r.amansRemarks ?? "",
      bucket: r.bucket,
      city: r.city,
      emiAmount: r.emiAmount,
      principalOutstanding: r.pos,
      approxForeclosure: r.foreclosure,
      allocationCategory: r.allocationCategory,
      allocationDate: r.allocationDate,
      alreadyPaid: r.alreadyPaid,
      isValidated: r.isValidated,
      isConflict: r.isConflict,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            totalCount,
            totalAmount,
            offset,
            limit,
            returnedCount: formattedRows.length,
            rows: formattedRows,
          }),
        },
      ],
      structuredContent: {
        totalCount,
        totalAmount,
        offset,
        limit,
        returnedCount: formattedRows.length,
        rows: formattedRows,
      },
    };
  },
});
