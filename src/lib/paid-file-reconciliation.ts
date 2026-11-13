export type DacMode = "split_sfdc_online" | "single_dac";
export type DuplicateStrategy = "last_wins" | "sum";
export type DacSource = "MANUAL" | "CORRECTED" | "PAID_FILE" | "PROVISIONAL" | "";

export type ColumnMapping = {
  agreementId: number;
  dacMode: DacMode;
  sfdc: number;
  online: number;
  paidAmount: number;
  ecs: number;
  special: number;
};

export type MasterRow = {
  row: number;
  agreementId: string;
  existingTotal: number;
  existingDac: number;
  existingEcs: number;
  existingSpecial: number;
  bucket: string;
  city: string;
  customer?: string;
  executive?: string;
  dacSource: DacSource;
  isCorrected: boolean;
  provisionalDac: number | null;
  isConflict: boolean;
  paidConflictDac: number | null;
};

export type PaidTransaction = {
  row: number;
  sfdc: number;
  online: number;
  paidAmount: number;
  ecs: number;
  special: number;
};

export type StagedPaidRow = {
  agreementId: string;
  sfdc: number;
  online: number;
  dac: number;
  ecs: number;
  special: number;
  sourceRows: number;
  duplicatesReplaced: number;
  transactions: PaidTransaction[];
};

export type SheetInfo = {
  name: string;
  rowCount: number;
  headers: string[];
  mapping: ColumnMapping;
  headerRow: number;
  sampleRows: string[][];
};

export type ReconciliationAction =
  | "clean_update"
  | "provisional_confirmed"
  | "conflict_provisional"
  | "protected_conflict"
  | "protected_match"
  | "unchanged"
  | "unmatched";

export type ReconciledRow = StagedPaidRow & {
  master?: MasterRow | undefined;
  newTotal?: number | undefined;
  action: ReconciliationAction;
  reason: string;
  hasDelta: boolean;
  conflictFlag: boolean;
  protectedSkip: boolean;
  isEditable: boolean;
};

export type ReconciliationSummary = {
  totalParsedRows: number;
  uniqueIds: number;
  duplicatesReplaced: number;
  invalidRows: number;
  matchedUpdates: number;
  provisionalConfirmed: number;
  protectedMatches: number;
  protectedConflicts: number;
  conflictProvisional: number;
  totalConflictsFlagged: number;
  protectedSkips: number;
  unchangedCount: number;
  unmatchedCount: number;
  totalIncomingDac: number;
  totalIncomingSfdc: number;
  totalIncomingOnline: number;
  totalUpdateDac: number;
};

export type SamplePreviewRow = {
  rowIndex: number;
  agreementId: string;
  sfdc: number;
  online: number;
  dac: number;
  ecs: number;
  special: number;
  valid: boolean;
};

export function normalisePaidId(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^['"\x60‘’]+|['"\x60‘’]+$/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function parsePaidAmount(value: unknown): number {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const raw = String(value)
    .trim()
    .replace(/[₹,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function isMappingValid(mapping: ColumnMapping): { valid: boolean; message?: string } {
  if (mapping.agreementId < 0) {
    return { valid: false, message: "Select the Agreement ID / Loan ID column." };
  }
  if (mapping.dacMode === "split_sfdc_online") {
    if (mapping.sfdc < 0 && mapping.online < 0) {
      return {
        valid: false,
        message:
          "Map at least one of SFDC or Online columns (or switch to Single DAC Column mode).",
      };
    }
  } else if (mapping.paidAmount < 0) {
    return {
      valid: false,
      message: "Map the Direct DAC / Paid Amount column (or switch to SFDC + Online mode).",
    };
  }
  return { valid: true };
}

export function computeSamplePreview(
  sampleRows: string[][],
  mapping: ColumnMapping,
  limit = 5,
): SamplePreviewRow[] {
  const out: SamplePreviewRow[] = [];
  for (let i = 0; i < sampleRows.length && out.length < limit; i++) {
    const row = sampleRows[i] ?? [];
    if (!row.some((cell) => String(cell ?? "").trim() !== "")) continue;
    const agreementId = mapping.agreementId >= 0 ? normalisePaidId(row[mapping.agreementId]) : "";
    const sfdc = parsePaidAmount(mapping.sfdc >= 0 ? row[mapping.sfdc] : 0);
    const online = parsePaidAmount(mapping.online >= 0 ? row[mapping.online] : 0);
    const paidAmount = parsePaidAmount(mapping.paidAmount >= 0 ? row[mapping.paidAmount] : 0);
    const ecs = parsePaidAmount(mapping.ecs >= 0 ? row[mapping.ecs] : 0);
    const special = parsePaidAmount(mapping.special >= 0 ? row[mapping.special] : 0);
    const numbersValid = [sfdc, online, paidAmount, ecs, special].every(Number.isFinite);
    const dac =
      mapping.dacMode === "single_dac"
        ? Number.isFinite(paidAmount)
          ? paidAmount
          : 0
        : (Number.isFinite(sfdc) ? sfdc : 0) + (Number.isFinite(online) ? online : 0);
    out.push({
      rowIndex: i + 1,
      agreementId: agreementId || "—",
      sfdc: Number.isFinite(sfdc) ? roundMoney(sfdc) : 0,
      online: Number.isFinite(online) ? roundMoney(online) : 0,
      dac: roundMoney(dac),
      ecs: Number.isFinite(ecs) ? roundMoney(ecs) : 0,
      special: Number.isFinite(special) ? roundMoney(special) : 0,
      valid: Boolean(agreementId) && numbersValid,
    });
  }
  return out;
}

const EPS = 0.01;
const differs = (a: number, b: number) => Math.abs(a - b) > EPS;

export function isProtectedSource(master: MasterRow): boolean {
  return master.isCorrected || master.dacSource === "MANUAL" || master.dacSource === "CORRECTED";
}

export function reconcilePaidRecord(
  record: StagedPaidRow,
  master: MasterRow | undefined,
  dacOverride?: number,
): ReconciledRow {
  const effectiveDac =
    dacOverride !== undefined && Number.isFinite(dacOverride)
      ? roundMoney(dacOverride)
      : record.dac;

  if (!master) {
    return {
      ...record,
      dac: effectiveDac,
      master: undefined,
      newTotal: undefined,
      action: "unmatched",
      reason: "Agreement ID not found in Master Allocation",
      hasDelta: false,
      conflictFlag: false,
      protectedSkip: false,
      isEditable: false,
    };
  }

  const protectedRecord = isProtectedSource(master);
  if (protectedRecord) {
    const mismatch =
      differs(effectiveDac, master.existingDac) ||
      differs(record.ecs, master.existingEcs) ||
      differs(record.special, master.existingSpecial);
    if (mismatch) {
      return {
        ...record,
        dac: effectiveDac,
        master,
        newTotal: master.existingTotal,
        action: "protected_conflict",
        reason: `Protected (${master.dacSource || "CORRECTED"}): incoming differs from confirmed Master values`,
        hasDelta: false,
        conflictFlag: true,
        protectedSkip: true,
        isEditable: false,
      };
    }
    return {
      ...record,
      dac: effectiveDac,
      master,
      newTotal: master.existingTotal,
      action: "protected_match",
      reason: `Protected (${master.dacSource || "CORRECTED"}): matches confirmed Master values`,
      hasDelta: false,
      conflictFlag: false,
      protectedSkip: true,
      isEditable: false,
    };
  }

  // Provisional collection cross-check
  if (master.provisionalDac !== null && master.provisionalDac > 0) {
    if (!differs(master.provisionalDac, effectiveDac)) {
      const hasAmountDelta =
        differs(effectiveDac, master.existingDac) ||
        differs(record.ecs, master.existingEcs) ||
        differs(record.special, master.existingSpecial) ||
        master.dacSource !== "PAID_FILE" ||
        master.isConflict;
      return {
        ...record,
        dac: effectiveDac,
        master,
        newTotal: roundMoney(master.existingTotal + effectiveDac),
        action: "provisional_confirmed",
        reason: "Provisional DAC matched Paid File — confirmed & provisional cleared",
        hasDelta: hasAmountDelta,
        conflictFlag: false,
        protectedSkip: false,
        isEditable: true,
      };
    }
    return {
      ...record,
      dac: effectiveDac,
      master,
      newTotal: roundMoney(master.existingTotal + effectiveDac),
      action: "conflict_provisional",
      reason: `Provisional DAC (₹${master.provisionalDac.toLocaleString("en-IN")}) differs from Paid File (₹${effectiveDac.toLocaleString("en-IN")})`,
      hasDelta: false,
      conflictFlag: true,
      protectedSkip: false,
      isEditable: true,
    };
  }

  const hasAmountDelta =
    differs(effectiveDac, master.existingDac) ||
    differs(record.ecs, master.existingEcs) ||
    differs(record.special, master.existingSpecial) ||
    (master.dacSource !== "PAID_FILE" &&
      (effectiveDac !== 0 || record.ecs !== 0 || record.special !== 0));

  if (!hasAmountDelta) {
    return {
      ...record,
      dac: effectiveDac,
      master,
      newTotal: roundMoney(master.existingTotal + effectiveDac),
      action: "unchanged",
      reason: "Already matches Master values",
      hasDelta: false,
      conflictFlag: false,
      protectedSkip: false,
      isEditable: true,
    };
  }

  return {
    ...record,
    dac: effectiveDac,
    master,
    newTotal: roundMoney(master.existingTotal + effectiveDac),
    action: "clean_update",
    reason: "Matched in Master — ready to commit",
    hasDelta: true,
    conflictFlag: false,
    protectedSkip: false,
    isEditable: true,
  };
}

export function reconcilePaidDataset(
  records: StagedPaidRow[],
  masterRows: MasterRow[],
  meta: { totalRows: number; invalidRows: number },
  overrides?: Map<string, number>,
): { rows: ReconciledRow[]; summary: ReconciliationSummary } {
  const masterById = new Map<string, MasterRow>();
  for (const row of masterRows) {
    masterById.set(row.agreementId, row);
  }

  const rows: ReconciledRow[] = records.map((record) =>
    reconcilePaidRecord(
      record,
      masterById.get(record.agreementId),
      overrides?.get(record.agreementId),
    ),
  );

  let duplicatesReplaced = 0;
  let matchedUpdates = 0;
  let provisionalConfirmed = 0;
  let protectedMatches = 0;
  let protectedConflicts = 0;
  let conflictProvisional = 0;
  let unchangedCount = 0;
  let unmatchedCount = 0;
  let totalIncomingDac = 0;
  let totalIncomingSfdc = 0;
  let totalIncomingOnline = 0;
  let totalUpdateDac = 0;

  for (const r of rows) {
    duplicatesReplaced += r.duplicatesReplaced;
    totalIncomingDac += r.dac;
    totalIncomingSfdc += r.sfdc;
    totalIncomingOnline += r.online;

    switch (r.action) {
      case "clean_update":
        matchedUpdates++;
        totalUpdateDac += r.dac;
        break;
      case "provisional_confirmed":
        provisionalConfirmed++;
        matchedUpdates++;
        totalUpdateDac += r.dac;
        break;
      case "protected_match":
        protectedMatches++;
        break;
      case "protected_conflict":
        protectedConflicts++;
        break;
      case "conflict_provisional":
        conflictProvisional++;
        break;
      case "unchanged":
        unchangedCount++;
        break;
      case "unmatched":
        unmatchedCount++;
        break;
    }
  }

  return {
    rows,
    summary: {
      totalParsedRows: meta.totalRows,
      uniqueIds: rows.length,
      duplicatesReplaced,
      invalidRows: meta.invalidRows,
      matchedUpdates,
      provisionalConfirmed,
      protectedMatches,
      protectedConflicts,
      conflictProvisional,
      totalConflictsFlagged: protectedConflicts + conflictProvisional,
      protectedSkips: protectedMatches + protectedConflicts,
      unchangedCount,
      unmatchedCount,
      totalIncomingDac: roundMoney(totalIncomingDac),
      totalIncomingSfdc: roundMoney(totalIncomingSfdc),
      totalIncomingOnline: roundMoney(totalIncomingOnline),
      totalUpdateDac: roundMoney(totalUpdateDac),
    },
  };
}
