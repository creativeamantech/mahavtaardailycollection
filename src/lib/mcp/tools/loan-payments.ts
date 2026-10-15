import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections, normId } from "../data";

export default defineTool({
  name: "loan_payments",
  title: "Payments for a Loan ID",
  description: "List all recorded payments for one Loan ID, including Already Paid flags.",
  inputSchema: { loanId: z.string().min(1).max(60).describe("Loan ID to look up.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ loanId }) => {
    const id = normId(loanId);
    const payments = (await loadCollections())
      .filter((r) => r.loanId === id)
      .map((r) => ({
        executive: r.executive,
        amount: r.amount,
        paymentDate: r.date,
        time: r.time,
        entryType: r.entryType,
        settlementType: r.settlementType,
        allocationCategory: r.allocationCategory,
        allocationDate: r.allocationDate,
        alreadyPaid: r.alreadyPaid,
      }));
    return {
      content: [{ type: "text", text: JSON.stringify({ loanId: id, payments }) }],
      structuredContent: { loanId: id, payments },
    };
  },
});
