import { describe, expect, test } from "bun:test";
import { summariseLoans, summarizeCollectionSheetPos, type CollectionRow } from "./loans";

function loan(amount: number, overrides: Partial<CollectionRow> = {}) {
  return {
    executive: "Test Executive",
    loanId: "LN-100",
    amount,
    date: "2026-11-11",
    bucket: "Bucket 5",
    emiAmount: 1000,
    pos: 2500,
    foreclosure: 4000,
    ...overrides,
  } satisfies CollectionRow;
}

describe("loan EMI calculation rules", () => {
  test("separates POS-based remaining loan life from capped monthly bucket target", () => {
    const [summary] = summariseLoans([loan(0)]);
    expect(summary?.remainingLoanEmis).toBe(2.5);
    expect(summary?.bucketTargetEmis).toBe(3);
    expect(summary?.totalEmiRequired).toBe(3000);
  });

  test("returns zero remaining loan EMIs when POS or EMI is missing or zero", () => {
    expect(summariseLoans([loan(0, { pos: 0 })])[0]?.remainingLoanEmis).toBe(0);
    expect(summariseLoans([loan(0, { emiAmount: null })])[0]?.remainingLoanEmis).toBe(0);
    expect(summariseLoans([loan(0, { emiAmount: 0 })])[0]?.bucketTargetEmis).toBe(0);
  });

  test("flags any first-EMI shortfall", () => {
    const [summary] = summariseLoans([loan(200)]);
    expect(summary?.currentShortEmi).toBe(1);
    expect(summary?.shortAmount).toBe(800);
  });

  test("flags the full first EMI when nothing has been paid", () => {
    const [summary] = summariseLoans([loan(0)]);
    expect(summary?.currentShortEmi).toBe(1);
    expect(summary?.shortAmount).toBe(1000);
  });

  test("flags second EMI only at 50 percent or more", () => {
    const below = summariseLoans([loan(1499)])[0];
    const atThreshold = summariseLoans([loan(1500)])[0];
    expect(below?.currentShortEmi).toBeNull();
    expect(atThreshold?.currentShortEmi).toBe(2);
    expect(atThreshold?.shortAmount).toBe(500);
  });

  test("uses the required status precedence: POS Paid before Foreclosure Paid", () => {
    const [summary] = summariseLoans([loan(2500, { foreclosure: 2000 })]);
    expect(summary?.posPaid).toBe(true);
    expect(summary?.foreclosurePaid).toBe(true);
    expect(summary?.status).toBe("POS Paid");
  });

  test("Settlement Paid remains above every other status", () => {
    const [summary] = summariseLoans([loan(4500, { settlement: true })]);
    expect(summary?.status).toBe("Settlement Paid");
    expect(summary?.mainPaid).toBe(true);
  });
});

describe("summarizeCollectionSheetPos", () => {
  test("deduplicates repeated payments for the same loan ID without double-counting POS", () => {
    const summary = summarizeCollectionSheetPos([
      loan(600, {
        loanId: "'ln-101",
        executive: "Aarti",
        bucket: "Bucket 1",
        pos: 12000,
        emiAmount: 1000,
      }),
      loan(400, {
        loanId: "LN-101",
        executive: "Aarti",
        bucket: "Bucket 1",
        pos: 12000,
        emiAmount: 1000,
      }),
      loan(300, {
        loanId: "LN-102",
        executive: "Bharti",
        bucket: "Bucket 2",
        pos: 8000,
        emiAmount: 1000,
      }),
      loan(2000, {
        loanId: "LN-103",
        executive: "Aarti",
        bucket: "Bucket 1",
        pos: 5000,
        emiAmount: 3000,
        settlement: true,
      }),
    ]);

    expect(summary.mainPaidCount).toBe(2);
    expect(summary.mainPaidPosCleared).toBe(17000);
    expect(summary.totalFilteredPos).toBe(25000);
    expect(summary.pendingPosAmount).toBe(8000);
    expect(summary.clearedPercent).toBe(68);
    expect(summary.byBucket).toEqual([
      {
        key: "Bucket 1",
        label: "Bucket 1",
        loanCount: 2,
        clearedPos: 17000,
        collection: 3000,
      },
    ]);
    expect(summary.byExecutive).toEqual([
      {
        key: "Aarti",
        label: "Aarti",
        loanCount: 2,
        clearedPos: 17000,
        collection: 3000,
      },
    ]);
  });

  test("tracks full POS coverage without Main Paid and missing POS cleared accounts cleanly", () => {
    const summary = summarizeCollectionSheetPos([
      loan(1500, {
        loanId: "LN-201",
        executive: "Pooja",
        bucket: "Bucket 1",
        pos: 1200,
        emiAmount: 2000,
      }),
      loan(1000, {
        loanId: "LN-202",
        executive: "Pooja",
        bucket: "Bucket 2",
        pos: null,
        emiAmount: 1000,
        settlement: true,
      }),
    ]);

    expect(summary.mainPaidCount).toBe(1);
    expect(summary.mainPaidPosCleared).toBe(0);
    expect(summary.missingPosClearedCount).toBe(1);
    expect(summary.posPaidNotMainCount).toBe(1);
    expect(summary.posPaidNotMainAmount).toBe(1200);
    expect(summary.anyPosClearedCount).toBe(2);
    expect(summary.anyPosClearedAmount).toBe(1200);
  });
});
