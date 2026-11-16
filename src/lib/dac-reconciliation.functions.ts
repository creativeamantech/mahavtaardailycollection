import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import { mergeAmansRemark } from "./dac-reconciliation";
import { normalisePaidId, roundMoney, type MasterRow } from "./paid-file-reconciliation";

export type DacReconciliationAuditEntry = {
  row: number;
  timestamp: string;
  loanId: string;
  oldDac: number;
  newDac: number;
  provisionalDac: number | null;
  action: string;
  collectionCategory: string;
  masterCategory: string;
  amansRemark: string;
  adminName: string;
  collectionRows: string;
  masterRow: number;
};

const DAC_AUDIT_TAB = "DAC_Reconciliation_Audit";
const DAC_AUDIT_HEADERS = [
  "Timestamp (IST)",
  "Loan ID",
  "Old DAC (₹)",
  "New DAC (₹)",
  "Provisional DAC (₹)",
  "Action",
  "Collection Category",
  "Master Category",
  "Aman's Remark",
  "Admin Name",
  "Collection Rows",
  "Master Row",
];

function chunkRanges<T>(items: T[], maxItems = 450): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += maxItems) {
    chunks.push(items.slice(i, i + maxItems));
  }
  return chunks;
}

async function ensureDacAuditTab(spreadsheetId: string) {
  const { paidFileChecked, paidFileSheetsUrl } = await import("./paid-file.functions");
  const meta = await paidFileChecked<{ sheets?: { properties?: { title?: string } }[] }>(
    paidFileSheetsUrl(spreadsheetId, "?fields=sheets.properties.title"),
    "GOOGLE_SHEETS_API_KEY",
  );
  if (!(meta.sheets ?? []).some((s) => s.properties?.title === DAC_AUDIT_TAB)) {
    await paidFileChecked(
      paidFileSheetsUrl(spreadsheetId, ":batchUpdate"),
      "GOOGLE_SHEETS_API_KEY",
      {
        method: "POST",
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: DAC_AUDIT_TAB } } }],
        }),
      },
    );
  }
  await paidFileChecked(
    paidFileSheetsUrl(
      spreadsheetId,
      "/values/" + encodeURIComponent("'" + DAC_AUDIT_TAB + "'!A1:L1") + "?valueInputOption=RAW",
    ),
    "GOOGLE_SHEETS_API_KEY",
    { method: "PUT", body: JSON.stringify({ values: [DAC_AUDIT_HEADERS] }) },
  );
}

export const getDacReconciliationData = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession("Admin");
  const { readCollections } = await import("./mahavtaar.functions");
  const { readExcludedLoanNumbers } = await import("./excluded-loans.functions");
  const { paidFileChecked, paidFileSheetsUrl, paidFileSheetValues, readMaster } =
    await import("./paid-file.functions");

  const [collections, excludedLoans, masterResult] = await Promise.all([
    readCollections(),
    readExcludedLoanNumbers(),
    readMaster("monthly-master")
      .then((master) => ({ ok: true as const, master }))
      .catch((error) => ({
        ok: false as const,
        message:
          error instanceof Error ? error.message : "Could not load Master Allocation spreadsheet.",
      })),
  ]);

  let auditEntries: DacReconciliationAuditEntry[] = [];
  if (masterResult.ok) {
    try {
      const meta = await paidFileChecked<{ sheets?: { properties?: { title?: string } }[] }>(
        paidFileSheetsUrl(masterResult.master.file.id, "?fields=sheets.properties.title"),
        "GOOGLE_SHEETS_API_KEY",
      );
      if ((meta.sheets ?? []).some((s) => s.properties?.title === DAC_AUDIT_TAB)) {
        const rows = await paidFileSheetValues(
          masterResult.master.file.id,
          `'${DAC_AUDIT_TAB}'!A2:L`,
        );
        auditEntries = rows
          .map((r, i) => ({
            row: i + 2,
            timestamp: String(r[0] ?? ""),
            loanId: String(r[1] ?? ""),
            oldDac: Number(r[2] ?? 0) || 0,
            newDac: Number(r[3] ?? 0) || 0,
            provisionalDac: String(r[4] ?? "").trim() === "" ? null : Number(r[4] ?? 0) || 0,
            action: String(r[5] ?? ""),
            collectionCategory: String(r[6] ?? ""),
            masterCategory: String(r[7] ?? ""),
            amansRemark: String(r[8] ?? ""),
            adminName: String(r[9] ?? ""),
            collectionRows: String(r[10] ?? ""),
            masterRow: Number(r[11] ?? 0) || 0,
          }))
          .filter((entry) => entry.loanId || entry.timestamp)
          .reverse()
          .slice(0, 40);
      }
    } catch (error) {
      console.warn("Could not read DAC reconciliation audit log:", error);
    }
  }

  return {
    collections,
    excludedLoans,
    auditEntries,
    master: masterResult.ok
      ? {
          found: true as const,
          spreadsheetName: masterResult.master.file.name,
          spreadsheetUrl: masterResult.master.file.url,
          tab: masterResult.master.file.tab,
          hasProtectionColumns: masterResult.master.hasProtectionColumns,
          columnSupport: {
            dac: masterResult.master.cols.dac >= 0,
            dacSource: masterResult.master.cols.dacSource >= 0,
            isCorrected: masterResult.master.cols.isCorrected >= 0,
            provisionalDac: masterResult.master.cols.provisionalDac >= 0,
            paymentDate: masterResult.master.cols.paymentDate >= 0,
          },
          rows: masterResult.master.data as MasterRow[],
          errorMessage: "",
        }
      : {
          found: false as const,
          spreadsheetName: "",
          spreadsheetUrl: "",
          tab: "",
          hasProtectionColumns: false,
          columnSupport: {
            dac: false,
            dacSource: false,
            isCorrected: false,
            provisionalDac: false,
            paymentDate: false,
          },
          rows: [] as MasterRow[],
          errorMessage: masterResult.message,
        },
  };
});

const remarkUpdateItemSchema = z.object({
  rows: z.array(z.number().int().min(2).max(1_000_000)).min(1).max(100),
  loanId: z.string().trim().min(1).max(100),
  remark: z.string().trim().max(1000),
  mode: z.enum(["append", "replace"]).default("append"),
});

export const batchUpdateAmansRemarks = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z
      .object({
        updates: z.array(remarkUpdateItemSchema).min(1).max(5000),
      })
      .parse(v),
  )
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const {
      invalidateSheetsCache,
      requireGoogleSheetsWriteAccess,
      sheetsBatchUpdateValuesStrict,
      sheetsGetFresh,
      withSheetMutex,
    } = await import("./mahavtaar.server");

    requireGoogleSheetsWriteAccess();

    return withSheetMutex("collections-amans-remarks", async () => {
      const sheetRows = await sheetsGetFresh("Collections!B2:S");
      const valueRanges: { range: string; values: (string | number)[][] }[] = [];
      const seenRows = new Set<number>();

      for (const item of data.updates) {
        const expectedLoan = normalisePaidId(item.loanId);
        for (const rowNumber of item.rows) {
          if (seenRows.has(rowNumber)) continue;
          seenRows.add(rowNumber);

          const rawRow = sheetRows[rowNumber - 2];
          if (!rawRow) {
            throw new Error(`Collection row ${rowNumber} could not be found in Collections sheet.`);
          }
          const actualLoan = normalisePaidId(rawRow[0]);
          if (actualLoan && actualLoan !== expectedLoan) {
            throw new Error(
              `Collections row ${rowNumber} changed (${actualLoan} vs ${expectedLoan}). Refresh before updating remarks.`,
            );
          }

          const existingRemark = String(rawRow[17] ?? "");
          const nextRemark =
            item.mode === "replace" ? item.remark : mergeAmansRemark(existingRemark, item.remark);
          valueRanges.push({
            range: `Collections!S${rowNumber}`,
            values: [[nextRemark]],
          });
        }
      }

      if (valueRanges.length === 0) {
        return { ok: true as const, updatedCount: 0, batches: 0 };
      }

      const chunks = chunkRanges(valueRanges, 450);
      for (const chunk of chunks) {
        await sheetsBatchUpdateValuesStrict(chunk);
      }
      invalidateSheetsCache();

      return {
        ok: true as const,
        updatedCount: valueRanges.length,
        batches: chunks.length,
      };
    });
  });

const commitItemSchema = z.object({
  agreementId: z.string().trim().min(1).max(100),
  masterRow: z.number().int().min(2).max(1_000_000).nullable(),
  expectedExistingDac: z.number().finite(),
  targetAmount: z.number().finite().min(0),
  paymentDate: z.string().trim().max(40).optional().default(""),
  collectionRows: z.array(z.number().int().min(2).max(1_000_000)).max(100),
  amansRemark: z.string().trim().max(1000),
  remarkMode: z.enum(["append", "replace"]).default("append"),
  collectionCategory: z.string().trim().max(160).optional().default(""),
  masterCategory: z.string().trim().max(160).optional().default(""),
  customerName: z.string().trim().max(200).optional().default(""),
  executiveName: z.string().trim().max(200).optional().default(""),
});

export const commitDacReconciliationBatch = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z
      .object({
        mode: z.enum(["PUSH_TO_DAC", "SET_PROVISIONAL"]),
        allowOverwriteProtected: z.boolean().optional().default(false),
        createMissingMasterRows: z.boolean().optional().default(false),
        items: z.array(commitItemSchema).min(1).max(5000),
      })
      .parse(v),
  )
  .handler(async ({ data }) => {
    const admin = await requireSession("Admin");
    const { createHash } = await import("node:crypto");
    const {
      invalidateSheetsCache,
      requireGoogleSheetsWriteAccess,
      sheetsBatchUpdateValuesStrict,
      sheetsGetFresh,
      withSheetMutex,
    } = await import("./mahavtaar.server");
    const {
      computePaidFileAuditChainHash,
      ensurePaidFileAuditTab,
      paidFileAuthHeaders,
      paidFileChecked,
      paidFileColumnLetter,
      paidFileSheetValues,
      paidFileSheetsUrl,
      readMaster,
      retryPaidFileFetch,
    } = await import("./paid-file.functions");

    requireGoogleSheetsWriteAccess();

    return withSheetMutex("dac-reconciliation-commit", async () => {
      const [master, collectionSheetRows] = await Promise.all([
        readMaster("monthly-master"),
        sheetsGetFresh("Collections!B2:S"),
      ]);
      const { file, cols } = master;

      if (data.mode === "SET_PROVISIONAL" && cols.provisionalDac < 0) {
        throw new Error(
          `Master tab "${file.tab}" does not have a "Provisional DAC" column. Add a "Provisional DAC" header column before staging provisional entries.`,
        );
      }
      if (data.mode === "PUSH_TO_DAC" && cols.dac < 0) {
        throw new Error(`Master tab "${file.tab}" is missing the DAC column.`);
      }

      const masterByRow = new Map(master.data.map((r) => [r.row, r]));
      const masterById = new Map(master.data.map((r) => [r.agreementId, r]));
      const seenMasterRows = new Set<number>();
      const seenNewAgreementIds = new Set<string>();
      const seenCollectionRows = new Set<number>();
      const colLetter = paidFileColumnLetter;
      const tabPrefix = `'${file.tab}'!`;

      const hasUnallocated = data.items.some((i) => i.masterRow === null);
      if (hasUnallocated && !data.createMissingMasterRows) {
        throw new Error(
          "One or more selected loans do not exist in Master Allocation yet. Confirm adding new Master rows before committing.",
        );
      }

      let nextInsertRow = master.data.reduce((maxRow, row) => Math.max(maxRow, row.row), 1) + 1;
      if (hasUnallocated) {
        const agreementCol = await paidFileSheetValues(
          file.id,
          `${tabPrefix}${colLetter(cols.agreement)}1:${colLetter(cols.agreement)}`,
        );
        nextInsertRow = Math.max(nextInsertRow, agreementCol.length + 1);
      }

      const masterRanges: { range: string; values: (string | number | boolean)[][] }[] = [];
      const collectionRemarkRanges: { range: string; values: (string | number)[][] }[] = [];
      const auditRows: (string | number)[][] = [];

      const timestamp = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date());

      let totalDacDelta = 0;

      for (const item of data.items) {
        const normalizedId = normalisePaidId(item.agreementId);
        let targetRowNumber: number;
        let existingDacValue = 0;
        let currentDacSource = "";
        let currentProvisionalDac: number | null = null;
        const isCreatingNewRow = item.masterRow === null;

        if (isCreatingNewRow) {
          if (seenNewAgreementIds.has(normalizedId)) {
            throw new Error(`Duplicate unallocated Loan ID in batch: ${normalizedId}`);
          }
          seenNewAgreementIds.add(normalizedId);

          if (masterById.has(normalizedId)) {
            throw new Error(
              `Loan ID ${normalizedId} already exists in Master Allocation (row ${masterById.get(normalizedId)?.row}). Refresh before retrying.`,
            );
          }

          targetRowNumber = nextInsertRow++;
          seenMasterRows.add(targetRowNumber);

          // Write Loan ID and metadata to the new row; never write formula columns (Remaining / New Total)
          masterRanges.push({
            range: `${tabPrefix}${colLetter(cols.agreement)}${targetRowNumber}`,
            values: [[normalizedId]],
          });
          if (cols.customer >= 0 && item.customerName.trim()) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.customer)}${targetRowNumber}`,
              values: [[item.customerName.trim()]],
            });
          }
          if (cols.executive >= 0 && item.executiveName.trim()) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.executive)}${targetRowNumber}`,
              values: [[item.executiveName.trim()]],
            });
          }
          if (cols.category >= 0 && item.collectionCategory.trim()) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.category)}${targetRowNumber}`,
              values: [[item.collectionCategory.trim()]],
            });
          }
          if (cols.bucket >= 0 && item.collectionCategory.trim()) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.bucket)}${targetRowNumber}`,
              values: [[item.collectionCategory.trim()]],
            });
          }
        } else {
          const masterRowNum = item.masterRow!;
          if (seenMasterRows.has(masterRowNum)) {
            throw new Error(`Duplicate Master row in batch request: ${masterRowNum}`);
          }
          seenMasterRows.add(masterRowNum);

          const current = masterByRow.get(masterRowNum);
          if (!current || current.agreementId !== normalizedId) {
            throw new Error(
              `Master Sheet changed after preview for ${normalizedId} (row ${masterRowNum}). Refresh and verify again.`,
            );
          }

          if (Math.abs(current.existingDac - item.expectedExistingDac) > 0.01) {
            throw new Error(
              `DAC changed on Master row ${masterRowNum} (${normalizedId}) from ₹${item.expectedExistingDac} to ₹${current.existingDac}. Refresh before committing.`,
            );
          }

          if (
            !data.allowOverwriteProtected &&
            data.mode === "PUSH_TO_DAC" &&
            (current.isCorrected ||
              current.dacSource === "MANUAL" ||
              current.dacSource === "CORRECTED")
          ) {
            throw new Error(
              `Record ${normalizedId} (row ${masterRowNum}) is marked ${current.dacSource || "CORRECTED"}. Enable "Allow updating previously corrected Master rows" to overwrite intentionally.`,
            );
          }

          targetRowNumber = current.row;
          existingDacValue = current.existingDac;
          currentDacSource = current.dacSource;
          currentProvisionalDac = current.provisionalDac;
        }

        const nextRemarkText = item.amansRemark.trim();
        for (const colRow of item.collectionRows) {
          if (seenCollectionRows.has(colRow)) continue;
          seenCollectionRows.add(colRow);
          const rawCol = collectionSheetRows[colRow - 2];
          if (!rawCol) {
            throw new Error(`Collection row ${colRow} not found in Collections sheet.`);
          }
          const actualLoan = normalisePaidId(rawCol[0]);
          if (actualLoan && actualLoan !== normalizedId) {
            throw new Error(
              `Collections row ${colRow} belongs to ${actualLoan}, expected ${normalizedId}.`,
            );
          }
          if (nextRemarkText) {
            const existingColRemark = String(rawCol[17] ?? "");
            const merged =
              item.remarkMode === "replace"
                ? nextRemarkText
                : mergeAmansRemark(existingColRemark, nextRemarkText);
            collectionRemarkRanges.push({
              range: `Collections!S${colRow}`,
              values: [[merged]],
            });
          }
        }

        if (data.mode === "PUSH_TO_DAC") {
          const targetDac = roundMoney(item.targetAmount);
          const delta = roundMoney(targetDac - existingDacValue);
          totalDacDelta = roundMoney(totalDacDelta + delta);

          // Never touch formula columns such as Remaining or New Total.
          masterRanges.push({
            range: `${tabPrefix}${colLetter(cols.dac)}${targetRowNumber}`,
            values: [[targetDac]],
          });
          if (cols.dacSource >= 0) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.dacSource)}${targetRowNumber}`,
              values: [["CORRECTED"]],
            });
          }
          if (cols.isCorrected >= 0) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.isCorrected)}${targetRowNumber}`,
              values: [[true]],
            });
          }
          if (cols.paymentDate >= 0 && item.paymentDate) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.paymentDate)}${targetRowNumber}`,
              values: [[item.paymentDate]],
            });
          }
          if (
            cols.provisionalDac >= 0 &&
            currentProvisionalDac !== null &&
            currentProvisionalDac > 0
          ) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.provisionalDac)}${targetRowNumber}`,
              values: [[""]],
            });
          }

          auditRows.push([
            timestamp,
            normalizedId,
            existingDacValue,
            targetDac,
            "",
            isCreatingNewRow ? "ADD_TO_MASTER_AND_PUSH_DAC" : "PUSH_TO_DAC (CORRECTED)",
            item.collectionCategory,
            isCreatingNewRow ? "Added New Row" : item.masterCategory,
            nextRemarkText,
            admin.name,
            item.collectionRows.join(", "),
            targetRowNumber,
          ]);
        } else {
          const provisionalAmount = roundMoney(item.targetAmount);
          if (isCreatingNewRow) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.dac)}${targetRowNumber}`,
              values: [[0]],
            });
          }
          masterRanges.push({
            range: `${tabPrefix}${colLetter(cols.provisionalDac)}${targetRowNumber}`,
            values: [[provisionalAmount]],
          });
          if (cols.dacSource >= 0 && (!currentDacSource || currentDacSource === "PROVISIONAL")) {
            masterRanges.push({
              range: `${tabPrefix}${colLetter(cols.dacSource)}${targetRowNumber}`,
              values: [["PROVISIONAL"]],
            });
          }
          auditRows.push([
            timestamp,
            normalizedId,
            existingDacValue,
            existingDacValue,
            provisionalAmount,
            isCreatingNewRow ? "ADD_TO_MASTER_PROVISIONAL" : "SET_PROVISIONAL",
            item.collectionCategory,
            isCreatingNewRow ? "Added New Row" : item.masterCategory,
            nextRemarkText,
            admin.name,
            item.collectionRows.join(", "),
            targetRowNumber,
          ]);
        }
      }

      // Chunk writes cleanly (<= 450 cells per Google Sheets batchUpdate request)
      const masterChunks = chunkRanges(masterRanges, 450);
      const collectionChunks = chunkRanges(collectionRemarkRanges, 450);

      for (const chunk of masterChunks) {
        await retryPaidFileFetch(paidFileSheetsUrl(file.id, "/values:batchUpdate"), {
          method: "POST",
          headers: paidFileAuthHeaders("GOOGLE_SHEETS_API_KEY"),
          body: JSON.stringify({ valueInputOption: "RAW", data: chunk }),
        });
      }

      for (const chunk of collectionChunks) {
        await sheetsBatchUpdateValuesStrict(chunk);
      }
      if (collectionChunks.length > 0) {
        invalidateSheetsCache();
      }

      // Append detailed row-level reconciliation audit
      await ensureDacAuditTab(file.id);
      await paidFileChecked(
        paidFileSheetsUrl(
          file.id,
          "/values/" +
            encodeURIComponent(`'${DAC_AUDIT_TAB}'!A:L`) +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        ),
        "GOOGLE_SHEETS_API_KEY",
        { method: "POST", body: JSON.stringify({ values: auditRows }) },
      );

      // Keep the tamper-evident Paid_File_Audit_Log hash chain continuous when DAC cells are updated
      if (data.mode === "PUSH_TO_DAC") {
        await ensurePaidFileAuditTab(file.id);
        const existingAudit = await paidFileSheetValues(file.id, "'Paid_File_Audit_Log'!A:O");
        let previousHash = "GENESIS";
        for (let i = existingAudit.length - 1; i >= 1; i--) {
          const candidate = String(existingAudit[i]?.[14] ?? "").trim();
          if (candidate) {
            previousHash = candidate;
            break;
          }
        }
        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              sourceMode: "CORRECTED",
              timestamp,
              items: data.items
                .map((i) => ({
                  row: i.masterRow,
                  id: normalisePaidId(i.agreementId),
                  dac: i.targetAmount,
                }))
                .sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || a.id.localeCompare(b.id)),
            }),
          )
          .digest("hex");
        const batchLabel = "Collections vs Master DAC Reconciliation (CORRECTED)";
        const chainHash = computePaidFileAuditChainHash({
          previousHash,
          fingerprint,
          timestamp,
          adminName: admin.name,
          fileName: batchLabel,
          recordsApplied: data.items.length,
          conflictsFlagged: 0,
        });
        await paidFileChecked(
          paidFileSheetsUrl(
            file.id,
            "/values/" +
              encodeURIComponent("'Paid_File_Audit_Log'!A:O") +
              ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
          ),
          "GOOGLE_SHEETS_API_KEY",
          {
            method: "POST",
            body: JSON.stringify({
              values: [
                [
                  timestamp,
                  admin.name,
                  batchLabel,
                  data.items.length,
                  totalDacDelta,
                  0,
                  0,
                  fingerprint,
                  "COMPLETE",
                  masterChunks.length,
                  0,
                  0,
                  0,
                  previousHash,
                  chainHash,
                ],
              ],
            }),
          },
        );
      }

      return {
        ok: true as const,
        updatedMasterRows: seenMasterRows.size,
        updatedCollectionRows: collectionRemarkRanges.length,
        batches: masterChunks.length + collectionChunks.length,
        auditCount: auditRows.length,
        totalDacDelta,
      };
    });
  });

const cleanupItemSchema = z.object({
  loanId: z.string().trim().min(1).max(100),
  rows: z.array(z.number().int().min(2).max(1_000_000)).min(1).max(200),
});

export const cleanupUnallocatedCollectionBatch = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z
      .object({
        mode: z.enum(["DELETE_COLLECTION", "IGNORE_LOAN"]),
        reason: z.string().trim().max(300).optional().default(""),
        items: z.array(cleanupItemSchema).min(1).max(5000),
      })
      .parse(v),
  )
  .handler(async ({ data }) => {
    const admin = await requireSession("Admin");
    const {
      ensureSheet,
      ensureSheetStrict,
      invalidateSheetsCache,
      requireGoogleSheetsWriteAccess,
      sheetsAppendStrict,
      sheetsBatchUpdateValuesStrict,
      sheetsGet,
      sheetsGetFresh,
      withSheetMutex,
    } = await import("./mahavtaar.server");

    requireGoogleSheetsWriteAccess();

    return withSheetMutex("collections-unallocated-cleanup", async () => {
      const sheetRows = await sheetsGetFresh("Collections!B2:S");
      const todayIst = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const cleanReason = data.reason.trim() || "Loan ID not present in active Master Allocation";

      const seenRows = new Set<number>();
      const seenLoanIds = new Set<string>();
      const collectionUpdates: { range: string; values: (string | number)[][] }[] = [];
      const verificationAuditRows: (string | number)[][] = [];
      const timestampIso = new Date().toISOString();

      for (const item of data.items) {
        const normalizedId = normalisePaidId(item.loanId);
        if (!normalizedId) continue;
        seenLoanIds.add(normalizedId);

        for (const rowNumber of item.rows) {
          if (seenRows.has(rowNumber)) continue;
          seenRows.add(rowNumber);

          const rawRow = sheetRows[rowNumber - 2];
          if (!rawRow) {
            throw new Error(`Collections row ${rowNumber} not found.`);
          }
          const actualLoan = normalisePaidId(rawRow[0]);
          if (actualLoan && actualLoan !== normalizedId) {
            throw new Error(
              `Collections row ${rowNumber} changed (${actualLoan} vs ${normalizedId}). Refresh and retry.`,
            );
          }

          const existingRemark = String(rawRow[17] ?? "");
          if (data.mode === "DELETE_COLLECTION") {
            const deleteNote = `Deleted by ${admin.name}: ${cleanReason} (${todayIst})`;
            collectionUpdates.push({
              range: `Collections!G${rowNumber}`,
              values: [["Deleted"]],
            });
            collectionUpdates.push({
              range: `Collections!S${rowNumber}`,
              values: [[mergeAmansRemark(existingRemark, deleteNote)]],
            });
            verificationAuditRows.push([
              timestampIso,
              admin.name,
              normalizedId,
              rowNumber,
              "ENTRY_DELETED",
              cleanReason,
              "DAC Reconciliation (Unallocated Cleanup)",
            ]);
          } else {
            const ignoreNote = `[Ignored - Not in Master]${data.reason.trim() ? ` ${data.reason.trim()}` : ""}`;
            collectionUpdates.push({
              range: `Collections!S${rowNumber}`,
              values: [[mergeAmansRemark(existingRemark, ignoreNote)]],
            });
          }
        }
      }

      let excludedAddedCount = 0;
      if (data.mode === "IGNORE_LOAN" && seenLoanIds.size > 0) {
        const EXCLUDED_TAB = "Excluded Loan Numbers";
        await ensureSheet(EXCLUDED_TAB, ["Loan Number", "Date Added", "Reason", "Status"]);
        const existingExcluded = await sheetsGet(`${EXCLUDED_TAB}!A2:D`);
        const activeSet = new Set(
          existingExcluded
            .filter((r) => ((r[3] ?? "Active").trim() || "Active").toLowerCase() === "active")
            .map((r) => normalisePaidId(r[0] ?? ""))
            .filter(Boolean),
        );
        const toAppend = [...seenLoanIds]
          .filter((id) => !activeSet.has(id))
          .map((id) => [id, todayIst, cleanReason, "Active"]);
        if (toAppend.length > 0) {
          await sheetsAppendStrict(`${EXCLUDED_TAB}!A:D`, toAppend);
          excludedAddedCount = toAppend.length;
        }
      }

      const chunks = chunkRanges(collectionUpdates, 450);
      for (const chunk of chunks) {
        await sheetsBatchUpdateValuesStrict(chunk);
      }
      if (chunks.length > 0 || excludedAddedCount > 0) {
        invalidateSheetsCache();
      }

      if (verificationAuditRows.length > 0) {
        try {
          await ensureSheetStrict("Verification_Audit", [
            "Timestamp",
            "Admin",
            "Loan ID",
            "Sheet Row",
            "Action",
            "Reason",
            "Source",
          ]);
          await sheetsAppendStrict("Verification_Audit!A:G", verificationAuditRows);
        } catch (error) {
          console.warn("Collections rows soft-deleted, but audit append failed:", error);
        }
      }

      return {
        ok: true as const,
        mode: data.mode,
        affectedLoanCount: seenLoanIds.size,
        updatedRowCount: seenRows.size,
        excludedAddedCount,
        batches: chunks.length,
      };
    });
  });
