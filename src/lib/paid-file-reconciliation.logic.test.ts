import { describe, expect, test } from "bun:test";
import { amount, computePaidFileDac, headerIndex, norm, normalizePaidFileSource, paidFileHistoryGeneration, isPaidFileRowApplyEligible } from "./paid-file-reconciliation.logic";
import * as XLSX from "xlsx";

describe("Paid File normalization", () => {
  test("parses Indian currency formatting and negative parentheses", () => {
    expect(amount("₹1,25,500.50")).toBe(125500.5);
    expect(amount("(1,250.25)")).toBe(-1250.25);
    expect(amount("")).toBeNull();
    expect(amount("not-a-number")).toBeNull();
  });
  test("normalizes Agreement IDs and locates aliased headers", () => {
    expect(norm("  'ab-123 / 45 ")).toBe("AB12345");
    expect(headerIndex(["Agreement ID", "Payment Date"], ["Loan Number", "Agreement ID"])).toBe(0);
  });
  test("calculates DAC as SFDC plus Online without mutating the source", () => {
    const source = [["Agreement ID", "SFDC", "Online", "DAC"], ["A1", "1,200", "300.5", "9999"], ["A2", "", "50", "77"]];
    const before = structuredClone(source);
    const result = computePaidFileDac(source);
    expect(result.dacIndex).toBe(3);
    expect(result.values[0]).toEqual(["Agreement ID", "SFDC", "Online", "DAC"]);
    expect(result.values[1]?.[3]).toBe("1500.5");
    expect(result.values[2]?.[3]).toBe("50");
    expect(source).toEqual(before);
  });
  test("marks malformed SFDC or Online as invalid for manual review", () => {
    const result = computePaidFileDac([["Agreement ID", "SFDC", "Online"], ["A1", "bad", "10"]]);
    expect(result.values[1]?.[3]).toBe("INVALID");
  });
  test("requires both source columns and rejects an empty file", () => {
    expect(() => computePaidFileDac([])).toThrow("Paid File is empty");
    expect(() => computePaidFileDac([["Agreement ID", "SFDC"]])).toThrow("SFDC and Online");
  });
});


describe("Paid File review fingerprint generations", () => {
  test("does not invalidate an approval because its own reversal decision was recorded", () => {
    expect(paidFileHistoryGeneration(["PRESENT", "REVERSAL_AUTHORIZED"])).toBe(1);
    expect(paidFileHistoryGeneration(["PRESENT", "REVERSAL_APPROVED"])).toBe(1);
    expect(paidFileHistoryGeneration(["PRESENT", "MISSING", "REVERSAL_AUTHORIZED"])).toBe(1);
    expect(paidFileHistoryGeneration(["PRESENT", "MISSING", "REVERSAL_APPROVED"])).toBe(1);
  });
  test("increments only when payment data reappears or changes after a missing state", () => {
    expect(paidFileHistoryGeneration(["PRESENT", "MISSING"])).toBe(1);
    expect(paidFileHistoryGeneration(["PRESENT", "MISSING", "REAPPEARED"])).toBe(1);
    expect(paidFileHistoryGeneration(["PRESENT", "AMOUNT_CHANGED"])).toBe(1);
  });
});

describe("Paid File Excel format regression", () => {
  const rows = [["Agreement ID", "SFDC", "Online"], ["LN-001", "1200.50", "300"]];
  test("normalizes XLSX, XLS and XLSB while preserving cell values", () => {
    for (const bookType of ["xlsx", "xls", "xlsb"] as const) {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Payments");
      const bytes = XLSX.write(workbook, { type: "array", bookType });
      expect(normalizePaidFileSource(new Uint8Array(bytes), bookType)).toContain("LN-001,1200.50,300");
    }
  });
  test("normalizes CSV source bytes", () => {
    const csv = "Agreement ID,SFDC,Online\nLN-001,1200.50,300";
    expect(normalizePaidFileSource(new TextEncoder().encode(csv), "csv")).toContain("LN-001,1200.50,300");
  });
  test("rejects unsupported and empty inputs", () => {
    expect(() => normalizePaidFileSource(new Uint8Array([1, 2]), "pdf")).toThrow("Unsupported");
    expect(() => normalizePaidFileSource(new Uint8Array([]), "xlsx")).toThrow();
  });
});

describe("Automatic Apply and Manual Review gate", () => {
  test("permits only Ready or explicitly Admin-resolved rows", () => {
    expect(isPaidFileRowApplyEligible("Ready")).toBe(true);
    expect(isPaidFileRowApplyEligible("Resolved – Admin New Total preserved")).toBe(true);
    expect(isPaidFileRowApplyEligible("Resolved – Admin authorized reversal")).toBe(true);
    expect(isPaidFileRowApplyEligible("Resolved – Admin approved correction")).toBe(true);
    for (const status of [
      "Manual Review – Overpaid",
      "Manual Review – Missing from Paid File",
      "Manual Review – DAC, ECS, Special and Total are zero",
      "Duplicate – manual review",
      "Invalid – non-numeric amount",
      "Pending – blank payment amount",
      "Stale snapshot",
      "Already applied – protected from duplicate processing",
    ]) expect(isPaidFileRowApplyEligible(status)).toBe(false);
  });
});
