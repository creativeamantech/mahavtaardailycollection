import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { highlightAlreadyPaidInSheet } from "../../mahavtaar.functions";

export default defineTool({
  name: "highlight_already_paid",
  title: "Highlight Already Paid rows in Google Sheet",
  description:
    "Highlights Already Paid rows (payments made before their allocation date) with a soft red background in Google Sheets so they are visually distinguished.",
  inputSchema: {
    rows: z
      .array(z.number().int().min(2))
      .optional()
      .describe(
        "Optional array of row numbers to highlight. If omitted or empty, all Already Paid rows in the sheet are automatically detected and highlighted.",
      ),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ rows }) => {
    const res = await highlightAlreadyPaidInSheet({
      data: { rows },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            highlightedCount: res?.count ?? 0,
          }),
        },
      ],
      structuredContent: {
        success: true,
        highlightedCount: res?.count ?? 0,
      },
    };
  },
});
