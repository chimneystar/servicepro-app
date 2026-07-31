"use client";

import { useState } from "react";

export default function CopyLinkButton({ path, label }: { path: string; label: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  }
  return <button type="button" onClick={copy} style={{ background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 9, padding: "9px 13px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{copied ? "✓ Copied" : label}</button>;
}
