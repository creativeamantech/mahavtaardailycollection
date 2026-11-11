import { describe, expect, test } from "bun:test";
import { summariseLoans, type CollectionRow } from "./loans";

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
