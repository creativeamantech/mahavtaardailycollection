import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;
const tab = "Hold_Cases";
const header = ["Submitted At", "Executive Name", "Loan ID", "Hold Reason / Remarks", "Status", "Removed At"];

function normaliseLoanId(value: string) {
  return value.replace(/^['\`\\u2018\\u2019]+/, "").trim().toUpperCase();
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
    const { requireGoogleSheetsWriteAccess, sheetsGet, sheetsAppendStrict, invalidateSheetsCache } =
      await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await ensureHoldTab();

    const existingRows = await sheetsGet("Hold_Cases!A2:F");
    const existingIds = new Set(
      (existingRows ?? [])
        .filter((row) => !String(row[4] ?? "").trim() || String(row[4]).trim().toLowerCase() === "active")
        .map((row) => normaliseLoanId(String(row[2] ?? "")))
        .filter(Boolean),
    );

    const seen = new Set<string>();
    const uniqueIds: string[] = [];
    const duplicates: string[] = [];
    for (const raw of data.loanIds) {
      const id = normaliseLoanId(raw);
      if (!id) continue;
      if (seen.has(id) || existingIds.has(id)) {
        duplicates.push(id);
        continue;
      }
      seen.add(id);
      uniqueIds.push(raw.trim());
    }

    if (uniqueIds.length > 0) {
      const submittedAt = new Date().toISOString();
      await sheetsAppendStrict("Hold_Cases!A:F", uniqueIds.map((loanId) => [
        submittedAt, data.executive, loanId, data.remarks, "Active", "",
      ]));
      invalidateSheetsCache();
    }

    return {
      ok: true as const,
      savedCount: uniqueIds.length,
      duplicateCount: duplicates.length,
      duplicates: [...new Set(duplicates)],
    };
  });

const executiveSchema = z.object({ executive: z.enum(executives) });

export const listActiveHoldCases = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => executiveSchema.parse(data))
  .handler(async ({ data }) => {
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
      .filter((item) =>
        item.executive === data.executive &&
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
    const {
      requireGoogleSheetsWriteAccess,
      sheetsGet,
      sheetsBatchUpdateValuesStrict,
      invalidateSheetsCache,
    } = await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await ensureHoldTab();

    const rows = await sheetsGet("Hold_Cases!A2:F");
    const requested = new Set(data.loanIds.map(normaliseLoanId));
    const updates: { range: string; values: (string | number)[][] }[] = [];
    const removedLoanIds: string[] = [];
    for (let index = 0; index < (rows ?? []).length; index++) {
      const row = rows[index]!;
      const executive = String(row[1] ?? "").trim();
      const loanId = String(row[2] ?? "").trim();
      const status = String(row[4] ?? "").trim() || "Active";
      if (executive === data.executive && loanId && requested.has(normaliseLoanId(loanId)) && status.toLowerCase() === "active") {
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
    return { ok: true as const, removedCount: removedLoanIds.length, removedLoanIds };
  });
