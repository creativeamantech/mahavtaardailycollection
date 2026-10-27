import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "scan_receipt_ocr",
  title: "Scan and verify receipt image with Free OCR",
  description:
    "Notice: Inbuilt OCR functionality has been disabled. This tool returns a notification that OCR is unavailable.",
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
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ message: "Inbuilt OCR feature has been removed as requested." }),
        },
      ],
      structuredContent: { message: "Inbuilt OCR feature has been removed as requested." },
    };
  },
});
