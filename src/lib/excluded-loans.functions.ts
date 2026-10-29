import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TAB = "Excluded Loan Numbers";
const header = ["Loan Number", "Date Added", "Reason", "Status"];

async function assertAdminPassword(password: string) {
  const { verifySettingsPassword } = await import("./app-config.functions");
  const result = await verifySettingsPassword({ data: { password } });
  if (!result.ok) throw new Error("Admin authorization failed.");
}

function normaliseLoanId(value: string) {
  return String(value ?? "").replace(/^['`\u2018\u2019]+/, "").trim().toUpperCase();
}

export type ExcludedLoan = {
  loanNumber: string;
  dateAdded: string;
  reason: string;
  status: string;
};

export const getExcludedLoanNumbers = createServerFn({ method: "GET" }).handler(async () => {
  const { ensureSheet, sheetsGet } = await import("./mahavtaar.server");
  await ensureSheet(TAB, header);
  const rows = await sheetsGet(`${TAB}!A2:D`);
  return rows
    .map((r) => ({
      loanNumber: (r[0] ?? "").trim(),
      dateAdded: (r[1] ?? "").trim(),
      reason: (r[2] ?? "").trim(),
      status: (r[3] ?? "Active").trim() || "Active",
    }))
    .filter((r) => r.loanNumber !== "");
});

export const addExcludedLoanNumber = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      loanNumber: z.string().trim().min(1).max(60),
      reason: z.string().trim().max(300).optional().default(""),
      adminPassword: z.string().max(200),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    await assertAdminPassword(data.adminPassword);
    const { ensureSheet, sheetsGet, sheetsAppend } = await import("./mahavtaar.server");
    await ensureSheet(TAB, header);
    const loanNumber = normaliseLoanId(data.loanNumber);
    const rows = await sheetsGet(`${TAB}!A2:D`);
    const exists = rows.some((r) =>
      normaliseLoanId(r[0] ?? "") === loanNumber && ((r[3] ?? "Active").trim() || "Active").toLowerCase() === "active",
    );
    if (exists) throw new Error("This loan number is already in the exclusion list.");
    await sheetsAppend(`${TAB}!A:D`, [[loanNumber, new Date().toISOString().slice(0, 10), data.reason ?? "", "Active"]]);
    return { ok: true as const, loanNumber };
  });

export const removeExcludedLoanNumber = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ loanNumber: z.string().trim().min(1).max(60), adminPassword: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    await assertAdminPassword(data.adminPassword);
    const { ensureSheet, sheetsGet, sheetsUpdate } = await import("./mahavtaar.server");
    await ensureSheet(TAB, header);
    const rows = await sheetsGet(`${TAB}!A2:D`);
    const target = normaliseLoanId(data.loanNumber);
    const idx = rows.findIndex((r) =>
      normaliseLoanId(r[0] ?? "") === target && ((r[3] ?? "Active").trim() || "Active").toLowerCase() === "active",
    );
    if (idx < 0) throw new Error("Active excluded loan number not found.");
    // Keep the audit record; mark it removed instead of deleting it.
    await sheetsUpdate(`${TAB}!D${idx + 2}`, [["Removed"]]);
    return { ok: true as const, loanNumber: target };
  });
