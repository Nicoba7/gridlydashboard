import { useState } from "react";

// ── SANDBOX DATA (swap for real API later) ────────────────────────────────
const HISTORY = [
  { day: "Mon", saved: 2.14, earned: 0.63, cost: -1.20 },
  { day: "Tue", saved: 3.42, earned: 1.21, cost: -0.52 },
  { day: "Wed", saved: 1.87, earned: 0.44, cost: 0.18 },
  { day: "Thu", saved: 4.11, earned: 1.84, cost: -1.94 },
  { day: "Fri", saved: 2.93, earned: 0.97, cost: -0.41 },
  { day: "Sat", saved: 5.24, earned: 2.31, cost: -2.87 },
  { day: "Sun", saved: 3.76, earned: 1.52, cost: -0.89 },
];

const TOTALS = {
  saved: HISTORY.reduce((s, d) => s + d.saved, 0).toFixed(2),
  earned: HISTORY.reduce((s, d) => s + d.earned, 0).toFixed(2),
  net: Math.abs(HISTORY.reduce((s, d) => s + d.cost, 0)).toFixed(2),
  negativeDays: HISTORY.filter(d => d.cost < 0).length,
};

type View = "saved" | "earned" | "cost";

export default function SavingsHistory() {
  const [view, setView] = useState<View>("saved");

  const values = HISTORY.map(d =>
    view === "saved" ? d.saved : view === "earned" ? d.earned : Math.abs(d.cost)
  );
  const maxVal = Math.max(...values);

  const viewConfig = {
    saved: { color: "#22C55E", label: "Saved", prefix: "£", totalLabel: "Total saved", total: TOTALS.saved },
    earned: { color: "#F59E0B", label: "Earned", prefix: "£", totalLabel: "Total earned", total: TOTALS.earned },
    cost: { color: "#60A5FA", label: "Net", prefix: "£", totalLabel: "Net benefit", total: TOTALS.net },
  };

  const cfg = viewConfig[view];

  return (
    <div style={{ background: "#0D1117", border: "1px solid #1F2937", borderRadius: 12, padding: "16px", marginBottom: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", letterSpacing: 1, marginBottom: 4 }}>LAST 7 DAYS</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: cfg.color, letterSpacing: -0.5 }}>
            £{cfg.total}
            <span style={{ fontSize: 12, fontWeight: 500, color: "#6B7280", marginLeft: 6 }}>{cfg.totalLabel}</span>
          </div>
        </div>
        {view === "cost" && (
          <div style={{ background: "#16A34A15", border: "1px solid #16A34A30", borderRadius: 8, padding: "6px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#22C55E" }}>{TOTALS.negativeDays}/7</div>
            <div style={{ fontSize: 9, color: "#6B7280" }}>days free</div>
          </div>
        )}
      </div>

      {/* Toggle */}
      <div style={{ display: "flex", background: "#111827", borderRadius: 8, padding: 3, marginBottom: 16, gap: 2 }}>
        {(["saved", "earned", "cost"] as View[]).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            flex: 1, padding: "6px 0", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit",
            background: view === v ? viewConfig[v].color : "transparent",
            color: view === v ? "#111827" : "#6B7280",
            fontSize: 11, fontWeight: 700, transition: "all 0.15s ease",
          }}>
            {viewConfig[v].label}
          </button>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 80, marginBottom: 8 }}>
        {HISTORY.map((d, i) => {
          const val = values[i];
          const height = maxVal > 0 ? Math.max(4, (val / maxVal) * 80) : 4;
          const isToday = i === HISTORY.length - 1;
          const isNegativeDay = view === "cost" && d.cost < 0;

          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 4 }}>
              {/* Value on hover effect — always show for today */}
              {isToday && (
                <div style={{ fontSize: 9, color: cfg.color, fontWeight: 700 }}>£{val.toFixed(2)}</div>
              )}
              <div style={{
                width: "100%", height,
                background: isToday ? cfg.color : `${cfg.color}50`,
                borderRadius: "3px 3px 0 0",
                position: "relative",
                transition: "height 0.3s ease",
              }}>
                {isNegativeDay && !isToday && (
                  <div style={{ position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)", fontSize: 8, color: "#22C55E" }}>✓</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* X axis */}
      <div style={{ display: "flex", gap: 6 }}>
        {HISTORY.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: i === HISTORY.length - 1 ? "#F9FAFB" : "#4B5563", fontWeight: i === HISTORY.length - 1 ? 700 : 400 }}>
            {i === HISTORY.length - 1 ? "Today" : d.day}
          </div>
        ))}
      </div>

      {/* Week summary */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #1F2937", display: "flex", justifyContent: "space-between" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#22C55E" }}>£{TOTALS.saved}</div>
          <div style={{ fontSize: 9, color: "#6B7280" }}>saved</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#F59E0B" }}>£{TOTALS.earned}</div>
          <div style={{ fontSize: 9, color: "#6B7280" }}>earned</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#60A5FA" }}>£{TOTALS.net}</div>
          <div style={{ fontSize: 9, color: "#6B7280" }}>net benefit</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#A78BFA" }}>{TOTALS.negativeDays}</div>
          <div style={{ fontSize: 9, color: "#6B7280" }}>free days</div>
        </div>
      </div>
    </div>
  );
}
