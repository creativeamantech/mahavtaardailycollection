import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { markConflictGroupAsValid } from "../../mahavtaar.functions";

export default defineTool({
  name: "resolve_conflict_group",
  title: "Validate entire conflict group",
  description:
    "Marks a whole group of conflicting collection rows as valid ('VALIDATED') in a single operation and clears their red highlighting in Google Sheets.",
  inputSchema: {
    rows: z
      .array(z.number().int().min(2))
      .min(1)
      .describe("Array of row numbers belonging to the conflict group to validate."),
    note: z.string().default("").describe("Optional validation note."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ rows, note }) => {
    await markConflictGroupAsValid({
      data: { rows, note },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            status: "VALIDATED",
            validatedRows: rows,
          }),
        },
      ],
      structuredContent: {
        success: true,
        status: "VALIDATED",
        validatedRows: rows,
      },
    };
  },
});
