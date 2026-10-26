import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadPending } from "../data";

export default defineTool({
  name: "pending_receipts",
  title: "Pending receipts",
  description:
    "List payments still waiting in Pending Receipts queue, including pending ID, receipt photo links, amount, executive, and settlement flag.",
  inputSchema: {
    executive: z.string().optional().describe("Optional executive filter."),
    loanNumber: z.string().optional().describe("Optional loan number filter."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ executive, loanNumber }) => {
    let pending = await loadPending();

    if (executive) {
      const ex = executive.toLowerCase().trim();
      pending = pending.filter((p) => p.executive.toLowerCase().includes(ex));
    }

    if (loanNumber) {
      const ln = loanNumber.toLowerCase().trim();
      pending = pending.filter((p) => p.loanNumber.toLowerCase().includes(ln));
    }

    const items = pending.map((p) => ({
      id: p.id,
      rowNumber: p.row,
      executive: p.executive,
      loanNumber: p.loanNumber,
      amount: p.amount,
      links: p.links,
      status: p.status,
      settlement: p.settlement,
    }));

    const totalPendingAmount = items.reduce((sum, p) => sum + p.amount, 0);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            count: items.length,
            totalPendingAmount,
            pending: items,
          }),
        },
      ],
      structuredContent: {
        count: items.length,
        totalPendingAmount,
        pending: items,
      },
    };
  },
});
