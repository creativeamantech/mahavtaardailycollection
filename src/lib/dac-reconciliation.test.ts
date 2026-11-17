import { describe, expect, test } from "bun:test";
import {
  buildDacReconciliation,
  composeProvisionalDacRemark,
  composeVerifyAddToDacRemark,
  dacReconciliationCsv,
  mergeAmansRemark,
  normalizeReconciliationDate,
  type CollectionReconciliationEntry,
} from "./dac-reconciliation";
import type { MasterRow } from "./paid-file-reconciliation";

function makeCollection(
  overrides: Partial<CollectionReconciliationEntry> = {},
): CollectionReconciliationEntry {
  return {
    row: 2,
    executive: "Aarti",
    loanId: "LN-101",
    amount: 5000,
    date: "2026-11-10",
    status: "Confirmed",
    bucket: "Bucket 1",
    allocationCategory: "Auto",
    allocationDate: "2026-11-01",
    amansRemarks: "",
    alreadyPaid: false,
    isValidated: true,
    isConflict: false,
    ...overrides,
  };
}

function makeMaster(overrides: Partial<MasterRow> = {}): MasterRow {
  return {
    row: 10,
    agreementId: "LN-101",
    existingTotal: 0,
    existingDac: 0,
    existingNewTotal: 0,
    existingRemaining: null,
    existingEcs: 0,
    existingSpecial: 0,
    existingPaymentDate: "",
    bucket: "Bucket 1",
    city: "Jaipur",
    customer: "Ramesh Kumar",
    executive: "Aarti",
    allocationType: "Fresh",
    category: "Auto",
    dacSource: "",
    isCorrected: false,
    provisionalDac: null,
    isConflict: false,
    paidConflictDac: null,
    ...overrides,
  };
}

describe("Collections vs Master DAC reconciliation engine", () => {
  test("classifies MISSING_IN_DAC, DAC_SHORTFALL, DAC_MATCHED, DAC_EXCEEDS_COLLECTION, and UNALLOCATED_COLLECTION", () => {
    const collections = [
      makeCollection({ row: 2, loanId: " 'ln-101 ", amount: 3000 }),
      makeCollection({ row: 3, loanId: "LN-101", amount: 2000 }), // sums to 5000
      makeCollection({ row: 4, loanId: "LN-102", amount: 8000, allocationCategory: "Personal" }),
      makeCollection({ row: 5, loanId: "LN-103", amount: 4500 }),
      makeCollection({ row: 6, loanId: "LN-104", amount: 3000 }),
      makeCollection({ row: 7, loanId: "LN-999", amount: 2500 }), // unallocated
      makeCollection({ row: 8, loanId: "LN-DEL", amount: 9000, status: "Deleted" }),
    ];
    const masterRows = [
      makeMaster({ row: 10, agreementId: "LN-101", existingDac: 0, category: "Auto" }),
      makeMaster({ row: 11, agreementId: "LN-102", existingDac: 5000, category: "Two-Wheeler" }),
      makeMaster({ row: 12, agreementId: "LN-103", existingDac: 4500, dacSource: "PAID_FILE" }),
      makeMaster({ row: 13, agreementId: "LN-104", existingDac: 6000, dacSource: "PAID_FILE" }),
    ];

    const result = buildDacReconciliation({ collections, masterRows });
    const byId = new Map(result.items.map((i) => [i.agreementId, i]));

    expect(byId.get("LN-101")?.varianceStatus).toBe("MISSING_IN_DAC");
    expect(byId.get("LN-101")?.collectionAmount).toBe(5000);
    expect(byId.get("LN-101")?.gapAmount).toBe(5000);

    expect(byId.get("LN-102")?.varianceStatus).toBe("DAC_SHORTFALL");
    expect(byId.get("LN-102")?.gapAmount).toBe(3000);
    expect(byId.get("LN-102")?.categoryMismatch).toBe(true);

    expect(byId.get("LN-103")?.varianceStatus).toBe("DAC_MATCHED");
    expect(byId.get("LN-103")?.gapAmount).toBe(0);

    expect(byId.get("LN-104")?.varianceStatus).toBe("DAC_EXCEEDS_COLLECTION");
    expect(byId.get("LN-104")?.difference).toBe(-3000);
    expect(byId.get("LN-104")?.gapAmount).toBe(0);

    expect(byId.get("LN-999")?.varianceStatus).toBe("UNALLOCATED_COLLECTION");
    expect(byId.get("LN-DEL")).toBe(undefined);

    expect(result.summary.missingInDacCount).toBe(1);
    expect(result.summary.missingInDacAmount).toBe(5000);
    expect(result.summary.shortfallCount).toBe(1);
    expect(result.summary.shortfallGapAmount).toBe(3000);
    expect(result.summary.unallocatedCount).toBe(1);
    expect(result.summary.totalCollectionsAmount).toBe(23000);
  });

  test("isolates Already Paid entries unless includeAlreadyPaid is enabled", () => {
    const collections = [
      makeCollection({
        row: 2,
        loanId: "LN-AP",
        amount: 4000,
        date: "2026-10-28",
        allocationDate: "2026-11-01",
        alreadyPaid: true,
      }),
      makeCollection({
        row: 3,
        loanId: "LN-ACT",
        amount: 3500,
        date: "2026-11-05",
        allocationDate: "2026-11-01",
        alreadyPaid: false,
      }),
    ];
    const masterRows = [
      makeMaster({ row: 10, agreementId: "LN-AP", existingDac: 0 }),
      makeMaster({ row: 11, agreementId: "LN-ACT", existingDac: 0 }),
    ];

    const isolated = buildDacReconciliation({
      collections,
      masterRows,
      includeAlreadyPaid: false,
    });
    expect(isolated.items.find((i) => i.agreementId === "LN-AP")?.varianceStatus).toBe(
      "ALREADY_PAID_EXCLUDED",
    );
    expect(isolated.summary.alreadyPaidRowCount).toBe(1);
    expect(isolated.summary.alreadyPaidAmount).toBe(4000);
    expect(isolated.summary.missingInDacCount).toBe(1);
    expect(isolated.summary.missingInDacAmount).toBe(3500);
    expect(isolated.summary.totalCollectionsAmount).toBe(3500);

    const included = buildDacReconciliation({
      collections,
      masterRows,
      includeAlreadyPaid: true,
    });
    expect(included.items.find((i) => i.agreementId === "LN-AP")?.varianceStatus).toBe(
      "MISSING_IN_DAC",
    );
    expect(included.summary.missingInDacCount).toBe(2);
    expect(included.summary.missingInDacAmount).toBe(7500);
  });

  test("preserves existing remarks when composing Aman's Remarks and builds safe CSV", () => {
    const r1 = composeVerifyAddToDacRemark(5000, "2026-11-15");
    expect(r1).toBe("Verified by Aman: Added ₹5,000 to DAC on 2026-11-15");

    const r2 = composeProvisionalDacRemark(4200, "2026-11-14");
    expect(r2).toBe("Provisional DAC ₹4,200 verified by Aman (2026-11-14)");

    const merged = mergeAmansRemark("Bank Slip Matched", r1);
    expect(merged).toBe("Bank Slip Matched | Verified by Aman: Added ₹5,000 to DAC on 2026-11-15");
    expect(mergeAmansRemark(merged, r1)).toBe(merged);

    const res = buildDacReconciliation({
      collections: [makeCollection({ amansRemarks: merged })],
      masterRows: [makeMaster({ existingPaymentDate: "2026-11-10" })],
    });
    expect(res.summary.verifiedAccountsCount).toBe(1);
    const csv = dacReconciliationCsv(res.items);
    expect(csv.includes("Collection Category")).toBe(true);
    expect(csv.includes("Master Category")).toBe(true);
    expect(csv.includes("Master Payment Date")).toBe(true);
    expect(csv.includes("Verified by Aman: Added ₹5,000 to DAC on 2026-11-15")).toBe(true);
  });

  test("normalizes payment dates and detects Collection vs Master payment date mismatch", () => {
    expect(normalizeReconciliationDate("10/11/2026")).toBe("2026-11-10");
    expect(normalizeReconciliationDate("10-11-2026")).toBe("2026-11-10");
    expect(normalizeReconciliationDate("2026-11-10T14:30:00Z")).toBe("2026-11-10");

    const collections = [
      makeCollection({ row: 2, loanId: "LN-SAME", date: "2026-11-10", amount: 2000 }),
      makeCollection({ row: 3, loanId: "LN-DIFF", date: "2026-11-12", amount: 2500 }),
      makeCollection({ row: 4, loanId: "LN-UNSET", date: "2026-11-13", amount: 1500 }),
    ];
    const masterRows = [
      makeMaster({ row: 10, agreementId: "LN-SAME", existingPaymentDate: "10/11/2026" }),
      makeMaster({ row: 11, agreementId: "LN-DIFF", existingPaymentDate: "2026-11-09" }),
      makeMaster({ row: 12, agreementId: "LN-UNSET", existingPaymentDate: "" }),
    ];

    const res = buildDacReconciliation({ collections, masterRows });
    const byId = new Map(res.items.map((i) => [i.agreementId, i]));

    expect(byId.get("LN-SAME")?.masterPaymentDate).toBe("2026-11-10");
    expect(byId.get("LN-SAME")?.paymentDateMismatch).toBe(false);

    expect(byId.get("LN-DIFF")?.masterPaymentDate).toBe("2026-11-09");
    expect(byId.get("LN-DIFF")?.paymentDateMismatch).toBe(true);

    expect(byId.get("LN-UNSET")?.masterPaymentDate).toBe("");
    expect(byId.get("LN-UNSET")?.paymentDateMismatch).toBe(false);
  });

  test("hides ignored/excluded loans unless includeIgnored is true", () => {
    const collections = [
      makeCollection({ row: 2, loanId: "LN-IGN", amount: 2500 }),
      makeCollection({ row: 3, loanId: "LN-KEEP", amount: 3000 }),
    ];
    const excludedLoanIds = new Set([" 'ln-ign "]);

    const hidden = buildDacReconciliation({
      collections,
      masterRows: [],
      excludedLoanIds,
    });
    expect(hidden.items.length).toBe(1);
    expect(hidden.items[0]?.agreementId).toBe("LN-KEEP");
    expect(hidden.summary.ignoredAccountCount).toBe(1);
    expect(hidden.summary.ignoredAmount).toBe(2500);
    expect(hidden.summary.totalCollectionsAmount).toBe(3000);

    const shown = buildDacReconciliation({
      collections,
      masterRows: [],
      excludedLoanIds,
      includeIgnored: true,
    });
    expect(shown.items.length).toBe(2);
    expect(shown.items.find((i) => i.agreementId === "LN-IGN")?.isExcludedLoan).toBe(true);
  });
});
