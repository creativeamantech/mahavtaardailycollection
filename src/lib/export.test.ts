import { describe, expect, test } from "bun:test";
import { toCsv } from "./export";

describe("CSV formula injection protection", () => {
  test("prefixes all spreadsheet formula initiators in untrusted string cells", () => {
    const csv = toCsv(["value"], [["=1+1"], ["+cmd"], ["-2"], ["@SUM(A1:A2)"], ["\tvalue"], ["\rvalue"], ["safe"], [123]]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-2");
    expect(csv).toContain("'@SUM(A1:A2)");
    expect(csv).toContain("'\tvalue");
    expect(csv).toContain("'\rvalue");
    expect(csv).toContain("\r\nsafe");
    expect(csv).toContain("\r\n123");
  });
});
