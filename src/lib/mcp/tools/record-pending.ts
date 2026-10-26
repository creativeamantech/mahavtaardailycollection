import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { savePending } from "../../mahavtaar.functions";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;

export default defineTool({
  name: "record_pending",
  title: "Record a pending receipt entry",
  description:
    "Records a payment entry in the Pending Receipts queue awaiting confirmation. Photos are uploaded to Google Drive.",
  inputSchema: {
    executive: z.enum(executives).describe("Executive submitting the pending receipt."),
    loanNumber: z.string().trim().min(1).max(60).describe("Loan account number / ID."),
    amount: z.number().positive().max(100000000).describe("Payment amount."),
    settlement: z.boolean().default(false).describe("Whether this is a settlement payment."),
    photos: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120).describe("File name of receipt image."),
          mimeType: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .describe("MIME type (e.g. image/jpeg, image/png)."),
          base64: z.string().min(1).max(9_000_000).describe("Base64-encoded image data."),
        }),
      )
      .min(1)
      .max(10)
      .describe("Receipt photos to upload to Google Drive."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ executive, loanNumber, amount, settlement, photos }) => {
    const res = await savePending({
      data: {
        executive,
        loanNumber,
        amount,
        settlement,
        photos,
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            id: res.id,
            links: res.links,
            executive,
            loanNumber,
            amount,
          }),
        },
      ],
      structuredContent: {
        success: true,
        id: res.id,
        links: res.links,
        executive,
        loanNumber,
        amount,
      },
    };
  },
});
