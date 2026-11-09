import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";

const GATEWAY = "https://connector-gateway.lovable.dev";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const TZ = "Asia/Kolkata";
const monthTitle = () => "Mahavtaar Master Allocation " + new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", year: "numeric" }).format(new Date());
const dateParts = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", day: "numeric", year: "numeric" }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return { month: get("month"), day: get("day"), year: get("year") };
};
function headers(key: string) {
  const token = process.env["LOVABLE_API_KEY"], connection = process.env[key];
  if (!token || !connection) throw new Error("Google Drive/Sheets connector is not configured.");
  return { Authorization: "Bearer " + token, "X-Connection-Api-Key": connection, "Content-Type": "application/json" };
}
async function json<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) throw new Error(label + " failed (" + res.status + "): " + (await res.text()).slice(0, 400));
  return res.json() as Promise<T>;
}
async function driveList(q: string) {
  const url = new URL(GATEWAY + "/google_drive/drive/v3/files");
  url.searchParams.set("q", q + " and trashed = false");
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("orderBy", "name");
  url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,version,webViewLink),nextPageToken");
  const result = await json<{files?: DriveFile[];nextPageToken?:string}>(await fetch(url, { headers: headers("GOOGLE_DRIVE_API_KEY") }), "Google Drive search");
  if (result.nextPageToken) throw new Error("Drive returned more than 1000 matching files; narrow the Paid File folder/search before processing.");
  return result.files ?? [];
}
type DriveFile = {id:string;name:string;mimeType:string;modifiedTime?:string;version?:string;webViewLink?:string};
async function sheetValues(id: string, range: string) {
  const url = GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(range);
  const result = await json<{values?:string[][]}>(await fetch(url, { headers: headers("GOOGLE_SHEETS_API_KEY") }), "Google Sheets read");
  return result.values ?? [];
}
async function ensureTabs(id: string, titles: string[]) {
  const meta = await json<{sheets?:{properties?:{title?:string}}[]}>(await fetch(GATEWAY + "/google_sheets/v4/spreadsheets/" + id + "?fields=sheets.properties", {headers:headers("GOOGLE_SHEETS_API_KEY")}), "Master spreadsheet metadata");
  const existing = new Set((meta.sheets ?? []).map(s => s.properties?.title));
  const requests = titles.filter(t => !existing.has(t)).map(title => ({addSheet:{properties:{title}}}));
  if (requests.length) await json(await fetch(GATEWAY + "/google_sheets/v4/spreadsheets/" + id + ":batchUpdate", {method:"POST",headers:headers("GOOGLE_SHEETS_API_KEY"),body:JSON.stringify({requests})}), "Create reconciliation tabs");
}
async function ensureHeaders(id:string) {
  const [audit,state]=await Promise.all([sheetValues(id,"'Paid File Audit'!A1:H1"),sheetValues(id,"'Paid File Snapshot State'!A1:F1")]);
  const data:{range:string;values:string[][]}[]=[];
  if(!audit.length)data.push({range:"'Paid File Audit'!A1:H1",values:[["Applied At","Paid File ID","Paid File Name","Agreement ID","New Total","Master Row","Status","Fingerprint"]]});
  if(!state.length)data.push({range:"'Paid File Snapshot State'!A1:F1",values:[["Agreement ID","Latest Sequence","Latest Cumulative Total","Paid File ID","Accepted At","Paid File Name"]]});
  if(data.length)await json(await fetch(GATEWAY+"/google_sheets/v4/spreadsheets/"+id+"/values:batchUpdate",{method:"POST",headers:headers("GOOGLE_SHEETS_API_KEY"),body:JSON.stringify({valueInputOption:"RAW",data})}),"Initialize reconciliation headers");
}
function norm(v: unknown) { return String(v ?? "").trim().toUpperCase().replace(/^['`]+/,"").replace(/[^A-Z0-9]/g,""); }
function headerIndex(row:string[], aliases:string[]) {
  const set = new Set(aliases.map(norm));
  return row.findIndex(v => set.has(norm(v)));
}
function amount(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim().replace(/[₹,\s]/g,"").replace(/^\((.*)\)$/,"-$1");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function col(n:number) { let x=n+1,s="";while(x){const r=(x-1)%26;s=String.fromCharCode(65+r)+s;x=Math.floor((x-1)/26);}return s; }
type RowPreview = {loan:string;row:number;oldTotal:number;newTotal:number;remaining:number;date:string;dac:number;ecs:number|null;special:number|null;status:string};
type Built = { rows:RowPreview[]; counts:{master:number;found:number;notFound:number;zeroZero:number;duplicates:number;invalid:number;overpaid:number;manualReview:number}; writes:{range:string;values:(string|number)[][]}[]; fingerprint:string; sequence:number };
async function masterFile() {
  const title = monthTitle();
  const files = await driveList("name = '" + title.replace(/'/g,"\\'") + "' and mimeType = '" + SHEET_MIME + "'");
  if (files.length !== 1) throw new Error(files.length ? "More than one current-month Master Allocation has the exact title. Resolve the duplicate files in Drive." : "Current-month Master Allocation not found: " + title);
  return files[0]!;
}
function paidFilePrefix() { const d=dateParts(); return "Paid File " + d.month + " " + d.day + " " + d.year + " - "; }
async function paidFiles() {
  const prefix=paidFilePrefix();
  const files=await driveList("name contains '" + prefix.replace(/'/g,"\\'") + "' and mimeType = '" + SHEET_MIME + "'");
  return files.map(f=>({...f, sequence:Number(f.name.slice(prefix.length))})).filter(f=>Number.isSafeInteger(f.sequence)&&f.sequence>0&&new RegExp("^"+prefix.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\d{2,}$").test(f.name)).sort((a,b)=>a.sequence-b.sequence);
}
async function build(masterId:string,file:DriveFile):Promise<Built> {
  if(file.mimeType!==SHEET_MIME) throw new Error("Paid File must be a native Google Sheet.");
  const [master,paid,audit,state]=await Promise.all([
    sheetValues(masterId,"Data!A1:GY"),
    sheetValues(file.id,"A1:AZ"),
    sheetValues(masterId,"'Paid File Audit'!A1:K"),
    sheetValues(masterId,"'Paid File Snapshot State'!A1:F")
  ]);
  if(master.length<2||paid.length<2) throw new Error("Master Data or Paid File has no data rows.");
  const mh=master[0]!, ph=paid[0]!;
  const mi=headerIndex(mh,["Agreement ID","Loan Number","Loan No"]), pi=headerIndex(ph,["Agreement ID","Loan Number","Loan No"]);
  const mTotal=headerIndex(mh,["Total"]), mNew=headerIndex(mh,["New Total"]), mRemain=headerIndex(mh,["Remaining"]), mDate=headerIndex(mh,["Date","Payment Date"]), mDac=headerIndex(mh,["DAC"]), mEcs=headerIndex(mh,["ECS"]), mSpecial=headerIndex(mh,["Special"]);
  const mSfdc=headerIndex(mh,["SFDC"]), mOnline=headerIndex(mh,["Online"]);
  const pTotal=headerIndex(ph,["Total","Paid Amount","Payment Amount","New Total"]), pDate=headerIndex(ph,["Date","Payment Date","Paid Date"]), pDac=headerIndex(ph,["DAC"]), pEcs=headerIndex(ph,["ECS"]), pSpecial=headerIndex(ph,["Special"]);
  if([mi,mTotal,mNew,mRemain,mDate,mDac,pi,pTotal].some(x=>x<0)) throw new Error("Required Agreement ID, Date, DAC, Total, New Total or Remaining columns are missing.");
  const masterById=new Map<string,{row:string[];rowNo:number}>();
  for(let i=1;i<master.length;i++){const r=master[i]??[];const id=norm(r[mi]);if(id){if(masterById.has(id)) throw new Error("Duplicate loan number exists in Master Data: "+id+". Resolve it before reconciliation.");masterById.set(id,{row:r,rowNo:i+1});}}
  const paidById=new Map<string,string[][]>();
  for(let i=1;i<paid.length;i++){const r=paid[i]??[];const id=norm(r[pi]);if(id){const a=paidById.get(id)??[];a.push(r);paidById.set(id,a);}}
  const appliedIds=new Set(audit.slice(1).filter(r=>r[1]===file.id).map(r=>r[1]));
  if(appliedIds.size) throw new Error("This Paid File has already been applied. Revisions require a new, separately named snapshot file.");
  const previous=new Map<string,{sequence:number;amount:number}>();
  for(const r of state.slice(1)){const id=norm(r[0]);const seq=Number(r[1]);const amt=amount(r[2]);if(id&&Number.isFinite(seq)&&amt!==null)previous.set(id,{sequence:seq,amount:amt});}
  const seq=Number(file.name.slice(paidFilePrefix().length));
  const preview:RowPreview[]=[]; const writes:{range:string;values:(string|number)[][]}[]=[];
  let notFound=0,zeroZero=0,duplicates=0,invalid=0,overpaid=0,manualReview=0,found=0;
  const stateWrites:(string|number)[][]=[];
  for(const [id,masterRow] of masterById){
    const matches=paidById.get(id);
    if(!matches){notFound++;continue;}
    found++;
    if(matches.length!==1){duplicates++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:amount(masterRow.row[mTotal])??0,newTotal:0,remaining:0,date:"",dac:0,ecs:null,special:null,status:"Duplicate – manual review"});continue;}
    const p=matches[0]!;
    const total=amount(p[pTotal]), old=amount(masterRow.row[mTotal]);
    const dac=pDac>=0?amount(p[pDac]):(mSfdc>=0?(amount(masterRow.row[mSfdc])??0):0)+(mOnline>=0?(amount(masterRow.row[mOnline])??0):0);
    const ecs=pEcs>=0?amount(p[pEcs]):null, special=pSpecial>=0?amount(p[pSpecial]):null;
    if(total===null||old===null||dac===null||(pEcs>=0&&ecs===null)||(pSpecial>=0&&special===null)){invalid++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old??0,newTotal:total??0,remaining:0,date:"",dac:dac??0,ecs,special,status:"Invalid / blank amount"});continue;}
    const prior=previous.get(id);
    if(prior&&seq<prior.sequence){manualReview++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining:old-total,date:String(p[pDate]??""),dac,ecs,special,status:"Stale snapshot"});continue;}
    if(prior&&seq===prior.sequence&&total!==prior.amount){manualReview++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining:old-total,date:String(p[pDate]??""),dac,ecs,special,status:"Same sequence changed – manual review"});continue;}
    if(prior&&seq>prior.sequence&&total<prior.amount){manualReview++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining:old-total,date:String(p[pDate]??""),dac,ecs,special,status:"Amount decreased – correction review"});continue;}
    const date=String(pDate>=0?p[pDate]??"":"").trim(), remaining=old-total;
    const zero=total===0&&dac===0&&(ecs===null||ecs===0)&&(special===null||special===0);
    if(zero)zeroZero++;
    if(remaining<0)overpaid++;
    const status=zero?"Zero-Zero":remaining<0?"Overpaid":"Ready";
    preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining,date,dac,ecs,special,status});
    if(date)writes.push({range:"Data!"+col(mDate)+masterRow.rowNo,values:[[date]]});
    writes.push({range:"Data!"+col(mDac)+masterRow.rowNo,values:[[dac]]},{range:"Data!"+col(mNew)+masterRow.rowNo,values:[[total]]},{range:"Data!"+col(mRemain)+masterRow.rowNo,values:[[remaining]]});
    if(mEcs>=0&&ecs!==null)writes.push({range:"Data!"+col(mEcs)+masterRow.rowNo,values:[[ecs]]});
    if(mSpecial>=0&&special!==null)writes.push({range:"Data!"+col(mSpecial)+masterRow.rowNo,values:[[special]]});
    stateWrites.push([id,seq,total,file.id,new Date().toISOString(),file.name]);
  }
  const ready=preview.filter(r=>["Ready","Overpaid","Zero-Zero"].includes(r.status));
  const counts={master:masterById.size,found,notFound,zeroZero,duplicates,invalid,overpaid,manualReview};
  const digest=JSON.stringify([file.id,file.version??"",file.modifiedTime??"",paid]);
  const fingerprint=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(digest)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const auditRows=ready.map(r=>[new Date().toISOString(),file.id,file.name,r.loan,r.newTotal,r.row,r.status,fingerprint]);
  const auditWrite=auditRows.length?{range:"'Paid File Audit'!A"+(audit.length+1)+":H"+(audit.length+auditRows.length),values:auditRows}:null;
  const stateWrite=stateWrites.length?{range:"'Paid File Snapshot State'!A"+(state.length+1)+":F"+(state.length+stateWrites.length),values:stateWrites}:null;
  return {rows:preview,counts,writes:[...writes,...(auditWrite?[auditWrite]:[]),...(stateWrite?[stateWrite]:[])],fingerprint,sequence:seq};
}
export const getMasterAllocationReconciliation = createServerFn({method:"GET"}).handler(async()=>{
  await requireSession("Admin");
  const master=await masterFile(), files=await paidFiles();
  await ensureTabs(master.id,["Paid File Audit","Paid File Snapshot State"]);
  await ensureHeaders(master.id);
  return {master:{id:master.id,name:master.name,url:master.webViewLink??("https://docs.google.com/spreadsheets/d/"+master.id+"/edit")},files:files.map(f=>({id:f.id,name:f.name,sequence:f.sequence,modifiedTime:f.modifiedTime??"",url:f.webViewLink??("https://docs.google.com/spreadsheets/d/"+f.id+"/edit")}))};
});
export const previewMasterAllocationReconciliation = createServerFn({method:"POST"})
.inputValidator((v:unknown)=>z.object({fileId:z.string().regex(/^[A-Za-z0-9_-]{15,120}$/)}).parse(v))
.handler(async({data})=>{
  await requireSession("Admin");
  const master=await masterFile(), files=await paidFiles(), file=files.find(f=>f.id===data.fileId);
  if(!file)throw new Error("Selected file is not a current-day Paid File Google Sheet.");
  await ensureTabs(master.id,["Paid File Audit","Paid File Snapshot State"]);
  await ensureHeaders(master.id);
  const result=await build(master.id,file);
  return {file:{id:file.id,name:file.name,sequence:file.sequence},rows:result.rows,counts:result.counts,fingerprint:result.fingerprint,sequence:result.sequence};
});
export const applyMasterAllocationReconciliation = createServerFn({method:"POST"})
.inputValidator((v:unknown)=>z.object({fileId:z.string().regex(/^[A-Za-z0-9_-]{15,120}$/),fingerprint:z.string().length(64),confirm:z.literal(true)}).parse(v))
.handler(async({data})=>{
  const session=await requireSession("Admin"), master=await masterFile(), files=await paidFiles(), file=files.find(f=>f.id===data.fileId);
  if(!file)throw new Error("Selected file is no longer in the current-day Paid File list.");
  await ensureTabs(master.id,["Paid File Audit","Paid File Snapshot State"]);
  await ensureHeaders(master.id);
  const result=await build(master.id,file);
  if(result.fingerprint!==data.fingerprint)throw new Error("Paid File changed after preview. Refresh preview and approve the new version.");
  if(result.counts.duplicates||result.counts.invalid||result.counts.manualReview)throw new Error("Write-back blocked: duplicate, invalid or manual-review cases must be resolved first.");
  const eligible=result.rows.filter(r=>["Ready","Overpaid","Zero-Zero"].includes(r.status));
  if(!eligible.length)throw new Error("No eligible Master Allocation loans were found.");
  const payload=result.writes;
  if(!payload.length)throw new Error("No write operations were generated.");
  const res=await fetch(GATEWAY+"/google_sheets/v4/spreadsheets/"+master.id+"/values:batchUpdate",{method:"POST",headers:headers("GOOGLE_SHEETS_API_KEY"),body:JSON.stringify({valueInputOption:"USER_ENTERED",data:payload})});
  await json(res,"Reconciliation write-back");
  return {ok:true,applied:eligible.length,counts:result.counts,appliedBy:session.name};
});
