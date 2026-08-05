import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const executives = [
  "Aarti",
  "Ankita",
  "Bharti",
  "Julee",
  "Pooja",
  "Sunanda",
  "Vinita",
] as const;

const ecsSchema = z.object({
  executive: z.enum(executives),
  loanId: z.string().trim().min(1).max(60),
  amount: z.number().positive().max(100000000),
  paymentType: z.enum(["ECS", "Special"]),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entryTime: z.string().trim().min(1).max(20),
  remark: z.string().trim().max(300).optional().default(""),
});

const updateSchema = z.object({
  id: z.string().trim().min(1).max(40),
  status: z.enum(["Confirmed", "Bounced", "Cancelled", "Cleared"]),
  remark: z.string().trim().max(300).optional().default(""),
});

export const saveEcsEntry = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ecsSchema.parse(d))
  .handler(async ({ data }) => {
    const { sheetsAppend } = await import("./mahavtaar.server");
    if (data.paymentDate > data.entryDate) {
      throw new Error("Payment date cannot be in the future.");
    }
    const id = `ECS-${Date.now()}`;
    const now = new Date().toISOString();
    await sheetsAppend("ECS_Special_Info!A:L", [
      [
        id,
        data.executive,
        data.loanId,
        data.amount,
        data.paymentType,
        data.paymentDate,
        data.entryDate,
        data.entryTime,
        "Confirmed",
        data.remark ?? "",
        now,
        now,
      ],
    ]);
    return { ok: true as const, id };
  });

export const getEcsEntries = createServerFn({ method: "GET" }).handler(async () => {
  const { sheetsGet } = await import("./mahavtaar.server");
  const { normalizeSheetDate, normalizeSheetTime } = await import("./executives");
  const rows = await sheetsGet("ECS_Special_Info!A2:L");
  return rows
    .filter((r) => (r[0] ?? "").trim() !== "")
    .map((r) => ({
      id: r[0] ?? "",
      executive: r[1] ?? "",
      loanId: r[2] ?? "",
      amount: Number(String(r[3] ?? "0").replace(/[^0-9.-]/g, "")) || 0,
      paymentType: (r[4] ?? "ECS") as "ECS" | "Special",
      paymentDate: normalizeSheetDate(r[5] ?? ""),
      entryDate: normalizeSheetDate(r[6] ?? ""),
      entryTime: normalizeSheetTime(r[7] ?? ""),
      status: r[8] ?? "Confirmed",
      remark: r[9] ?? "",
    }));
});

export const updateEcsEntry = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data }) => {
    const { sheetsGet, sheetsUpdate } = await import("./mahavtaar.server");
    const rows = await sheetsGet("ECS_Special_Info!A2:L");
    const idx = rows.findIndex((r) => (r[0] ?? "").trim() === data.id);
    if (idx === -1) throw new Error("ECS / Special entry not found.");
    const rowNumber = idx + 2;
    await sheetsUpdate(`ECS_Special_Info!I${rowNumber}:J${rowNumber}`, [
      [data.status, data.remark ?? ""],
    ]);
    await sheetsUpdate(`ECS_Special_Info!L${rowNumber}`, [[new Date().toISOString()]]);
    return { ok: true as const };
  });
