import { toCsv } from "./export";
import {
  normalisePaidId,
  roundMoney,
  type DacSource,
  type MasterRow,
} from "./paid-file-reconciliation";

export type VarianceStatus =
  | "MISSING_IN_DAC"
  | "DAC_SHORTFALL"
  | "UNALLOCATED_COLLECTION"
  | "ALREADY_PAID_EXCLUDED"
  | "DAC_MATCHED"
  | "DAC_EXCEEDS_COLLECTION";

export type CollectionReconciliationEntry = {
  row: number;
  executive: string;
  loanId: string;
  amount: number;
  date: string;
  entryType?: string;
  status: string;
  bucket?: string;
  city?: string;
  linkedName?: string;
  amansRemarks?: string;
  allocationCategory?: string;
  allocationDate?: string;
  allocationType?: string;
  settlementType?: string;
  alreadyPaid: boolean;
  isValidated?: boolean;
  isConflict?: boolean;
};

export type DacReconciliationItem = {
  agreementId: string;
  displayLoanId: string;
  customerName: string;
  executives: string[];
  allRows: CollectionReconciliationEntry[];
  activeRows: CollectionReconciliationEntry[];
  alreadyPaidCount: number;
  alreadyPaidAmount: number;
  hasAlreadyPaid: boolean;
  collectionCategory: string;
  collectionCategories: string[];
  collectionBucket: string;
  masterCategory: string;
  masterCategories: string[];
  masterAllocationType: string;
  masterBucket: string;
  categoryMismatch: boolean;
  earliestPaymentDate: string;
  latestPaymentDate: string;
  allocationDate: string;
  collectionAmount: number;
  masterRow: number | null;
  masterDac: number;
  provisionalDac: number | null;
  existingTotal: number;
  existingNewTotal: number;
  existingRemaining: number | null;
  existingPaymentDate: string;
  dacSource: DacSource;
  isCorrected: boolean;
  isMasterProtected: boolean;
  hasDuplicateMaster: boolean;
  hasCollectionConflict: boolean;
  isExcludedLoan: boolean;
  difference: number;
  gapAmount: number;
  varianceStatus: VarianceStatus;
  combinedAmansRemarks: string;
  isVerifiedByAman: boolean;
  targetPushDac: number;
};

export type DacReconciliationSummary = {
  totalCollectionsCount: number;
  totalCollectionsRows: number;
  totalCollectionsAmount: number;
  missingInDacCount: number;
  missingInDacAmount: number;
  shortfallCount: number;
  shortfallGapAmount: number;
  shortfallCollectionAmount: number;
  shortfallMasterDacAmount: number;
  unallocatedCount: number;
  unallocatedAmount: number;
  matchedCount: number;
  exceedsCount: number;
  verifiedAccountsCount: number;
  verifiedRowsCount: number;
  alreadyPaidRowCount: number;
  alreadyPaidAccountCount: number;
  alreadyPaidAmount: number;
};

export const FAST_REMARK_TAGS = [
  "[Verified - Add to DAC]",
  "[Pending Paid File]",
  "[Duplicate Paid]",
  "[Wrong Loan ID Corrected]",
  "[Settlement Approved]",
] as const;

export function formatInrAmount(amount: number): string {
  return roundMoney(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function composeVerifyAddToDacRemark(amount: number, verifiedDateIso: string): string {
  return `Verified by Aman: Added ₹${formatInrAmount(amount)} to DAC on ${verifiedDateIso}`;
}

export function composeProvisionalDacRemark(amount: number, paymentDate: string): string {
  return `Provisional DAC ₹${formatInrAmount(amount)} verified by Aman (${paymentDate || "Date N/A"})`;
}

export function mergeAmansRemark(existing: string, addition: string): string {
  const cleanAdd = addition.trim();
  const cleanExisting = existing.trim();
  if (!cleanAdd) return cleanExisting;
  if (!cleanExisting) return cleanAdd;
  const parts = cleanExisting
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const existsAlready = parts.some((part) => part.toLowerCase() === cleanAdd.toLowerCase());
  if (existsAlready) return parts.join(" | ");
  return [...parts, cleanAdd].join(" | ");
}

export function isRemarkVerifiedByAman(remarks: string | undefined): boolean {
  const text = String(remarks ?? "").toLowerCase();
  if (!text.trim()) return false;
  return (
    text.includes("verified by aman") ||
    text.includes("[verified - add to dac]") ||
    text.includes("provisional dac") ||
    text.includes("[settlement approved]")
  );
}

const EPS = 0.01;

function uniqueNonEmpty(values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const val of values) {
    const trimmed = String(val ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function resolveMasterCategory(master: MasterRow | undefined): {
  primary: string;
  categories: string[];
  allocationType: string;
  bucket: string;
} {
  if (!master) {
    return { primary: "Unmapped", categories: [], allocationType: "", bucket: "" };
  }
  const cat = String(master.category ?? "").trim();
  const allocType = String(master.allocationType ?? "").trim();
  const bucket = String(master.bucket ?? "").trim();
  const categories = uniqueNonEmpty([cat, allocType, bucket]);
  const primary = cat || allocType || bucket || "Uncategorized";
  return { primary, categories, allocationType: allocType, bucket };
}

export function buildDacReconciliation(params: {
  collections: CollectionReconciliationEntry[];
  masterRows: MasterRow[];
  includeAlreadyPaid?: boolean;
  excludedLoanIds?: Set<string>;
}): {
  items: DacReconciliationItem[];
  summary: DacReconciliationSummary;
  collectionCategoryOptions: string[];
  masterCategoryOptions: string[];
  executiveOptions: string[];
} {
  const includeAlreadyPaid = params.includeAlreadyPaid ?? false;
  const excludedSet = params.excludedLoanIds ?? new Set<string>();

  const masterById = new Map<string, MasterRow[]>();
  for (const row of params.masterRows) {
    const id = normalisePaidId(row.agreementId);
    if (!id) continue;
    const list = masterById.get(id) ?? [];
    list.push(row);
    masterById.set(id, list);
  }

  const grouped = new Map<string, CollectionReconciliationEntry[]>();
  let alreadyPaidRowCount = 0;
  let alreadyPaidAmount = 0;

  for (const entry of params.collections) {
    if (
      String(entry.status ?? "")
        .trim()
        .toUpperCase() === "DELETED"
    )
      continue;
    const amount = Number(entry.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const id = normalisePaidId(entry.loanId);
    if (!id) continue;

    if (entry.alreadyPaid) {
      alreadyPaidRowCount += 1;
      alreadyPaidAmount = roundMoney(alreadyPaidAmount + amount);
    }

    const list = grouped.get(id) ?? [];
    list.push(entry);
    grouped.set(id, list);
  }

  const items: DacReconciliationItem[] = [];
  let alreadyPaidAccountCount = 0;

  for (const [agreementId, entries] of grouped.entries()) {
    const sortedRows = [...entries].sort(
      (a, b) => (a.date || "").localeCompare(b.date || "") || a.row - b.row,
    );
    const alreadyPaidRows = sortedRows.filter((e) => e.alreadyPaid);
    const nonAlreadyPaidRows = sortedRows.filter((e) => !e.alreadyPaid);

    const rowAlreadyPaidAmount = roundMoney(
      alreadyPaidRows.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    );
    if (alreadyPaidRows.length > 0) {
      alreadyPaidAccountCount += 1;
    }

    const activeRows = includeAlreadyPaid ? sortedRows : nonAlreadyPaidRows;
    const allExcludedAsAlreadyPaid = nonAlreadyPaidRows.length === 0 && alreadyPaidRows.length > 0;
    const scopeRows = activeRows.length > 0 ? activeRows : sortedRows;

    const collectionAmount = roundMoney(
      activeRows.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    );

    const masterMatches = masterById.get(agreementId) ?? [];
    const hasDuplicateMaster = masterMatches.length > 1;
    const master = masterMatches[0];

    const colCategories = uniqueNonEmpty(
      scopeRows.map((e) => e.allocationCategory || e.bucket || e.allocationType),
    );
    const colCatRaw = uniqueNonEmpty(scopeRows.map((e) => e.allocationCategory));
    const colBuckets = uniqueNonEmpty(scopeRows.map((e) => e.bucket));
    const collectionCategory = colCatRaw.join(", ") || colBuckets.join(", ") || "Uncategorized";

    const masterCatInfo = resolveMasterCategory(master);

    const colSet = new Set(colCategories.map((c) => c.toLowerCase()));
    const masterSet = new Set(masterCatInfo.categories.map((c) => c.toLowerCase()));
    const categoryMismatch =
      Boolean(master) &&
      colCategories.length > 0 &&
      masterCatInfo.categories.length > 0 &&
      ![...colSet].some((c) => masterSet.has(c));

    const executives = uniqueNonEmpty(scopeRows.map((e) => e.executive));
    const dates = scopeRows
      .map((e) => e.date)
      .filter(Boolean)
      .sort();
    const allocDates = uniqueNonEmpty(scopeRows.map((e) => e.allocationDate));
    const linkedNames = uniqueNonEmpty(scopeRows.map((e) => e.linkedName));

    const remarksList = uniqueNonEmpty(
      sortedRows.flatMap((e) => String(e.amansRemarks ?? "").split("|")).map((s) => s.trim()),
    );
    const combinedAmansRemarks = remarksList.join(" | ");
    const isVerifiedByAman = sortedRows.some((e) => isRemarkVerifiedByAman(e.amansRemarks));

    const masterDac = master ? roundMoney(master.existingDac) : 0;
    const difference = roundMoney(collectionAmount - masterDac);
    const gapAmount = roundMoney(Math.max(0, difference));

    let varianceStatus: VarianceStatus;
    if (!includeAlreadyPaid && allExcludedAsAlreadyPaid) {
      varianceStatus = "ALREADY_PAID_EXCLUDED";
    } else if (!master) {
      varianceStatus = "UNALLOCATED_COLLECTION";
    } else if (collectionAmount > EPS && masterDac <= EPS) {
      varianceStatus = "MISSING_IN_DAC";
    } else if (difference > EPS) {
      varianceStatus = "DAC_SHORTFALL";
    } else if (difference < -EPS) {
      varianceStatus = "DAC_EXCEEDS_COLLECTION";
    } else {
      varianceStatus = "DAC_MATCHED";
    }

    const isMasterProtected = master
      ? master.isCorrected || master.dacSource === "MANUAL" || master.dacSource === "CORRECTED"
      : false;

    items.push({
      agreementId,
      displayLoanId: sortedRows[0]?.loanId || agreementId,
      customerName: master?.customer?.trim() || linkedNames[0] || "—",
      executives,
      allRows: sortedRows,
      activeRows,
      alreadyPaidCount: alreadyPaidRows.length,
      alreadyPaidAmount: rowAlreadyPaidAmount,
      hasAlreadyPaid: alreadyPaidRows.length > 0,
      collectionCategory,
      collectionCategories: colCategories,
      collectionBucket: colBuckets.join(", "),
      masterCategory: master ? masterCatInfo.primary : "Not in Master",
      masterCategories: masterCatInfo.categories,
      masterAllocationType: masterCatInfo.allocationType,
      masterBucket: masterCatInfo.bucket,
      categoryMismatch,
      earliestPaymentDate: dates[0] ?? "",
      latestPaymentDate: dates[dates.length - 1] ?? "",
      allocationDate: allocDates[allocDates.length - 1] ?? "",
      collectionAmount,
      masterRow: master?.row ?? null,
      masterDac,
      provisionalDac: master?.provisionalDac ?? null,
      existingTotal: master?.existingTotal ?? 0,
      existingNewTotal: master?.existingNewTotal ?? 0,
      existingRemaining: master?.existingRemaining ?? null,
      existingPaymentDate: master?.existingPaymentDate ?? "",
      dacSource: master?.dacSource ?? "",
      isCorrected: master?.isCorrected ?? false,
      isMasterProtected,
      hasDuplicateMaster,
      hasCollectionConflict: sortedRows.some((e) => e.isConflict),
      isExcludedLoan: excludedSet.has(agreementId),
      difference: varianceStatus === "ALREADY_PAID_EXCLUDED" ? 0 : difference,
      gapAmount: varianceStatus === "ALREADY_PAID_EXCLUDED" ? 0 : gapAmount,
      varianceStatus,
      combinedAmansRemarks,
      isVerifiedByAman,
      targetPushDac: roundMoney(Math.max(collectionAmount, masterDac)),
    });
  }

  const STATUS_PRIORITY: Record<VarianceStatus, number> = {
    MISSING_IN_DAC: 0,
    DAC_SHORTFALL: 1,
    UNALLOCATED_COLLECTION: 2,
    DAC_MATCHED: 3,
    DAC_EXCEEDS_COLLECTION: 4,
    ALREADY_PAID_EXCLUDED: 5,
  };

  items.sort(
    (a, b) =>
      STATUS_PRIORITY[a.varianceStatus] - STATUS_PRIORITY[b.varianceStatus] ||
      b.gapAmount - a.gapAmount ||
      b.collectionAmount - a.collectionAmount ||
      a.agreementId.localeCompare(b.agreementId),
  );

  let totalCollectionsCount = 0;
  let totalCollectionsRows = 0;
  let totalCollectionsAmount = 0;
  let missingInDacCount = 0;
  let missingInDacAmount = 0;
  let shortfallCount = 0;
  let shortfallGapAmount = 0;
  let shortfallCollectionAmount = 0;
  let shortfallMasterDacAmount = 0;
  let unallocatedCount = 0;
  let unallocatedAmount = 0;
  let matchedCount = 0;
  let exceedsCount = 0;
  let verifiedAccountsCount = 0;
  let verifiedRowsCount = 0;

  for (const item of items) {
    if (item.isVerifiedByAman) {
      verifiedAccountsCount += 1;
    }
    verifiedRowsCount += item.allRows.filter((r) => isRemarkVerifiedByAman(r.amansRemarks)).length;

    if (item.varianceStatus === "ALREADY_PAID_EXCLUDED") {
      continue;
    }

    totalCollectionsCount += 1;
    totalCollectionsRows += item.activeRows.length;
    totalCollectionsAmount = roundMoney(totalCollectionsAmount + item.collectionAmount);

    switch (item.varianceStatus) {
      case "MISSING_IN_DAC":
        missingInDacCount += 1;
        missingInDacAmount = roundMoney(missingInDacAmount + item.gapAmount);
        break;
      case "DAC_SHORTFALL":
        shortfallCount += 1;
        shortfallGapAmount = roundMoney(shortfallGapAmount + item.gapAmount);
        shortfallCollectionAmount = roundMoney(shortfallCollectionAmount + item.collectionAmount);
        shortfallMasterDacAmount = roundMoney(shortfallMasterDacAmount + item.masterDac);
        break;
      case "UNALLOCATED_COLLECTION":
        unallocatedCount += 1;
        unallocatedAmount = roundMoney(unallocatedAmount + item.collectionAmount);
        break;
      case "DAC_MATCHED":
        matchedCount += 1;
        break;
      case "DAC_EXCEEDS_COLLECTION":
        exceedsCount += 1;
        break;
    }
  }

  const collectionCategoryOptions = uniqueNonEmpty(
    items.flatMap((i) => i.collectionCategories),
  ).sort((a, b) => a.localeCompare(b));
  const masterCategoryOptions = uniqueNonEmpty(items.flatMap((i) => i.masterCategories)).sort(
    (a, b) => a.localeCompare(b),
  );
  const executiveOptions = uniqueNonEmpty(items.flatMap((i) => i.executives)).sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    items,
    summary: {
      totalCollectionsCount,
      totalCollectionsRows,
      totalCollectionsAmount,
      missingInDacCount,
      missingInDacAmount,
      shortfallCount,
      shortfallGapAmount,
      shortfallCollectionAmount,
      shortfallMasterDacAmount,
      unallocatedCount,
      unallocatedAmount,
      matchedCount,
      exceedsCount,
      verifiedAccountsCount,
      verifiedRowsCount,
      alreadyPaidRowCount,
      alreadyPaidAccountCount,
      alreadyPaidAmount,
    },
    collectionCategoryOptions,
    masterCategoryOptions,
    executiveOptions,
  };
}

export function dacReconciliationCsv(items: DacReconciliationItem[]): string {
  return toCsv(
    [
      "Loan ID",
      "Customer Name",
      "Executive(s)",
      "Collection Category",
      "Collection Bucket",
      "Master Category",
      "Master Allocation Type",
      "Master Bucket",
      "Category Match",
      "Payment Date(s)",
      "Allocation Date",
      "Already Paid Status",
      "Collection Amount",
      "Master DAC",
      "Provisional DAC",
      "Difference / Gap",
      "Variance Status",
      "DAC Source",
      "Master Row",
      "Collection Rows",
      "Verified by Aman",
      "Aman's Remarks",
    ],
    items.map((item) => [
      item.agreementId,
      item.customerName,
      item.executives.join(", "),
      item.collectionCategory,
      item.collectionBucket,
      item.masterCategory,
      item.masterAllocationType,
      item.masterBucket,
      item.categoryMismatch ? "Mismatch" : "Aligned",
      item.earliestPaymentDate === item.latestPaymentDate
        ? item.latestPaymentDate
        : `${item.earliestPaymentDate} to ${item.latestPaymentDate}`,
      item.allocationDate,
      item.hasAlreadyPaid
        ? item.varianceStatus === "ALREADY_PAID_EXCLUDED"
          ? `Already Paid Excluded (₹${formatInrAmount(item.alreadyPaidAmount)})`
          : `Partial Already Paid (${item.alreadyPaidCount} rows, ₹${formatInrAmount(item.alreadyPaidAmount)})`
        : "No",
      item.collectionAmount,
      item.masterDac,
      item.provisionalDac ?? "",
      item.difference,
      item.varianceStatus,
      item.dacSource || "",
      item.masterRow ?? "",
      item.allRows.map((r) => r.row).join(", "),
      item.isVerifiedByAman ? "Verified" : "Unverified",
      item.combinedAmansRemarks,
    ]),
  );
}
