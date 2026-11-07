import { requireSession } from "./auth.functions";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const executives = [
  "Aarti",
  "Ankita",
  "Bharti",
  "Julee",
  "Pooja",
  "Shikha",
  "Sona",
  "Sunanda",
  "Vinita",
] as const;
const tab = "Hold_Cases";
const LOCK_KEY = "holdCasesLocked";

async function assertHoldCasesUnlocked() {
  const { sheetsGet } = await import("./mahavtaar.server");
  const settings = await sheetsGet("AppSettings!A2:B");
  const locked = settings.some(
    (row) =>
      String(row[0] ?? "").trim() === LOCK_KEY &&
      String(row[1] ?? "")
        .trim()
        .toUpperCase() === "ON",
  );
  if (locked)
    throw new Error(
      "Hold Cases are locked by administrator. Adding or removing is currently disabled for everyone.",
    );
}
const header = [
  "Submitted At",
  "Executive Name",
  "Loan ID",
  "Hold Reason / Remarks",
  "Status",
  "Removed At",
];

function normaliseLoanId(value: string) {
  return value
    .replace(/^['’‘\x60]+/, "")
    .trim()
    .toUpperCase();
}

async function ensureHoldTab() {
  const { ensureSheetStrict, sheetsGet, sheetsUpdateStrict } = await import("./mahavtaar.server");
  await ensureSheetStrict(tab, header);
  const currentHeader = await sheetsGet("Hold_Cases!A1:F1");
  if (String(currentHeader?.[0]?.[4] ?? "").trim() !== "Status") {
    await sheetsUpdateStrict("Hold_Cases!E1:F1", [["Status", "Removed At"]]);
  }
}

const holdCasesSchema = z.object({
  executive: z.enum(executives),
  loanIds: z.array(z.string().trim().min(1).max(60)).min(1).max(1000),
  remarks: z.string().trim().max(300).optional().default(""),
});

export const submitHoldCases = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => holdCasesSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireSession();
    const executive = session.role === "Admin" ? data.executive : session.name;
    const {
      requireGoogleSheetsWriteAccess,
      sheetsGet,
      sheetsAppendStrict,
      sheetsBatchUpdateValuesStrict,
      invalidateSheetsCache,
    } = await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await assertHoldCasesUnlocked();
    await ensureHoldTab();

    const existingRows = await sheetsGet("Hold_Cases!A2:F");
    const { loadLoanCaseIndex } = await import("./ptp.functions");
    const caseIndex = await loadLoanCaseIndex();
    const existingIds = new Set(
      (existingRows ?? [])
        .filter(
          (row) => !String(row[4] ?? "").trim() || String(row[4]).trim().toLowerCase() === "active",
        )
        .map((row) => normaliseLoanId(String(row[2] ?? "")))
        .filter(Boolean),
    );

    const seen = new Set<string>();
    const uniqueIds: string[] = [];
    const duplicates: string[] = [];
    let skippedPaidCount = 0;
    let skippedHoldCount = 0;
    for (const raw of data.loanIds) {
      const id = normaliseLoanId(raw);
      if (!id) continue;
      if (seen.has(id) || existingIds.has(id)) {
        duplicates.push(id);
        skippedHoldCount++;
        continue;
      }
      if (caseIndex.paid.has(id)) {
        duplicates.push(id);
        skippedPaidCount++;
        continue;
      }
      seen.add(id);
      uniqueIds.push(raw.trim());
    }

    let movedFromPTPCount = 0;
    if (uniqueIds.length > 0) {
      const ptpRows = await sheetsGet("PTPs!A2:H");
      const moveIds = new Set(uniqueIds.map(normaliseLoanId));
      const ptpUpdates: { range: string; values: (string | number)[][] }[] = [];
      for (let i = 0; i < (ptpRows ?? []).length; i++) {
        const row = ptpRows[i]!;
        const id = normaliseLoanId(String(row[2] ?? ""));
        const status = String(row[6] ?? "").trim() || "Active";
        if (moveIds.has(id) && status.toLowerCase() === "active") {
          ptpUpdates.push({
            range: `PTPs!G${i + 2}:H${i + 2}`,
            values: [["Removed", new Date().toISOString()]],
          });
        }
      }
      if (ptpUpdates.length) {
        await sheetsBatchUpdateValuesStrict(ptpUpdates);
        movedFromPTPCount = ptpUpdates.length;
      }
      const submittedAt = new Date().toISOString();
      await sheetsAppendStrict(
        "Hold_Cases!A:F",
        uniqueIds.map((loanId) => [submittedAt, executive, loanId, data.remarks, "Active", ""]),
      );
      invalidateSheetsCache();
    }

    return {
      ok: true as const,
      savedCount: uniqueIds.length,
      duplicateCount: duplicates.length,
      skippedPaidCount,
      skippedHoldCount,
      movedFromPTPCount,
      duplicates: [...new Set(duplicates)],
    };
  });

export async function readActiveHoldCasesForReport() {
  const { sheetsGetOptional } = await import("./mahavtaar.server");
  const rows = await sheetsGetOptional("Hold_Cases!A2:I");
  return (rows ?? [])
    .map((row, index) => ({
      row: index + 2,
      submittedAt: String(row[0] ?? "").trim(),
      executive: String(row[1] ?? "").trim(),
      loanId: String(row[2] ?? "").trim(),
      remarks: String(row[3] ?? "").trim(),
      status: String(row[4] ?? "").trim() || "Active",
      removedAt: String(row[5] ?? "").trim(),
      actualId: String(row[6] ?? "").trim(),
      city: String(row[7] ?? "").trim() || "Unmapped",
      principalOutstanding: Number(String(row[8] ?? "").replace(/[,₹\\s]/g, "")) || 0,
    }))
    .filter((item) => item.loanId !== "" && item.status.toLowerCase() === "active");
}

export const listActiveHoldCasesForReport = createServerFn({ method: "POST" }).handler(async () => {
  await requireSession();
  return readActiveHoldCasesForReport();
});

const executiveSchema = z.object({ executive: z.enum(executives) });

export const listActiveHoldCases = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => executiveSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireSession();
    const targetExecutive = session.role === "Admin" ? data.executive : session.name;
    const { sheetsGet } = await import("./mahavtaar.server");
    await ensureHoldTab();
    const rows = await sheetsGet("Hold_Cases!A2:F");
    return (rows ?? [])
      .map((row, index) => ({
        row: index + 2,
        submittedAt: String(row[0] ?? ""),
        executive: String(row[1] ?? "").trim(),
        loanId: String(row[2] ?? "").trim(),
        remarks: String(row[3] ?? "").trim(),
        status: String(row[4] ?? "").trim() || "Active",
      }))
      .filter(
        (item) =>
          item.executive === targetExecutive &&
          item.loanId !== "" &&
          item.status.toLowerCase() === "active",
      )
      .reverse();
  });

const removeHoldCasesSchema = z.object({
  executive: z.enum(executives),
  loanIds: z.array(z.string().trim().min(1).max(60)).min(1).max(1000),
});

export const removeHoldCases = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => removeHoldCasesSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireSession();
    const targetExecutive = session.role === "Admin" ? data.executive : session.name;
    const {
      requireGoogleSheetsWriteAccess,
      sheetsGet,
      sheetsBatchUpdateValuesStrict,
      invalidateSheetsCache,
    } = await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await assertHoldCasesUnlocked();
    await ensureHoldTab();

    const rows = await sheetsGet("Hold_Cases!A2:F");
    const requested = new Set(data.loanIds.map(normaliseLoanId));
    const { loadLoanCaseIndex } = await import("./ptp.functions");
    const caseIndex = await loadLoanCaseIndex();
    const paidRequested = new Set([...requested].filter((id) => caseIndex.paid.has(id)));
    const updates: { range: string; values: (string | number)[][] }[] = [];
    const removedLoanIds: string[] = [];
    for (let index = 0; index < (rows ?? []).length; index++) {
      const row = rows[index]!;
      const executive = String(row[1] ?? "").trim();
      const loanId = String(row[2] ?? "").trim();
      const status = String(row[4] ?? "").trim() || "Active";
      if (
        executive === targetExecutive &&
        loanId &&
        requested.has(normaliseLoanId(loanId)) &&
        !caseIndex.paid.has(normaliseLoanId(loanId)) &&
        status.toLowerCase() === "active"
      ) {
        const sheetRow = index + 2;
        updates.push({
          range: "Hold_Cases!E" + sheetRow + ":F" + sheetRow,
          values: [["Removed", new Date().toISOString()]],
        });
        removedLoanIds.push(loanId);
      }
    }

    if (updates.length > 0) {
      await sheetsBatchUpdateValuesStrict(updates);
      invalidateSheetsCache();
    }
    return {
      ok: true as const,
      removedCount: removedLoanIds.length,
      removedLoanIds,
      skippedPaidCount: paidRequested.size,
    };
  });

// Called only after a collection entry has been successfully appended.
// Matching active holds are closed as Collected, regardless of the executive,
// so the loan disappears from every executive's active Hold Cases list.
export async function removeMatchingHoldCasesAfterCollection(loanId: string) {
  const targetId = normaliseLoanId(loanId);
  if (!targetId) return { collectedCount: 0 };

  const {
    requireGoogleSheetsWriteAccess,
    sheetsGet,
    sheetsBatchUpdateValuesStrict,
    invalidateSheetsCache,
  } = await import("./mahavtaar.server");
  requireGoogleSheetsWriteAccess();
  await ensureHoldTab();

  const rows = await sheetsGet("Hold_Cases!A2:F");
  const updates: { range: string; values: (string | number)[][] }[] = [];
  for (let index = 0; index < (rows ?? []).length; index++) {
    const row = rows[index]!;
    const existingId = normaliseLoanId(String(row[2] ?? ""));
    const status = String(row[4] ?? "").trim() || "Active";
    if (existingId === targetId && status.toLowerCase() === "active") {
      const sheetRow = index + 2;
      updates.push({
        range: `Hold_Cases!E${sheetRow}:F${sheetRow}`,
        values: [["Collected", new Date().toISOString()]],
      });
    }
  }

  if (updates.length > 0) {
    await sheetsBatchUpdateValuesStrict(updates);
    invalidateSheetsCache();
  }
  return { collectedCount: updates.length };
}
