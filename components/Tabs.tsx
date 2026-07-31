"use client";

import { useState } from "react";

export default function Tabs({ tabs }: { tabs: { label: string; badge?: string; content: React.ReactNode }[] }) {
  const [i, setI] = useState(0);
  return (
    <div>
      <div className="scroll-x" style={{ display: "flex", gap: 2, borderBottom: "1px solid #e2e8f0", marginBottom: 18 }}>
        {tabs.map((t, idx) => (
          <button type="button" key={idx} onClick={() => setI(idx)}
            style={{
              border: "none", background: "transparent", padding: "10px 14px 12px", cursor: "pointer",
              fontSize: "0.875rem", fontWeight: 700, whiteSpace: "nowrap",
              color: idx === i ? "#2563eb" : "#5c6675",
              borderBottom: idx === i ? "3px solid #2563eb" : "3px solid transparent", marginBottom: -1,
            }}>
            {t.label}{t.badge ? <span style={{ color: "#9aa3b2", fontWeight: 600 }}> · {t.badge}</span> : ""}
          </button>
        ))}
      </div>
      <div>{tabs[i]?.content}</div>
    </div>
  );
}
