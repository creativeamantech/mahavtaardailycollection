import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { updateCollectionRow } from "../../mahavtaar.functions";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;

export default defineTool({
  name: "update_payment",
  title: "Update an existing payment entry row",
  description:
    "Updates an existing collection row in the Google Sheet (Collections sheet) by its row number (e.g. correcting amount, date, time, executive, or remark).",
  inputSchema: {
    rowNumber: z
      .number()
      .int()
      .min(2)
      .describe("Google Sheet row number to update (row 1 is header)."),
    executive: z.enum(executives).describe("Executive name."),
    loanId: z.string().trim().min(1).max(60).describe("Loan account number."),
    amount: z.number().positive().describe("Payment amount."),
    paymentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Payment date (YYYY-MM-DD)."),
    time: z.string().default("").describe("Payment time (e.g. '02:15 PM')."),
    entryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Entry date (YYYY-MM-DD)."),
    entryType: z.enum(["Normal", "Previous Paid File"]).default("Normal"),
    settlementType: z.enum(["No", "Settlement", "Foreclosure"]).default("No"),
    remark: z.string().default("").describe("Remark or note."),
    amansRemarks: z.string().optional().describe("Aman's Remarks (Column S in Collections sheet)."),
    receiptLinks: z.array(z.string()).default([]).describe("Receipt URLs."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({
    rowNumber,
    executive,
    loanId,
    amount,
    paymentDate,
    time,
    entryDate,
    entryType,
    settlementType,
    remark,
    amansRemarks,
    receiptLinks,
  }) => {
    await updateCollectionRow({
      data: {
        row: rowNumber,
        executive,
        loanId,
        amount,
        date: paymentDate,
        time,
        entryDate: entryDate || paymentDate,
        entryType,
        settlement: settlementType !== "No",
        settlementType,
        remark,
        amansRemarks,
        receiptLinks,
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            updatedRow: rowNumber,
            loanId,
            amount,
            executive,
          }),
        },
      ],
      structuredContent: {
        success: true,
        updatedRow: rowNumber,
        loanId,
        amount,
        executive,
      },
    };
  },
});
