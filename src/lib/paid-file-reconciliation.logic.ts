export function norm(v: unknown): string {
  return String(v ?? "").trim().toUpperCase().replace(/^['\`]+/,"").replace(/[^A-Z0-9]/g,"");
}
export function headerIndex(row: string[], aliases: string[]): number {
  const set = new Set(aliases.map(norm));
  return row.findIndex(v => set.has(norm(v)));
}
export function amount(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim().replace(/[₹,\s]/g,"").replace(/^\((.*)\)$/,"-$1");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function computePaidFileDac(paid: string[][]): { values: string[][]; dacIndex: number } {
  if (!paid.length) throw new Error("Paid File is empty.");
  const header = paid[0] ?? [];
  const sfdcIndex = headerIndex(header, ["SFDC"]), onlineIndex = headerIndex(header, ["Online"]);
  if (sfdcIndex < 0 || onlineIndex < 0) throw new Error("Paid File must contain both SFDC and Online columns so DAC can be calculated.");
  const existingDac = headerIndex(header, ["DAC"]);
  const dacIndex = existingDac >= 0 ? existingDac : header.length;
  const values = paid.map((row, index) => {
    const copy = [...(row ?? [])];
    if (index === 0) { copy[dacIndex] = "DAC"; return copy; }
    const rawSfdc = copy[sfdcIndex], rawOnline = copy[onlineIndex];
    const sfdc = rawSfdc === undefined || String(rawSfdc).trim() === "" ? 0 : amount(rawSfdc);
    const online = rawOnline === undefined || String(rawOnline).trim() === "" ? 0 : amount(rawOnline);
    copy[dacIndex] = sfdc === null || online === null ? "INVALID" : String(sfdc + online);
    return copy;
  });
  return { values, dacIndex };
}
