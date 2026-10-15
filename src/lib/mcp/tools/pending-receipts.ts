import { defineTool } from "@lovable.dev/mcp-js";
import { loadPending } from "../data";

export default defineTool({
  name: "pending_receipts",
  title: "Pending receipts",
  description: "List payments still waiting in Pending Receipts.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const pending = (await loadPending()).map((p) => ({
      executive: p.executive,
      loanNumber: p.loanNumber,
      amount: p.amount,
      settlement: p.settlement,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ pending }) }],
      structuredContent: { pending },
    };
  },
});
