import { requireSession } from "./auth.functions";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const executives = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Shikha", "Sona", "Sunanda", "Vinita"] as const;
const tab = "PTPs";
const header = ["Submitted At", "Executive Name", "Loan ID", "Promise Date", "Promise Amount", "Remarks", "Status", "Removed At"];

export async function loadLoanCaseIndex() {
  const { sheetsGet } = await import("./mahavtaar.server");
  const [collections, holds, ptps] = await Promise.all([
    sheetsGet("Collections!A2:R"),
    sheetsGet("Hold_Cases!A2:F"),
    sheetsGet("PTPs!A2:H"),
  ]);
  const paid = new Set<string>();
  const held = new Set<string>();
  const promised = new Set<string>();
  for (const row of collections ?? []) {
    const status = String(row[6] ?? "").trim().toUpperCase();
    if (status === "DELETED") continue;
    const loanId = normaliseLoanId(String(row[1] ?? ""));
    const actualId = normaliseLoanId(String(row[17] ?? ""));
    if (loanId) paid.add(loanId);
    if (actualId) paid.add(actualId);
  }
  for (const row of holds ?? []) {
    const id = normaliseLoanId(String(row[2] ?? ""));
    const status = String(row[4] ?? "").trim().toLowerCase() || "active";
    if (id && status === "active") held.add(id);
  }
  for (const row of ptps ?? []) {
    const id = normaliseLoanId(String(row[2] ?? ""));
    const status = String(row[6] ?? "").trim().toLowerCase() || "active";
    if (id && status === "active") promised.add(id);
  }
  return { paid, held, promised };
}

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
    await requireSession();
    const { requireGoogleSheetsWriteAccess, sheetsGet, sheetsAppendStrict, invalidateSheetsCache } = await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await ensurePTPTab();
    const rows = await sheetsGet("PTPs!A2:H");
    const caseIndex = await loadLoanCaseIndex();
    const active = new Set((rows ?? []).filter(r => !String(r[6] ?? "").trim() || String(r[6]).trim().toLowerCase() === "active").map(r => normaliseLoanId(String(r[2] ?? ""))).filter(Boolean));
    const seen = new Set<string>();
    const fresh: string[] = [];
    let duplicateCount = 0;
    let skippedPaidCount = 0;
    let skippedHoldCount = 0;
    for (const raw of data.loanIds) {
      const id = normaliseLoanId(raw);
      if (!id || seen.has(id) || active.has(id)) { duplicateCount++; continue; }
      if (caseIndex.paid.has(id)) { skippedPaidCount++; continue; }
      if (caseIndex.held.has(id)) { skippedHoldCount++; continue; }
      seen.add(id); fresh.push(raw.trim());
    }
    if (fresh.length) {
      const stamp = new Date().toISOString();
      await sheetsAppendStrict("PTPs!A:H", fresh.map(loanId => [stamp, data.executive, loanId, "", "", data.remarks, "Active", ""]));
      invalidateSheetsCache();
    }
    return { ok: true as const, savedCount: fresh.length, duplicateCount, skippedPaidCount, skippedHoldCount };
  });

const executiveSchema = z.object({ executive: z.enum(executives) });

export const listActivePTPs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => executiveSchema.parse(data))
  .handler(async ({ data }) => {
    await requireSession();
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
    await requireSession();
    const { requireGoogleSheetsWriteAccess, sheetsGet, sheetsBatchUpdateValuesStrict, invalidateSheetsCache } = await import("./mahavtaar.server");
    requireGoogleSheetsWriteAccess();
    await ensurePTPTab();
    const rows = await sheetsGet("PTPs!A2:H");
    const requested = new Set(data.loanIds.map(normaliseLoanId));
    const caseIndex = await loadLoanCaseIndex();
    const paidRequested = new Set([...requested].filter(id => caseIndex.paid.has(id)));
    const updates: { range: string; values: (string | number)[][] }[] = [];
    for (let i = 0; i < (rows ?? []).length; i++) {
      const r = rows[i]!;
      const id = normaliseLoanId(String(r[2] ?? ""));
      if (String(r[1] ?? "").trim() === data.executive && requested.has(id) && !caseIndex.paid.has(id) && (String(r[6] ?? "").trim() || "Active").toLowerCase() === "active") {
        const row = i + 2;
        updates.push({ range: `PTPs!G${row}:H${row}`, values: [["Removed", new Date().toISOString()]] });
      }
    }
    if (updates.length) { await sheetsBatchUpdateValuesStrict(updates); invalidateSheetsCache(); }
    return { ok: true as const, removedCount: updates.length, skippedPaidCount: paidRequested.size };
  });

export const listActivePTPsForReport = createServerFn({ method: "POST" })
  .handler(async () => {
    await requireSession();
    const { sheetsGet } = await import("./mahavtaar.server");
    await ensurePTPTab();
    const rows = await sheetsGet("PTPs!A2:K");
    return (rows ?? []).map((r, i) => ({
      row: i + 2, submittedAt: String(r[0] ?? ""), executive: String(r[1] ?? "").trim(),
      loanId: String(r[2] ?? "").trim(), actualId: String(r[8] ?? "").trim(),
      promiseDate: String(r[3] ?? ""), promiseAmount: Number(String(r[4] ?? "").replace(/[,₹\\s]/g, "")) || 0,
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
