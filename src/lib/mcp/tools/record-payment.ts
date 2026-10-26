import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { saveCollection, uploadReceiptImage } from "../../mahavtaar.functions";
import { todayISO } from "../../executives";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;

export default defineTool({
  name: "record_payment",
  title: "Record a loan collection payment with optional receipt upload",
  description:
    "Records a payment collection entry into Google Sheets (Collections sheet) with executive, loan ID, amount, date, and optional receipt image upload (uploaded to Google Drive just like in the app UI). Automatically classifies as Normal or Previous Paid File based on date.",
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
      .describe("Optional array of pre-existing public receipt/photo URLs."),
    receiptPhotos: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120).default("receipt.jpg").describe("File name."),
          mimeType: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .default("image/jpeg")
            .describe("Image MIME type (e.g. image/jpeg, image/png)."),
          base64: z
            .string()
            .min(1)
            .max(9_000_000)
            .describe("Base64 string or data URL of the image."),
        }),
      )
      .optional()
      .describe(
        "Optional array of receipt images to upload to Google Drive during entry (just like in the app UI).",
      ),
    receiptBase64: z
      .string()
      .min(1)
      .max(9_000_000)
      .optional()
      .describe(
        "Optional single base64 string or data URL of a receipt photo to upload to Google Drive.",
      ),
    receiptFileName: z
      .string()
      .trim()
      .max(120)
      .default("receipt.jpg")
      .optional()
      .describe("File name when using receiptBase64."),
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
    receiptLinks = [],
    receiptPhotos,
    receiptBase64,
    receiptFileName = "receipt.jpg",
  }) => {
    const today = todayISO();
    const isPast = paymentDate < today;
    const entryType = isPast ? "Previous Paid File" : "Normal";
    const effectivePaymentDate = isPast ? paymentDate : today;

    const allReceiptLinks: string[] = [...receiptLinks];

    // 1. Process receiptPhotos array if provided
    if (receiptPhotos && receiptPhotos.length > 0) {
      for (const photo of receiptPhotos) {
        const raw = photo.base64;
        const cleanBase64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
        const mime =
          photo.mimeType ||
          (raw.startsWith("data:") ? raw.slice(5, raw.indexOf(";")) : "image/jpeg");
        const uploadRes = await uploadReceiptImage({
          data: {
            loanNumber: loanId,
            name: photo.name || "receipt.jpg",
            mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
            base64: cleanBase64,
          },
        });
        if (uploadRes?.link) {
          allReceiptLinks.push(uploadRes.link);
        }
      }
    }

    // 2. Process single receiptBase64 if provided
    if (receiptBase64) {
      const raw = receiptBase64;
      const cleanBase64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
      const mime = raw.startsWith("data:") ? raw.slice(5, raw.indexOf(";")) : "image/jpeg";
      const uploadRes = await uploadReceiptImage({
        data: {
          loanNumber: loanId,
          name: receiptFileName || "receipt.jpg",
          mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
          base64: cleanBase64,
        },
      });
      if (uploadRes?.link) {
        allReceiptLinks.push(uploadRes.link);
      }
    }

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
        receiptLinks: allReceiptLinks,
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
            rowNumber: result?.row,
            receiptLinks: allReceiptLinks,
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
        rowNumber: result?.row,
        receiptLinks: allReceiptLinks,
      },
    };
  },
});
