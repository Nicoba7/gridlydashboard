import { PlanTimelineViewModel } from "./planViewModels";

export default function PlanTimelineCard({ viewModel }: { viewModel: PlanTimelineViewModel }) {
  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "#93C5FD", fontWeight: 700, letterSpacing: 1.5, marginBottom: 12 }}>TONIGHT AT A GLANCE</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {viewModel.rows.map((row, index) => (
          <div key={index} style={{ display: "flex", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 36, flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: `${row.color}15`, border: `1.5px solid ${row.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
                {row.coreAction === "charge_battery"
                  ? "⚡"
                  : row.coreAction === "charge_ev"
                  ? "🚗"
                  : row.coreAction === "export"
                  ? "💰"
                  : row.coreAction === "solar_use"
                  ? "☀️"
                  : "⏸"}
              </div>
              {row.highlight && <div style={{ width: 1.5, flex: 1, background: "#1F2937", minHeight: 20 }} />}
            </div>
            <div style={{ flex: 1, paddingBottom: row.highlight ? 0 : 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB", marginBottom: 2 }}>{row.action}</div>
                  {row.modeTag && (
                    <div style={{ fontSize: 10, color: row.emphasis === "high" ? "#93C5FD" : row.emphasis === "medium" ? "#86EFAC" : "#6B7280", fontWeight: 700 }}>
                      {row.modeTag}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: row.color, flexShrink: 0, marginLeft: 8 }}>{row.value}</div>
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 2 }}>{row.reason}</div>
              <div style={{ fontSize: 10, color: "#374151" }}>{row.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
