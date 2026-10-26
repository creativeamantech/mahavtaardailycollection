import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { recordCashierLinkAction } from "../../cashier-link.functions";
import { EXECUTIVES } from "../../executives";

export default defineTool({
  name: "record_cashier_link_action",
  title: "Record Cashier ID Link ON/OFF Action",
  description:
    "Records an ON or OFF action for an executive's Cashier ID Link, saving to the Cashier Link Activity worksheet with date, timestamp, and automatically calculated active duration. Prevents duplicate or invalid actions.",
  inputSchema: {
    executive: z.enum(EXECUTIVES).describe("Executive turning their Cashier ID Link ON or OFF."),
    action: z.enum(["ON", "OFF"]).describe("Action to perform: 'ON' or 'OFF'."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ executive, action }) => {
    const res = await recordCashierLinkAction({
      data: { executive, action },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            executive,
            action,
            activity: res.activity,
          }),
        },
      ],
      structuredContent: {
        success: true,
        executive,
        action,
        activity: res.activity,
      },
    };
  },
});
