import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { updateCollectionAmount, readCollections } from "../../mahavtaar.functions";
import { normId } from "../data";

export default defineTool({
  name: "edit_collection_amount",
  title: "Edit payment collection amount",
  description:
    "Edits the collection payment amount (Column C in Collections sheet) for an entry by its row number or Loan ID. Updates Google Sheets directly.",
  inputSchema: {
    amount: z
      .number()
      .positive()
      .max(100000000)
      .describe("New corrected collection amount in rupees."),
    rowNumber: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Google Sheet row number to update (row 1 is header)."),
    loanId: z.string().optional().describe("Loan ID (used if rowNumber is not provided)."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ amount, rowNumber, loanId }) => {
    let targetRow = rowNumber;

    if (!targetRow && loanId) {
      const targetId = normId(loanId).toLowerCase();
      const rows = await readCollections();
      const match = rows.find((r) => r.loanId.toLowerCase() === targetId);
      if (!match) {
        throw new Error(`No collection record found for Loan ID: ${loanId}`);
      }
      targetRow = match.row;
    }

    if (!targetRow) {
      throw new Error("Either rowNumber or loanId must be provided.");
    }

    const res = await updateCollectionAmount({
      data: { row: targetRow, amount },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            updatedRow: targetRow,
            newAmount: amount,
            details: res,
          }),
        },
      ],
      structuredContent: {
        success: true,
        updatedRow: targetRow,
        newAmount: amount,
      },
    };
  },
});
