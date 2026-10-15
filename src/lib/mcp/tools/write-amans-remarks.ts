import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { updateAmansRemarks, readCollections } from "../../mahavtaar.functions";
import { normId } from "../data";

export default defineTool({
  name: "write_amans_remarks",
  title: "Write to Aman's Remarks in Collections sheet",
  description:
    "Writes, updates, or appends a note to 'Aman's Remarks' (Column S in Collections sheet) for a specific row number or Loan ID. Directly updates Google Sheets.",
  inputSchema: {
    remarks: z
      .string()
      .trim()
      .max(1000)
      .describe("The text content to write into Aman's Remarks (Column S)."),
    rowNumber: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Google Sheet row number to update (row 1 is header)."),
    loanId: z
      .string()
      .optional()
      .describe("Loan account ID (used to locate the row if rowNumber is not provided)."),
    append: z
      .boolean()
      .default(false)
      .describe("If true, appends to existing remarks instead of overwriting."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ remarks, rowNumber, loanId, append }) => {
    let targetRow = rowNumber;
    let existingRemarks = "";

    if (!targetRow || append) {
      const rows = await readCollections();
      if (!targetRow && loanId) {
        const targetId = normId(loanId).toLowerCase();
        const match = rows.find((r) => r.loanId.toLowerCase() === targetId);
        if (!match) {
          throw new Error(`No collection record found for Loan ID: ${loanId}`);
        }
        targetRow = match.row;
        existingRemarks = match.amansRemarks ?? "";
      } else if (targetRow) {
        const match = rows.find((r) => r.row === targetRow);
        if (match) {
          existingRemarks = match.amansRemarks ?? "";
        }
      }
    }

    if (!targetRow) {
      throw new Error("Either rowNumber or loanId must be provided.");
    }

    const finalRemarks = append && existingRemarks ? `${existingRemarks} | ${remarks}` : remarks;

    const res = await updateAmansRemarks({
      data: { row: targetRow, remarks: finalRemarks },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            rowNumber: targetRow,
            amansRemarks: finalRemarks,
            details: res,
          }),
        },
      ],
      structuredContent: {
        success: true,
        rowNumber: targetRow,
        amansRemarks: finalRemarks,
      },
    };
  },
});
