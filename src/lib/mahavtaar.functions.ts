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
  settlement: z.union([z.boolean(), z.string()]).default(false),
  settlementType: z.enum(["No", "Settlement", "Foreclosure"]).optional(),
  receiptLinks: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  remark: z.string().trim().max(300).default(""),
  amansRemarks: z.string().trim().max(1000).optional(),
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
    let settlementValue = "No";
    if (data.settlementType) {
      settlementValue = data.settlementType;
    } else if (typeof data.settlement === "string") {
      const s = data.settlement.trim().toLowerCase();
      if (s === "settlement") settlementValue = "Settlement";
      else if (s === "foreclosure") settlementValue = "Foreclosure";
      else if (s === "yes") settlementValue = "Settlement";
      else settlementValue = "No";
    } else if (data.settlement === true) {
      settlementValue = "Settlement";
    } else {
      settlementValue = "No";
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
        settlementValue,
      ],
    ])) as { updates?: { updatedRange?: string } };

    // Receipt links (P) and remark (Q) live to the right of the formula columns K:O,
    // so they are written to the exact row the append landed on.
    const rowNum = Number(/![A-Z]+(\d+)/.exec(appended?.updates?.updatedRange ?? "")?.[1] ?? "0");
    if (rowNum > 0) {
      const { sheetsUpdate } = await import("./mahavtaar.server");
      if (data.receiptLinks.length > 0 || data.remark !== "") {
        await sheetsUpdate(`Collections!P${rowNum}:Q${rowNum}`, [
          [data.receiptLinks.join(" | "), data.remark],
        ]);
      }
      if (data.amansRemarks) {
        await sheetsUpdate(`Collections!S${rowNum}`, [[data.amansRemarks]]);
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

// Marks Already Paid Collections rows with a soft red background in Google Sheets
// so they are visually highlighted in the source sheet.
export const highlightAlreadyPaidInSheet = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        rows: z.array(z.number().int().min(2).max(1000000)).max(5000).optional(),
      })
      .optional()
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { sheetsGet, getSheetId, sheetsBatchUpdate } = await import("./mahavtaar.server");
    const { normalizeSheetDate } = await import("./executives");

    let targetRows: number[] = data?.rows ?? [];

    if (!targetRows || targetRows.length === 0) {
      // Find all already-paid row indices directly from the sheet
      const raw = await sheetsGet("Collections!A2:U");
      targetRows = (raw ?? [])
        .map((r, i) => {
          const paymentDate = normalizeSheetDate(r[3] ?? "");
          const allocRaw = (r[20] ?? "").trim();
          const allocationDate = allocRaw ? normalizeSheetDate(allocRaw) : "";
          const validAlloc = /^\d{4}-\d{2}-\d{2}$/.test(allocationDate);
          const isAlreadyPaid = validAlloc && paymentDate !== "" && paymentDate < allocationDate;
          return isAlreadyPaid ? i + 2 : 0;
        })
        .filter((r) => r > 1);
    }

    if (targetRows.length === 0) {
      return { ok: true as const, count: 0 };
    }

    const sheetId = await getSheetId("Collections");
    const red = { red: 0.98, green: 0.8, blue: 0.8 };
    const uniqueRows = [...new Set(targetRows)];
    const CHUNK_SIZE = 200;
    for (let i = 0; i < uniqueRows.length; i += CHUNK_SIZE) {
      const chunk = uniqueRows.slice(i, i + CHUNK_SIZE);
      const requests = chunk.map((row) => ({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: row - 1,
            endRowIndex: row,
            startColumnIndex: 0,
            endColumnIndex: 21,
          },
          cell: { userEnteredFormat: { backgroundColor: red } },
          fields: "userEnteredFormat.backgroundColor",
        },
      }));
      await sheetsBatchUpdate(requests);
    }

    return { ok: true as const, count: uniqueRows.length };
  });

export async function readCollections() {
  try {
    const { sheetsGet, sheetsGetCellLinks } = await import("./mahavtaar.server");
    const { normalizeSheetDate, normalizeSheetTime } = await import("./executives");
    // Read K:O too — those are maintained with formulas in the sheet and come back
    // as their calculated values (never the formula text).
    // T = Allocation Category, U = Allocation Date (sheet-maintained values).
    // V = Validation flag (VALIDATED if conflict verified as valid)
    const [rows, linkedNameUrls] = await Promise.all([
      sheetsGet("Collections!A2:W"),
      sheetsGetCellLinks("Collections!W2:W"),
    ]);
    const num = (v: string | undefined) => {
      const s = String(v ?? "")
        .replace(/[^0-9.-]/g, "")
        .trim();
      return s === "" || Number.isNaN(Number(s)) ? null : Number(s);
    };
    const mapped = (rows ?? [])
      .map((r, i) => {
        const paymentDate = normalizeSheetDate(r[3] ?? "");
        const entryDateRaw = (r[7] ?? "").trim();
        const allocRaw = (r[20] ?? "").trim();
        const allocationDate = allocRaw ? normalizeSheetDate(allocRaw) : "";
        const validAlloc = /^\d{4}-\d{2}-\d{2}$/.test(allocationDate);
        const settlementRaw = (r[9] ?? "").trim();
        const settlementLower = settlementRaw.toLowerCase();
        const isSettlement = settlementLower === "yes" || settlementLower === "settlement";
        const isForeclosure = settlementLower === "foreclosure";
        const settlementType: "No" | "Settlement" | "Foreclosure" = isForeclosure
          ? "Foreclosure"
          : isSettlement
            ? "Settlement"
            : "No";
        const validationCol = (r[21] ?? "").trim().toUpperCase();
        const isValidated = validationCol.startsWith("VALID");
        return {
          bucket: (r[10] ?? "").trim(),
          city: (r[11] ?? "").trim(),
          emiAmount: num(r[12]),
          pos: num(r[13]),
          foreclosure: num(r[14]),
          row: i + 2,
          executive: r[0] ?? "",
          linkedName: (r[22] ?? "").trim(),
          portalUrl: linkedNameUrls[i + 2] ?? "",
          loanId: String(r[1] ?? "")
            .replace(/^['`\u2018\u2019]+/, "")
            .trim(),
          amount: Number(String(r[2] ?? "0").replace(/[^0-9.-]/g, "")) || 0,
          date: paymentDate,
          time: normalizeSheetTime(r[4] ?? ""),
          createdAt: (r[5] ?? "").trim(),
          status: r[6] ?? "",
          entryDate: entryDateRaw ? normalizeSheetDate(entryDateRaw) : paymentDate,
          entryType: (r[8] ?? "").trim() === "Previous Paid File" ? "Previous Paid File" : "Normal",
          settlement: isSettlement,
          settlementType,
          foreclosureEntry: isForeclosure,
          receiptLinks: (r[15] ?? "")
            .split(/[|,\s]+/)
            .map((s) => s.trim())
            .filter((s) => s.startsWith("http")),
          remark: (r[16] ?? "").trim(),
          actualId: (r[17] ?? "").trim(),
          amansRemarks: (r[18] ?? "").trim(),
          allocationCategory: (r[19] ?? "").trim(),
          allocationDate: validAlloc ? allocationDate : "",
          // Payment before allocation = Already Paid (reporting rule only).
          alreadyPaid: validAlloc && paymentDate !== "" && paymentDate < allocationDate,
          isValidated,
          isConflict: false,
          conflictWith: [] as { row: number; executive: string; date: string; amount: number }[],
        };
      })
      .filter((item) => item.executive && item.status.trim().toUpperCase() !== "DELETED");

    // Detect conflicts across entries (same loanId and same amount)
    const groupMap = new Map<string, typeof mapped>();
    for (const item of mapped) {
      if (!item.loanId || item.amount <= 0) continue;
      const key = `${item.loanId.toLowerCase()}_${item.amount}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(item);
    }

    for (const [, group] of groupMap.entries()) {
      if (group.length > 1) {
        for (const item of group) {
          if (!item.isValidated) {
            item.isConflict = true;
            item.conflictWith = group
              .filter((other) => other.row !== item.row)
              .map((other) => ({
                row: other.row,
                executive: other.executive,
                date: other.date,
                amount: other.amount,
              }));
          }
        }
      }
    }

    return mapped;
  } catch (err) {
    console.error("Failed to read collections from Google Sheets:", err);
    return [];
  }
}

export const getCollections = createServerFn({ method: "GET" }).handler(() => readCollections());

// Admin-only read path: the password is checked on the server for every request.
async function assertProductivityAdmin(password: string) {
  const { isSettingsPasswordValid } = await import("./app-config.functions");
  if (!isSettingsPasswordValid(password)) throw new Error("Admin authorization failed. Unlock the Productivity Desk again.");
}

export const getAdminCollections = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ adminPassword: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    await assertProductivityAdmin(data.adminPassword);
    return readCollections();
  });

const verificationAuditTab = "VerificationAudit";
const verificationAuditHeader = ["Timestamp", "Admin", "Loan Number", "Collection Row", "Action", "Note", "Source"];

export const getAdminReviewState = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ adminPassword: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    await assertProductivityAdmin(data.adminPassword);
    const { ensureSheet, sheetsGet } = await import("./mahavtaar.server");
    await ensureSheet(verificationAuditTab, verificationAuditHeader);
    const rows = await sheetsGet(`${verificationAuditTab}!A2:G`);
    const latest = new Map<number, { verified: boolean; timestamp: string; note: string }>();
    for (const row of rows) {
      const collectionRow = Number(row[3]);
      if (!Number.isInteger(collectionRow) || collectionRow < 2) continue;
      const action = String(row[4] ?? "").trim().toUpperCase();
      if (action !== "VERIFIED" && action !== "UNVERIFIED") continue;
      latest.set(collectionRow, {
        verified: action === "VERIFIED",
        timestamp: String(row[0] ?? ""),
        note: String(row[5] ?? ""),
      });
    }
    return [...latest.entries()].filter(([, state]) => state.verified).map(([row]) => row);
  });

const verificationEventSchema = z.object({
  loanNumber: z.string().trim().min(1).max(60),
  collectionRow: z.number().int().min(2).max(1000000),
  action: z.enum(["VERIFIED", "UNVERIFIED", "ENTRY_EDITED", "ENTRY_DELETED"]),
  note: z.string().max(300).optional().default(""),
});

export const saveAdminReviewEvents = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    adminPassword: z.string().min(1).max(200),
    events: z.array(verificationEventSchema).min(1).max(500),
  }).parse(d))
  .handler(async ({ data }) => {
    await assertProductivityAdmin(data.adminPassword);
    const { ensureSheet, requireGoogleSheetsWriteAccess, sheetsAppendStrict } = await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await ensureSheet(verificationAuditTab, verificationAuditHeader);
    const timestamp = new Date().toISOString();
    await sheetsAppendStrict(`${verificationAuditTab}!A:G`, data.events.map((event) => [
      timestamp, "Admin", event.loanNumber, event.collectionRow, event.action, event.note, "Productivity Desk",
    ]));
    return { ok: true as const, saved: data.events.length, timestamp };
  });

const updateCollectionRowSchema = z.object({
  row: z.number().int().min(2),
  executive: z.string().trim().min(1),
  loanId: z.string().trim().min(1),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().optional().default(""),
  entryDate: z.string().optional().default(""),
  entryType: z.enum(["Normal", "Previous Paid File"]).optional().default("Normal"),
  settlement: z.boolean().optional().default(false),
  settlementType: z.enum(["No", "Settlement", "Foreclosure"]).optional().default("No"),
  receiptLinks: z.array(z.string()).optional().default([]),
  remark: z.string().optional().default(""),
  amansRemarks: z.string().optional(),
});

type CollectionRowUpdate = z.infer<typeof updateCollectionRowSchema>;

async function persistCollectionRow(data: CollectionRowUpdate) {
  const { sheetsUpdateStrict, invalidateSheetsCache, requireGoogleSheetsWriteAccess } = await import("./mahavtaar.server");
  requireGoogleSheetsWriteAccess();
  const settlementVal = data.settlementType || (data.settlement ? "Settlement" : "No");
  await sheetsUpdateStrict(`Collections!A${data.row}:J${data.row}`, [[
    data.executive, data.loanId, data.amount, data.date, data.time || "",
    new Date().toISOString(), "Confirmed", data.entryDate || data.date,
    data.entryType, settlementVal,
  ]]);
  await sheetsUpdateStrict(`Collections!P${data.row}:Q${data.row}`, [[data.receiptLinks.join(", "), data.remark]]);
  if (data.amansRemarks !== undefined) {
    await sheetsUpdateStrict(`Collections!S${data.row}`, [[data.amansRemarks]]);
  }
  invalidateSheetsCache();
  return { ok: true as const };
}

export const adminUpdateCollectionRow = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    adminPassword: z.string().min(1).max(200),
    entry: updateCollectionRowSchema,
  }).parse(d))
  .handler(async ({ data }) => {
    await assertProductivityAdmin(data.adminPassword);
    return persistCollectionRow(data.entry);
  });

export const updateCollectionRow = createServerFn({ method: "POST" })
  .validator((d: unknown) => updateCollectionRowSchema.parse(d))
  .handler(async ({ data }) => persistCollectionRow(data));

export const updateAmansRemarks = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ row: z.number().int().min(2), remarks: z.string() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sheetsUpdate, invalidateSheetsCache } = await import("./mahavtaar.server");
    await sheetsUpdate(`Collections!S${data.row}`, [[data.remarks]]);
    invalidateSheetsCache();
    return { ok: true as const, row: data.row, remarks: data.remarks };
  });

export const updateCollectionAmount = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ row: z.number().int().min(2), amount: z.number().positive() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sheetsUpdate, invalidateSheetsCache } = await import("./mahavtaar.server");
    await sheetsUpdate(`Collections!C${data.row}`, [[data.amount]]);
    invalidateSheetsCache();
    return { ok: true as const, row: data.row, amount: data.amount };
  });

async function persistDeleteCollectionRow(row: number) {
  const { getSheetId, sheetsBatchUpdate, sheetsUpdate, invalidateSheetsCache, requireGoogleSheetsWriteAccess } =
    await import("./mahavtaar.server");
  requireGoogleSheetsWriteAccess();
  try {
    const sheetId = await getSheetId("Collections");
    await sheetsBatchUpdate([{
      deleteDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: row - 1, endIndex: row },
      },
    }]);
  } catch {
    await sheetsUpdate(`Collections!A${row}:V${row}`, [Array(22).fill("")]);
  }
  invalidateSheetsCache();
  return { ok: true as const };
}

export const deleteCollectionRow = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ row: z.number().int().min(2) }).parse(d))
  .handler(async ({ data }) => persistDeleteCollectionRow(data.row));

export const adminDeleteCollectionRow = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    adminPassword: z.string().min(1).max(200),
    row: z.number().int().min(2),
  }).parse(d))
  .handler(async ({ data }) => {
    await assertProductivityAdmin(data.adminPassword);
    const { sheetsUpdateStrict, ensureSheet, requireGoogleSheetsWriteAccess, sheetsAppendStrict, invalidateSheetsCache } =
      await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    const entry = (await readCollections()).find((item) => item.row === data.row);
    if (!entry) throw new Error("Collection entry not found or already deleted.");
    await sheetsUpdateStrict(`Collections!G${data.row}`, [["Deleted"]]);
    await ensureSheet(verificationAuditTab, verificationAuditHeader);
    await sheetsAppendStrict(`${verificationAuditTab}!A:G`, [[
      new Date().toISOString(), "Admin", entry.loanId, data.row, "ENTRY_DELETED",
      "Soft-deleted from Productivity Desk", "Productivity Desk",
    ]]);
    invalidateSheetsCache();
    return { ok: true as const };
  });

export const markConflictAsValid = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        row: z.number().int().min(2),
        note: z.string().optional().default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getSheetId, sheetsBatchUpdate, sheetsUpdate, invalidateSheetsCache } =
      await import("./mahavtaar.server");
    await sheetsUpdate(`Collections!V${data.row}`, [["VALIDATED"]]);
    try {
      const sheetId = await getSheetId("Collections");
      const white = { red: 1, green: 1, blue: 1 };
      await sheetsBatchUpdate([
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: data.row - 1,
              endRowIndex: data.row,
              startColumnIndex: 0,
              endColumnIndex: 22,
            },
            cell: { userEnteredFormat: { backgroundColor: white } },
            fields: "userEnteredFormat.backgroundColor",
          },
        },
      ]);
    } catch (err) {
      console.warn("Could not un-highlight valid row in sheet:", err);
    }
    invalidateSheetsCache();
    return { ok: true as const };
  });

export const markConflictGroupAsValid = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        rows: z.array(z.number().int().min(2)),
        note: z.string().optional().default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getSheetId, sheetsBatchUpdate, sheetsUpdate, invalidateSheetsCache } =
      await import("./mahavtaar.server");
    for (const r of data.rows) {
      await sheetsUpdate(`Collections!V${r}`, [["VALIDATED"]]);
    }
    try {
      const sheetId = await getSheetId("Collections");
      const white = { red: 1, green: 1, blue: 1 };
      const requests = data.rows.map((row) => ({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: row - 1,
            endRowIndex: row,
            startColumnIndex: 0,
            endColumnIndex: 22,
          },
          cell: { userEnteredFormat: { backgroundColor: white } },
          fields: "userEnteredFormat.backgroundColor",
        },
      }));
      await sheetsBatchUpdate(requests);
    } catch (err) {
      console.warn("Could not un-highlight group rows in sheet:", err);
    }
    invalidateSheetsCache();
    return { ok: true as const };
  });

export const revertConflictValidation = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ row: z.number().int().min(2) }).parse(d))
  .handler(async ({ data }) => {
    const { getSheetId, sheetsBatchUpdate, sheetsUpdate, invalidateSheetsCache } =
      await import("./mahavtaar.server");
    await sheetsUpdate(`Collections!V${data.row}`, [[""]]);
    try {
      const sheetId = await getSheetId("Collections");
      const red = { red: 0.98, green: 0.8, blue: 0.8 };
      await sheetsBatchUpdate([
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: data.row - 1,
              endRowIndex: data.row,
              startColumnIndex: 0,
              endColumnIndex: 22,
            },
            cell: { userEnteredFormat: { backgroundColor: red } },
            fields: "userEnteredFormat.backgroundColor",
          },
        },
      ]);
    } catch (err) {
      console.warn("Could not mark row red in sheet:", err);
    }
    invalidateSheetsCache();
    return { ok: true as const };
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

export async function readPending() {
  try {
    const { sheetsGet } = await import("./mahavtaar.server");
    const rows = await sheetsGet("Pending!A2:H");
    return (rows ?? [])
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
  } catch (err) {
    console.error("Failed to read pending from Google Sheets:", err);
    return [];
  }
}

export const getPending = createServerFn({ method: "GET" }).handler(() => readPending());

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
