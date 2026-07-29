"use client";

import { useState, useTransition } from "react";
import type { Locale } from "@/lib/i18n";
import { importMigrationCustomers, rollbackMigration, type MigrationCustomer } from "@/app/(app)/migration/actions";

type Source = "workiz" | "housecall_pro" | "spreadsheet";
type Batch = { id: string; source: Source; filename: string | null; status: string; counts_json: Record<string,number> | null; created_at: string; completed_at: string | null };

function csvRows(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index++) { const char = text[index]; const next = text[index + 1]; if (char === '"' && quoted && next === '"') { cell += '"'; index++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") index++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; } else cell += char; }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); return rows;
}
const aliases: Record<keyof MigrationCustomer,string[]> = { externalId: ["id","customer id","customer_id","client id"], name: ["name","customer name","customer","full name","full_name"], phone: ["phone","phone number","mobile"], email: ["email","email address"], address: ["address","street","service address"], city: ["city","service city"], notes: ["notes","customer notes","history"] };

function parseCustomers(text: string): MigrationCustomer[] {
  const data = csvRows(text); if (data.length < 2) return [];
  const headers = data[0].map((value) => value.toLowerCase().replace(/^\ufeff/, ""));
  const indexFor = (key: keyof MigrationCustomer) => headers.findIndex((header) => aliases[key].includes(header));
  return data.slice(1).map((cells) => ({ externalId: cells[indexFor("externalId")] || undefined, name: cells[indexFor("name")] || "", phone: cells[indexFor("phone")] || "", email: cells[indexFor("email")] || "", address: cells[indexFor("address")] || "", city: cells[indexFor("city")] || "", notes: cells[indexFor("notes")] || "" })).filter((row) => row.name);
}

export default function MigrationCenter({ locale, batches, canRollback }: { locale: Locale; batches: Batch[]; canRollback: boolean }) {
  const he = locale === "he"; const [source,setSource] = useState<Source>("workiz"); const [filename,setFilename] = useState(""); const [rows,setRows] = useState<MigrationCustomer[]>([]); const [notice,setNotice] = useState<string | null>(null); const [pending,start] = useTransition();
  function choose(file?: File) { if (!file) return; setFilename(file.name); const reader = new FileReader(); reader.onload = () => { const parsed = parseCustomers(String(reader.result ?? "")); setRows(parsed); setNotice(parsed.length ? null : (he ? "לא מצאנו עמודת שם לקוח בקובץ." : "We couldn't find a customer-name column.")); }; reader.readAsText(file); }
  function run() { start(async () => { const result = await importMigrationCustomers(source, filename, rows); setNotice(result.ok ? (he ? `יובאו ${result.imported} לקוחות בבטחה.` : `Safely imported ${result.imported} customers.`) : (he ? "הייבוא נעצר בלי לשנות את הנתונים הקיימים." : "Import stopped without changing existing data.")); if (result.ok) setRows([]); }); }
  function rollback(id: string) { start(async () => { const result = await rollbackMigration(id); setNotice(result.ok ? (he ? "הייבוא הועבר לארכיון וניתן לבצע אותו מחדש." : "The import was rolled back and can be run again.") : (he ? "לא ניתן לבטל את הייבוא הזה." : "This import could not be rolled back.")); }); }
  return <div className="migration-page">
    <header className="migration-hero"><span>{he ? "מעבר בטוח ל-ServicePro" : "Safe move to ServicePro"}</span><h1>{he ? "מביאים את הלקוחות מהמערכת הקודמת" : "Bring customers from your previous system"}</h1><p>{he ? "מעלים קובץ CSV, בודקים תצוגה מקדימה, ורק אז מייבאים. כל ייבוא מתועד וניתן לביטול." : "Upload a CSV, review the preview, then import. Every batch is tracked and reversible."}</p></header>
    <section className="migration-flow"><div className="migration-steps"><b className="on">1</b><span>{he ? "מקור" : "Source"}</span><b className={filename ? "on" : ""}>2</b><span>{he ? "קובץ" : "File"}</span><b className={rows.length ? "on" : ""}>3</b><span>{he ? "בדיקה וייבוא" : "Review & import"}</span></div><div className="migration-source-grid">{(["workiz","housecall_pro","spreadsheet"] as Source[]).map((item) => <button type="button" className={source === item ? "active" : ""} onClick={() => setSource(item)} key={item}>{item === "housecall_pro" ? "Housecall Pro" : item === "workiz" ? "Workiz" : (he ? "גיליון נתונים" : "Spreadsheet")}</button>)}</div><label className="migration-file"><input type="file" accept=".csv,text/csv" onChange={(event) => choose(event.target.files?.[0])} /><strong>{filename || (he ? "בחירת קובץ CSV" : "Choose a CSV file")}</strong><small>{he ? "הקובץ נשאר במכשיר עד שתאשרו את הייבוא." : "The file stays on this device until you approve the import."}</small></label>{rows.length > 0 && <><div className="migration-preview"><header><strong>{he ? "תצוגה מקדימה" : "Preview"}</strong><b>{rows.length} {he ? "לקוחות תקינים" : "valid customers"}</b></header>{rows.slice(0,6).map((row,index) => <div key={`${row.name}-${index}`}><strong>{row.name}</strong><span>{[row.phone,row.email,row.city].filter(Boolean).join(" · ")}</span></div>)}</div><button className="migration-import" disabled={pending} onClick={run}>{pending ? (he ? "מייבאים…" : "Importing…") : (he ? `ייבוא ${rows.length} לקוחות` : `Import ${rows.length} customers`)}</button></>}{notice && <p className="migration-notice" role="status">{notice}</p>}</section>
    <section className="migration-history"><h2>{he ? "היסטוריית ייבוא" : "Import history"}</h2>{batches.length ? batches.map((batch) => <article key={batch.id}><div><strong>{batch.source === "housecall_pro" ? "Housecall Pro" : batch.source === "workiz" ? "Workiz" : (he ? "גיליון נתונים" : "Spreadsheet")}</strong><small>{batch.filename || "CSV"} · {new Intl.DateTimeFormat(he ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(batch.created_at))}</small></div><span>{batch.counts_json?.imported ?? 0} {he ? "יובאו" : "imported"}</span><b className={`migration-status ${batch.status}`}>{batch.status.replaceAll("_", " ")}</b>{canRollback && batch.status === "completed" && <button type="button" disabled={pending} onClick={() => rollback(batch.id)}>{he ? "ביטול הייבוא" : "Roll back"}</button>}</article>) : <div className="tech-empty">{he ? "עוד לא בוצע ייבוא." : "No imports yet."}</div>}</section>
  </div>;
}
