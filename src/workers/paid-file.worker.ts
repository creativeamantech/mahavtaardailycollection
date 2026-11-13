import * as XLSX from "xlsx";
import {
  normalisePaidId,
  parsePaidAmount,
  parsePaidDate,
  roundMoney,
  type ColumnMapping,
  type DuplicateStrategy,
  type PaidTransaction,
  type SheetInfo,
  type StagedPaidRow,
} from "../lib/paid-file-reconciliation";

type WorkerMessage =
  | { type: "inspect"; file: File; fileName: string }
  | {
      type: "process";
      sheetName: string;
      mapping: ColumnMapping;
      duplicateStrategy?: DuplicateStrategy;
    };

let workbook: XLSX.WorkBook | null = null;
let fileName = "";

const aliases = {
  agreementId: [
    "AGREEMENTID",
    "AGREEMENT ID",
    "AGREEMENT_ID",
    "LOAN NO",
    "LOAN NUMBER",
    "ACCOUNT NO",
    "LOAN_ID",
    "LOAN ID",
    "LAN",
    "AGMT_NO",
    "AGMT NO",
    "CONTRACT NO",
    "PROPOSAL NO",
    "CASE ID",
    "AGREEMENTNO",
  ],
  sfdc: ["SFDC", "SFDC AMOUNT", "SFDC_AMT", "SFDC AMT"],
  online: ["ONLINE", "ONLINE AMOUNT", "ONLINE_AMT", "PAYMENT_GATEWAY", "ONLINE PAID"],
  paidAmount: [
    "DAC",
    "DAC AMOUNT",
    "PAID DAC",
    "PAID AMOUNT",
    "PAID_AMOUNT",
    "AMOUNT",
    "PAYMENT AMOUNT",
  ],
  paidTotal: [
    "TOTAL",
    "TOTAL PAID",
    "PAID TOTAL",
    "TOTAL AMOUNT",
    "GRAND TOTAL",
    "TOTAL COLLECTION",
    "PAID FILE TOTAL",
  ],
  ecs: ["ECS", "ECS AMOUNT", "NACH", "ACH"],
  special: ["SPECIAL", "SPECIAL AMOUNT", "SPECIAL_AMT", "SPECIAL PRES"],
  paymentDate: [
    "PAYMENT DATE",
    "PAYMENT_DATE",
    "PAID DATE",
    "PAID_DATE",
    "PAY DATE",
    "COLLECTION DATE",
    "TXN DATE",
    "TRANSACTION DATE",
    "RECEIPT DATE",
    "DATE",
  ],
};

function headerKey(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function detect(headers: unknown[], keys: string[]) {
  const accepted = new Set(keys.map(headerKey));
  return headers.findIndex((value) => accepted.has(headerKey(value)));
}

function progress(percent: number, label: string) {
  self.postMessage({ type: "progress", percent, label });
}

function detectHeader(rows: unknown[][]) {
  const keywords = [
    "AGREEMENT",
    "LOAN",
    "LAN",
    "AGMT",
    "CONTRACT",
    "PROPOSAL",
    "CASE ID",
    "SFDC",
    "ONLINE",
    "DAC",
    "AMOUNT",
    "PAID",
    "TOTAL",
    "PAYMENT DATE",
  ];
  let best = { row: 0, score: -1 };
  for (let row = 0; row < Math.min(10, rows.length); row++) {
    const values = (rows[row] ?? []).map(headerKey);
    const score = keywords.reduce(
      (count, keyword) => count + (values.some((value) => value.includes(keyword)) ? 1 : 0),
      0,
    );
    if (score > best.score) best = { row, score };
  }
  return best.score > 0 ? best.row : 0;
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  try {
    const message = event.data;
    if (message.type === "inspect") {
      fileName = message.fileName;
      progress(10, "Reading workbook");
      const buffer = await message.file.arrayBuffer();
      workbook = XLSX.read(buffer, { type: "array", cellDates: false, dense: true });
      progress(45, "Inspecting headers & sample rows");
      const sheets: SheetInfo[] = workbook.SheetNames.map((name) => {
        const sheet = workbook!.Sheets[name]!;
        const usedRange = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: false,
          blankrows: true,
        });
        const headerRow = detectHeader(rows);
        const headers = (rows[headerRow] ?? []).map((v) => String(v ?? ""));
        const sfdcIdx = detect(headers, aliases.sfdc);
        const onlineIdx = detect(headers, aliases.online);
        const paidAmountIdx = detect(headers, aliases.paidAmount);
        const rawPaidTotalIdx = detect(headers, aliases.paidTotal);
        const dacMode =
          sfdcIdx >= 0 || onlineIdx >= 0
            ? "split_sfdc_online"
            : paidAmountIdx >= 0 || rawPaidTotalIdx >= 0
              ? "single_dac"
              : "split_sfdc_online";
        const effectivePaidAmountIdx =
          paidAmountIdx >= 0 ? paidAmountIdx : dacMode === "single_dac" ? rawPaidTotalIdx : -1;
        const paidTotalIdx =
          rawPaidTotalIdx >= 0 &&
          rawPaidTotalIdx !== sfdcIdx &&
          rawPaidTotalIdx !== onlineIdx &&
          rawPaidTotalIdx !== effectivePaidAmountIdx
            ? rawPaidTotalIdx
            : -1;

        const mapping: ColumnMapping = {
          agreementId: detect(headers, aliases.agreementId),
          dacMode,
          sfdc: sfdcIdx,
          online: onlineIdx,
          paidAmount: effectivePaidAmountIdx,
          paidTotal: paidTotalIdx,
          ecs: detect(headers, aliases.ecs),
          special: detect(headers, aliases.special),
          paymentDate: detect(headers, aliases.paymentDate),
        };

        const sampleRows: string[][] = [];
        for (let r = headerRow + 1; r < rows.length && sampleRows.length < 15; r++) {
          const row = (rows[r] ?? []).map((cell) => String(cell ?? ""));
          if (row.some((cell) => cell.trim() !== "")) {
            sampleRows.push(row);
          }
        }

        return {
          name,
          rowCount: Math.max(0, usedRange.e.r + 1 - headerRow - 1),
          headers,
          mapping,
          headerRow,
          sampleRows,
        };
      });

      const firstWithAgreement = sheets.find((s) => s.mapping.agreementId >= 0);
      const firstWithData = firstWithAgreement ?? sheets.find((s) => s.rowCount > 0) ?? sheets[0];
      progress(70, "Columns auto-detected — confirm mapping");
      self.postMessage({ type: "inspected", sheets, defaultSheet: firstWithData?.name ?? "" });
      return;
    }

    if (!workbook) throw new Error("Select a file before processing.");
    const sheet = workbook.Sheets[message.sheetName];
    if (!sheet) throw new Error("Selected worksheet was not found.");

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: true,
    });
    const headerRow = detectHeader(rows);
    const mapping = message.mapping;
    const duplicateStrategy: DuplicateStrategy = message.duplicateStrategy ?? "last_wins";

    if (mapping.agreementId < 0) throw new Error("Map an Agreement ID / Loan ID column.");
    if (
      mapping.dacMode === "split_sfdc_online" &&
      mapping.sfdc < 0 &&
      mapping.online < 0 &&
      mapping.paidTotal < 0
    ) {
      throw new Error("Map SFDC and/or Online column (or switch to Single DAC Column mode).");
    }
    if (mapping.dacMode === "single_dac" && mapping.paidAmount < 0 && mapping.paidTotal < 0) {
      throw new Error("Map a Direct DAC / Paid Amount column.");
    }

    progress(45, "Parsing & deduplicating rows");

    const grouped = new Map<
      string,
      {
        agreementId: string;
        sfdc: number;
        online: number;
        dac: number;
        paidTotal: number;
        ecs: number;
        special: number;
        paymentDate: string;
        sourceRows: number;
        duplicatesReplaced: number;
        transactions: PaidTransaction[];
      }
    >();

    let invalidRows = 0;
    let totalRows = 0;

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (!row.some((value) => String(value ?? "").trim() !== "")) continue;
      totalRows++;

      const agreementId = normalisePaidId(row[mapping.agreementId]);
      if (!agreementId) {
        invalidRows++;
        continue;
      }

      const sfdc = parsePaidAmount(mapping.sfdc >= 0 ? row[mapping.sfdc] : 0);
      const online = parsePaidAmount(mapping.online >= 0 ? row[mapping.online] : 0);
      const paidAmount = parsePaidAmount(mapping.paidAmount >= 0 ? row[mapping.paidAmount] : 0);
      const mappedTotal = parsePaidAmount(mapping.paidTotal >= 0 ? row[mapping.paidTotal] : 0);
      const ecs = parsePaidAmount(mapping.ecs >= 0 ? row[mapping.ecs] : 0);
      const special = parsePaidAmount(mapping.special >= 0 ? row[mapping.special] : 0);
      const paymentDate = mapping.paymentDate >= 0 ? parsePaidDate(row[mapping.paymentDate]) : "";

      if (![sfdc, online, paidAmount, mappedTotal, ecs, special].every(Number.isFinite)) {
        invalidRows++;
        continue;
      }

      const rowDac = mapping.dacMode === "single_dac" ? paidAmount : sfdc + online;
      const rowPaidTotal = mapping.paidTotal >= 0 ? mappedTotal : rowDac + ecs + special;
      const tx: PaidTransaction = {
        row: i + 1,
        sfdc: roundMoney(sfdc),
        online: roundMoney(online),
        paidAmount: roundMoney(paidAmount),
        paidTotal: roundMoney(rowPaidTotal),
        ecs: roundMoney(ecs),
        special: roundMoney(special),
        paymentDate,
      };

      const existing = grouped.get(agreementId);
      if (!existing) {
        grouped.set(agreementId, {
          agreementId,
          sfdc: roundMoney(sfdc),
          online: roundMoney(online),
          dac: roundMoney(rowDac),
          paidTotal: roundMoney(rowPaidTotal),
          ecs: roundMoney(ecs),
          special: roundMoney(special),
          paymentDate,
          sourceRows: 1,
          duplicatesReplaced: 0,
          transactions: [tx],
        });
      } else if (duplicateStrategy === "last_wins") {
        existing.sfdc = roundMoney(sfdc);
        existing.online = roundMoney(online);
        existing.dac = roundMoney(rowDac);
        existing.paidTotal = roundMoney(rowPaidTotal);
        existing.ecs = roundMoney(ecs);
        existing.special = roundMoney(special);
        if (paymentDate) existing.paymentDate = paymentDate;
        existing.sourceRows += 1;
        existing.duplicatesReplaced += 1;
        existing.transactions.push(tx);
      } else {
        existing.sfdc = roundMoney(existing.sfdc + sfdc);
        existing.online = roundMoney(existing.online + online);
        existing.dac = roundMoney(existing.dac + rowDac);
        existing.paidTotal = roundMoney(existing.paidTotal + rowPaidTotal);
        existing.ecs = roundMoney(existing.ecs + ecs);
        existing.special = roundMoney(existing.special + special);
        if (paymentDate) existing.paymentDate = paymentDate;
        existing.sourceRows += 1;
        existing.transactions.push(tx);
      }
    }

    const records: StagedPaidRow[] = [...grouped.values()];
    progress(100, "Analysis ready");
    self.postMessage({ type: "processed", fileName, records, invalidRows, totalRows });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Could not process this file.",
    });
  }
};
