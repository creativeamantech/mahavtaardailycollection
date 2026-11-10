import { createServerFn } from "@tanstack/react-start";
import { requireSession } from "./auth.functions";

const GATEWAY = "https://connector-gateway.lovable.dev";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const TZ = "Asia/Kolkata";

function monthTitle() {
  return "Mahavtaar Master Allocation " + new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", year: "numeric" }).format(new Date());
}
function apiHeaders(key: string) {
  const token = process.env["LOVABLE_API_KEY"];
  const connection = process.env[key];
  if (!token || !connection) throw new Error("Google Drive/Sheets connector is not configured.");
  return { Authorization: "Bearer " + token, "X-Connection-Api-Key": connection };
}
async function readJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw new Error(label + " failed (" + response.status + "): " + (await response.text()).slice(0, 300));
  return response.json() as Promise<T>;
}
function norm(value: unknown) { return String(value ?? "").trim().toUpperCase(); }
function numeric(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const parsed = Number(String(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
async function masterFile() {
  const url = new URL(GATEWAY + "/google_drive/drive/v3/files");
  url.searchParams.set("q", "name = '" + monthTitle().replace(/'/g, "\\'") + "' and mimeType = '" + SHEET_MIME + "' and trashed = false");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("fields", "files(id,name,mimeType,webViewLink)");
  const result = await readJson<{files?:{id:string;name:string;mimeType:string;webViewLink?:string}[]}>(await fetch(url, { headers: apiHeaders("GOOGLE_DRIVE_API_KEY") }), "Master Allocation search");
  const files = result.files ?? [];
  if (files.length !== 1) throw new Error(files.length ? "Multiple current-month Master Allocation files found. Resolve the duplicate in Drive." : "Current-month Master Allocation not found: " + monthTitle());
  return files[0]!;
}
async function readData(id: string) {
  const url = GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent("Data!A1:GY");
  const result = await readJson<{values?:unknown[][]}>(await fetch(url, { headers: apiHeaders("GOOGLE_SHEETS_API_KEY") }), "Master Data read");
  return result.values ?? [];
}
export const getAdminNeededPosReport = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession("Admin");
  const master = await masterFile();
  const values = await readData(master.id);
  if (values.length < 2) throw new Error("Master Data has no allocated loan rows.");
  const headers = (values[0] ?? []).map(v => norm(v));
  const index = (aliases: string[]) => headers.findIndex(h => aliases.map(norm).includes(h));
  const ix = {
    agreement: index(["agreementid", "agreement id", "loan number"]),
    allocation: index(["allocation type"]),
    executive: index(["ex. name", "executive", "executive name"]),
    fos: index(["fos"]),
    city: index(["city"]),
    bucket: index(["bucket"]),
    state: index(["state"]),
    pos: index(["principal_outstanding", "principal outstanding", "pos"]),
    dac: index(["dac"]),
    unpaid: index(["unpaid"]),
    paidCount: index(["main paid count"]),
    paidPos: index(["main paid pos"]),
    rollbackPos: index(["rollback pos"]),
  };
  const missing = Object.entries(ix).filter(([key, value]) => value < 0 && !["allocation","fos","unpaid","paidCount","paidPos","rollbackPos"].includes(key)).map(([key]) => key);
  if (missing.length) throw new Error("Master Data is missing required report columns: " + missing.join(", "));
  type Metric = { cases:number; paidCount:number; unpaidCount:number; collection:number; pos:number; mainPaidPos:number; rollbackPos:number };
  type ExecutiveRow = Metric & { executive:string };
  type CityRow = Metric & { city:string; executives:ExecutiveRow[] };
  const empty = ():Metric => ({cases:0,paidCount:0,unpaidCount:0,collection:0,pos:0,mainPaidPos:0,rollbackPos:0});
  const buckets = new Map<string,Map<string,Map<string,Metric>>>();
  let skipped = 0;
  for (const row of values.slice(1)) {
    const r = row ?? [];
    const agreement = String(r[ix.agreement] ?? "").trim();
    const city = String(r[ix.city] ?? "").trim();
    const bucket = String(r[ix.bucket] ?? "").trim();
    if (!agreement || !city || !bucket) { skipped++; continue; }
    const executive = String(r[ix.executive >= 0 ? ix.executive : ix.fos] ?? "").trim() || "Unassigned";
    const byCity = buckets.get(bucket) ?? new Map<string,Map<string,Metric>>();
    const byExecutive = byCity.get(city) ?? new Map<string,Metric>();
    const metric = byExecutive.get(executive) ?? empty();
    metric.cases += 1;
    metric.collection += numeric(r[ix.dac]);
    metric.pos += numeric(r[ix.pos]);
    metric.paidCount += ix.paidCount >= 0 ? numeric(r[ix.paidCount]) : 0;
    metric.unpaidCount += ix.unpaid >= 0 ? numeric(r[ix.unpaid]) : 0;
    metric.mainPaidPos += ix.paidPos >= 0 ? numeric(r[ix.paidPos]) : 0;
    metric.rollbackPos += ix.rollbackPos >= 0 ? numeric(r[ix.rollbackPos]) : 0;
    byExecutive.set(executive,metric); byCity.set(city,byExecutive); buckets.set(bucket,byCity);
  }
  const result = [...buckets.entries()].map(([bucket, cities]) => ({
    bucket,
    cities: [...cities.entries()].map(([city, executives]) => {
      const rows = [...executives.entries()].map(([executive,metric]) => ({ executive,...metric }));
      const total = rows.reduce((sum,row) => {
        sum.cases += row.cases; sum.paidCount += row.paidCount; sum.unpaidCount += row.unpaidCount;
        sum.collection += row.collection; sum.pos += row.pos; sum.mainPaidPos += row.mainPaidPos; sum.rollbackPos += row.rollbackPos;
        return sum;
      },empty());
      return { city, ...total, executives: rows.sort((a,b) => b.cases-a.cases) };
    }).sort((a,b) => b.cases-a.cases),
  })).sort((a,b) => Number(a.bucket)-Number(b.bucket));
  return { master:{name:master.name,url:master.webViewLink ?? ("https://docs.google.com/spreadsheets/d/"+master.id+"/edit"),id:master.id}, buckets:result, skipped, generatedAt:new Date().toISOString() };
});
