import * as XLSX from "xlsx";

type Mapping = { agreementId: number; sfdc: number; online: number; ecs: number; special: number };
type WorkerMessage =
  | { type: "inspect"; buffer: ArrayBuffer; fileName: string }
  | { type: "process"; sheetName: string; mapping: Mapping };
let workbook: XLSX.WorkBook | null = null;
let fileName = "";

const aliases = {
  agreementId: ["AGREEMENTID", "AGREEMENT ID", "AGREEMENT_ID", "LOAN NO", "LOAN NUMBER", "ACCOUNT NO"],
  sfdc: ["SFDC", "SFDC AMOUNT", "SFDC_AMT", "SFDC AMT"],
  online: ["ONLINE", "ONLINE AMOUNT", "ONLINE_AMT", "PAYMENT_GATEWAY"],
  ecs: ["ECS", "ECS AMOUNT", "NACH", "ACH"],
  special: ["SPECIAL", "SPECIAL AMOUNT", "SPECIAL_AMT"],
};
function headerKey(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[\s_-]+/g, " ").trim();
}
function detect(headers: unknown[], keys: string[]) {
  const accepted = new Set(keys.map(headerKey));
  return headers.findIndex(value => accepted.has(headerKey(value)));
}
function normaliseId(value: unknown) {
  return String(value ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/^['"\x60‘’]+|['"\x60‘’]+$/g, "").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "").toUpperCase();
}
function amount(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const raw = String(value).trim().replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}
function progress(percent: number, label: string) {
  self.postMessage({ type: "progress", percent, label });
}
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  try {
    const message = event.data;
    if (message.type === "inspect") {
      fileName = message.fileName;
      progress(0, "Reading File");
      workbook = XLSX.read(message.buffer, { type: "array", cellDates: false, dense: true });
      progress(40, "Parsing Sheets");
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook!.Sheets[name]!;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false, range: 0 });
        const headers = (rows[0] ?? []).map(v => String(v ?? ""));
        const mapping = {
          agreementId: detect(headers, aliases.agreementId),
          sfdc: detect(headers, aliases.sfdc),
          online: detect(headers, aliases.online),
          ecs: detect(headers, aliases.ecs),
          special: detect(headers, aliases.special),
        };
        return { name, rowCount: Math.max(0, rows.length - 1), headers, mapping };
      });
      const firstWithData = sheets.find(s => s.rowCount > 0) ?? sheets[0];
      progress(70, "Extracting Columns");
      self.postMessage({ type: "inspected", sheets, defaultSheet: firstWithData?.name ?? "" });
      return;
    }
    if (!workbook) throw new Error("Select a file before processing.");
    const sheet = workbook.Sheets[message.sheetName];
    if (!sheet) throw new Error("Selected worksheet was not found.");
    progress(40, "Parsing Sheets");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false });
    const grouped = new Map<string, { agreementId: string; sfdc: number; online: number; ecs: number; special: number; sourceRows: number; invalid: boolean }>();
    let invalidRows = 0;
    progress(70, "Extracting Columns");
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const agreementId = normaliseId(row[message.mapping.agreementId]);
      if (!agreementId) { invalidRows++; continue; }
      const sfdc = amount(message.mapping.sfdc >= 0 ? row[message.mapping.sfdc] : 0);
      const online = amount(message.mapping.online >= 0 ? row[message.mapping.online] : 0);
      const ecs = amount(message.mapping.ecs >= 0 ? row[message.mapping.ecs] : 0);
      const special = amount(message.mapping.special >= 0 ? row[message.mapping.special] : 0);
      if (![sfdc, online, ecs, special].every(Number.isFinite)) { invalidRows++; continue; }
      const current = grouped.get(agreementId) ?? { agreementId, sfdc: 0, online: 0, ecs: 0, special: 0, sourceRows: 0, invalid: false };
      current.sfdc += sfdc; current.online += online; current.ecs += ecs; current.special += special; current.sourceRows++;
      grouped.set(agreementId, current);
    }
    const records = [...grouped.values()].map(row => ({ ...row, dac: row.sfdc + row.online }));
    const resultFileName = fileName;
    workbook.Sheets[message.sheetName] = undefined as never;
    workbook = null;
    progress(100, "Ready");
    self.postMessage({ type: "processed", fileName: resultFileName, records, invalidRows, totalRows: Math.max(0, rows.length - 1) });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Could not process this file." });
  }
};
