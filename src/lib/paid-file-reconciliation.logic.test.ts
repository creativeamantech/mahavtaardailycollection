// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { amount, computePaidFileDac, headerIndex, norm } from "./paid-file-reconciliation.logic";

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
