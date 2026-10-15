import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadEcs } from "../data";

export default defineTool({
  name: "list_ecs_entries",
  title: "List ECS and Special entries",
  description:
    "Lists ECS and Special collection entries from Google Sheets with optional status or executive filter.",
  inputSchema: {
    status: z
      .enum(["All", "Confirmed", "Bounced", "Cancelled", "Cleared"])
      .default("All")
      .describe("Status filter: All, Confirmed, Bounced, Cancelled, or Cleared."),
    executive: z.string().optional().describe("Optional executive name filter."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, executive }) => {
    const all = await loadEcs();
    const filtered = all.filter((e) => {
      if (status !== "All" && e.status !== status) return false;
      if (executive && e.executive.toLowerCase() !== executive.toLowerCase()) return false;
      return true;
    });

    const totalAmount = filtered.reduce((s, e) => s + e.amount, 0);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ count: filtered.length, totalAmount, entries: filtered }),
        },
      ],
      structuredContent: { count: filtered.length, totalAmount, entries: filtered },
    };
  },
});
