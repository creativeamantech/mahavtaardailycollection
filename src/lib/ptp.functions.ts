import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;
const tab = "PTPs";
const header = ["Submitted At", "Executive Name", "Loan ID", "Promise Date", "Promise Amount", "Remarks", "Status", "Removed At"];

function normaliseLoanId(value: string) {
  return value.replace(/^['’‘\x60]+/, "").trim().toUpperCase();
}

async function ensurePTPTab() {
  const { ensureSheetStrict, sheetsGet, sheetsUpdateStrict } = await import("./mahavtaar.server");
  await ensureSheetStrict(tab, header);
  const current = await sheetsGet("PTPs!A1:H1");
  if (String(current?.[0]?.[6] ?? "").trim() !== "Status") {
    await sheetsUpdateStrict("PTPs!G1:H1", [["Status", "Removed At"]]);
  }
}

const submitSchema = z.object({
  executive: z.enum(executives),
  loanIds: z.array(z.string().trim().min(1).max(60)).min(1).max(1000),
  remarks: z.string().trim().max(300).optional().default(""),
});

export const submitPTPs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => submitSchema.parse(data))
  .handler(async ({ data }) => {
    const { requireGoogleSheetsWriteAccess, sheetsGet, sheetsAppendStrict, invalidateSheetsCache } = await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await ensurePTPTab();
    const rows = await sheetsGet("PTPs!A2:H");
    const active = new Set((rows ?? []).filter(r => !String(r[6] ?? "").trim() || String(r[6]).trim().toLowerCase() === "active").map(r => normaliseLoanId(String(r[2] ?? ""))).filter(Boolean));
    const seen = new Set<string>();
    const fresh: string[] = [];
    let duplicateCount = 0;
    for (const raw of data.loanIds) {
      const id = normaliseLoanId(raw);
      if (!id || seen.has(id) || active.has(id)) { duplicateCount++; continue; }
      seen.add(id); fresh.push(raw.trim());
    }
    if (fresh.length) {
      const stamp = new Date().toISOString();
      await sheetsAppendStrict("PTPs!A:H", fresh.map(loanId => [stamp, data.executive, loanId, "", "", data.remarks, "Active", ""]));
      invalidateSheetsCache();
    }
    return { ok: true as const, savedCount: fresh.length, duplicateCount };
  });

const executiveSchema = z.object({ executive: z.enum(executives) });

export const listActivePTPs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => executiveSchema.parse(data))
  .handler(async ({ data }) => {
    const { sheetsGet } = await import("./mahavtaar.server");
    await ensurePTPTab();
    const rows = await sheetsGet("PTPs!A2:H");
    return (rows ?? []).map((r, i) => ({
      row: i + 2, submittedAt: String(r[0] ?? ""), executive: String(r[1] ?? "").trim(),
      loanId: String(r[2] ?? "").trim(), promiseDate: String(r[3] ?? ""),
      promiseAmount: Number(r[4] ?? 0) || 0, remarks: String(r[5] ?? "").trim(),
      status: String(r[6] ?? "").trim() || "Active",
    })).filter(r => r.executive === data.executive && r.loanId && r.status.toLowerCase() === "active").reverse();
  });

const removeSchema = z.object({ executive: z.enum(executives), loanIds: z.array(z.string().trim().min(1).max(60)).min(1).max(1000) });

export const removePTPs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => removeSchema.parse(data))
  .handler(async ({ data }) => {
    const { requireGoogleSheetsWriteAccess, sheetsGet, sheetsBatchUpdateValuesStrict, invalidateSheetsCache } = await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await ensurePTPTab();
    const rows = await sheetsGet("PTPs!A2:H");
    const requested = new Set(data.loanIds.map(normaliseLoanId));
    const updates: { range: string; values: (string | number)[][] }[] = [];
    for (let i = 0; i < (rows ?? []).length; i++) {
      const r = rows[i]!;
      if (String(r[1] ?? "").trim() === data.executive && requested.has(normaliseLoanId(String(r[2] ?? ""))) && (String(r[6] ?? "").trim() || "Active").toLowerCase() === "active") {
        const row = i + 2;
        updates.push({ range: `PTPs!G${row}:H${row}`, values: [["Removed", new Date().toISOString()]] });
      }
    }
    if (updates.length) { await sheetsBatchUpdateValuesStrict(updates); invalidateSheetsCache(); }
    return { ok: true as const, removedCount: updates.length };
  });

export const listActivePTPsForReport = createServerFn({ method: "POST" })
  .handler(async () => {
    const { sheetsGet } = await import("./mahavtaar.server");
    await ensurePTPTab();
    const rows = await sheetsGet("PTPs!A2:K");
    return (rows ?? []).map((r, i) => ({
      row: i + 2, submittedAt: String(r[0] ?? ""), executive: String(r[1] ?? "").trim(),
      loanId: String(r[2] ?? "").trim(), promiseDate: String(r[3] ?? ""),
      promiseAmount: Number(String(r[4] ?? "").replace(/[,₹\\s]/g, "")) || 0,
      remarks: String(r[5] ?? "").trim(), status: String(r[6] ?? "").trim() || "Active",
      city: String(r[9] ?? "").trim(), principalOutstanding: Number(String(r[10] ?? "").replace(/[,₹\\s]/g, "")) || 0,
    })).filter(r => r.loanId);
  });

// A successfully recorded payment fulfils the matching active PTP, retaining its history.
export async function markMatchingPTPsKept(loanId: string) {
  const target = normaliseLoanId(loanId);
  if (!target) return { keptCount: 0 };
  const { requireGoogleSheetsWriteAccess, sheetsGet, sheetsBatchUpdateValuesStrict, invalidateSheetsCache } = await import("./mahavtaar.server");
  requireGoogleSheetsWriteAccess();
  await ensurePTPTab();
  const rows = await sheetsGet("PTPs!A2:H");
  const updates: { range: string; values: (string | number)[][] }[] = [];
  for (let i = 0; i < (rows ?? []).length; i++) {
    const r = rows[i]!;
    if (normaliseLoanId(String(r[2] ?? "")) === target && (String(r[6] ?? "").trim() || "Active").toLowerCase() === "active") {
      const row = i + 2;
      updates.push({ range: `PTPs!G${row}:H${row}`, values: [["Kept", new Date().toISOString()]] });
    }
  }
  if (updates.length) { await sheetsBatchUpdateValuesStrict(updates); invalidateSheetsCache(); }
  return { keptCount: updates.length };
}
