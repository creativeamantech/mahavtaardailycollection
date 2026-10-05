// Server-side data store for Mahavtaar Daily Collection.
// Operates directly and self-contained without requiring external Sheet ID, Drive ID, or Lovable gateway.

const getKolkataDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

const todayKolkata = getKolkataDate(0);
const yesterdayKolkata = getKolkataDate(-1);

const store: Record<string, string[][]> = {
  Collections: [
    [
      "Executive",
      "Loan ID",
      "Amount",
      "Date",
      "Time",
      "Created At",
      "Status",
      "Entry Date",
      "Entry Type",
      "Settlement",
      "Bucket",
      "City",
      "EMI Amount",
      "POS",
      "Foreclosure",
      "Receipt Links",
      "Remark",
    ],
    [
      "Aarti",
      "LN-100234",
      "15000",
      todayKolkata,
      "10:30:00 AM",
      `${todayKolkata}T05:00:00.000Z`,
      "Confirmed",
      todayKolkata,
      "Normal",
      "No",
      "Bucket 1",
      "Mumbai",
      "5000",
      "25000",
      "50000",
      "",
      "",
    ],
    [
      "Ankita",
      "LN-100235",
      "12000",
      todayKolkata,
      "11:15:00 AM",
      `${todayKolkata}T05:45:00.000Z`,
      "Confirmed",
      todayKolkata,
      "Normal",
      "No",
      "Bucket 2",
      "Pune",
      "6000",
      "36000",
      "72000",
      "",
      "",
    ],
    [
      "Bharti",
      "LN-100236",
      "20000",
      yesterdayKolkata,
      "02:00:00 PM",
      `${yesterdayKolkata}T08:30:00.000Z`,
      "Confirmed",
      yesterdayKolkata,
      "Normal",
      "No",
      "Bucket 1",
      "Thane",
      "5000",
      "20000",
      "40000",
      "",
      "",
    ],
    [
      "Pooja",
      "LN-100237",
      "8500",
      yesterdayKolkata,
      "03:45:00 PM",
      `${yesterdayKolkata}T10:15:00.000Z`,
      "Confirmed",
      yesterdayKolkata,
      "Normal",
      "No",
      "Bucket 3",
      "Mumbai",
      "4250",
      "25000",
      "50000",
      "",
      "",
    ],
    [
      "Sunanda",
      "LN-100238",
      "16000",
      todayKolkata,
      "01:20:00 PM",
      `${todayKolkata}T07:50:00.000Z`,
      "Confirmed",
      todayKolkata,
      "Normal",
      "Yes",
      "Bucket 2",
      "Pune",
      "8000",
      "40000",
      "60000",
      "",
      "",
    ],
  ],
  Pending: [
    [
      "Executive",
      "Loan Number",
      "Amount",
      "Photo Links",
      "Status",
      "Created At",
      "ID",
      "Settlement",
    ],
    [
      "Vinita",
      "LN-100240",
      "7500",
      "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
      "Pending",
      `${todayKolkata}T06:00:00.000Z`,
      "PND-1727850000000",
      "No",
    ],
  ],
  ECS_Special_Info: [
    [
      "ID",
      "Executive",
      "Loan ID",
      "Amount",
      "Payment Type",
      "Payment Date",
      "Entry Date",
      "Entry Time",
      "Status",
      "Remark",
      "Created At",
      "Updated At",
    ],
    [
      "ECS-1727851111111",
      "Julee",
      "LN-100239",
      "10000",
      "ECS",
      todayKolkata,
      todayKolkata,
      "09:30:00 AM",
      "Confirmed",
      "Cleared via auto-debit",
      `${todayKolkata}T04:00:00.000Z`,
      `${todayKolkata}T04:00:00.000Z`,
    ],
  ],
  AppSettings: [
    ["Key", "Value"],
    ["entry", "ON"],
    ["report", "ON"],
    ["loans", "ON"],
    ["pending", "ON"],
    ["ecs", "ON"],
    ["remarks", "ON"],
  ],
  Notifications: [
    ["Notification", "Image URL", "Status", "Created At", "ID"],
    [
      "Welcome to Mahavtaar Daily Collection. All collections and reports are active.",
      "",
      "Active",
      `${todayKolkata}T00:00:00.000Z`,
      "NTF-welcome",
    ],
  ],
};

function parseColLetter(colStr: string): number {
  let num = 0;
  for (let i = 0; i < colStr.length; i++) {
    num = num * 26 + (colStr.charCodeAt(i) - 64);
  }
  return num - 1; // 0-based
}

function parseA1Range(range: string): {
  sheetName: string;
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
} {
  const [sheetName = "Collections", cellRange = ""] = range.split("!");
  const parts = cellRange.split(":");
  const first = parts[0] || "A1";
  const second = parts[1] || first;

  const matchFirst = first.match(/^([A-Za-z]+)?(\d+)?$/);
  const matchSecond = second.match(/^([A-Za-z]+)?(\d+)?$/);

  const startColStr = matchFirst?.[1] || "A";
  const startRowStr = matchFirst?.[2];
  const endColStr = matchSecond?.[1] || startColStr;
  const endRowStr = matchSecond?.[2];

  const startCol = parseColLetter(startColStr.toUpperCase());
  const endCol = parseColLetter(endColStr.toUpperCase());
  const startRow = startRowStr ? parseInt(startRowStr, 10) : 1;
  const endRow = endRowStr ? parseInt(endRowStr, 10) : Infinity;

  return { sheetName, startCol, startRow, endCol, endRow };
}

function getOrCreateSheet(name: string): string[][] {
  if (!store[name]) {
    store[name] = [];
  }
  return store[name]!;
}

export function invalidateSheetsCache() {
  // In-memory store is always up to date
}

export async function sheetsGet(range: string): Promise<string[][]> {
  const { sheetName, startCol, startRow, endCol, endRow } = parseA1Range(range);
  const sheet = store[sheetName] ?? [];
  const result: string[][] = [];
  const maxRow = Math.min(sheet.length, endRow === Infinity ? sheet.length : endRow);
  for (let r = startRow - 1; r < maxRow; r++) {
    const row = sheet[r] || [];
    const sliced: string[] = [];
    for (let c = startCol; c <= endCol; c++) {
      sliced.push(row[c] ?? "");
    }
    result.push(sliced);
  }
  return result;
}

export async function sheetsAppend(range: string, values: (string | number)[][]) {
  const { sheetName } = parseA1Range(range);
  const sheet = getOrCreateSheet(sheetName);
  const startRowNum = sheet.length + 1;
  for (const row of values) {
    sheet.push(row.map((v) => String(v ?? "")));
  }
  const endRowNum = sheet.length;
  return {
    updates: {
      updatedRange: `${sheetName}!A${startRowNum}:J${endRowNum}`,
      updatedRows: values.length,
    },
  };
}

export async function sheetsUpdate(range: string, values: (string | number)[][]) {
  const { sheetName, startCol, startRow } = parseA1Range(range);
  const sheet = getOrCreateSheet(sheetName);
  for (let rIdx = 0; rIdx < values.length; rIdx++) {
    const targetRowIdx = startRow - 1 + rIdx;
    while (sheet.length <= targetRowIdx) {
      sheet.push([]);
    }
    const row = sheet[targetRowIdx]!;
    const rowValues = values[rIdx]!;
    for (let cIdx = 0; cIdx < rowValues.length; cIdx++) {
      const targetColIdx = startCol + cIdx;
      while (row.length <= targetColIdx) {
        row.push("");
      }
      row[targetColIdx] = String(rowValues[cIdx] ?? "");
    }
  }
  return { updatedRows: values.length };
}

const sheetIdCache: Record<string, number> = {};

export async function getSheetId(title: string): Promise<number> {
  const cached = sheetIdCache[title];
  if (typeof cached === "number") return cached;

  const titles = Object.keys(store);
  let idx = titles.indexOf(title);
  if (idx === -1) {
    store[title] = [];
    idx = Object.keys(store).indexOf(title);
  }
  sheetIdCache[title] = idx;
  return idx;
}

export async function sheetsBatchUpdate(_requests: unknown[]) {
  return { replies: [] };
}

export async function driveUpload(_name: string, mimeType: string, base64: string) {
  if (base64 && base64.length < 500000) {
    return `data:${mimeType};base64,${base64}`;
  }
  return `data:${mimeType};base64,${base64.slice(0, 100)}...`;
}

// Creates a tab (with optional header row) when it does not exist yet.
export async function ensureSheet(title: string, header?: string[]) {
  if (!store[title]) {
    store[title] = header ? [header] : [];
  }
  return getSheetId(title);
}
