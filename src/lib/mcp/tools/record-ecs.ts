import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { saveEcsEntry } from "../../ecs.functions";
import { todayISO } from "../../executives";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;

export default defineTool({
  name: "record_ecs_entry",
  title: "Record an ECS or Special payment entry",
  description:
    "Records a new ECS or Special collection transaction into Google Sheets (ECS_Special_Info tab).",
  inputSchema: {
    executive: z.enum(executives).describe("Executive name."),
    loanId: z.string().trim().min(1).max(60).describe("Loan account number."),
    amount: z.number().positive().max(100000000).describe("Amount in rupees."),
    paymentType: z.enum(["ECS", "Special"]).describe("Payment type: 'ECS' or 'Special'."),
    paymentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Date of payment (YYYY-MM-DD)."),
    entryTime: z.string().default("12:00 PM").describe("Entry time (e.g. '11:00 AM')."),
    remark: z.string().max(300).default("").describe("Optional note or remark."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ executive, loanId, amount, paymentType, paymentDate, entryTime, remark }) => {
    const today = todayISO();
    const effectivePaymentDate = paymentDate > today ? today : paymentDate;

    const res = await saveEcsEntry({
      data: {
        executive,
        loanId,
        amount,
        paymentType,
        paymentDate: effectivePaymentDate,
        entryDate: today,
        entryTime,
        remark,
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            id: res.id,
            executive,
            loanId,
            amount,
            paymentType,
            paymentDate: effectivePaymentDate,
          }),
        },
      ],
      structuredContent: {
        success: true,
        id: res.id,
        executive,
        loanId,
        amount,
        paymentType,
      },
    };
  },
});
