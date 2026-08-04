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

const entrySchema = z.object({
  executive: z.enum(executives),
  loanId: z.string().trim().min(1).max(60),
  amount: z.number().positive().max(100000000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().trim().min(1).max(20),
});

const pendingSchema = z.object({
  executive: z.enum(executives),
  loanNumber: z.string().trim().min(1).max(60),
  amount: z.number().positive().max(100000000),
  photos: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        mimeType: z.string().trim().min(1).max(80),
        base64: z.string().min(1).max(9_000_000),
      }),
    )
    .min(1)
    .max(10),
});

export const saveCollection = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => entrySchema.parse(d))
  .handler(async ({ data }) => {
    const { sheetsAppend } = await import("./mahavtaar.server");
    await sheetsAppend("Collections!A:G", [
      [
        data.executive,
        data.loanId,
        data.amount,
        data.date,
        data.time,
        new Date().toISOString(),
        "Confirmed",
      ],
    ]);
    return { ok: true as const };
  });

export const getCollections = createServerFn({ method: "GET" }).handler(async () => {
  const { sheetsGet } = await import("./mahavtaar.server");
  const { normalizeSheetDate, normalizeSheetTime } = await import("./executives");
  const rows = await sheetsGet("Collections!A2:G");
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      executive: r[0] ?? "",
      loanId: r[1] ?? "",
      amount: Number(String(r[2] ?? "0").replace(/[^0-9.-]/g, "")) || 0,
      date: normalizeSheetDate(r[3] ?? ""),
      time: normalizeSheetTime(r[4] ?? ""),
      status: r[6] ?? "",
    }));
});

export const savePending = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pendingSchema.parse(d))
  .handler(async ({ data }) => {
    const { sheetsAppend, driveUpload } = await import("./mahavtaar.server");
    const links: string[] = [];
    for (const p of data.photos) {
      links.push(await driveUpload(`${data.loanNumber}-${p.name}`, p.mimeType, p.base64));
    }
    const id = `PND-${Date.now()}`;
    await sheetsAppend("Pending!A:G", [
      [
        data.executive,
        data.loanNumber,
        data.amount,
        links.join(", "),
        "Pending",
        new Date().toISOString(),
        id,
      ],
    ]);
    return { ok: true as const, links, id };
  });

export const getPending = createServerFn({ method: "GET" }).handler(async () => {
  const { sheetsGet } = await import("./mahavtaar.server");
  const rows = await sheetsGet("Pending!A2:G");
  return rows
    .map((r, i) => ({
      row: i + 2,
      executive: r[0] ?? "",
      loanNumber: r[1] ?? "",
      amount: Number(String(r[2] ?? "0").replace(/[^0-9.-]/g, "")) || 0,
      links: (r[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      status: r[4] ?? "",
      id: r[6] ?? "",
    }))
    .filter((r) => r.loanNumber && r.status === "Pending");
});

export const markPendingDone = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().trim().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const { sheetsGet, sheetsUpdate, sheetsAppend } = await import("./mahavtaar.server");
    const rows = await sheetsGet("Pending!A2:G");
    const idx = rows.findIndex((r) => (r[6] ?? "") === data.id && (r[4] ?? "") === "Pending");
    if (idx === -1) throw new Error("Pending entry not found or already completed.");
    const r = rows[idx]!;
    const rowNumber = idx + 2;

    await sheetsUpdate(`Pending!E${rowNumber}`, [["Done"]]);

    const { todayISO, nowTime } = await import("./executives");
    const now = new Date();
    await sheetsAppend("Collections!A:G", [
      [
        r[0] ?? "",
        r[1] ?? "",
        Number(String(r[2] ?? "0").replace(/[^0-9.-]/g, "")) || 0,
        todayISO(now),
        nowTime(now),
        now.toISOString(),
        "Confirmed",
      ],
    ]);
    return { ok: true as const };
  });
