import { describe, expect, test } from "bun:test";
import { toCsv } from "./export";

describe("CSV formula injection protection", () => {
  test("prefixes all spreadsheet formula initiators in untrusted string cells", () => {
    const csv = toCsv(["value"], [["=1+1"], ["+cmd"], ["-2"], ["@SUM(A1:A2)"], ["\tvalue"], ["\rvalue"], ["safe"], [123]]);
    expect(csv.includes("'=1+1")).toBe(true);
    expect(csv.includes("'+cmd")).toBe(true);
    expect(csv.includes("'-2")).toBe(true);
    expect(csv.includes("'@SUM(A1:A2)")).toBe(true);
    expect(csv.includes("'\tvalue")).toBe(true);
    expect(csv.includes("'\rvalue")).toBe(true);
    expect(csv.includes("\r\nsafe")).toBe(true);
    expect(csv.includes("\r\n123")).toBe(true);
  });
});
