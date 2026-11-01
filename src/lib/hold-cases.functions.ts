import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;

const holdCasesSchema = z.object({
  executive: z.enum(executives),
  loanIds: z.array(z.string().trim().min(1).max(60)).min(1).max(1000),
  remarks: z.string().trim().max(300).optional().default(""),
});

function normaliseLoanId(value: string) {
  return value.replace(/^['`\u2018\u2019]+/, "").trim().toUpperCase();
}

export const submitHoldCases = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => holdCasesSchema.parse(data))
  .handler(async ({ data }) => {
    const {
      ensureSheetStrict,
      requireGoogleSheetsWriteAccess,
      sheetsGet,
      sheetsAppendStrict,
      invalidateSheetsCache,
    } = await import("./mahavtaar.server");

    requireGoogleSheetsWriteAccess();
    const tab = "Hold_Cases";
    const header = ["Submitted At", "Executive Name", "Loan ID", "Hold Reason / Remarks"];
    await ensureSheetStrict(tab, header);

    const existingRows = await sheetsGet(`${tab}!A2:D`);
    const existingIds = new Set(
      (existingRows ?? [])
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
      await sheetsAppendStrict(`${tab}!A:D`, uniqueIds.map((loanId) => [
        submittedAt,
        data.executive,
        loanId,
        data.remarks,
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
