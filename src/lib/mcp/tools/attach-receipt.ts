import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { uploadReceiptImage } from "../../mahavtaar.functions";

export default defineTool({
  name: "attach_receipt_to_payment",
  title: "Attach receipt image to an existing payment entry",
  description:
    "Attaches a receipt image to an existing row in Collections sheet. Either uploads a new base64 receipt image to Google Drive or links an existing URL, appending it to Column P in Google Sheets.",
  inputSchema: {
    rowNumber: z
      .number()
      .int()
      .min(2)
      .describe("Row number in Collections sheet to attach the receipt to."),
    loanNumber: z.string().trim().optional().describe("Optional Loan ID for file naming."),
    receiptBase64: z
      .string()
      .min(1)
      .max(9_000_000)
      .optional()
      .describe("Base64 string or data URL of the receipt image to upload and attach."),
    receiptFileName: z
      .string()
      .trim()
      .max(120)
      .default("receipt.jpg")
      .optional()
      .describe("File name for the uploaded receipt."),
    receiptUrl: z
      .string()
      .url()
      .optional()
      .describe("Pre-existing receipt URL to attach directly."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({
    rowNumber,
    loanNumber,
    receiptBase64,
    receiptFileName = "receipt.jpg",
    receiptUrl,
  }) => {
    let finalLink = receiptUrl;

    if (receiptBase64) {
      const cleanBase64 = receiptBase64.includes(",")
        ? receiptBase64.slice(receiptBase64.indexOf(",") + 1)
        : receiptBase64;
      const mime = receiptBase64.startsWith("data:")
        ? receiptBase64.slice(5, receiptBase64.indexOf(";"))
        : "image/jpeg";

      const uploadRes = await uploadReceiptImage({
        data: {
          loanNumber: loanNumber || `row-${rowNumber}`,
          name: receiptFileName,
          mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
          base64: cleanBase64,
        },
      });
      finalLink = uploadRes.link;
    }

    if (!finalLink) {
      throw new Error("Either receiptBase64 or receiptUrl must be provided.");
    }

    const { sheetsGet, sheetsUpdate } = await import("../../mahavtaar.server");
    const current = await sheetsGet(`Collections!P${rowNumber}:Q${rowNumber}`);
    const existingLinksRaw = current?.[0]?.[0] ?? "";
    const existingRemark = current?.[0]?.[1] ?? "";

    const links = existingLinksRaw
      .split(/[|,\s]+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.startsWith("http"));

    if (!links.includes(finalLink)) {
      links.push(finalLink);
    }

    await sheetsUpdate(`Collections!P${rowNumber}:Q${rowNumber}`, [
      [links.join(" | "), existingRemark],
    ]);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            rowNumber,
            attachedLink: finalLink,
            allReceiptLinks: links,
          }),
        },
      ],
      structuredContent: {
        success: true,
        rowNumber,
        attachedLink: finalLink,
        allReceiptLinks: links,
      },
    };
  },
});
