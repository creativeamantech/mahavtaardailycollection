import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { deleteCollectionRow } from "../../mahavtaar.functions";

export default defineTool({
  name: "delete_payment",
  title: "Delete a payment collection row",
  description:
    "Deletes an erroneous or duplicate payment collection row from Google Sheets by row number.",
  inputSchema: {
    rowNumber: z
      .number()
      .int()
      .min(2)
      .describe("Row number in Collections sheet to delete (2 or greater)."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ rowNumber }) => {
    await deleteCollectionRow({
      data: { row: rowNumber },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            deletedRow: rowNumber,
          }),
        },
      ],
      structuredContent: {
        success: true,
        deletedRow: rowNumber,
      },
    };
  },
});
