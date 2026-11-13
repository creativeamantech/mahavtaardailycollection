export type DacMode = "split_sfdc_online" | "single_dac";
export type DuplicateStrategy = "last_wins" | "sum";
export type ReconciliationMode = "difference" | "additive";
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
  existingNewTotal: number;
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
  | "master_higher"
  | "unchanged"
  | "unmatched";

export type ReconciledRow = StagedPaidRow & {
  master?: MasterRow | undefined;
  /** Cumulative total parsed from the Paid File (SFDC + Online or Direct Paid Amount) */
  paidFileTotal: number;
  /** Effective current total already recorded in Master (max of existingTotal and existingNewTotal) */
  currentMasterTotal: number;
  /** Difference between Paid File Total and Current Master Total (or raw Paid File amount in additive mode) */
  difference: number;
  /** Target DAC value to write to Master's DAC column so existingTotal + dac = newTotal */
  dac: number;
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
  masterHigherCount: number;
  totalConflictsFlagged: number;
  protectedSkips: number;
  unchangedCount: number;
  unmatchedCount: number;
  totalIncomingDac: number;
  totalIncomingSfdc: number;
  totalIncomingOnline: number;
  totalUpdateDac: number;
  totalNetDifference: number;
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

const ACTION_PRIORITY: Record<ReconciliationAction, number> = {
  clean_update: 0,
  provisional_confirmed: 1,
  conflict_provisional: 2,
  protected_conflict: 3,
  master_higher: 4,
  protected_match: 5,
  unchanged: 6,
  unmatched: 7,
};

export function reconcilePaidRecord(
  record: StagedPaidRow,
  master: MasterRow | undefined,
  dacOverride?: number,
  mode: ReconciliationMode = "difference",
): ReconciledRow {
  const paidFileTotal = roundMoney(record.dac);

  if (!master) {
    const effectiveDac =
      dacOverride !== undefined && Number.isFinite(dacOverride)
        ? roundMoney(dacOverride)
        : paidFileTotal;
    return {
      ...record,
      paidFileTotal,
      currentMasterTotal: 0,
      difference: effectiveDac,
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

  const currentMasterTotal = roundMoney(
    Math.max(master.existingTotal, master.existingNewTotal || 0),
  );
  const rawDifference =
    mode === "difference" ? roundMoney(paidFileTotal - currentMasterTotal) : paidFileTotal;

  // Target DAC to write into Master's DAC column so existingTotal + dac = newTotal
  const computedTargetDac =
    mode === "difference"
      ? roundMoney(Math.max(0, paidFileTotal - master.existingTotal))
      : paidFileTotal;

  const effectiveDac =
    dacOverride !== undefined && Number.isFinite(dacOverride)
      ? roundMoney(dacOverride)
      : computedTargetDac;

  const effectiveDiff =
    dacOverride !== undefined && Number.isFinite(dacOverride)
      ? roundMoney(master.existingTotal + effectiveDac - currentMasterTotal)
      : rawDifference;

  const protectedRecord = isProtectedSource(master);
  if (protectedRecord) {
    const mismatch =
      (mode === "difference"
        ? differs(paidFileTotal, currentMasterTotal)
        : differs(effectiveDac, master.existingDac)) ||
      differs(record.ecs, master.existingEcs) ||
      differs(record.special, master.existingSpecial);
    if (mismatch) {
      return {
        ...record,
        paidFileTotal,
        currentMasterTotal,
        difference: rawDifference,
        dac: paidFileTotal,
        master,
        newTotal: currentMasterTotal,
        action: "protected_conflict",
        reason: `Protected (${master.dacSource || "CORRECTED"}): Paid File (${paidFileTotal.toLocaleString("en-IN")}) differs from Master (${currentMasterTotal.toLocaleString("en-IN")})`,
        hasDelta: false,
        conflictFlag: true,
        protectedSkip: true,
        isEditable: false,
      };
    }
    return {
      ...record,
      paidFileTotal,
      currentMasterTotal,
      difference: 0,
      dac: 0,
      master,
      newTotal: currentMasterTotal,
      action: "protected_match",
      reason: `Protected (${master.dacSource || "CORRECTED"}): matches confirmed Master total`,
      hasDelta: false,
      conflictFlag: false,
      protectedSkip: true,
      isEditable: false,
    };
  }

  // Provisional collection cross-check
  if (master.provisionalDac !== null && master.provisionalDac > 0) {
    const provisionalCompare = mode === "difference" ? rawDifference : effectiveDac;
    if (!differs(master.provisionalDac, provisionalCompare)) {
      const nextTotal = roundMoney(master.existingTotal + effectiveDac);
      const hasAmountDelta =
        differs(nextTotal, currentMasterTotal) ||
        differs(effectiveDac, master.existingDac) ||
        differs(record.ecs, master.existingEcs) ||
        differs(record.special, master.existingSpecial) ||
        master.dacSource !== "PAID_FILE" ||
        master.isConflict;
      return {
        ...record,
        paidFileTotal,
        currentMasterTotal,
        difference: effectiveDiff,
        dac: effectiveDac,
        master,
        newTotal: nextTotal,
        action: "provisional_confirmed",
        reason: "Provisional DAC matched Paid File difference — confirmed",
        hasDelta: hasAmountDelta,
        conflictFlag: false,
        protectedSkip: false,
        isEditable: true,
      };
    }
    return {
      ...record,
      paidFileTotal,
      currentMasterTotal,
      difference: rawDifference,
      dac: effectiveDac,
      master,
      newTotal: currentMasterTotal,
      action: "conflict_provisional",
      reason: `Provisional DAC (₹${master.provisionalDac.toLocaleString("en-IN")}) differs from Paid File update (₹${provisionalCompare.toLocaleString("en-IN")})`,
      hasDelta: false,
      conflictFlag: true,
      protectedSkip: false,
      isEditable: true,
    };
  }

  if (mode === "difference") {
    // Master Total already exceeds Paid File Total -> never subtract or double-add!
    if (effectiveDiff < -EPS) {
      return {
        ...record,
        paidFileTotal,
        currentMasterTotal,
        difference: effectiveDiff,
        dac: 0,
        master,
        newTotal: currentMasterTotal,
        action: "master_higher",
        reason: `Master Total (₹${currentMasterTotal.toLocaleString("en-IN")}) is higher than Paid File (₹${paidFileTotal.toLocaleString("en-IN")}) by ₹${Math.abs(effectiveDiff).toLocaleString("en-IN")} — skipped`,
        hasDelta: false,
        conflictFlag: false,
        protectedSkip: false,
        isEditable: true,
      };
    }

    const hasEcsOrSpecialChange =
      (record.ecs > EPS && differs(record.ecs, master.existingEcs)) ||
      (record.special > EPS && differs(record.special, master.existingSpecial));

    // Exact match with Master Total -> Already reconciled, do NOT add again!
    if (effectiveDiff <= EPS && !hasEcsOrSpecialChange) {
      return {
        ...record,
        paidFileTotal,
        currentMasterTotal,
        difference: 0,
        dac: master.existingDac,
        master,
        newTotal: currentMasterTotal,
        action: "unchanged",
        reason: "Paid File total matches Master total — no new amount to add",
        hasDelta: false,
        conflictFlag: false,
        protectedSkip: false,
        isEditable: true,
      };
    }

    const nextTotal = roundMoney(master.existingTotal + effectiveDac);
    return {
      ...record,
      paidFileTotal,
      currentMasterTotal,
      difference: effectiveDiff,
      dac: effectiveDac,
      master,
      newTotal: nextTotal,
      action: "clean_update",
      reason:
        effectiveDiff > EPS
          ? `New payment difference +₹${effectiveDiff.toLocaleString("en-IN")} to apply`
          : "Updated ECS / Special amount",
      hasDelta: true,
      conflictFlag: false,
      protectedSkip: false,
      isEditable: true,
    };
  }

  // Legacy additive mode
  const hasAmountDelta =
    differs(effectiveDac, master.existingDac) ||
    differs(record.ecs, master.existingEcs) ||
    differs(record.special, master.existingSpecial) ||
    (master.dacSource !== "PAID_FILE" &&
      (effectiveDac !== 0 || record.ecs !== 0 || record.special !== 0));

  if (!hasAmountDelta) {
    return {
      ...record,
      paidFileTotal,
      currentMasterTotal,
      difference: effectiveDac,
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
    paidFileTotal,
    currentMasterTotal,
    difference: effectiveDac,
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
  mode: ReconciliationMode = "difference",
): { rows: ReconciledRow[]; summary: ReconciliationSummary } {
  const masterById = new Map<string, MasterRow>();
  for (const row of masterRows) {
    masterById.set(row.agreementId, row);
  }

  const rows: ReconciledRow[] = records
    .map((record) =>
      reconcilePaidRecord(
        record,
        masterById.get(record.agreementId),
        overrides?.get(record.agreementId),
        mode,
      ),
    )
    .sort((a, b) => {
      const pDiff = ACTION_PRIORITY[a.action] - ACTION_PRIORITY[b.action];
      if (pDiff !== 0) return pDiff;
      return Math.abs(b.difference) - Math.abs(a.difference);
    });

  let duplicatesReplaced = 0;
  let matchedUpdates = 0;
  let provisionalConfirmed = 0;
  let protectedMatches = 0;
  let protectedConflicts = 0;
  let conflictProvisional = 0;
  let masterHigherCount = 0;
  let unchangedCount = 0;
  let unmatchedCount = 0;
  let totalIncomingDac = 0;
  let totalIncomingSfdc = 0;
  let totalIncomingOnline = 0;
  let totalUpdateDac = 0;
  let totalNetDifference = 0;

  for (const r of rows) {
    duplicatesReplaced += r.duplicatesReplaced;
    totalIncomingDac += r.paidFileTotal;
    totalIncomingSfdc += r.sfdc;
    totalIncomingOnline += r.online;

    switch (r.action) {
      case "clean_update":
        matchedUpdates++;
        totalUpdateDac += r.dac;
        totalNetDifference += Math.max(0, r.difference);
        break;
      case "provisional_confirmed":
        provisionalConfirmed++;
        matchedUpdates++;
        totalUpdateDac += r.dac;
        totalNetDifference += Math.max(0, r.difference);
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
      case "master_higher":
        masterHigherCount++;
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
      masterHigherCount,
      totalConflictsFlagged: protectedConflicts + conflictProvisional,
      protectedSkips: protectedMatches + protectedConflicts,
      unchangedCount,
      unmatchedCount,
      totalIncomingDac: roundMoney(totalIncomingDac),
      totalIncomingSfdc: roundMoney(totalIncomingSfdc),
      totalIncomingOnline: roundMoney(totalIncomingOnline),
      totalUpdateDac: roundMoney(totalUpdateDac),
      totalNetDifference: roundMoney(totalNetDifference),
    },
  };
}
