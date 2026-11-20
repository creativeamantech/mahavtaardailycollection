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

const tab = "Sensitive_Cases";
const header = ["Submitted At", "Executive Name", "Loan ID", "Remarks"];

function normaliseLoanId(value: string) {
  return value.replace(/^['’‘\x60]+/, "").trim().toUpperCase();
}

async function ensureSensitiveTab() {
  const { ensureSheetStrict } = await import("./mahavtaar.server");
  await ensureSheetStrict(tab, header);
}

const submitSchema = z.object({
  executive: z.enum(executives),
  loanIds: z.array(z.string().trim().min(1).max(60)).min(1).max(1000),
  remarks: z.string().trim().max(300).optional().default(""),
});

export const submitSensitiveCases = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => submitSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireSession();
    const executive = session.role === "Admin" ? data.executive : session.name;
    const {
      requireGoogleSheetsWriteAccess,
      sheetsGet,
      sheetsAppendStrict,
      invalidateSheetsCache,
    } = await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await ensureSensitiveTab();

    const existingRows = await sheetsGet("Sensitive_Cases!A2:D");
    const existingIds = new Set(
      (existingRows ?? [])
        .map((row) => normaliseLoanId(String(row[2] ?? "")))
        .filter(Boolean),
    );
    const seen = new Set<string>();
    const fresh: string[] = [];
    let duplicateCount = 0;
    for (const raw of data.loanIds) {
      const id = normaliseLoanId(raw);
      if (!id || seen.has(id) || existingIds.has(id)) {
        duplicateCount++;
        continue;
      }
      seen.add(id);
      fresh.push(raw.trim());
    }

    if (fresh.length > 0) {
      const submittedAt = new Date().toISOString();
      await sheetsAppendStrict(
        "Sensitive_Cases!A:D",
        fresh.map((loanId) => [submittedAt, executive, loanId, data.remarks]),
      );
      invalidateSheetsCache();
    }

    return { ok: true as const, savedCount: fresh.length, duplicateCount };
  });
