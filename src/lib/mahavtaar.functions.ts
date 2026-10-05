import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;

const entrySchema = z.object({
  executive: z.enum(executives),
  loanId: z.string().trim().min(1).max(60),
  amount: z.number().positive().max(100000000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().trim().min(1).max(20),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  entryType: z.enum(["Normal", "Previous Paid File"]).default("Normal"),
  settlement: z.boolean().default(false),
  receiptLinks: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  remark: z.string().trim().max(300).default(""),
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

const receiptSchema = z.object({
  loanNumber: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  mimeType: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((m) => m.startsWith("image/"), {
      message: "Only image files are allowed.",
    }),
  base64: z.string().min(1).max(9_000_000),
});

export const uploadReceiptImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => receiptSchema.parse(d))
  .handler(async ({ data }) => {
    const { driveUpload } = await import("./mahavtaar.server");
    const safeLoan = data.loanNumber.replace(/[^A-Za-z0-9._-]/g, "");
    const link = await driveUpload(
      `${safeLoan}-receipt-${Date.now()}-${data.name}`,
      data.mimeType,
      data.base64,
    );
    return { ok: true as const, link };
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
    const appended = (await sheetsAppend("Collections!A:J", [
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
    ])) as { updates?: { updatedRange?: string } };

    // Receipt links (P) and remark (Q) live to the right of the formula columns K:O,
    // so they are written to the exact row the append landed on.
    const rowNum = Number(/![A-Z]+(\d+)/.exec(appended?.updates?.updatedRange ?? "")?.[1] ?? "0");
    if (data.receiptLinks.length > 0 || data.remark !== "") {
      if (rowNum > 0) {
        const { sheetsUpdate } = await import("./mahavtaar.server");
        await sheetsUpdate(`Collections!P${rowNum}:Q${rowNum}`, [
          [data.receiptLinks.join(" | "), data.remark],
        ]);
      }
    }
    return { ok: true as const, row: rowNum };
  });

// Marks conflicting Collections rows with a red background so the conflict is
// visible directly in the source sheet. Cell values are never modified.
export const markConflictRows = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ rows: z.array(z.number().int().min(2).max(1000000)).min(1).max(50) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getSheetId, sheetsBatchUpdate } = await import("./mahavtaar.server");
    const sheetId = await getSheetId("Collections");
    const red = { red: 0.98, green: 0.8, blue: 0.8 };
    const requests = [...new Set(data.rows)].map((row) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: row - 1,
          endRowIndex: row,
          startColumnIndex: 0,
          endColumnIndex: 17,
        },
        cell: { userEnteredFormat: { backgroundColor: red } },
        fields: "userEnteredFormat.backgroundColor",
      },
    }));
    await sheetsBatchUpdate(requests);
    return { ok: true as const };
  });

export const getCollections = createServerFn({ method: "GET" }).handler(async () => {
  const { sheetsGet } = await import("./mahavtaar.server");
  const { normalizeSheetDate, normalizeSheetTime } = await import("./executives");

  // Read all columns from A1 to AZ to capture dynamic columns including Cases Category and Allocation Date
  const allRows = await sheetsGet("Collections!A1:AZ");
  if (!allRows || allRows.length === 0) return [];

  const rawHeaders = allRows[0] || [];
  const headers = rawHeaders.map((h) => String(h ?? "").trim());
  const dataRows = allRows.slice(1);

  // Helper to find column index by matching patterns against headers
  const findCol = (patterns: RegExp[], fallback: number): number => {
    const idx = headers.findIndex((h) => patterns.some((p) => p.test(h)));
    return idx !== -1 ? idx : fallback;
  };

  const colExecutive = findCol([/^exec/i], 0);
  const colLoanId = findCol([/^loan/i], 1);
  const colAmount = findCol([/^amount/i], 2);
  const colDate = findCol([/^payment\s*date/i, /^date$/i], 3);
  const colTime = findCol([/^time/i], 4);
  const colCreatedAt = findCol([/created/i], 5);
  const colStatus = findCol([/^status/i], 6);
  const colEntryDate = findCol([/entry\s*date/i], 7);
  const colEntryType = findCol([/entry\s*type/i], 8);
  const colSettlement = findCol([/settle/i], 9);
  const colBucket = findCol([/bucket/i], 10);
  const colCity = findCol([/city/i], 11);
  const colEmiAmount = findCol([/emi/i], 12);
  const colPos = findCol([/pos/i], 13);
  const colForeclosure = findCol([/foreclos/i], 14);
  const colReceiptLinks = findCol([/receipt/i, /link/i], 15);
  const colRemark = findCol([/remark/i], 16);
  const colCasesCategory = findCol([/cases?\s*category/i, /^category$/i], 17);
  const colAllocationDate = findCol([/allocat(ion)?\s*date/i], 18);

  const num = (v: string | undefined) => {
    const s = String(v ?? "")
      .replace(/[^0-9.-]/g, "")
      .trim();
    return s === "" || Number.isNaN(Number(s)) ? null : Number(s);
  };

  return dataRows
    .filter((r) => r[colExecutive])
    .map((r, i) => {
      const paymentDate = normalizeSheetDate(r[colDate] ?? "");
      const entryDateRaw = (r[colEntryDate] ?? "").trim();
      const allocationDateRaw = (r[colAllocationDate] ?? "").trim();
      const allocationDate = allocationDateRaw ? normalizeSheetDate(allocationDateRaw) : "";
      const casesCategory = (r[colCasesCategory] ?? "").trim();

      // Allocation Date logic:
      // If Payment Date < Allocation Date -> "Already Paid"
      // If Payment Date = Allocation Date -> NOT Already Paid
      // If Payment Date > Allocation Date -> NOT Already Paid (normal)
      let isAlreadyPaid = false;
      if (paymentDate && allocationDate) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) && /^\d{4}-\d{2}-\d{2}$/.test(allocationDate)) {
          isAlreadyPaid = paymentDate < allocationDate;
        } else {
          const tPay = new Date(paymentDate).getTime();
          const tAlloc = new Date(allocationDate).getTime();
          if (!Number.isNaN(tPay) && !Number.isNaN(tAlloc)) {
            isAlreadyPaid = tPay < tAlloc;
          }
        }
      }

      const originalStatus = (r[colStatus] ?? "").trim();
      const status = isAlreadyPaid ? "Already Paid" : originalStatus;

      return {
        bucket: (r[colBucket] ?? "").trim(),
        city: (r[colCity] ?? "").trim(),
        emiAmount: num(r[colEmiAmount]),
        pos: num(r[colPos]),
        foreclosure: num(r[colForeclosure]),
        row: i + 2,
        executive: r[colExecutive] ?? "",
        loanId: String(r[colLoanId] ?? "")
          .replace(/^['`\u2018\u2019]+/, "")
          .trim(),
        amount: Number(String(r[colAmount] ?? "0").replace(/[^0-9.-]/g, "")) || 0,
        date: paymentDate,
        time: normalizeSheetTime(r[colTime] ?? ""),
        createdAt: (r[colCreatedAt] ?? "").trim(),
        status,
        originalStatus,
        entryDate: entryDateRaw ? normalizeSheetDate(entryDateRaw) : paymentDate,
        entryType:
          (r[colEntryType] ?? "").trim() === "Previous Paid File" ? "Previous Paid File" : "Normal",
        settlement: (r[colSettlement] ?? "").trim().toLowerCase() === "yes",
        receiptLinks: (r[colReceiptLinks] ?? "")
          .split(/[|,\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.startsWith("http")),
        remark: (r[colRemark] ?? "").trim(),
        casesCategory,
        allocationDate,
        isAlreadyPaid,
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
      links: (r[3] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
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
