import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { updateEcsEntry } from "../../ecs.functions";

export default defineTool({
  name: "update_ecs_entry",
  title: "Update ECS entry status",
  description:
    "Updates status and remark for an ECS or Special payment entry in Google Sheets (ECS_Special_Info tab).",
  inputSchema: {
    id: z.string().trim().min(1).max(40).describe("ECS ID, e.g. 'ECS-1729000000000'."),
    status: z
      .enum(["Confirmed", "Bounced", "Cancelled", "Cleared"])
      .describe("New status: Confirmed, Bounced, Cancelled, or Cleared."),
    remark: z.string().max(300).default("").describe("Optional update remark."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, status, remark }) => {
    await updateEcsEntry({
      data: {
        id,
        status,
        remark,
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            id,
            status,
            remark,
          }),
        },
      ],
      structuredContent: {
        success: true,
        id,
        status,
        remark,
      },
    };
  },
});
