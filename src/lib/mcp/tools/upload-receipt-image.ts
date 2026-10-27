import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { uploadReceiptImage } from "../../mahavtaar.functions";

export default defineTool({
  name: "upload_receipt_image",
  title: "Upload receipt image to Google Drive",
  description:
    "Uploads a receipt image (base64 string or data URL) to Google Drive, returning the public Google Drive link. Optionally attaches it to an existing Collections row in Google Sheets and/or runs OCR extraction.",
  inputSchema: {
    loanNumber: z.string().trim().min(1).max(60).describe("Loan account number / ID."),
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .default("receipt.jpg")
      .describe("File name (e.g. 'receipt.jpg')."),
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
      .describe("Base64 string or data URL of the receipt image."),
    rowNumber: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe(
        "Optional row number in Collections sheet. If provided, the uploaded receipt link will be immediately attached to this entry in Google Sheets (Column P).",
      ),
    runOcr: z
      .boolean()
      .default(false)
      .describe(
        "If true, runs OCR extraction on the receipt to extract amount, loan ID, date, and UTR.",
      ),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ loanNumber, name, mimeType, base64, rowNumber, runOcr }) => {
    const cleanBase64 = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
    const effectiveMime =
      mimeType ||
      (base64.startsWith("data:") ? base64.slice(5, base64.indexOf(";")) : "image/jpeg");

    const uploadRes = await uploadReceiptImage({
      data: {
        loanNumber,
        name: name || "receipt.jpg",
        mimeType: effectiveMime.startsWith("image/") ? effectiveMime : "image/jpeg",
        base64: cleanBase64,
      },
    });

    const link = uploadRes.link;
    let attachedToRow: number | null = null;

    if (rowNumber && rowNumber >= 2) {
      const { sheetsGet, sheetsUpdate } = await import("../../mahavtaar.server");
      const current = await sheetsGet(`Collections!P${rowNumber}:Q${rowNumber}`);
      const existingLinksRaw = current?.[0]?.[0] ?? "";
      const existingRemark = current?.[0]?.[1] ?? "";

      const links = existingLinksRaw
        .split(/[|,\s]+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.startsWith("http"));

      if (!links.includes(link)) {
        links.push(link);
      }

      await sheetsUpdate(`Collections!P${rowNumber}:Q${rowNumber}`, [
        [links.join(" | "), existingRemark],
      ]);
      attachedToRow = rowNumber;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            link,
            loanNumber,
            attachedToRow,
          }),
        },
      ],
      structuredContent: JSON.parse(
        JSON.stringify({
          success: true,
          link,
          loanNumber,
          attachedToRow,
        }),
      ),
    };
  },
});
