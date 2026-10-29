import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections } from "../data";

function extractDriveId(value: string): string | null {
  const filePath = /\/file\/d\/([A-Za-z0-9_-]+)/i.exec(value);
  if (filePath?.[1]) return filePath[1];
  const queryId = /[?&]id=([A-Za-z0-9_-]+)/i.exec(value);
  if (queryId?.[1]) return queryId[1];
  return /^[A-Za-z0-9_-]{20,100}$/.test(value.trim()) ? value.trim() : null;
}

function normalizeAmount(value: string | number): string {
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

export default defineTool({
  name: "scan_receipt_ocr",
  title: "Scan receipt with server-side OCR",
  description:
    "Reads an attached Google Drive receipt image using Google Drive OCR and compares extracted text with the selected Collections entry. It never changes the sheet.",
  inputSchema: {
    rowNumber: z.number().int().min(2).optional().describe("Collections sheet row number."),
    loanId: z.string().trim().min(1).max(60).optional().describe("Loan ID to find a receipt for."),
    receiptUrl: z.string().trim().min(1).max(1000).optional().describe("Direct Google Drive receipt URL or file ID."),
    language: z.enum(["hi", "en", "mr", "gu"]).default("hi").describe("OCR language hint: Hindi, English, Marathi, or Gujarati."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ rowNumber, loanId, receiptUrl, language }) => {
    const collections = await loadCollections();
    let entry: (typeof collections)[number] | undefined;
    let selectedUrl = receiptUrl;

    if (rowNumber !== undefined || loanId) {
      const matches = collections.filter((item) =>
        (rowNumber === undefined || item.row === rowNumber) &&
        (!loanId || item.loanId.trim().toLowerCase() === loanId.trim().toLowerCase())
      );
      entry = matches.find((item) => item.receiptLinks?.length) ?? matches[0];
      if (!entry) throw new Error("No matching Collections entry was found.");
      if (!selectedUrl) selectedUrl = entry.receiptLinks?.[0];
      if (!selectedUrl) throw new Error("This Collections entry has no receipt URL attached.");
    }
    if (!selectedUrl) throw new Error("Provide rowNumber, loanId, or receiptUrl.");

    const fileId = extractDriveId(selectedUrl);
    if (!fileId) throw new Error("Could not extract a Google Drive file ID from the receipt URL.");

    const { ocrDriveReceipt } = await import("../../mahavtaar.server");
    const ocr = await ocrDriveReceipt(fileId, language);
    const text = ocr.text ?? "";
    const expectedAmount = entry ? normalizeAmount(entry.amount) : "";
    const amountTokens = [...text.matchAll(/(?:₹|Rs\.?|INR)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi)]
      .map((m) => normalizeAmount(m[1] ?? ""))
      .filter(Boolean);
    const amountFound = expectedAmount ? amountTokens.includes(expectedAmount) : null;

    const expectedLoanDigits = entry ? entry.loanId.replace(/\D/g, "") : "";
    const ocrDigits = text.replace(/\D/g, "");
    const loanIdFound = expectedLoanDigits && ocrDigits.includes(expectedLoanDigits) ? true : null;

    let status = "MANUAL_REVIEW";
    if (amountFound === true && (loanIdFound === true || loanIdFound === null)) status = "AMOUNT_MATCH";
    if (amountFound === false) status = "CHECK_MISMATCH";

    const result = {
      success: true,
      status,
      source: "Google Drive OCR conversion",
      fileId: ocr.fileId,
      fileName: ocr.fileName,
      mimeType: ocr.mimeType,
      collectionsEntry: entry ? {
        rowNumber: entry.row,
        loanId: entry.loanId,
        amount: entry.amount,
        paymentDate: entry.date,
        executive: entry.executive,
      } : null,
      comparison: {
        expectedAmount: expectedAmount || null,
        amountFoundInOcr: amountFound,
        expectedLoanId: entry?.loanId ?? null,
        loanIdFoundInOcr: loanIdFound,
        note: "OCR matches are advisory only; visually verify the receipt before confirming payment.",
      },
      extractedText: text,
      characterCount: ocr.characterCount,
      sheetModified: false,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
});
