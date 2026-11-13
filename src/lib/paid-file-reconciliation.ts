export type DacMode = "split_sfdc_online" | "single_dac";
export type DuplicateStrategy = "last_wins" | "sum";
export type ReconciliationMode = "difference";
export type DacSource = "MANUAL" | "CORRECTED" | "PAID_FILE" | "PROVISIONAL" | "";

export type ColumnMapping = {
  agreementId: number;
  dacMode: DacMode;
  sfdc: number;
  online: number;
  paidAmount: number;
  /** Optional explicit Total column from Paid File (-1 = auto DAC + ECS + Special) */
  paidTotal: number;
  ecs: number;
  special: number;
  /** Optional Payment Date column from Paid File (-1 = use default payment date) */
  paymentDate: number;
};

export type MasterRow = {
  row: number;
  agreementId: string;
  existingTotal: number;
  existingDac: number;
  existingNewTotal: number;
  existingRemaining: number | null;
  existingEcs: number;
  existingSpecial: number;
  existingPaymentDate: string;
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
  paidTotal: number;
  ecs: number;
  special: number;
  paymentDate: string;
};

export type StagedPaidRow = {
  agreementId: string;
  sfdc: number;
  online: number;
  /** Paid File DAC column (SFDC + Online or Direct DAC) */
  dac: number;
  /** Paid File Total column (or computed DAC + ECS + Special) */
  paidTotal: number;
  ecs: number;
  special: number;
  paymentDate: string;
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
  /** Paid File DAC (SFDC + Online or Direct DAC from Paid File) */
  paidFileDac: number;
  /** Paid File Total (for Master New Total VLOOKUP comparison) */
  paidFileTotal: number;
  /** Current effective Total in Master Sheet */
  currentMasterTotal: number;
  /** Master Sheet Remaining formula equivalent: Master Total - Paid File Total (negative = needs update) */
  remaining: number;
  /** Positive net update amount needed (Paid File Total - Master Total) */
  difference: number;
  /** Delta amounts to add to Master's DAC, ECS, and Special columns */
  deltaDac: number;
  deltaEcs: number;
  deltaSpecial: number;
  /** Final values written to Master Sheet's DAC, ECS, Special, and Payment Date columns */
  dac: number;
  targetEcs: number;
  targetSpecial: number;
  resolvedPaymentDate: string;
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
  totalUpdateEcs: number;
  totalUpdateSpecial: number;
  totalNetDifference: number;
};

export type SamplePreviewRow = {
  rowIndex: number;
  agreementId: string;
  sfdc: number;
  online: number;
  dac: number;
  paidTotal: number;
  ecs: number;
  special: number;
  paymentDate: string;
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

const MONTHS_SHORT: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function validYmd(year: number, month: number, day: number): string {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parsePaidDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  // Excel serial date number (e.g. 46338)
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const serial = Math.floor(Number(raw));
    if (serial >= 30000 && serial <= 80000) {
      const utcMs = Date.UTC(1899, 11, 30) + serial * 86_400_000;
      const d = new Date(utcMs);
      return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }

  // ISO YYYY-MM-DD (optionally with timestamp)
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    return validYmd(Number(iso[1]), Number(iso[2]), Number(iso[3])) || raw;
  }

  // DD-MMM-YYYY or DD MMM YYYY (common in Indian NBFC exports)
  const mmm = raw.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,5})[-\s/](\d{2,4})$/);
  if (mmm) {
    const mon = MONTHS_SHORT[mmm[2]!.toLowerCase()];
    const yrRaw = Number(mmm[3]);
    const yr = yrRaw < 100 ? 2000 + yrRaw : yrRaw;
    if (mon) {
      return validYmd(yr, mon, Number(mmm[1])) || raw;
    }
  }

  // DD/MM/YYYY, DD-MM-YYYY, or MM/DD/YY from Excel raw:false
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    const yrRaw = Number(dmy[3]);
    const yr = yrRaw < 100 ? 2000 + yrRaw : yrRaw;
    // Prefer DD/MM unless second part exceeds 12
    if (b <= 12 && (a > 12 || dmy[3]!.length === 4)) {
      return validYmd(yr, b, a) || raw;
    }
    if (a <= 12 && b <= 31) {
      return validYmd(yr, a, b) || raw;
    }
    return validYmd(yr, b, a) || raw;
  }

  return raw.slice(0, 32);
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function isMappingValid(mapping: ColumnMapping): { valid: boolean; message?: string } {
  if (mapping.agreementId < 0) {
    return { valid: false, message: "Select the Agreement ID / Loan ID column." };
  }
  if (mapping.dacMode === "split_sfdc_online") {
    if (mapping.sfdc < 0 && mapping.online < 0 && mapping.paidTotal < 0) {
      return {
        valid: false,
        message:
          "Map at least one of SFDC or Online columns (or switch to Single DAC Column mode).",
      };
    }
  } else if (mapping.paidAmount < 0 && mapping.paidTotal < 0) {
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
  defaultPaymentDate = "",
): SamplePreviewRow[] {
  const out: SamplePreviewRow[] = [];
  for (let i = 0; i < sampleRows.length && out.length < limit; i++) {
    const row = sampleRows[i] ?? [];
    if (!row.some((cell) => String(cell ?? "").trim() !== "")) continue;
    const agreementId = mapping.agreementId >= 0 ? normalisePaidId(row[mapping.agreementId]) : "";
    const sfdc = parsePaidAmount(mapping.sfdc >= 0 ? row[mapping.sfdc] : 0);
    const online = parsePaidAmount(mapping.online >= 0 ? row[mapping.online] : 0);
    const paidAmount = parsePaidAmount(mapping.paidAmount >= 0 ? row[mapping.paidAmount] : 0);
    const paidTotalRaw = parsePaidAmount(mapping.paidTotal >= 0 ? row[mapping.paidTotal] : 0);
    const ecs = parsePaidAmount(mapping.ecs >= 0 ? row[mapping.ecs] : 0);
    const special = parsePaidAmount(mapping.special >= 0 ? row[mapping.special] : 0);
    const paymentDate =
      (mapping.paymentDate >= 0 ? parsePaidDate(row[mapping.paymentDate]) : "") ||
      defaultPaymentDate;
    const numbersValid = [sfdc, online, paidAmount, paidTotalRaw, ecs, special].every(
      Number.isFinite,
    );
    const dac =
      mapping.dacMode === "single_dac"
        ? Number.isFinite(paidAmount)
          ? paidAmount
          : 0
        : (Number.isFinite(sfdc) ? sfdc : 0) + (Number.isFinite(online) ? online : 0);
    const paidTotal =
      mapping.paidTotal >= 0
        ? Number.isFinite(paidTotalRaw)
          ? paidTotalRaw
          : 0
        : dac + (Number.isFinite(ecs) ? ecs : 0) + (Number.isFinite(special) ? special : 0);

    out.push({
      rowIndex: i + 1,
      agreementId: agreementId || "—",
      sfdc: Number.isFinite(sfdc) ? roundMoney(sfdc) : 0,
      online: Number.isFinite(online) ? roundMoney(online) : 0,
      dac: roundMoney(dac),
      paidTotal: roundMoney(paidTotal),
      ecs: Number.isFinite(ecs) ? roundMoney(ecs) : 0,
      special: Number.isFinite(special) ? roundMoney(special) : 0,
      paymentDate: paymentDate || "—",
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
  defaultPaymentDate = "",
): ReconciledRow {
  const paidFileDac = roundMoney(record.dac);
  const paidFileTotal = roundMoney(
    record.paidTotal > 0 ? record.paidTotal : record.dac + record.ecs + record.special,
  );
  const resolvedPaymentDate = record.paymentDate || defaultPaymentDate;

  if (!master) {
    const effectiveDac =
      dacOverride !== undefined && Number.isFinite(dacOverride)
        ? roundMoney(dacOverride)
        : paidFileDac;
    return {
      ...record,
      paidFileDac,
      paidFileTotal,
      currentMasterTotal: 0,
      remaining: roundMoney(-paidFileTotal),
      difference: paidFileTotal,
      deltaDac: effectiveDac,
      deltaEcs: roundMoney(record.ecs),
      deltaSpecial: roundMoney(record.special),
      dac: effectiveDac,
      targetEcs: roundMoney(record.ecs),
      targetSpecial: roundMoney(record.special),
      resolvedPaymentDate,
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
  // Master Sheet Remaining formula = Total - New Total (negative => needs update)
  const remaining =
    mode === "difference"
      ? roundMoney(currentMasterTotal - paidFileTotal)
      : roundMoney(-paidFileTotal);
  const rawDifference =
    mode === "difference" ? roundMoney(paidFileTotal - currentMasterTotal) : paidFileTotal;

  // Allocate negative Remaining (neededAmount) across ECS, Special, and DAC cleanly
  const neededAmount =
    mode === "difference"
      ? roundMoney(Math.max(0, paidFileTotal - currentMasterTotal))
      : paidFileTotal;

  const deltaEcs =
    mode === "difference"
      ? roundMoney(Math.max(0, Math.min(neededAmount, record.ecs - master.existingEcs)))
      : roundMoney(record.ecs);
  const deltaSpecial =
    mode === "difference"
      ? roundMoney(
          Math.max(0, Math.min(neededAmount - deltaEcs, record.special - master.existingSpecial)),
        )
      : roundMoney(record.special);
  const deltaDac =
    mode === "difference"
      ? roundMoney(Math.max(0, neededAmount - deltaEcs - deltaSpecial))
      : paidFileDac;

  const targetEcs = roundMoney(mode === "difference" ? master.existingEcs + deltaEcs : record.ecs);
  const targetSpecial = roundMoney(
    mode === "difference" ? master.existingSpecial + deltaSpecial : record.special,
  );
  const computedTargetDac = roundMoney(
    mode === "difference" ? master.existingDac + deltaDac : paidFileDac,
  );

  const effectiveDac =
    dacOverride !== undefined && Number.isFinite(dacOverride)
      ? roundMoney(dacOverride)
      : computedTargetDac;
  const effectiveDeltaDac =
    dacOverride !== undefined && Number.isFinite(dacOverride)
      ? roundMoney(effectiveDac - master.existingDac)
      : deltaDac;
  const effectiveDifference =
    dacOverride !== undefined && Number.isFinite(dacOverride)
      ? roundMoney(effectiveDeltaDac + deltaEcs + deltaSpecial)
      : rawDifference;
  const effectiveRemaining =
    dacOverride !== undefined && Number.isFinite(dacOverride)
      ? roundMoney(-effectiveDifference)
      : remaining;

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
        paidFileDac,
        paidFileTotal,
        currentMasterTotal,
        remaining,
        difference: rawDifference,
        deltaDac: 0,
        deltaEcs: 0,
        deltaSpecial: 0,
        dac: paidFileDac,
        targetEcs: master.existingEcs,
        targetSpecial: master.existingSpecial,
        resolvedPaymentDate,
        master,
        newTotal: currentMasterTotal,
        action: "protected_conflict",
        reason: `Protected (${master.dacSource || "CORRECTED"}): Paid File Total (${paidFileTotal.toLocaleString("en-IN")}) differs from Master (${currentMasterTotal.toLocaleString("en-IN")})`,
        hasDelta: false,
        conflictFlag: true,
        protectedSkip: true,
        isEditable: false,
      };
    }
    return {
      ...record,
      paidFileDac,
      paidFileTotal,
      currentMasterTotal,
      remaining: 0,
      difference: 0,
      deltaDac: 0,
      deltaEcs: 0,
      deltaSpecial: 0,
      dac: master.existingDac,
      targetEcs: master.existingEcs,
      targetSpecial: master.existingSpecial,
      resolvedPaymentDate,
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
    const provisionalCompare = mode === "difference" ? effectiveDifference : effectiveDac;
    if (!differs(master.provisionalDac, provisionalCompare)) {
      const nextTotal = roundMoney(
        currentMasterTotal + effectiveDeltaDac + deltaEcs + deltaSpecial,
      );
      return {
        ...record,
        paidFileDac,
        paidFileTotal,
        currentMasterTotal,
        remaining: effectiveRemaining,
        difference: effectiveDifference,
        deltaDac: effectiveDeltaDac,
        deltaEcs,
        deltaSpecial,
        dac: effectiveDac,
        targetEcs,
        targetSpecial,
        resolvedPaymentDate,
        master,
        newTotal: nextTotal,
        action: "provisional_confirmed",
        reason: "Provisional DAC matched Paid File difference — confirmed",
        hasDelta: true,
        conflictFlag: false,
        protectedSkip: false,
        isEditable: true,
      };
    }
    return {
      ...record,
      paidFileDac,
      paidFileTotal,
      currentMasterTotal,
      remaining,
      difference: rawDifference,
      deltaDac: 0,
      deltaEcs: 0,
      deltaSpecial: 0,
      dac: effectiveDac,
      targetEcs: master.existingEcs,
      targetSpecial: master.existingSpecial,
      resolvedPaymentDate,
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
    // Master Remaining > 0 means Master Total is already higher than Paid File Total -> skip
    if (effectiveRemaining > EPS) {
      return {
        ...record,
        paidFileDac,
        paidFileTotal,
        currentMasterTotal,
        remaining: effectiveRemaining,
        difference: effectiveDifference,
        deltaDac: 0,
        deltaEcs: 0,
        deltaSpecial: 0,
        dac: master.existingDac,
        targetEcs: master.existingEcs,
        targetSpecial: master.existingSpecial,
        resolvedPaymentDate,
        master,
        newTotal: currentMasterTotal,
        action: "master_higher",
        reason: `Master Total (₹${currentMasterTotal.toLocaleString("en-IN")}) > Paid File (₹${paidFileTotal.toLocaleString("en-IN")}) · Remaining +₹${effectiveRemaining.toLocaleString("en-IN")}`,
        hasDelta: false,
        conflictFlag: false,
        protectedSkip: false,
        isEditable: true,
      };
    }

    // Remaining === 0 -> Already reconciled, do NOT re-add
    if (effectiveRemaining >= -EPS) {
      return {
        ...record,
        paidFileDac,
        paidFileTotal,
        currentMasterTotal,
        remaining: 0,
        difference: 0,
        deltaDac: 0,
        deltaEcs: 0,
        deltaSpecial: 0,
        dac: master.existingDac,
        targetEcs: master.existingEcs,
        targetSpecial: master.existingSpecial,
        resolvedPaymentDate,
        master,
        newTotal: currentMasterTotal,
        action: "unchanged",
        reason: "Remaining is ₹0 — Master Total matches Paid File Total",
        hasDelta: false,
        conflictFlag: false,
        protectedSkip: false,
        isEditable: true,
      };
    }

    // Negative Remaining (< 0) -> Apply delta to DAC / ECS / Special + Payment Date & New Total = Paid File Total
    const nextTotal = roundMoney(currentMasterTotal + effectiveDeltaDac + deltaEcs + deltaSpecial);
    const parts: string[] = [];
    if (effectiveDeltaDac > EPS) parts.push(`DAC +₹${effectiveDeltaDac.toLocaleString("en-IN")}`);
    if (deltaEcs > EPS) parts.push(`ECS +₹${deltaEcs.toLocaleString("en-IN")}`);
    if (deltaSpecial > EPS) parts.push(`Special +₹${deltaSpecial.toLocaleString("en-IN")}`);
    if (resolvedPaymentDate) parts.push(`Date ${resolvedPaymentDate}`);

    return {
      ...record,
      paidFileDac,
      paidFileTotal,
      currentMasterTotal,
      remaining: effectiveRemaining,
      difference: effectiveDifference,
      deltaDac: effectiveDeltaDac,
      deltaEcs,
      deltaSpecial,
      dac: effectiveDac,
      targetEcs,
      targetSpecial,
      resolvedPaymentDate,
      master,
      newTotal: nextTotal,
      action: "clean_update",
      reason: `Remaining -₹${Math.abs(effectiveRemaining).toLocaleString("en-IN")} → Update ${parts.join(", ")}`,
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
      paidFileDac,
      paidFileTotal,
      currentMasterTotal,
      remaining: 0,
      difference: 0,
      deltaDac: 0,
      deltaEcs: 0,
      deltaSpecial: 0,
      dac: effectiveDac,
      targetEcs: record.ecs,
      targetSpecial: record.special,
      resolvedPaymentDate,
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
    paidFileDac,
    paidFileTotal,
    currentMasterTotal,
    remaining: roundMoney(-effectiveDac),
    difference: effectiveDac,
    deltaDac: effectiveDac,
    deltaEcs: record.ecs,
    deltaSpecial: record.special,
    dac: effectiveDac,
    targetEcs: record.ecs,
    targetSpecial: record.special,
    resolvedPaymentDate,
    master,
    newTotal: roundMoney(master.existingTotal + effectiveDac),
    action: "clean_update",
    reason: "Additive update — ready to commit",
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
  defaultPaymentDate = "",
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
        defaultPaymentDate,
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
  let totalUpdateEcs = 0;
  let totalUpdateSpecial = 0;
  let totalNetDifference = 0;

  for (const r of rows) {
    duplicatesReplaced += r.duplicatesReplaced;
    totalIncomingDac += r.paidFileTotal;
    totalIncomingSfdc += r.sfdc;
    totalIncomingOnline += r.online;

    switch (r.action) {
      case "clean_update":
        matchedUpdates++;
        totalUpdateDac += r.deltaDac;
        totalUpdateEcs += r.deltaEcs;
        totalUpdateSpecial += r.deltaSpecial;
        totalNetDifference += Math.max(0, r.difference);
        break;
      case "provisional_confirmed":
        provisionalConfirmed++;
        matchedUpdates++;
        totalUpdateDac += r.deltaDac;
        totalUpdateEcs += r.deltaEcs;
        totalUpdateSpecial += r.deltaSpecial;
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
      totalUpdateEcs: roundMoney(totalUpdateEcs),
      totalUpdateSpecial: roundMoney(totalUpdateSpecial),
      totalNetDifference: roundMoney(totalNetDifference),
    },
  };
}
