import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { markPendingDone } from "../../mahavtaar.functions";

export default defineTool({
  name: "complete_pending",
  title: "Complete pending receipt & create collection",
  description:
    "Marks a pending receipt entry as 'Done' and automatically appends it to the Collections sheet as a Confirmed Normal payment.",
  inputSchema: {
    pendingId: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .describe("Pending entry ID (e.g. 'PND-1718000000000') to mark as completed."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ pendingId }) => {
    await markPendingDone({
      data: { id: pendingId },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            pendingId,
            status: "Done",
            message: "Pending receipt confirmed and moved to Collections.",
          }),
        },
      ],
      structuredContent: {
        success: true,
        pendingId,
        status: "Done",
      },
    };
  },
});
