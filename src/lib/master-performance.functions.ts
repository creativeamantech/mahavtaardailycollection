import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";

const GATEWAY = "https://connector-gateway.lovable.dev";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const TZ = "Asia/Kolkata";
const TARGET_TAB = "Performance Targets";


type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
};
type TargetRule = {
  id: string;
  allocationType: string;
  bucket: string;
  state: string;
  city: string;
  mainTarget: number;
  rollbackTarget: number;
};
type Metric = {
  totalCount: number;
  paidCount: number;
  unpaidCount: number;
  totalPos: number;
  collection: number;
  mainPaidPos: number;
  rollbackPos: number;
  mainPercent: number;
  rollbackPercent: number;
  mainTarget: number | null;
  targetPos: number | null;
  neededPos: number | null;
  rollbackTarget: number | null;
  targetRollbackPos: number | null;
  neededRollbackPos: number | null;
};
type ExecutiveRow = Metric & { executive: string };
type CityRow = Metric & { city: string; executives: ExecutiveRow[] };
type BucketReport = { bucket: string; cities: CityRow[]; total: Metric };
const monthTitle = () =>
  "Mahavtaar Master Allocation " +
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", year: "numeric" }).format(
    new Date(),
  );

function authHeaders(key: string) {
  const token = process.env["LOVABLE_API_KEY"],
    connection = process.env[key];
  if (!token || !connection) throw new Error("Google Drive/Sheets connector is not configured.");
  return {
    Authorization: "Bearer " + token,
    "X-Connection-Api-Key": connection,
    "Content-Type": "application/json",
  };
}
async function checkedJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok)
    throw new Error(label + " failed (" + res.status + "): " + (await res.text()).slice(0, 350));
  return res.json() as Promise<T>;
}
async function findMaster(): Promise<DriveFile> {
  const url = new URL(GATEWAY + "/google_drive/drive/v3/files");
  url.searchParams.set(
    "q",
    "name = '" +
      monthTitle().replace(/'/g, "\\'") +
      "' and mimeType = '" +
      SHEET_MIME +
      "' and trashed = false",
  );
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,webViewLink)");
  const result = await checkedJson<{ files?: DriveFile[] }>(
    await fetch(url, { headers: authHeaders("GOOGLE_DRIVE_API_KEY") }),
    "Master Allocation search",
  );
  const files = result.files ?? [];
  if (files.length !== 1)
    throw new Error(
      files.length
        ? "Multiple current-month Master Allocation files found. Please resolve the duplicate."
        : "Current-month Master Allocation not found: " + monthTitle(),
    );
  return files[0]!;
}
async function sheetValues(id: string, range: string): Promise<string[][]> {
  const url =
    GATEWAY +
    "/google_sheets/v4/spreadsheets/" +
    encodeURIComponent(id) +
    "/values/" +
    encodeURIComponent(range);
  const result = await checkedJson<{ values?: string[][] }>(
    await fetch(url, { headers: authHeaders("GOOGLE_SHEETS_API_KEY") }),
    "Google Sheets read",
  );
  return result.values ?? [];
}

async function ensureTargetTab(id: string) {
  const meta = await checkedJson<{ sheets?: { properties?: { title?: string } }[] }>(
    await fetch(GATEWAY + "/google_sheets/v4/spreadsheets/" + id + "?fields=sheets.properties", {
      headers: authHeaders("GOOGLE_SHEETS_API_KEY"),
    }),
    "Master spreadsheet metadata",
  );
  if ((meta.sheets ?? []).some((s) => s.properties?.title === TARGET_TAB)) return;
  await checkedJson(
    await fetch(GATEWAY + "/google_sheets/v4/spreadsheets/" + id + ":batchUpdate", {
      method: "POST",
      headers: authHeaders("GOOGLE_SHEETS_API_KEY"),
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TARGET_TAB } } }] }),
    }),
    "Create Performance Targets tab",
  );
  await checkedJson(
    await fetch(
      GATEWAY +
        "/google_sheets/v4/spreadsheets/" +
        id +
        "/values/" +
        encodeURIComponent("'" + TARGET_TAB + "'!A1:G1") +
        "?valueInputOption=RAW",
      {
        method: "PUT",
        headers: authHeaders("GOOGLE_SHEETS_API_KEY"),
        body: JSON.stringify({
          values: [
            [
              "ID",
              "Allocation Type",
              "Bucket",
              "State",
              "City",
              "Main Target %",
              "Rollback Target %",
            ],
          ],
        }),
      },
    ),
    "Initialize Performance Targets",
  );
}
function norm(v: unknown) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function bucketKey(v: unknown) {
  return norm(v)
    .replace(/^bucket\s*/, "")
    .replace(/^b\s*/, "")
    .replace(/[^0-9]/g, "");
}
function headerIndex(headers: string[], aliases: string[]) {
  const accepted = new Set(aliases.map((v) => norm(v)));
  return headers.findIndex((v) => accepted.has(norm(v)));
}
function numeric(v: unknown): number {
  if (v === null || v === undefined || String(v).trim() === "") return 0;
  const raw = String(v)
    .trim()
    .replace(/[₹,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const n = Number(raw);
  if (!Number.isFinite(n))
    throw new Error("Non-numeric value found in Master Data: " + String(v).slice(0, 40));
  return n;
}
function targetNumber(v: unknown) {
  if (v === null || v === undefined || String(v).trim() === "") return 0;
  const n = Number(String(v).replace("%", "").trim());
  if (!Number.isFinite(n) || n < 0 || n > 100)
    throw new Error("Target percentages must be between 0 and 100.");
  return n;
}
function readTargets(rows: string[][]): TargetRule[] {
  return rows
    .slice(1)
    .filter((r) => r.some((v) => String(v ?? "").trim()))
    .map((r, i) => ({
      id: String(r[0] || "rule-" + (i + 1)),
      allocationType: String(r[1] ?? "").trim(),
      bucket: String(r[2] ?? "").trim(),
      state: String(r[3] ?? "").trim(),
      city: String(r[4] ?? "").trim(),
      mainTarget: targetNumber(r[5]),
      rollbackTarget: targetNumber(r[6]),
    }));
}
function targetFor(
  rules: TargetRule[],
  allocationType: string,
  bucket: string,
  state: string,
  city: string,
 ) {
  const dimensions = [allocationType, bucket, state, city];
  const matches = rules.filter((rule) => {
    const values = [rule.allocationType, rule.bucket, rule.state, rule.city];
    return values.every(
      (v, i) =>
        !v ||
        (i === 1 ? bucketKey(v) === bucketKey(dimensions[i]) : norm(v) === norm(dimensions[i])),
    );
  });
  matches.sort(
    (a, b) =>
      [b.allocationType, b.bucket, b.state, b.city].filter(Boolean).length -
      [a.allocationType, a.bucket, a.state, a.city].filter(Boolean).length,
  );
  if (matches.length > 1) {
    const top = [
      matches[0]!.allocationType,
      matches[0]!.bucket,
      matches[0]!.state,
      matches[0]!.city,
    ].filter(Boolean).length;
    const next = [
      matches[1]!.allocationType,
      matches[1]!.bucket,
      matches[1]!.state,
      matches[1]!.city,
    ].filter(Boolean).length;
    if (top === next)
      throw new Error(
        "Conflicting target rules match " +
          [allocationType, bucket, state, city].join(" / ") +
          ". Please make the rules more specific.",
      );
  }
  return matches[0] ?? null;
}
function makeMetric(
  rows: {
    agreement: string;
    dac: number;
    mainPaidCount: number;
    unpaid: number;
    pos: number;
    main: number;
    rollback: number;
    mainTarget: number | null;
    rollbackTarget: number | null;
  }[],
): Metric {
  const totalCount = rows.length;
  const paidCount = rows.reduce((s, r) => s + r.mainPaidCount, 0);
  const unpaidCount = rows.reduce((s, r) => s + r.unpaid, 0);
  const totalPos = rows.reduce((s, r) => s + r.pos, 0);
  const collection = rows.reduce((s, r) => s + r.dac, 0);
  const mainPaidPos = rows.reduce((s, r) => s + r.main, 0);
  const rollbackPos = rows.reduce((s, r) => s + r.rollback, 0);
  const targetedRows = rows.filter((row) => row.mainTarget !== null && row.rollbackTarget !== null);
  const targetedPos = targetedRows.reduce((sum, row) => sum + row.pos, 0);
  const targetedMainPaidPos = targetedRows.reduce((sum, row) => sum + row.main, 0);
  const targetedRollbackPaidPos = targetedRows.reduce((sum, row) => sum + row.rollback, 0);
  const targetPos = targetedRows.reduce((sum, row) => sum + (row.pos * row.mainTarget!) / 100, 0);
  const targetRollbackPos = targetedRows.reduce((sum, row) => sum + (row.pos * row.rollbackTarget!) / 100, 0);
  const mainTarget = targetedPos ? (targetPos / targetedPos) * 100 : null;
  const rollbackTarget = targetedPos ? (targetRollbackPos / targetedPos) * 100 : null;
  return {
    totalCount,
    paidCount,
    unpaidCount,
    totalPos,
    collection,
    mainPaidPos,
    rollbackPos,
    mainPercent: totalPos ? (mainPaidPos / totalPos) * 100 : 0,
    rollbackPercent: totalPos ? (rollbackPos / totalPos) * 100 : 0,
    mainTarget,
    targetPos,
    neededPos: targetedRows.length ? targetPos - targetedMainPaidPos : null,
    rollbackTarget,
    targetRollbackPos,
    neededRollbackPos: targetedRows.length ? targetRollbackPos - targetedRollbackPaidPos : null,
  };
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const getMasterPerformanceReport = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession("Admin");
  const master = await findMaster();
  await ensureTargetTab(master.id);
  const [data, targetRows] = await Promise.all([
    sheetValues(master.id, "Data!A1:GY"),
    sheetValues(master.id, "'" + TARGET_TAB + "'!A1:G"),
  ]);
  if (data.length < 2) throw new Error("Master Allocation Data tab has no data rows.");
  const h = data[0]!;
  const idx = {
    agreement: headerIndex(h, ["agreementid", "Agreement ID"]),
    allocation: headerIndex(h, ["Allocation Type"]),
    executive: headerIndex(h, ["EX. Name", "Executive Name"]),
    city: headerIndex(h, ["city", "City"]),
    bucket: headerIndex(h, ["bucket", "Bucket"]),
    pos: headerIndex(h, ["principal_outstanding", "Principal Outstanding"]),
    dac: headerIndex(h, ["DAC"]),
    unpaid: headerIndex(h, ["Unpaid"]),
    paidCount: headerIndex(h, ["Main Paid Count"]),
    main: headerIndex(h, ["Main Paid POS"]),
    rollback: headerIndex(h, ["RollBack POS", "Rollback POS"]),
    state: headerIndex(h, ["state", "State"]),
  };
  const missing = Object.entries(idx)
    .filter(([, v]) => v < 0)
    .map(([k]) => k);
  if (missing.length)
    throw new Error("Required Master Data columns missing: " + missing.join(", "));
  const rules = readTargets(targetRows);
  const grouped = new Map<string, Map<string, Map<string, (typeof parsed)[number]>>>();
  const parsed: {
    agreement: string;
    allocation: string;
    executive: string;
    city: string;
    bucket: string;
    state: string;
    dac: number;
    unpaid: number;
    mainPaidCount: number;
    pos: number;
    main: number;
    rollback: number;
    mainTarget: number | null;
    rollbackTarget: number | null;
  }[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i] ?? [];
    const agreement = String(row[idx.agreement] ?? "").trim();
    if (!agreement) continue;
    const item = {
      agreement,
      allocation: String(row[idx.allocation] ?? "").trim() || "Unspecified",
      executive: String(row[idx.executive] ?? "").trim() || "Unassigned",
      city: String(row[idx.city] ?? "").trim() || "Unknown",
      bucket: String(row[idx.bucket] ?? "").trim() || "Unbucketed",
      state: String(row[idx.state] ?? "").trim() || "Unknown",
      dac: numeric(row[idx.dac]),
      unpaid: numeric(row[idx.unpaid]),
      mainPaidCount: numeric(row[idx.paidCount]),
      pos: numeric(row[idx.pos]),
      main: numeric(row[idx.main]),
      rollback: numeric(row[idx.rollback]),
    };
    const target = targetFor(rules, item.allocation, item.bucket, item.state, item.city);
    parsed.push({ ...item, mainTarget: target?.mainTarget ?? null, rollbackTarget: target?.rollbackTarget ?? null });
  }
  const bucketNames = ["Bucket 1", "Bucket 2", "Bucket 3", "Bucket 4", "Bucket 5"];
  const buckets: BucketReport[] = bucketNames.map((bucket) => {
    const rows = parsed.filter((r) => bucketKey(r.bucket) === bucketKey(bucket));
    const cityMap = new Map<string, typeof parsed>();
    for (const r of rows) {
      const list = cityMap.get(r.city) ?? [];
      list.push(r);
      cityMap.set(r.city, list);
    }
    const cities: CityRow[] = [...cityMap.entries()]
      .map(([city, cityRows]) => {
        const executiveMap = new Map<string, typeof parsed>();
        cityRows.forEach((r) => {
          const list = executiveMap.get(r.executive) ?? [];
          list.push(r);
          executiveMap.set(r.executive, list);
        });
        const executives: ExecutiveRow[] = [...executiveMap.entries()]
          .map(([executive, exRows]) => {
            return { executive, ...makeMetric(exRows) };
          })
          .sort((a, b) => b.totalCount - a.totalCount || a.executive.localeCompare(b.executive));
        return { city, executives, ...makeMetric(cityRows) };
      })
      .sort((a, b) => b.totalCount - a.totalCount || a.city.localeCompare(b.city));
    return { bucket, cities, total: makeMetric(rows) };
  });
  const uniqueValues = (values: string[]) =>
    [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "en-IN", { sensitivity: "base" }),
    );
  const dimensionOptions = {
    allocationTypes: uniqueValues(parsed.map((r) => r.allocation)),
    buckets: uniqueValues(parsed.map((r) => r.bucket)),
    states: uniqueValues(parsed.map((r) => r.state)),
    cities: uniqueValues(parsed.map((r) => r.city)),
  };
  const totals = makeMetric(parsed);
  const positiveNeededPos = buckets.flatMap((b) =>
    b.cities
      .filter((c) => c.neededPos !== null && c.neededPos > 0)
      .map((c) => ({
        bucket: b.bucket,
        city: c.city,
        totalCount: c.totalCount,
        neededPos: round(c.neededPos),
        mainPaidPos: round(c.mainPaidPos),
        targetPos: round(c.targetPos),
      })),
  );
  const positiveNeededRollback = buckets.flatMap((b) =>
    b.cities
      .filter((c) => c.neededRollbackPos !== null && c.neededRollbackPos > 0)
      .map((c) => ({
        bucket: b.bucket,
        city: c.city,
        totalCount: c.totalCount,
        neededRollbackPos: round(c.neededRollbackPos),
        rollbackPos: round(c.rollbackPos),
        targetRollbackPos: round(c.targetRollbackPos),
      })),
  );
  return {
    master: {
      id: master.id,
      name: master.name,
      url: master.webViewLink ?? "https://docs.google.com/spreadsheets/d/" + master.id + "/edit",
      modifiedTime: master.modifiedTime ?? null,
    },
    rowCount: parsed.length,
    buckets,
    totals,
    rules,
    dimensionOptions,
    positiveNeededPos,
    positiveNeededRollback,
  };
});

const targetInput = z.object({
  rules: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        allocationType: z.string().trim().max(100),
        bucket: z.string().trim().max(40),
        state: z.string().trim().max(100),
        city: z.string().trim().max(100),
        mainTarget: z.number().min(0).max(100),
        rollbackTarget: z.number().min(0).max(100),
      }),
    )
    .max(300),
});
export const saveMasterPerformanceTargets = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => targetInput.parse(value))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const ids = new Set<string>();
    for (const rule of data.rules) {
      if (ids.has(rule.id)) throw new Error("Duplicate target rule ID: " + rule.id);
      ids.add(rule.id);
    }
    const master = await findMaster();
    await ensureTargetTab(master.id);
    const values = [
      ["ID", "Allocation Type", "Bucket", "State", "City", "Main Target %", "Rollback Target %"],
      ...data.rules.map((r) => [
        r.id,
        r.allocationType,
        r.bucket,
        r.state,
        r.city,
        String(r.mainTarget),
        String(r.rollbackTarget),
      ]),
    ];
    const range = "'" + TARGET_TAB + "'!A1:G" + Math.max(values.length, 1);
    await checkedJson(
      await fetch(
        GATEWAY +
          "/google_sheets/v4/spreadsheets/" +
          master.id +
          "/values/" +
          encodeURIComponent(range) +
          "?valueInputOption=RAW",
        {
          method: "PUT",
          headers: authHeaders("GOOGLE_SHEETS_API_KEY"),
          body: JSON.stringify({ majorDimension: "ROWS", values }),
        },
      ),
      "Save Performance Targets",
    );
    return { saved: data.rules.length };
  });
