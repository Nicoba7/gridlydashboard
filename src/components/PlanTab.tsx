import { useState } from "react";
import TomorrowForecast from "../pages/TomorrowForecast";
import { AGILE_RATES } from "../data/agileRates";
import { SANDBOX } from "../data/sandbox";
import { buildGridlyPlan } from "../lib/gridlyPlan";

type Device = {
  id: string;
  name: string;
  status: string;
  monthlyValue: number;
  icon: any;
  color: string;
  historyColor: string;
};

function getCurrentSlotIndex() {
  const now = new Date();
  return Math.min(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30), 47);
}

function getBarColor(p: number) {
  if (p < 10) return "#22C55E";
  if (p < 20) return "#F59E0B";
  if (p < 30) return "#F97316";
  return "#EF4444";
}

export default function PlanTab({ connectedDevices }: { connectedDevices: Device[] }) {
  const currentSlot = getCurrentSlotIndex();
  const maxPence = Math.max(...AGILE_RATES.map(r => r.pence));
  const minPence = Math.min(...AGILE_RATES.map(r => r.pence));
  const [hovered, setHovered] = useState<number | null>(null);

  const connectedDeviceIds = connectedDevices.map(d => d.id) as ("solar" | "battery" | "ev" | "grid")[];
  const { plan, summary } = buildGridlyPlan(
    AGILE_RATES,
    connectedDeviceIds,
    SANDBOX.solarForecast.kwh
  );
  const projectedValue = (summary.projectedEarnings + summary.projectedSavings).toFixed(2);

  return (
    <div style={{ padding: "44px 0 0" }}>
      <div style={{ padding: "0 24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginBottom: 2 }}>Tonight's plan</div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>Already sorted — nothing you need to do</div>
      </div>

      <div style={{ margin: "0 20px 16px", background: "#0D1F14", border: "1px solid #16A34A30", borderRadius: 16, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, color: "#9CA3AF" }}>Projected value tonight</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#22C55E" }}>+£{projectedValue}</div>
      </div>

      <div style={{ margin: "0 20px" }}>
        <TomorrowForecast />
      </div>

      <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1 }}>PRICES TODAY</div>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>
            Now: <span style={{ color: getBarColor(AGILE_RATES[currentSlot].pence), fontWeight: 700 }}>{AGILE_RATES[currentSlot].pence}p</span>
          </div>
        </div>

        {hovered !== null && (
          <div style={{ fontSize: 11, color: "#F9FAFB", background: "#1F2937", borderRadius: 6, padding: "3px 8px", display: "inline-block", marginBottom: 6 }}>
            {AGILE_RATES[hovered].time} · <span style={{ color: getBarColor(AGILE_RATES[hovered].pence), fontWeight: 700 }}>{AGILE_RATES[hovered].pence}p</span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 72 }}>
          {AGILE_RATES.map((r, i) => (
            <div
              key={i}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "pointer" }}
            >
              <div
                style={{
                  width: "100%",
                  height: Math.max(2, (r.pence / maxPence) * 72),
                  background: r.pence === minPence ? "#22C55E" : i === currentSlot ? "#fff" : getBarColor(r.pence),
                  opacity: hovered !== null && hovered !== i ? 0.3 : 1,
                  borderRadius: "2px 2px 0 0",
                  transition: "opacity 0.1s"
                }}
              />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", marginTop: 4 }}>
          {AGILE_RATES.map((r, i) => (
            <div key={i} style={{ flex: 1, fontSize: 8, textAlign: "center", color: i === currentSlot ? "#fff" : "#374151" }}>
              {i % 4 === 0 ? r.time.split(":")[0] : ""}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "#4B5563" }}>
          <span>🟢 Cheapest: <span style={{ color: "#22C55E", fontWeight: 700 }}>{minPence}p</span></span>
          <span>🔴 Peak: <span style={{ color: "#EF4444", fontWeight: 700 }}>{maxPence}p</span></span>
        </div>
      </div>

      <div style={{ margin: "0 20px" }}>
        <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 12 }}>GRIDLY'S SCHEDULE</div>
        {plan
          .filter(slot => slot.requires.length === 0 || slot.requires.some(r => connectedDevices.some(d => d.id === r)))
          .map((slot, i, arr) => {
            const isLast = i === arr.length - 1;
            return (
              <div key={i} style={{ display: "flex", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 36, flexShrink: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: `${slot.color}15`, border: `1.5px solid ${slot.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
                    {slot.action === "CHARGE" ? "⚡" : slot.action === "EXPORT" ? "💰" : slot.action === "SOLAR" ? "☀️" : "⏸"}
                  </div>
                  {!isLast && <div style={{ width: 1.5, flex: 1, background: "#1F2937", minHeight: 20 }} />}
                </div>

                <div style={{ flex: 1, paddingBottom: isLast ? 0 : 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB", marginBottom: 2 }}>{slot.title}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: slot.color, flexShrink: 0, marginLeft: 8 }}>{slot.price}p</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 2 }}>{slot.reason}</div>
                  <div style={{ fontSize: 10, color: "#374151" }}>{slot.time}</div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
