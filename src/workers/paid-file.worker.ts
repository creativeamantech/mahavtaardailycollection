import * as XLSX from "xlsx";

type Mapping = { agreementId: number; sfdc: number; online: number; paidAmount: number; ecs: number; special: number };
type WorkerMessage =
  | { type: "inspect"; file: File; fileName: string }
  | { type: "process"; sheetName: string; mapping: Mapping };
let workbook: XLSX.WorkBook | null = null;
let fileName = "";

const aliases = {
  agreementId: ["AGREEMENTID", "AGREEMENT ID", "AGREEMENT_ID", "LOAN NO", "LOAN NUMBER", "ACCOUNT NO", "LOAN_ID", "LOAN ID", "LAN", "AGMT_NO", "AGMT NO", "CONTRACT NO", "PROPOSAL NO", "CASE ID", "AGREEMENTNO"],
  sfdc: ["SFDC", "SFDC AMOUNT", "SFDC_AMT", "SFDC AMT"],
  online: ["ONLINE", "ONLINE AMOUNT", "ONLINE_AMT", "PAYMENT_GATEWAY"],
  paidAmount: ["PAID AMOUNT", "PAID_AMOUNT", "AMOUNT", "TOTAL PAID", "PAYMENT AMOUNT"],
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
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/^['"\x60‘’]+|['"\x60‘’]+$/g, "").replace(/\s+/g, "").toUpperCase();
}
function amount(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const raw = String(value).trim().replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}
function progress(percent: number, label: string) { self.postMessage({ type: "progress", percent, label }); }
function detectHeader(rows: unknown[][]) {
  const keywords = ["AGREEMENT", "LOAN", "LAN", "AGMT", "CONTRACT", "PROPOSAL", "CASE ID", "SFDC", "ONLINE", "AMOUNT", "PAID"];
  let best = { row: 0, score: -1 };
  for (let row = 0; row < Math.min(10, rows.length); row++) {
    const values = (rows[row] ?? []).map(headerKey);
    const score = keywords.reduce((count, keyword) => count + (values.some(value => value.includes(keyword)) ? 1 : 0), 0);
    if (score > best.score) best = { row, score };
  }
  return best.score > 0 ? best.row : 0;
}
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  try {
    const message = event.data;
    if (message.type === "inspect") {
      fileName = message.fileName;
      progress(0, "Reading File");
      const buffer = await message.file.arrayBuffer();
      workbook = XLSX.read(buffer, { type: "array", cellDates: false, dense: true });
      progress(40, "Parsing Sheets");
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook!.Sheets[name]!;
        const usedRange = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: true });
        const headerRow = detectHeader(rows);
        const headers = (rows[headerRow] ?? []).map(v => String(v ?? ""));
        const mapping = {
          agreementId: detect(headers, aliases.agreementId),
          sfdc: detect(headers, aliases.sfdc),
          online: detect(headers, aliases.online),
          paidAmount: detect(headers, aliases.paidAmount),
          ecs: detect(headers, aliases.ecs),
          special: detect(headers, aliases.special),
        };
        return { name, rowCount: Math.max(0, usedRange.e.r + 1 - headerRow - 1), headers, mapping, headerRow };
      });
      const firstWithAgreement = sheets.find(s => s.mapping.agreementId >= 0);
      const firstWithData = firstWithAgreement ?? sheets.find(s => s.rowCount > 0) ?? sheets[0];
      progress(70, "Sheets inspected — workbook retained locally");
      self.postMessage({ type: "inspected", sheets, defaultSheet: firstWithData?.name ?? "" });
      return;
    }
    if (!workbook) throw new Error("Select a file before processing.");
    const sheet = workbook.Sheets[message.sheetName];
    if (!sheet) throw new Error("Selected worksheet was not found.");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: true });
    const headerRow = detectHeader(rows);
    const mapping = message.mapping;
    if (mapping.agreementId < 0) throw new Error("Map an Agreement ID / Loan ID column.");
    if (mapping.sfdc < 0 && mapping.online < 0 && mapping.paidAmount < 0) throw new Error("Map SFDC, Online, or a unified Paid Amount / Amount column.");
    progress(40, "Processing selected worksheet");
    type Tx = { row: number; sfdc: number; online: number; paidAmount: number; ecs: number; special: number };
    const grouped = new Map<string, { agreementId: string; sfdc: number; online: number; ecs: number; special: number; sourceRows: number; transactions: Tx[] }>();
    let invalidRows = 0, totalRows = 0;
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (!row.some(value => String(value ?? "").trim() !== "")) continue;
      totalRows++;
      const agreementId = normaliseId(row[mapping.agreementId]);
      if (!agreementId) { invalidRows++; continue; }
      const sfdc = amount(mapping.sfdc >= 0 ? row[mapping.sfdc] : 0);
      const online = amount(mapping.online >= 0 ? row[mapping.online] : 0);
      const paidAmount = amount(mapping.paidAmount >= 0 ? row[mapping.paidAmount] : 0);
      const ecs = amount(mapping.ecs >= 0 ? row[mapping.ecs] : 0);
      const special = amount(mapping.special >= 0 ? row[mapping.special] : 0);
      if (![sfdc, online, paidAmount, ecs, special].every(Number.isFinite)) { invalidRows++; continue; }
      const current = grouped.get(agreementId) ?? { agreementId, sfdc: 0, online: 0, ecs: 0, special: 0, sourceRows: 0, transactions: [] };
      current.sfdc += sfdc; current.online += online; current.ecs += ecs; current.special += special;
      current.sourceRows++;
      current.transactions.push({ row: i + 1, sfdc, online, paidAmount, ecs, special });
      grouped.set(agreementId, current);
    }
    const records = [...grouped.values()].map(row => {
      const unified = row.transactions.reduce((sum, tx) => sum + tx.paidAmount, 0);
      const split = row.sfdc + row.online;
      const hasUnified = mapping.paidAmount >= 0;
      return { ...row, dac: hasUnified && mapping.sfdc < 0 && mapping.online < 0 ? unified : split };
    });
    progress(100, "Ready");
    self.postMessage({ type: "processed", fileName, records, invalidRows, totalRows });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Could not process this file." });
  }
};
