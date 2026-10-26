import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { readCashierLinkActivities } from "../../cashier-link.functions";

export default defineTool({
  name: "cashier_link_status",
  title: "Get Cashier ID Link Status and Activity History",
  description:
    "Retrieves the current Cashier ID Link ON/OFF status for executives, currently active sessions with live durations, and recent activity logs from the Cashier Link Activity worksheet.",
  inputSchema: {
    executive: z
      .string()
      .optional()
      .describe("Optional executive filter to view their specific status and activity history."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Max number of recent activity log entries to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ executive, limit }) => {
    const data = await readCashierLinkActivities();

    let activities = data.activities;
    if (executive) {
      const ex = executive.toLowerCase().trim();
      activities = activities.filter((a) => a.executive.toLowerCase().includes(ex));
    }

    const recentLogs = activities.slice(0, limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            activeCount: data.activeCount,
            executiveStatuses: data.executiveStatuses,
            returnedLogsCount: recentLogs.length,
            activityHistory: recentLogs,
          }),
        },
      ],
      structuredContent: {
        activeCount: data.activeCount,
        executiveStatuses: data.executiveStatuses,
        returnedLogsCount: recentLogs.length,
        activityHistory: recentLogs,
      },
    };
  },
});
