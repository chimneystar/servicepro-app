// Lightweight, dependency-free SVG charts. Server-renderable (no hooks).

export function Donut({
  segments,
  size = 128,
  thickness = 18,
  centerTop,
  centerSub,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerSub?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2,
    cy = size / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef2f8" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((s, i) => {
            const frac = Math.max(0, s.value) / total;
            const dash = frac * C;
            const el = (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
              />
            );
            offset += dash;
            return el;
          })}
      </svg>
      {(centerTop || centerSub) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {centerTop && <div style={{ fontSize: "1.0625rem", fontWeight: 800 }}>{centerTop}</div>}
          {centerSub && (
            <div style={{ fontSize: "0.875rem", color: "#5c6675", fontWeight: 600 }}>
              {centerSub}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Bars({
  data,
  color = "#2563eb",
  height = 120,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height, paddingTop: 6 }}>
      {data.map((d, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
          }}
        >
          <div style={{ width: "100%", display: "flex", alignItems: "flex-end", height: "100%" }}>
            <div
              title={String(d.value)}
              style={{
                width: "100%",
                height: `${Math.max(3, (d.value / max) * 100)}%`,
                background: `linear-gradient(180deg, ${color}, ${color}bb)`,
                borderRadius: "7px 7px 3px 3px",
                transition: "height .3s ease",
              }}
            />
          </div>
          <div
            style={{
              fontSize: "0.875rem",
              color: "#5c6675",
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%",
            }}
          >
            {d.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem" }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{ width: 11, height: 11, borderRadius: 3, background: it.color, flexShrink: 0 }}
          />
          <span style={{ color: "#5c6675", flex: 1 }}>{it.label}</span>
          {it.value && <b>{it.value}</b>}
        </div>
      ))}
    </div>
  );
}
