import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { saveCollection } from "../../mahavtaar.functions";
import { todayISO } from "../../executives";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;

export default defineTool({
  name: "record_payment",
  title: "Record a loan collection payment",
  description:
    "Records a payment collection entry into Google Sheets (Collections sheet) with executive, loan ID, amount, and date. Automatically classifies as Normal or Previous Paid File based on date.",
  inputSchema: {
    executive: z.enum(executives).describe("Executive who collected the payment."),
    loanId: z.string().trim().min(1).max(60).describe("Loan account number / ID."),
    amount: z.number().positive().max(100000000).describe("Collection amount in rupees."),
    paymentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Date payment was collected (YYYY-MM-DD)."),
    entryTime: z
      .string()
      .trim()
      .max(20)
      .default("12:00 PM")
      .describe("Time of collection (e.g. '11:30 AM')."),
    settlementType: z
      .enum(["No", "Settlement", "Foreclosure"])
      .default("No")
      .describe("Settlement type: 'No', 'Settlement', or 'Foreclosure'."),
    remark: z.string().max(300).default("").describe("Optional collection note or remark."),
    receiptLinks: z
      .array(z.string().url())
      .default([])
      .describe("Optional array of public receipt/photo URLs."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({
    executive,
    loanId,
    amount,
    paymentDate,
    entryTime,
    settlementType,
    remark,
    receiptLinks,
  }) => {
    const today = todayISO();
    const isPast = paymentDate < today;
    const entryType = isPast ? "Previous Paid File" : "Normal";
    const effectivePaymentDate = isPast ? paymentDate : today;

    const result = await saveCollection({
      data: {
        executive,
        loanId,
        amount,
        date: effectivePaymentDate,
        time: entryTime,
        entryDate: today,
        entryType,
        settlement: settlementType !== "No",
        settlementType,
        receiptLinks,
        remark,
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            executive,
            loanId,
            amount,
            paymentDate: effectivePaymentDate,
            entryType,
            appended: result,
          }),
        },
      ],
      structuredContent: {
        success: true,
        executive,
        loanId,
        amount,
        paymentDate: effectivePaymentDate,
        entryType,
      },
    };
  },
});
