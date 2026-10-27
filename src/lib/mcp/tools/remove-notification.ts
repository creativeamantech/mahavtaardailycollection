import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { removeNotification } from "../../app-config.functions";

export default defineTool({
  name: "remove_notification",
  title: "Remove announcement notification",
  description: "Deactivates an active announcement notification banner by ID.",
  inputSchema: {
    id: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .describe("Notification ID to remove (e.g. 'NTF-1729000000000')."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ id }) => {
    await removeNotification({
      data: { id },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            id,
            status: "Removed",
          }),
        },
      ],
      structuredContent: {
        success: true,
        id,
        status: "Removed",
      },
    };
  },
});
