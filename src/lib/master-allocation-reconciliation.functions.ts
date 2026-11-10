import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import * as XLSX from "xlsx";
import { amount, computePaidFileDac, headerIndex, norm } from "./paid-file-reconciliation.logic";

const GATEWAY = "https://connector-gateway.lovable.dev";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const TZ = "Asia/Kolkata";
const monthTitle = () => "Mahavtaar Master Allocation " + new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", year: "numeric" }).format(new Date());
const dateKey = () => { const p = dateParts(); return new Date(Date.UTC(Number(p.year), new Date(p.month+" 1, "+p.year).getMonth(), Number(p.day))).toISOString().slice(0,10); };
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
async function driveGet(id: string): Promise<DriveFile> {
  const url = GATEWAY + "/google_drive/drive/v3/files/" + encodeURIComponent(id) + "?fields=id,name,mimeType,modifiedTime,version,webViewLink";
  return json<DriveFile>(await fetch(url, { headers: headers("GOOGLE_DRIVE_API_KEY") }), "Google Drive file lookup");
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
async function readHistory(id:string) {
  const meta=await json<{sheets?:{properties?:{title?:string}}[]}>(await fetch(GATEWAY+"/google_sheets/v4/spreadsheets/"+id+"?fields=sheets.properties",{headers:headers("GOOGLE_SHEETS_API_KEY")}),"Master spreadsheet metadata");
  const names=new Set((meta.sheets??[]).map(s=>s.properties?.title));
  const [audit,state,resolutions,timeline]=await Promise.all([
    names.has("Paid File Audit")?sheetValues(id,"'Paid File Audit'!A1:H"):Promise.resolve([] as string[][]),
    names.has("Paid File Snapshot State")?sheetValues(id,"'Paid File Snapshot State'!A1:G"):Promise.resolve([] as string[][]),
    names.has("Paid File Review Resolutions")?sheetValues(id,"'Paid File Review Resolutions'!A1:J"):Promise.resolve([] as string[][]),
    names.has("Paid File Timeline")?sheetValues(id,"'Paid File Timeline'!A1:N"):Promise.resolve([] as string[][])
  ]);
  return {audit,state,resolutions,timeline};
}
async function ensureHeaders(id:string) {
  const [audit,state,resolutions,timeline]=await Promise.all([sheetValues(id,"'Paid File Audit'!A1:H1"),sheetValues(id,"'Paid File Snapshot State'!A1:G1"),sheetValues(id,"'Paid File Review Resolutions'!A1:J1"),sheetValues(id,"'Paid File Timeline'!A1:N1")]);
  const data:{range:string;values:string[][]}[]=[];
  if(!audit.length)data.push({range:"'Paid File Audit'!A1:H1",values:[["Applied At","Paid File ID","Paid File Name","Agreement ID","New Total","Master Row","Status","Fingerprint"]]});
  if(!state.length)data.push({range:"'Paid File Snapshot State'!A1:G1",values:[["Agreement ID","Latest Sequence","Latest Cumulative Total","Paid File ID","Accepted At","Paid File Name","Snapshot Date"]]});
  else if(!(state[0]??[])[6])data.push({range:"'Paid File Snapshot State'!G1",values:[["Snapshot Date"]]});
  if(!resolutions.length)data.push({range:"'Paid File Review Resolutions'!A1:J1",values:[["Agreement ID","Review Type","Resolved Difference","Admin New Total","Paid File Total","Decision","Resolved By","Resolved At","Source Paid File","Condition Fingerprint"]]});
  else if(!(resolutions[0]??[])[9])data.push({range:"'Paid File Review Resolutions'!J1",values:[["Condition Fingerprint"]]});
  if(!timeline.length)data.push({range:"'Paid File Timeline'!A1:N1",values:[["Event At","Agreement ID","Snapshot Sequence","Paid File ID","Paid File Name","Event Type","Previous Paid Total","Observed Paid Total","DAC","ECS","Special","Status / Reason","Actor","Condition Fingerprint"]]});
  else if(!(timeline[0]??[])[13])data.push({range:"'Paid File Timeline'!M1:N1",values:[["Actor","Condition Fingerprint"]]});
  if(data.length)await json(await fetch(GATEWAY+"/google_sheets/v4/spreadsheets/"+id+"/values:batchUpdate",{method:"POST",headers:headers("GOOGLE_SHEETS_API_KEY"),body:JSON.stringify({valueInputOption:"RAW",data})}),"Initialize reconciliation headers");
}
function col(n:number) { let x=n+1,s="";while(x){const r=(x-1)%26;s=String.fromCharCode(65+r)+s;x=Math.floor((x-1)/26);}return s; }
async function conditionFingerprint(values:unknown[]) { const bytes=new TextEncoder().encode(JSON.stringify(values.map(v=>v===null||v===undefined?"":String(v).trim()))); const digest=await crypto.subtle.digest("SHA-256",bytes); return Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join(""); }
type RowPreview = {loan:string;row:number;oldTotal:number;newTotal:number;remaining:number;date:string;dac:number;ecs:number|null;special:number|null;status:string;difference?:number|undefined;conditionFingerprint?:string};
type Built = { rows:RowPreview[]; notFoundLoans:string[]; counts:{master:number;found:number;notFound:number;zeroZero:number;duplicates:number;invalid:number;pending:number;overpaid:number;manualReview:number}; writes:{range:string;values:(string|number)[][]}[]; fingerprint:string; sequence:number };
async function masterFile() {
  const title = monthTitle();
  const files = await driveList("name = '" + title.replace(/'/g,"\\'") + "' and mimeType = '" + SHEET_MIME + "'");
  if (files.length !== 1) throw new Error(files.length ? "More than one current-month Master Allocation has the exact title. Resolve the duplicate files in Drive." : "Current-month Master Allocation not found: " + title);
  return files[0]!;
}
function paidFilePrefix() { const d=dateParts(); return "Paid File " + d.month + " " + d.day + " " + d.year + " - "; }
async function assertUniquePaidSequence(file: DriveFile) {
  const escapedName = file.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const matches = await driveList("name = '" + escapedName + "' and mimeType = '" + SHEET_MIME + "'");
  if (matches.length > 1) throw new Error("Two or more Paid Files use the same sequence number. Resolve the duplicate sequence before processing.");
}
function identifyPaidFile(file: DriveFile): (DriveFile & {sequence:number}) | null {
  if (file.mimeType !== SHEET_MIME) return null;
  const d = dateParts();
  const match = file.name.match(/^Paid File\s+([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})\s+-\s+(\d{2,})$/i);
  if (!match || !adjacentTypoMonthMatches(match[1]!, d.month) || Number(match[2]) !== Number(d.day) || Number(match[3]) !== Number(d.year)) return null;
  const sequence = Number(match[4]);
  return Number.isSafeInteger(sequence) && sequence > 0 ? { ...file, sequence } : null;
}

function adjacentTypoMonthMatches(value:string, expected:string) {
  const candidate=value.toLowerCase(), target=expected.toLowerCase();
  if(candidate===target)return true;
  if(Math.abs(candidate.length-target.length)>1)return false;
  if(candidate.length===target.length) {
    let differences=0;
    for(let i=0;i<candidate.length;i++)if(candidate[i]!==target[i])differences++;
    return differences<=1;
  }
  const longer=candidate.length>target.length?candidate:target;
  const shorter=candidate.length>target.length?target:candidate;
  for(let i=0;i<longer.length;i++)if(longer.slice(0,i)+longer.slice(i+1)===shorter)return true;
  return false;
}
async function paidFiles() {
  const d=dateParts();
  const files=await driveList("name contains 'Paid File' and mimeType = '" + SHEET_MIME + "'");
  const pattern=/^Paid File\s+([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})\s+-\s+(\d{2,})$/i;
  return files.flatMap(file=>{
    const match=file.name.match(pattern);
    if(!match||!adjacentTypoMonthMatches(match[1]!,d.month)||Number(match[2])!==Number(d.day)||Number(match[3])!==Number(d.year))return [];
    const sequence=Number(match[4]);
    return Number.isSafeInteger(sequence)&&sequence>0?[{...file,sequence}]:[];
  }).sort((a,b)=>a.sequence-b.sequence);
}
async function build(masterId:string,file:DriveFile,actor?:string):Promise<Built> {
  if(file.mimeType!==SHEET_MIME) throw new Error("Paid File must be a native Google Sheet.");
  const [master,rawPaid,history]=await Promise.all([
    sheetValues(masterId,"Data!A1:GY"),
    sheetValues(file.id,"A1:ZZ"),
    readHistory(masterId)
  ]);
  const {audit,state,resolutions,timeline}=history;
  const paidResult=computePaidFileDac(rawPaid);
  const paid=paidResult.values;
  if(master.length<2||paid.length<2) throw new Error("Master Data or Paid File has no data rows.");
  const mh=master[0]!, ph=paid[0]!;
  const mi=headerIndex(mh,["Agreement ID","Loan Number","Loan No"]), pi=headerIndex(ph,["Agreement ID","Loan Number","Loan No"]);
  const mTotal=headerIndex(mh,["Original Total","Total"]), mNew=headerIndex(mh,["New Total"]), mRemain=headerIndex(mh,["Remaining"]), mDate=headerIndex(mh,["Date","Payment Date"]), mDac=headerIndex(mh,["DAC"]), mEcs=headerIndex(mh,["ECS"]), mSpecial=headerIndex(mh,["Special"]);
  const pTotal=headerIndex(ph,["Total","Paid Amount","Payment Amount","New Total"]), pDate=headerIndex(ph,["Date","Payment Date","Paid Date"]), pDac=paidResult.dacIndex, pEcs=headerIndex(ph,["ECS"]), pSpecial=headerIndex(ph,["Special"]);
  if([mi,mTotal,mNew,mRemain,mDate,mDac,pi,pTotal,pDate,pEcs].some(x=>x<0)) throw new Error("Required Agreement ID, SFDC, Online, ECS, Total and Payment Date columns in Paid File, plus Date, DAC, Total, New Total and Remaining columns in Master Data, are required. Special is optional and defaults to zero when absent.");
  const masterById=new Map<string,{row:string[];rowNo:number}>();
  for(let i=1;i<master.length;i++){const r=master[i]??[];const id=norm(r[mi]);if(id){if(masterById.has(id)) throw new Error("Duplicate loan number exists in Master Data: "+id+". Resolve it before reconciliation.");masterById.set(id,{row:r,rowNo:i+1});}}
  const paidById=new Map<string,string[][]>();
  for(let i=1;i<paid.length;i++){const r=paid[i]??[];const id=norm(r[pi]);if(id){const a=paidById.get(id)??[];a.push(r);paidById.set(id,a);}}
  const appliedLoans=new Set(audit.slice(1).filter(r=>String(r[1]??"")===file.id).map(r=>norm(r[3])));
  const seq=Number(file.name.match(/ - (\d+)$/)?.[1]??0);
  const appliedSequences=audit.slice(1).map(r=>identifyPaidFile({id:String(r[1]??""),name:String(r[2]??""),mimeType:SHEET_MIME})?.sequence??0).filter(n=>Number.isSafeInteger(n)&&n>0);
  const latestAppliedSequence=appliedSequences.length?Math.max(...appliedSequences):0;
  const previous=new Map<string,{sequence:number;amount:number}>();
  for(const r of state.slice(1)){const snapshotName=String(r[5]??"");const sameDay=String(r[6]??"")===dateKey()||(!r[6]&&snapshotName.startsWith(paidFilePrefix()));const id=norm(r[0]);const priorSeq=Number(r[1]);const amt=amount(r[2]);if(sameDay&&id&&Number.isFinite(priorSeq)&&amt!==null)previous.set(id,{sequence:priorSeq,amount:amt});}
  const preview:RowPreview[]=[]; const writes:{range:string;values:(string|number)[][]}[]=[];
  const notFoundLoans:string[]=[];
  let notFound=0,zeroZero=0,duplicates=0,invalid=0,pending=0,overpaid=0,manualReview=0,found=0;
  for(let i=1;i<paid.length;i++){const row=paid[i]??[];if(row.some(v=>String(v??"").trim()!=="")&&!norm(row[pi]))invalid++;}
  const stateWrites:(string|number)[][]=[];
  for(const [id,masterRow] of masterById){
    const matches=paidById.get(id);
    if(!matches){notFound++;notFoundLoans.push(id);continue;}
    found++;
    if(appliedLoans.has(id)){preview.push({loan:id,row:masterRow.rowNo,oldTotal:amount(masterRow.row[mTotal])??0,newTotal:0,remaining:amount(masterRow.row[mRemain])??0,date:"",dac:0,ecs:null,special:null,status:"Already applied – protected from duplicate processing"});continue;}
    if(matches.length!==1){duplicates++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:amount(masterRow.row[mTotal])??0,newTotal:0,remaining:0,date:"",dac:0,ecs:null,special:null,status:"Duplicate – manual review"});continue;}
    const p=matches[0]!;
    const total=amount(p[pTotal]), old=amount(masterRow.row[mTotal]);
    const dac=amount(p[pDac]);
    const ecs=pEcs>=0?amount(p[pEcs]):null, special=pSpecial>=0?amount(p[pSpecial]):0;
    const paidFields=[p[pTotal],p[pDac],pEcs>=0?p[pEcs]:undefined,pSpecial>=0?p[pSpecial]:undefined];
    const malformed=paidFields.some(v=>v!==undefined&&String(v??"").trim()!==""&&amount(v)===null);
    if(malformed||old===null){invalid++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old??0,newTotal:total??0,remaining:0,date:"",dac:dac??0,ecs,special,status:"Invalid – non-numeric amount or missing Master Total"});continue;}
    if(total===null||dac===null||(pEcs>=0&&ecs===null)||(pSpecial>=0&&special===null)){pending++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total??0,remaining:0,date:"",dac:dac??0,ecs,special,status:"Pending – blank payment amount"});continue;}
    const paymentDate=String(p[pDate]??"").trim();
    if(!paymentDate){pending++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining:old-total,date:"",dac,ecs,special,status:"Pending – blank payment date"});continue;}
    const prior=previous.get(id);
    const adminNewTotal=amount(masterRow.row[mNew]);
    const adminDifference=adminNewTotal!==null&&adminNewTotal>total?adminNewTotal-total:0;
    const previousEvents=timeline.slice(1).filter(event=>norm(event[1])===id);
    const lastEventType=String(previousEvents[previousEvents.length-1]?.[5]??"");
    const historyGeneration=previousEvents.filter(event=>["REAPPEARED","AMOUNT_CHANGED"].includes(String(event[5]??""))).length+(["MISSING","REVERSAL_AUTHORIZED","REVERSAL_APPROVED"].includes(lastEventType)?1:0);
    const conditionHash=await conditionFingerprint([id,old,total,dac,ecs,special,pDate>=0?p[pDate]??"":"",adminNewTotal,historyGeneration]);
    const allPaymentValuesZero=total===0&&dac===0&&ecs===0&&special===0;
    if(allPaymentValuesZero){
      zeroZero++;
      const zeroApproved=resolutions.slice(1).some(r=>norm(r[0])===id&&String(r[1]??"")==="ZERO_VALUE_REVERSAL"&&String(r[5]??"")==="AUTHORIZE_REVERSAL"&&String(r[9]??"")===conditionHash);
      if(zeroApproved){
        preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:0,remaining:old,date:"",dac,ecs,special,status:"Resolved – Admin authorized reversal",conditionFingerprint:conditionHash});
        writes.push({range:"Data!"+col(mNew)+masterRow.rowNo,values:[[0]]},{range:"Data!"+col(mRemain)+masterRow.rowNo,values:[[old]]},{range:"Data!"+col(mDac)+masterRow.rowNo,values:[[0]]});
        if(mEcs>=0)writes.push({range:"Data!"+col(mEcs)+masterRow.rowNo,values:[[0]]});
        if(mSpecial>=0)writes.push({range:"Data!"+col(mSpecial)+masterRow.rowNo,values:[[0]]});
        if(mDate>=0)writes.push({range:"Data!"+col(mDate)+masterRow.rowNo,values:[[""]]});
        stateWrites.push([id,seq,0,file.id,new Date().toISOString(),file.name,dateKey()]);
      }else{
        manualReview++;
        preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining:old-total,date:String(pDate>=0?p[pDate]??"":""),dac,ecs,special,status:"Manual Review – DAC, ECS, Special and Total are zero",conditionFingerprint:conditionHash});
      }
      continue;
    }
    const resolvedDifference=adminDifference>0&&resolutions.slice(1).some(r=>norm(r[0])===id&&String(r[1]??"")==="ADMIN_TOTAL_EXCEEDS_PAID_FILE"&&amount(r[2])===adminDifference&&String(r[5]??"")==="KEEP_ADMIN_TOTAL"&&String(r[9]??"")===conditionHash);
    if(adminDifference>0&&!resolvedDifference){
      manualReview++;
      preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining:old-adminNewTotal!,date:String(pDate>=0?p[pDate]??"":""),dac,ecs,special,difference:adminDifference,conditionFingerprint:conditionHash,status:"Manual Review – Admin New Total exceeds Paid File by "+adminDifference});
      continue;
    }
    if(prior&&seq<prior.sequence){manualReview++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining:old-total,date:String(p[pDate]??""),dac,ecs,special,status:"Stale snapshot"});continue;}
    const sameSequenceApproval=resolutions.slice(1).some(r=>norm(r[0])===id&&String(r[1]??"")==="SAME_SEQUENCE_CHANGED"&&String(r[5]??"")==="APPROVE_CORRECTION"&&String(r[9]??"")===conditionHash);
    const decreaseApproval=resolutions.slice(1).some(r=>norm(r[0])===id&&String(r[1]??"")==="PAID_AMOUNT_DECREASE"&&String(r[5]??"")==="APPROVE_CORRECTION"&&String(r[9]??"")===conditionHash);
    const overpaidApproval=resolutions.slice(1).some(r=>norm(r[0])===id&&String(r[1]??"")==="OVERPAID"&&String(r[5]??"")==="APPROVE_CORRECTION"&&String(r[9]??"")===conditionHash);
    if(prior&&seq===prior.sequence&&total!==prior.amount&&!sameSequenceApproval){manualReview++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining:old-total,date:String(p[pDate]??""),dac,ecs,special,status:"Same sequence changed – manual review",conditionFingerprint:conditionHash});continue;}
    if(prior&&seq>prior.sequence&&total<prior.amount&&!decreaseApproval){manualReview++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:total,remaining:old-total,date:String(p[pDate]??""),dac,ecs,special,status:"Amount decreased – correction review",conditionFingerprint:conditionHash});continue;}
    const date=paymentDate;
    const retainedNewTotal=resolvedDifference&&adminNewTotal!==null?adminNewTotal:total;
    const remaining=old-retainedNewTotal;
    if(remaining<0){overpaid++;if(!overpaidApproval){manualReview++;preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:retainedNewTotal,remaining,date,dac,ecs,special,status:"Manual Review – Overpaid",conditionFingerprint:conditionHash});continue;}}
    const status=resolvedDifference?"Resolved – Admin New Total preserved":sameSequenceApproval||decreaseApproval||overpaidApproval?"Resolved – Admin approved correction":"Ready";
    preview.push({loan:id,row:masterRow.rowNo,oldTotal:old,newTotal:retainedNewTotal,remaining,date,dac,ecs,special,status,difference:resolvedDifference?adminDifference:undefined,conditionFingerprint:conditionHash});
    if(date)writes.push({range:"Data!"+col(mDate)+masterRow.rowNo,values:[[date]]});
    writes.push({range:"Data!"+col(mDac)+masterRow.rowNo,values:[[dac]]},{range:"Data!"+col(mRemain)+masterRow.rowNo,values:[[remaining]]});
    if(!resolvedDifference)writes.push({range:"Data!"+col(mNew)+masterRow.rowNo,values:[[total]]});
    if(mEcs>=0&&ecs!==null)writes.push({range:"Data!"+col(mEcs)+masterRow.rowNo,values:[[ecs]]});
    if(mSpecial>=0&&special!==null)writes.push({range:"Data!"+col(mSpecial)+masterRow.rowNo,values:[[special]]});
    stateWrites.push([id,seq,total,file.id,new Date().toISOString(),file.name,dateKey()]);
  }
  const alreadyRecorded=new Set(timeline.slice(1).filter(r=>String(r[3]??"")===file.id).map(r=>norm(r[1])));
  const latestEvent=new Map<string,string>();
  for(const event of timeline.slice(1)){const loan=norm(event[1]);if(loan)latestEvent.set(loan,String(event[5]??""));}
  const timelineRows:(string|number)[][]=[];
  for(const [loan,prior] of previous){
    if(paidById.has(loan)||latestEvent.get(loan)==="MISSING"||prior.amount<=0)continue;
    const masterRow=masterById.get(loan);
    if(!masterRow)continue;
    const oldTotal=amount(masterRow.row[mTotal])??0;
    const conditionHash=await conditionFingerprint([loan,prior.amount,file.id,seq,"MISSING"]);
    const reversalApproved=resolutions.slice(1).some(r=>norm(r[0])===loan&&String(r[1]??"")==="MISSING_LOAN"&&String(r[5]??"")==="AUTHORIZE_REVERSAL"&&String(r[9]??"")===conditionHash);
    const missingRow:RowPreview={loan,row:masterRow.rowNo,oldTotal,newTotal:reversalApproved?0:prior.amount,remaining:reversalApproved?oldTotal:oldTotal-prior.amount,date:"",dac:0,ecs:0,special:0,status:reversalApproved?"Resolved – Admin authorized reversal":"Manual Review – Missing from Paid File; previous values held",conditionFingerprint:conditionHash};
    preview.push(missingRow);
    if(!notFoundLoans.includes(loan)){notFoundLoans.push(loan);notFound++;}
    if(reversalApproved){
      writes.push({range:"Data!"+col(mNew)+masterRow.rowNo,values:[[0]]},{range:"Data!"+col(mRemain)+masterRow.rowNo,values:[[oldTotal]]},{range:"Data!"+col(mDac)+masterRow.rowNo,values:[[0]]});
      if(mEcs>=0)writes.push({range:"Data!"+col(mEcs)+masterRow.rowNo,values:[[0]]});
      if(mSpecial>=0)writes.push({range:"Data!"+col(mSpecial)+masterRow.rowNo,values:[[0]]});
      if(mDate>=0)writes.push({range:"Data!"+col(mDate)+masterRow.rowNo,values:[[""]]});
      stateWrites.push([loan,seq,0,file.id,new Date().toISOString(),file.name,dateKey()]);
    }else manualReview++;
    if(actor&&!alreadyRecorded.has(loan))timelineRows.push([new Date().toISOString(),loan,seq,file.id,file.name,reversalApproved?"REVERSAL_APPROVED":"MISSING",prior.amount,reversalApproved?0:"","","","",""+missingRow.status,actor,conditionHash]);
  }
  if(actor){
    for(const row of preview){
      const loan=norm(row.loan);
      if(alreadyRecorded.has(loan)||!paidById.has(loan))continue;
      const prior=previous.get(loan);
      const matches=paidById.get(loan)??[];
      const paidRow=matches.length===1?matches[0]:undefined;
      const observed=paidRow?amount(paidRow[pTotal]):null;
      const eventType=row.status==="Resolved – Admin authorized reversal"?"REVERSAL_APPROVED":["MISSING","REVERSAL_AUTHORIZED","REVERSAL_APPROVED"].includes(latestEvent.get(loan)??"")?"REAPPEARED":prior&&observed!==null&&observed!==prior.amount?"AMOUNT_CHANGED":"PRESENT";
      timelineRows.push([new Date().toISOString(),row.loan,seq,file.id,file.name,eventType,prior?.amount??"",observed??"",paidRow?amount(paidRow[pDac])??"": "",paidRow&&pEcs>=0?amount(paidRow[pEcs])??"": "",paidRow&&pSpecial>=0?amount(paidRow[pSpecial])??"": "",row.status,actor,row.conditionFingerprint??""]);
    }
    if(timelineRows.length)writes.push({range:"'Paid File Timeline'!A"+(Math.max(timeline.length,1)+1)+":N"+(Math.max(timeline.length,1)+timelineRows.length),values:timelineRows});
  }
  if(latestAppliedSequence>seq){
    manualReview++;
    for(const row of preview) row.status="Stale snapshot – newer sequence already applied";
    writes.length=0;
    stateWrites.length=0;
  }
  const ready=preview.filter(r=>["Ready","Resolved – Admin New Total preserved","Resolved – Admin authorized reversal","Resolved – Admin approved correction"].includes(r.status));
  const counts={master:masterById.size,found,notFound,zeroZero,duplicates,invalid,pending,overpaid,manualReview};
  const digest=JSON.stringify([file.id,file.version??"",file.modifiedTime??"",paid,master,audit.slice(1),state.slice(1),resolutions.slice(1),timeline.slice(1)]);
  const fingerprint=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(digest)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const auditRows=ready.map(r=>[new Date().toISOString(),file.id,file.name,r.loan,r.newTotal,r.row,r.status,fingerprint]);
  const auditWrite=auditRows.length?{range:"'Paid File Audit'!A"+(Math.max(audit.length,1)+1)+":H"+(Math.max(audit.length,1)+auditRows.length),values:auditRows}:null;
  const stateWrite=stateWrites.length?{range:"'Paid File Snapshot State'!A"+(Math.max(state.length,1)+1)+":G"+(Math.max(state.length,1)+stateWrites.length),values:stateWrites}:null;
  return {rows:preview,notFoundLoans,counts,writes:[...writes,...(auditWrite?[auditWrite]:[]),...(stateWrite?[stateWrite]:[])],fingerprint,sequence:seq};
}
export const getMasterAllocationReconciliation = createServerFn({method:"GET"}).handler(async()=>{
  await requireSession("Admin");
  const master=await masterFile(), files=await paidFiles();
  return {master:{id:master.id,name:master.name,url:master.webViewLink??("https://docs.google.com/spreadsheets/d/"+master.id+"/edit")},files:files.map(f=>({id:f.id,name:f.name,sequence:f.sequence,modifiedTime:f.modifiedTime??"",url:f.webViewLink??("https://docs.google.com/spreadsheets/d/"+f.id+"/edit")}))};
});
export const previewMasterAllocationReconciliation = createServerFn({method:"POST"})
.inputValidator((v:unknown)=>z.object({fileId:z.string().regex(/^[A-Za-z0-9_-]{15,120}$/),masterId:z.string().regex(/^[A-Za-z0-9_-]{15,120}$/)}).parse(v))
.handler(async({data})=>{
  await requireSession("Admin");
  const [master, rawFile]=await Promise.all([driveGet(data.masterId),driveGet(data.fileId)]);
  if(master.mimeType!==SHEET_MIME||master.name!==monthTitle())throw new Error("Selected Master Allocation is no longer the current-month Google Sheet.");
  const file=identifyPaidFile(rawFile);
  if(!file)throw new Error("Selected file is not a current-day Paid File Google Sheet.");
  await assertUniquePaidSequence(file);
  const result=await build(master.id,file);
  return {masterId:master.id,file:{id:file.id,name:file.name,sequence:file.sequence},rows:result.rows,notFoundLoans:result.notFoundLoans,counts:result.counts,fingerprint:result.fingerprint,sequence:result.sequence};
});
async function applyBuiltReconciliation(masterId:string,file:DriveFile,result:Built,actor:string) {
  const eligible=result.rows.filter(r=>["Ready","Resolved – Admin New Total preserved","Resolved – Admin authorized reversal","Resolved – Admin approved correction"].includes(r.status));
  if(!result.writes.length)return {ok:true as const,applied:0,counts:result.counts,appliedBy:actor};

  const res=await fetch(GATEWAY+"/google_sheets/v4/spreadsheets/"+encodeURIComponent(masterId)+"/values:batchUpdate",{method:"POST",headers:headers("GOOGLE_SHEETS_API_KEY"),body:JSON.stringify({valueInputOption:"USER_ENTERED",data:result.writes})});
  await json(res,"Reconciliation write-back");
  return {ok:true as const,applied:eligible.length,counts:result.counts,appliedBy:actor,fileId:file.id};
}

export const applyMasterAllocationReconciliation = createServerFn({method:"POST"})
.inputValidator((v:unknown)=>z.object({fileId:z.string().regex(/^[A-Za-z0-9_-]{15,120}$/),masterId:z.string().regex(/^[A-Za-z0-9_-]{15,120}$/),fingerprint:z.string().length(64),confirm:z.literal(true)}).parse(v))
.handler(async({data})=>{
  const session=await requireSession("Admin");
  const [master, rawFile]=await Promise.all([driveGet(data.masterId),driveGet(data.fileId)]);
  if(master.mimeType!==SHEET_MIME||master.name!==monthTitle())throw new Error("Selected Master Allocation is no longer the current-month Google Sheet.");
  const file=identifyPaidFile(rawFile);
  if(!file)throw new Error("Selected file is no longer a current-day Paid File Google Sheet.");
  await assertUniquePaidSequence(file);
  await ensureTabs(master.id,["Paid File Audit","Paid File Snapshot State","Paid File Review Resolutions","Paid File Timeline"]);
  await ensureHeaders(master.id);
  const result=await build(master.id,file,session.name);
  if(result.fingerprint!==data.fingerprint)throw new Error("Master Allocation, Paid File, or reconciliation history changed after preview. Refresh preview and approve the new version.");
  return applyBuiltReconciliation(master.id,file,result,session.name);
});

export const resolveMasterAllocationReview = createServerFn({method:"POST"})
.inputValidator((v:unknown)=>z.object({fileId:z.string().regex(/^[A-Za-z0-9_-]{15,120}$/),masterId:z.string().regex(/^[A-Za-z0-9_-]{15,120}$/),loan:z.string().min(1),decision:z.enum(["KEEP_ADMIN_TOTAL","AUTHORIZE_REVERSAL","APPROVE_CORRECTION"])}).parse(v))
.handler(async({data})=>{
  const session=await requireSession("Admin");
  const [master,rawFile]=await Promise.all([driveGet(data.masterId),driveGet(data.fileId)]);
  if(master.mimeType!==SHEET_MIME||master.name!==monthTitle())throw new Error("Selected Master Allocation is no longer the current-month Google Sheet.");
  const file=identifyPaidFile(rawFile);
  if(!file)throw new Error("Selected Paid File is no longer available as a current-day Google Sheet.");
  await ensureTabs(master.id,["Paid File Audit","Paid File Snapshot State","Paid File Review Resolutions","Paid File Timeline"]);
  await ensureHeaders(master.id);
  const result=await build(master.id,file);
  const row=result.rows.find(r=>norm(r.loan)===norm(data.loan));
  let reviewType="",resolvedDifference=0;
  if(data.decision==="KEEP_ADMIN_TOTAL"){
    if(!row||!row.status.startsWith("Manual Review – Admin New Total exceeds Paid File by ")||!row.difference)throw new Error("This loan no longer has the expected positive difference. Refresh the preview.");
    reviewType="ADMIN_TOTAL_EXCEEDS_PAID_FILE";resolvedDifference=row.difference;
  }else if(data.decision==="AUTHORIZE_REVERSAL"){
    if(!row||!row.conditionFingerprint)throw new Error("This loan no longer has an eligible reversal review. Refresh the preview.");
    if(row.status.startsWith("Manual Review – Missing from Paid File"))reviewType="MISSING_LOAN";
    else if(row.status==="Manual Review – DAC, ECS, Special and Total are zero")reviewType="ZERO_VALUE_REVERSAL";
    else throw new Error("This loan is no longer eligible for reversal approval.");
    resolvedDifference=row.newTotal;
  }else{
    if(!row||!row.conditionFingerprint)throw new Error("This correction review is no longer available. Refresh the preview.");
    if(row.status.startsWith("Amount decreased"))reviewType="PAID_AMOUNT_DECREASE";
    else if(row.status.startsWith("Same sequence changed"))reviewType="SAME_SEQUENCE_CHANGED";
    else if(row.status.startsWith("Manual Review – Overpaid"))reviewType="OVERPAID";
    else throw new Error("This loan no longer has an approvable correction review.");
    resolvedDifference=row.difference??0;
  }
  if(data.decision==="AUTHORIZE_REVERSAL"){
    const states=await sheetValues(master.id,"'Paid File Snapshot State'!A1:G");
    const previousState=[...states.slice(1)].reverse().find(r=>norm(r[0])===norm(row.loan));
    resolvedDifference=amount(previousState?.[2])??resolvedDifference;
  }
  const values=await sheetValues(master.id,"'Paid File Review Resolutions'!A1:J");
  const already=values.slice(1).some(r=>norm(r[0])===norm(row.loan)&&String(r[1]??"")===reviewType&&String(r[5]??"")===data.decision&&String(r[9]??"")===row.conditionFingerprint);
  if(already)return {ok:true,alreadyResolved:true,loan:row.loan};
  const next=Math.max(values.length,1)+1;
  const now=new Date().toISOString();
  const adminTotal=data.decision==="AUTHORIZE_REVERSAL"?0:row.newTotal+(row.difference??0);
  const decisionRow=[row.loan,reviewType,resolvedDifference,adminTotal,row.newTotal,data.decision,session.name,now,file.name,row.conditionFingerprint??""];
  const timelineValues=await sheetValues(master.id,"'Paid File Timeline'!A1:N");
  const timelineRow=[now,row.loan,file.sequence,file.id,file.name,data.decision==="AUTHORIZE_REVERSAL"?"REVERSAL_AUTHORIZED":data.decision==="APPROVE_CORRECTION"?"CORRECTION_APPROVED":"ADMIN_REVIEW_RESOLVED",data.decision==="AUTHORIZE_REVERSAL"?resolvedDifference:data.decision==="APPROVE_CORRECTION"?row.newTotal:adminTotal,data.decision==="AUTHORIZE_REVERSAL"?0:row.newTotal,"","","",data.decision,session.name,row.conditionFingerprint??""];
  await json(await fetch(GATEWAY+"/google_sheets/v4/spreadsheets/"+master.id+"/values:batchUpdate",{method:"POST",headers:headers("GOOGLE_SHEETS_API_KEY"),body:JSON.stringify({valueInputOption:"RAW",data:[
    {range:"'Paid File Review Resolutions'!A"+next+":J"+next,values:[decisionRow]},
    {range:"'Paid File Timeline'!A"+(Math.max(timelineValues.length,1)+1)+":N"+(Math.max(timelineValues.length,1)+1),values:[timelineRow]}
  ]})}),"Save Admin review decision");
  return {ok:true,alreadyResolved:false,loan:row.loan,decision:data.decision,difference:row.difference??0};
});


const uploadSchema = z.object({
  fileName:z.string().trim().min(1).max(180),
  sourceMimeType:z.enum(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel","application/vnd.ms-excel.sheet.binary.macroEnabled.12","text/csv","application/csv"]),
  sourceBase64:z.string().min(1).max(22_000_000),
  normalizedCsvBase64:z.string().min(1).max(22_000_000),
  sequence:z.number().int().min(1).max(9999),
});
export const uploadPaidFileSnapshot = createServerFn({method:"POST"})
.inputValidator((v:unknown)=>uploadSchema.parse(v))
.handler(async({data})=>{
  const session=await requireSession("Admin");
  const extension=data.fileName.toLowerCase().split(".").pop()??"";
  const expectedMime:Record<string,string>={xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",xls:"application/vnd.ms-excel",xlsb:"application/vnd.ms-excel.sheet.binary.macroEnabled.12",csv:"text/csv"};
  if(expectedMime[extension]!==data.sourceMimeType)throw new Error("File extension and source file type do not match.");
  const sourceBytes=Buffer.from(data.sourceBase64,"base64");
  const submittedCsvBytes=Buffer.from(data.normalizedCsvBase64,"base64");
  if(!sourceBytes.length||sourceBytes.length>15*1024*1024)throw new Error("Original Paid File must be between 1 byte and 15 MB.");
  if(!submittedCsvBytes.length||submittedCsvBytes.length>15*1024*1024)throw new Error("Converted Paid File data must be between 1 byte and 15 MB.");
  // Re-derive the normalized sheet on the server from the archived source bytes.
  // Never trust a client-supplied CSV that could differ from the original file.
  let workbook:XLSX.WorkBook;
  try {
    workbook=XLSX.read(new Uint8Array(sourceBytes),{type:"array",cellDates:true});
  } catch {
    throw new Error("Original Paid File could not be parsed. Check that the file is a valid XLSX, XLS, XLSB or CSV.");
  }
  const firstSheet=workbook.SheetNames[0];
  const worksheet=firstSheet?workbook.Sheets[firstSheet]:undefined;
  if(!worksheet)throw new Error("Paid File में कोई worksheet नहीं मिली।");
  const canonicalCsv=XLSX.utils.sheet_to_csv(worksheet);
  if(!canonicalCsv.trim())throw new Error("Paid File की पहली worksheet खाली है।");
  const csvBytes=Buffer.from(canonicalCsv,"utf8");
  if(!csvBytes.length||csvBytes.length>15*1024*1024)throw new Error("Converted Paid File data must be between 1 byte and 15 MB.");
  if(!csvBytes.equals(submittedCsvBytes))throw new Error("Uploaded conversion does not match the original Paid File. Please retry the upload.");
  const files=await paidFiles();
  if(files.some(f=>f.sequence===data.sequence))throw new Error("This snapshot sequence already exists. Select a different sequence number.");
  const prefix=paidFilePrefix(), sequence=String(data.sequence).padStart(2,"0");
  const originalName=prefix+sequence+" - original."+extension;
  const sourceBoundary="mahaPaidSource"+crypto.randomUUID().replace(/-/g,"");
  const sourceMetadata=JSON.stringify({name:originalName,mimeType:data.sourceMimeType});
  const sourceBody=new Blob([
    "--"+sourceBoundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+sourceMetadata+"\r\n",
    "--"+sourceBoundary+"\r\nContent-Type: "+data.sourceMimeType+"\r\n\r\n",
    new Uint8Array(sourceBytes),
    "\r\n--"+sourceBoundary+"--"
  ]);
  const sourceRes=await fetch(GATEWAY+"/google_drive/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType",{method:"POST",headers:{...headers("GOOGLE_DRIVE_API_KEY"),"Content-Type":"multipart/related; boundary="+sourceBoundary},body:sourceBody,signal:AbortSignal.timeout(60000)});
  const source=await json<{id:string;name:string;mimeType:string}>(sourceRes,"Original Paid File archive");
  const sheetName=prefix+sequence;
  const boundary="mahaPaidSheet"+crypto.randomUUID().replace(/-/g,"");
  const metadata=JSON.stringify({name:sheetName,mimeType:SHEET_MIME,description:"Immutable converted snapshot. Original source file: "+source.id+" ("+data.fileName+"). DAC is computed in memory as SFDC + Online; this sheet is not modified during reconciliation."});
  const body=new Blob([
    "--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+metadata+"\r\n",
    "--"+boundary+"\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n",
    new Uint8Array(csvBytes),
    "\r\n--"+boundary+"--"
  ]);
  const res=await fetch(GATEWAY+"/google_drive/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,modifiedTime,version",{method:"POST",headers:{...headers("GOOGLE_DRIVE_API_KEY"),"Content-Type":"multipart/related; boundary="+boundary},body,signal:AbortSignal.timeout(60000)});
  const uploaded=await json<DriveFile>(res,"Paid File CSV conversion to Google Sheets");
  if(uploaded.mimeType!==SHEET_MIME)throw new Error("Google Drive did not convert the normalized CSV into a native Google Sheet. Original source was archived as "+source.id+".");
  const master=await masterFile();
  await ensureTabs(master.id,["Paid File Audit","Paid File Snapshot State","Paid File Review Resolutions","Paid File Timeline"]);
  await ensureHeaders(master.id);
  const result=await build(master.id,uploaded,session.name);
  const applied=await applyBuiltReconciliation(master.id,uploaded,result,session.name);
  return {ok:true as const,id:uploaded.id,name:uploaded.name,url:uploaded.webViewLink??("https://docs.google.com/spreadsheets/d/"+uploaded.id+"/edit"),sourceFileId:source.id,sourceFileName:source.name,preview:{masterId:master.id,file:{id:uploaded.id,name:uploaded.name,sequence:data.sequence},rows:result.rows,notFoundLoans:result.notFoundLoans,counts:result.counts,fingerprint:result.fingerprint,sequence:result.sequence,autoApplied:applied.applied>0},applied};
});
