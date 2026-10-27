import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { scanExistingReceiptPlain } from "../../receipt-ocr";

export default defineTool({
  name: "scan_receipt_ocr",
  title: "Scan and verify receipt image with Free OCR",
  description:
    "Scans a payment receipt image using free hybrid Vision + local Tesseract.js OCR and compares the extracted payment status, bill amount (minus convenience fees), payment date, time, Loan ID, and UTR against the Google Sheet row. Can optionally write the verification result to Aman's Remarks (Column S) or auto-fix the row's amount/date.",
  inputSchema: {
    rowNumber: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Google Sheet row number in Collections (row 1 is header)."),
    receiptUrl: z
      .string()
      .optional()
      .describe("Optional direct Google Drive receipt URL (if rowNumber is not provided)."),
    writeToAmansRemarks: z
      .boolean()
      .default(false)
      .describe("If true, writes the OCR verification summary into Aman's Remarks (Column S)."),
    autoFixSheetRow: z
      .boolean()
      .default(false)
      .describe(
        "If true, updates the row's Amount and Payment Date in Google Sheets to match the scanned receipt and writes Aman's Remarks.",
      ),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ rowNumber, receiptUrl, writeToAmansRemarks, autoFixSheetRow }) => {
    try {
      const result = await scanExistingReceiptPlain({
        row: rowNumber,
        receiptUrl,
        writeToAmansRemarks,
        autoFixSheetRow,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      console.error("[scan_receipt_ocr error]:", msg);
      return {
        content: [
          {
            type: "text",
            text: `Receipt OCR error: ${msg}`,
          },
        ],
        isError: true,
      };
    }
  },
});
