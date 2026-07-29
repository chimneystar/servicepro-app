"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { flushJobOutbox, queueJobAction, readOutbox } from "@/lib/offline-outbox";

export type TechJob = { id: string; service: string; status: string; scheduled_date: string; start_time: string | null; end_time: string | null; job_address: string | null; job_city: string | null; customers: { name: string; phone: string; address: string | null; city: string | null } | null };

function vapidBytes(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export default function TechnicianWorkspace({ locale, jobs, vapidPublicKey }: { locale: Locale; jobs: TechJob[]; vapidPublicKey: string }) {
  const he = locale === "he";
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [queued, setQueued] = useState(() => typeof window === "undefined" ? 0 : readOutbox().length);
  const [sharingLocation, setSharingLocation] = useState(false);
  const locationWatch = useRef<number | null>(null); const lastLocationSent = useRef(0);
  const today = new Date().toISOString().slice(0, 10);
  const todayJobs = useMemo(() => jobs.filter((job) => job.scheduled_date === today), [jobs, today]);
  const laterJobs = useMemo(() => jobs.filter((job) => job.scheduled_date !== today), [jobs, today]);
  useEffect(() => {
    const refresh = async () => { setOnline(navigator.onLine); if (navigator.onLine) { const result = await flushJobOutbox(); setQueued(result.pending); if (result.sent) { setNotice(he ? `${result.sent} עדכונים סונכרנו.` : `${result.sent} updates synced.`); location.reload(); } } };
    refresh(); window.addEventListener("online", refresh); window.addEventListener("offline", refresh);
    try { localStorage.setItem("servicepro:tech-snapshot", JSON.stringify({ savedAt: new Date().toISOString(), jobs })); } catch {}
    return () => { window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); if (locationWatch.current !== null) navigator.geolocation.clearWatch(locationWatch.current); };
  }, [jobs, he]);

  async function enableNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setNotice(he ? "המכשיר הזה לא תומך בהתראות." : "This device does not support push notifications.");
    if (!vapidPublicKey) return setNotice(he ? "ההתראות מוכנות באפליקציה וממתינות למפתח השליחה של העסק." : "Push is installed and waiting for the business delivery key.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setNotice(he ? "ההתראות לא הופעלו. אפשר לשנות זאת בהגדרות המכשיר." : "Notifications were not enabled. You can change this in device settings.");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(vapidPublicKey) });
    const payload = subscription.toJSON();
    const response = await fetch("/api/devices/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, deviceName: navigator.userAgent, locale }) });
    setNotice(response.ok ? (he ? "ההתראות הופעלו במכשיר הזה." : "Notifications are on for this device.") : (he ? "לא הצלחנו לשמור את ההתראות." : "We couldn't save notification access."));
  }

  async function changeStatus(jobId: string, action: "start" | "complete") {
    setQueued(queueJobAction(jobId,action));
    if (navigator.onLine) { const result = await flushJobOutbox(); setQueued(result.pending); setNotice(result.sent ? (he ? "העבודה עודכנה." : "Job updated.") : (he ? "השינוי נשמר ויישלח כשהחיבור יחזור." : "Change saved and will send when you're back online.")); if (result.sent) location.reload(); }
    else setNotice(he ? "השינוי נשמר במכשיר ויישלח כשהחיבור יחזור." : "Change saved on this device and will send when you're back online.");
  }

  async function toggleLocation() {
    if (sharingLocation) { if (locationWatch.current !== null) navigator.geolocation.clearWatch(locationWatch.current); locationWatch.current = null; setSharingLocation(false); await fetch("/api/devices/location",{ method:"DELETE" }); setNotice(he ? "שיתוף המיקום הופסק." : "Location sharing is off."); return; }
    if (!("geolocation" in navigator)) { setNotice(he ? "המכשיר הזה לא תומך בשיתוף מיקום." : "This device cannot share location."); return; }
    locationWatch.current = navigator.geolocation.watchPosition(async (position) => { const now=Date.now(); if (now-lastLocationSent.current<60000) return; lastLocationSent.current=now; const response=await fetch("/api/devices/location",{ method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy }) }); if (response.ok) { setSharingLocation(true); setNotice(he ? "המיקום משותף כל עוד יום העבודה פתוח." : "Location is shared while My workday stays open."); } },() => setNotice(he ? "לא התקבלה הרשאה לשיתוף מיקום." : "Location permission was not granted."),{ enableHighAccuracy:true,maximumAge:30000,timeout:15000 });
  }

  const list = (rows: TechJob[]) => <div className="tech-job-list">{rows.map((job, index) => {
    const customer = job.customers;
    const address = [job.job_address || customer?.address, job.job_city || customer?.city].filter(Boolean).join(", ");
    return <article className="tech-job-card" key={job.id}><Link href={`/jobs/${job.id}`}><span className="tech-stop">{index + 1}</span><div><small>{(job.start_time ?? "").slice(0, 5)}{job.end_time ? `–${job.end_time.slice(0, 5)}` : ""}</small><strong>{job.service}</strong><p>{customer?.name || (he ? "לקוח" : "Customer")}{address ? ` · ${address}` : ""}</p></div><span className="tech-open">›</span></Link><footer><button type="button" onClick={() => changeStatus(job.id,"start")}>{he ? "התחלת עבודה" : "Start job"}</button><button type="button" onClick={() => changeStatus(job.id,"complete")}>{he ? "סיום עבודה" : "Complete"}</button></footer></article>;
  })}</div>;

  return <div className="tech-workspace">
    <header className="tech-hero"><div><span>{he ? "יום העבודה שלי" : "My workday"}</span><h1>{todayJobs.length ? (he ? `${todayJobs.length} עבודות להיום` : `${todayJobs.length} jobs today`) : (he ? "אין עבודות להיום" : "No jobs today")}</h1><p>{online ? (he ? "מחובר ומעודכן" : "Online and up to date") : (he ? "אין חיבור · השינויים ימתינו לסנכרון" : "Offline · changes will wait to sync")}</p></div><i className={online ? "online" : "offline"}>{online ? "●" : "○"}</i></header>
    <div className="tech-quick-actions"><Link href="/route">{he ? "המסלול שלי" : "My route"}</Link><button type="button" onClick={enableNotifications}>{he ? "התראות" : "Notifications"}</button><button type="button" className={sharingLocation ? "location-on" : ""} onClick={toggleLocation}>{sharingLocation ? (he ? "הפסקת מיקום" : "Stop location") : (he ? "שיתוף מיקום" : "Share location")}</button></div>
    {(notice || queued > 0) && <div className="tech-notice" role="status">{notice || `${queued} ${he ? "עדכונים ממתינים לסנכרון" : "updates waiting to sync"}`}</div>}
    <section><h2>{he ? "היום" : "Today"}</h2>{todayJobs.length ? list(todayJobs) : <div className="tech-empty">{he ? "כשתשובץ עבודה היא תופיע כאן." : "Assigned jobs will appear here."}</div>}</section>
    {laterJobs.length > 0 && <section><h2>{he ? "בהמשך" : "Coming up"}</h2>{list(laterJobs)}</section>}
  </div>;
}
