import { useState } from "react";
import { SANDBOX, DeviceConfig } from "../pages/SimplifiedDashboard";


function ChargeSessionHistory() {
  const [expanded, setExpanded] = useState(false);
  const sessions = SANDBOX.chargeSessions;
  const shown = expanded ? sessions : sessions.slice(0, 3);
  const totalKwh = sessions.reduce((s, c) => s + c.kwh, 0).toFixed(0);
  const totalCost = sessions.reduce((s, c) => s + c.cost, 0).toFixed(2);

  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #1F2937", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: "#38BDF8", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>CHARGE SESSIONS</div>
          <div style={{ fontSize: 13, color: "#9CA3AF" }}>{totalKwh} kWh · £{totalCost} last 10 sessions</div>
        </div>
        <button
          onClick={() => {
            const csv = [
              "Date,Start,End,kWh,Cost (£),Avg (p/kWh),Carbon (gCO2)",
              ...sessions.map(
                s => `${s.date},${s.startTime},${s.endTime},${s.kwh},${s.cost},${s.avgPence},${s.carbonG}`
              )
            ].join("\n");

            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "gridly-sessions.csv";
            a.click();
          }}
          style={{ background: "#1F2937", border: "none", borderRadius: 8, padding: "5px 10px", color: "#9CA3AF", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
        >
          Export CSV
        </button>
      </div>

      <div>
        {shown.map((s, i) => (
          <div key={i} style={{ padding: "10px 16px", borderBottom: i < shown.length - 1 ? "1px solid #111827" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#F9FAFB", marginBottom: 2 }}>
                {s.date} · {s.startTime}–{s.endTime}
              </div>
              <div style={{ fontSize: 10, color: "#4B5563" }}>
                {s.kwh} kWh · avg {s.avgPence}p · {(s.carbonG / 1000).toFixed(1)} kg CO₂
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#38BDF8" }}>£{s.cost}</div>
          </div>
        ))}
      </div>

      {sessions.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ width: "100%", background: "none", border: "none", borderTop: "1px solid #111827", padding: "10px", color: "#4B5563", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          {expanded ? "Show less" : `Show all ${sessions.length} sessions`}
        </button>
      )}
    </div>
  );
}

export default function HistoryTab({
  connectedDevices,
}: {
  connectedDevices: DeviceConfig[];
}) {
  const [activeDevice, setActiveDevice] = useState<string>("all");

  const values = SANDBOX.history.map(d => {
    if (activeDevice === "all") return d.solar + d.battery + d.ev + d.grid;
    return (d as any)[activeDevice] ?? 0;
  });

  const maxVal = Math.max(...values);
  const weekTotal = values.reduce((s, v) => s + v, 0).toFixed(2);

  const activeColor =
    activeDevice === "all"
      ? "#22C55E"
      : connectedDevices.find(d => d.id === activeDevice)?.historyColor ?? "#22C55E";

  const deviceTotals = connectedDevices.map(device => ({
    ...device,
    total: SANDBOX.history
      .reduce((s, d) => s + ((d as any)[device.id] ?? 0), 0)
      .toFixed(2),
  }));

  return (
    <div style={{ padding: "44px 0 0" }}>
      <div style={{ padding: "0 24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginBottom: 2 }}>
          Your savings
        </div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>
          Every penny Gridly has made you
        </div>
      </div>

      <div style={{ margin: "0 20px 16px" }}>
        <ChargeSessionHistory />
      </div>

      <div style={{ margin: "0 20px 16px", background: "linear-gradient(135deg, #0a0a0a, #111827)", border: "1px solid #1F2937", borderRadius: 20, padding: "24px", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#4B5563", letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>
          ALL TIME
        </div>
        <div style={{ fontSize: 52, fontWeight: 900, color: "#22C55E", letterSpacing: -3, lineHeight: 1 }}>
          +£{SANDBOX.allTime}
        </div>
        <div style={{ fontSize: 12, color: "#4B5563", marginTop: 8 }}>
          since {SANDBOX.allTimeSince}
        </div>
      </div>

      <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
              THIS WEEK
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: activeColor }}>
              £{weekTotal}
              <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, marginLeft: 6 }}>
                {activeDevice === "all"
                  ? "all devices"
                  : connectedDevices.find(d => d.id === activeDevice)?.name}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveDevice("all")}
            style={{
              padding: "4px 12px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 700,
              background: activeDevice === "all" ? "#22C55E" : "#1F2937",
              color: activeDevice === "all" ? "#111827" : "#6B7280",
            }}
          >
            All
          </button>

          {connectedDevices.map(device => (
            <button
              key={device.id}
              onClick={() => setActiveDevice(device.id)}
              style={{
                padding: "4px 12px",
                borderRadius: 20,
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 700,
                background: activeDevice === device.id ? device.historyColor : "#1F2937",
                color: activeDevice === device.id ? "#111827" : "#6B7280",
              }}
            >
              {device.name.split(" ")[0]}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 72, marginBottom: 8 }}>
          {SANDBOX.history.map((d, i) => {
            const val = values[i];
            const h = Math.max(4, maxVal > 0 ? (val / maxVal) * 72 : 4);
            const isToday = i === SANDBOX.history.length - 1;

            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                {isToday && (
                  <div style={{ fontSize: 9, color: activeColor, fontWeight: 700, marginBottom: 2 }}>
                    £{val.toFixed(2)}
                  </div>
                )}
                <div
                  style={{
                    width: "100%",
                    height: h,
                    background: isToday ? activeColor : `${activeColor}40`,
                    borderRadius: "3px 3px 0 0",
                  }}
                />
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {SANDBOX.history.map((d, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 10,
                color: i === SANDBOX.history.length - 1 ? "#F9FAFB" : "#4B5563",
                fontWeight: i === SANDBOX.history.length - 1 ? 700 : 400,
              }}
            >
              {i === SANDBOX.history.length - 1 ? "Today" : d.day}
            </div>
          ))}
        </div>
      </div>

      <div style={{ margin: "0 20px" }}>
        <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
          THIS WEEK BY DEVICE
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {deviceTotals.map(device => {
            const Icon = device.icon;
            const pct = Math.round(
              (parseFloat(device.total) / parseFloat(weekTotal === "0.00" ? "1" : weekTotal)) * 100
            );

            return (
              <div key={device.id} style={{ background: "#111827", borderRadius: 12, padding: "12px 16px", border: "1px solid #1F2937" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon size={15} color={device.color} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#F9FAFB" }}>
                      {device.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: device.color }}>
                    £{device.total}
                  </div>
                </div>

                <div style={{ height: 3, background: "#1F2937", borderRadius: 2 }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: device.color,
                      borderRadius: 2,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>

                <div style={{ fontSize: 10, color: "#4B5563", marginTop: 4 }}>
                  {pct}% of total savings
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
