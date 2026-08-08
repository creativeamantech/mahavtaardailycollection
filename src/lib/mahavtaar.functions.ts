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
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entryType: z.enum(["Normal", "Previous Paid File"]).default("Normal"),
  settlement: z.boolean().default(false),
});

const pendingSchema = z.object({
  executive: z.enum(executives),
  loanNumber: z.string().trim().min(1).max(60),
  amount: z.number().positive().max(100000000),
  settlement: z.boolean().default(false),
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
    const { todayISO } = await import("./executives");
    const entryDate = data.entryDate ?? todayISO();
    if (data.entryType === "Previous Paid File") {
      if (data.date >= entryDate) {
        throw new Error("Original payment date must be earlier than today.");
      }
    } else if (data.date !== entryDate) {
      throw new Error("Normal entries must use today's date.");
    }
    await sheetsAppend("Collections!A:J", [
      [
        data.executive,
        data.loanId,
        data.amount,
        data.date,
        data.time,
        new Date().toISOString(),
        "Confirmed",
        entryDate,
        data.entryType,
        data.settlement ? "Yes" : "No",
      ],
    ]);
    return { ok: true as const };
  });

export const getCollections = createServerFn({ method: "GET" }).handler(async () => {
  const { sheetsGet } = await import("./mahavtaar.server");
  const { normalizeSheetDate, normalizeSheetTime } = await import("./executives");
  // Read K:O too — those are maintained with formulas in the sheet and come back
  // as their calculated values (never the formula text).
  const rows = await sheetsGet("Collections!A2:O");
  const num = (v: string | undefined) => {
    const s = String(v ?? "").replace(/[^0-9.-]/g, "").trim();
    return s === "" || Number.isNaN(Number(s)) ? null : Number(s);
  };
  return rows
    .filter((r) => r[0])
    .map((r, i) => {
      const paymentDate = normalizeSheetDate(r[3] ?? "");
      const entryDateRaw = (r[7] ?? "").trim();
      return {
        bucket: (r[10] ?? "").trim(),
        city: (r[11] ?? "").trim(),
        emiAmount: num(r[12]),
        pos: num(r[13]),
        foreclosure: num(r[14]),
        row: i + 2,
        executive: r[0] ?? "",
        loanId: r[1] ?? "",
        amount: Number(String(r[2] ?? "0").replace(/[^0-9.-]/g, "")) || 0,
        date: paymentDate,
        time: normalizeSheetTime(r[4] ?? ""),
        createdAt: (r[5] ?? "").trim(),
        status: r[6] ?? "",
        entryDate: entryDateRaw ? normalizeSheetDate(entryDateRaw) : paymentDate,
        entryType:
          (r[8] ?? "").trim() === "Previous Paid File" ? "Previous Paid File" : "Normal",
        settlement: (r[9] ?? "").trim().toLowerCase() === "yes",
      };
    });
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
    await sheetsAppend("Pending!A:H", [
      [
        data.executive,
        data.loanNumber,
        data.amount,
        links.join(", "),
        "Pending",
        new Date().toISOString(),
        id,
        data.settlement ? "Yes" : "No",
      ],
    ]);
    return { ok: true as const, links, id };
  });

export const getPending = createServerFn({ method: "GET" }).handler(async () => {
  const { sheetsGet } = await import("./mahavtaar.server");
  const rows = await sheetsGet("Pending!A2:H");
  return rows
    .map((r, i) => ({
      row: i + 2,
      executive: r[0] ?? "",
      loanNumber: r[1] ?? "",
      amount: Number(String(r[2] ?? "0").replace(/[^0-9.-]/g, "")) || 0,
      links: (r[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      status: r[4] ?? "",
      id: r[6] ?? "",
      settlement: (r[7] ?? "").trim().toLowerCase() === "yes",
    }))
    .filter((r) => r.loanNumber && r.status === "Pending");
});

export const markPendingDone = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().trim().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const { sheetsGet, sheetsUpdate, sheetsAppend } = await import("./mahavtaar.server");
    const rows = await sheetsGet("Pending!A2:H");
    const idx = rows.findIndex((r) => (r[6] ?? "") === data.id && (r[4] ?? "") === "Pending");
    if (idx === -1) throw new Error("Pending entry not found or already completed.");
    const r = rows[idx]!;
    const rowNumber = idx + 2;

    await sheetsUpdate(`Pending!E${rowNumber}`, [["Done"]]);

    const { todayISO, nowTime } = await import("./executives");
    const now = new Date();
    await sheetsAppend("Collections!A:J", [
      [
        r[0] ?? "",
        r[1] ?? "",
        Number(String(r[2] ?? "0").replace(/[^0-9.-]/g, "")) || 0,
        todayISO(now),
        nowTime(now),
        now.toISOString(),
        "Confirmed",
        todayISO(now),
        "Normal",
        (r[7] ?? "").trim().toLowerCase() === "yes" ? "Yes" : "No",
      ],
    ]);
    return { ok: true as const };

  });
