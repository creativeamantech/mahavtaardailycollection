import { createServerFn } from "@tanstack/react-start";
import { requireAppAuth } from "./app-auth.server";
import { z } from "zod";
import {
  analyzeReceiptBufferServer,
  downloadDriveImageBuffer,
  scanExistingReceiptPlain,
} from "./receipt-ocr";

export const fetchDriveReceiptBase64 = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((d: unknown) => z.object({ receiptUrl: z.string().trim().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { buffer, mimeType } = await downloadDriveImageBuffer(data.receiptUrl);
    const base64 = buffer.toString("base64");
    const parsed = await analyzeReceiptBufferServer(buffer, mimeType);
    return {
      mimeType,
      dataUrl: `data:${mimeType};base64,${base64}`,
      parsed,
    };
  });

export const scanUploadedReceiptServer = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        base64: z.string().min(1),
        mimeType: z.string().default("image/jpeg"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const cleanBase64 = data.base64.includes(",")
      ? data.base64.slice(data.base64.indexOf(",") + 1)
      : data.base64;
    const buffer = Buffer.from(cleanBase64, "base64");
    return await analyzeReceiptBufferServer(buffer, data.mimeType);
  });

const scanRowSchema = z.object({
  row: z.number().int().min(2).optional(),
  receiptUrl: z.string().trim().optional(),
  writeToAmansRemarks: z.boolean().optional().default(false),
  autoFixSheetRow: z.boolean().optional().default(false),
});

export const scanExistingReceiptServer = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((d: unknown) => scanRowSchema.parse(d))
  .handler(async ({ data }) => {
    return await scanExistingReceiptPlain(data);
  });
