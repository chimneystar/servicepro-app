"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addReview } from "@/app/(app)/customers/[id]/actions";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export default function ReviewForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const { pending, error, run } = useActionStatus();

  function submit() {
    // The form used to reset on failure, discarding what the customer said.
    run(() => addReview(customerId, rating, body), () => { setBody(""); setRating(5); router.refresh(); });
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Add a review</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`} style={{ background: "none", border: "none", fontSize: 26, cursor: "pointer", color: n <= rating ? "#eab308" : "#d7dce6", lineHeight: 1 }}>★</button>
        ))}
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Optional note" aria-label="Optional note" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", outline: "none", marginBottom: 10 }} />
      <button type="button" onClick={submit} disabled={pending} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>{pending ? "…" : "Save review"}</button>
      <ActionError error={error} />
    </div>
  );
}
