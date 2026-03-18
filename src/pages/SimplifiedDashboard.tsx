import HistoryTab from "../components/HistoryTab";
import HomeTab from "../components/HomeTab";
import PlanTab from "../components/PlanTab";
import { SANDBOX } from "../data/sandbox";
import { useState, useEffect, useMemo } from "react";
import { Sun, Battery, Zap, Grid3X3, Home, Calendar, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { AGILE_RATES, type AgileRate } from "../data/agileRates";

export { SANDBOX };

// ── DEVICE CONFIG ─────────────────────────────────────────────────────────
export const ALL_DEVICES = [
  { id: "solar",   name: "Solar Inverter", status: "2.8kW generating", monthlyValue: 35, icon: Sun,      color: "#F59E0B", historyColor: "#F59E0B" },
  { id: "battery", name: "Home Battery",   status: "62% charged",      monthlyValue: 32, icon: Battery,  color: "#22C55E", historyColor: "#22C55E" },
  { id: "ev",      name: "EV Charger",     status: "Connected",        monthlyValue: 26, icon: Zap,      color: "#38BDF8", historyColor: "#38BDF8" },
  { id: "grid",    name: "Smart Meter",    status: "Live pricing",     monthlyValue: 15, icon: Grid3X3,  color: "#A78BFA", historyColor: "#A78BFA" },
];

export type DeviceConfig = (typeof ALL_DEVICES)[number];

export { AGILE_RATES };
export type { AgileRate };

// ── INTELLIGENCE ENGINE ───────────────────────────────────────────────────
export function getCurrentSlotIndex() {
  const now = new Date();
  return Math.min(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30), 47);
}

export function getBestChargeSlot() {
  return AGILE_RATES.reduce(
    (min, r, i) => r.pence < min.price ? { index: i, price: r.pence, time: r.time } : min,
    { index: 0, price: AGILE_RATES[0].pence, time: AGILE_RATES[0].time }
  );
}

function calculateSavings() {
  const peak = 38.6, charge = 4.8, batterySize = 10;
  return ((peak - charge) / 100 * batterySize).toFixed(2);
}

// EV planner — finds cheapest slots to hit target % by ready-by time
function calcEVPlan(targetPct: number, readyByHour: number, currentPct = 20) {
  const kwhNeeded = ((targetPct - currentPct) / 100) * 60;
  const kwhPerSlot = 3.7; // 7.4kW charger × 0.5hr
  const slotsNeeded = Math.max(1, Math.ceil(kwhNeeded / kwhPerSlot));
  const currentSlot = getCurrentSlotIndex();
  const readyBySlot = readyByHour * 2;

  const candidates = AGILE_RATES
    .map((r, i) => ({ ...r, i }))
    .filter(r => r.i >= currentSlot && r.i < readyBySlot)
    .sort((a, b) => a.pence - b.pence)
    .slice(0, slotsNeeded);

  const totalCost = candidates.reduce((s, r) => s + (r.pence / 100) * kwhPerSlot, 0);
  const sorted = [...candidates].sort((a, b) => a.i - b.i);
  const lastSlot = sorted[sorted.length - 1];
  const finishHour = lastSlot ? Math.floor(lastSlot.i / 2) : readyByHour;
  const finishMin = lastSlot && lastSlot.i % 2 === 1 ? "30" : "00";

  return {
    slots: candidates.map(r => r.i),
    cost: totalCost,
    finishTime: `${String(finishHour).padStart(2, "0")}:${finishMin}`,
  };
}

function getBarColor(p: number) {
  if (p < 10) return "#22C55E";
  if (p < 20) return "#F59E0B";
  if (p < 30) return "#F97316";
  return "#EF4444";
}

export const MODE_CONFIG = {
  CHARGE: {
    icon: "⚡",
    label: "CHARGING BATTERY",
    color: "#22C55E",
    bg: "#0D1F14",
    border: "#16A34A30",
  },
  EV_CHARGE: {
    icon: "🚗",
    label: "CHARGING EV",
    color: "#38BDF8",
    bg: "#0D1521",
    border: "#38BDF830",
  },
  SPLIT_CHARGE: {
    icon: "⚡🚗",
    label: "SPLIT CHARGING",
    color: "#F59E0B",
    bg: "#1A1200",
    border: "#F59E0B30",
  },
  EXPORT: {
    icon: "💰",
    label: "EXPORTING",
    color: "#F59E0B",
    bg: "#1A1200",
    border: "#F59E0B30",
  },
  SOLAR: {
    icon: "☀️",
    label: "SOLAR POWER",
    color: "#FCD34D",
    bg: "#17120A",
    border: "#F59E0B30",
  },
  HOLD: {
    icon: "⏸",
    label: "HOLDING",
    color: "#9CA3AF",
    bg: "#0D1117",
    border: "#1F2937",
  },
} as const;

// ── MANUAL OVERRIDE ───────────────────────────────────────────────────────
export function ManualOverride({ currentPence, connectedDevices }: { currentPence: number; connectedDevices: DeviceConfig[] }) {
  const [override, setOverride] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const hasBattery = connectedDevices.some(d => d.id === "battery");
  const hasEV = connectedDevices.some(d => d.id === "ev");

  const handleOverride = (action: string) => {
    setOverride(override === action ? null : action);
    setExpanded(false);
  };

  if (!hasBattery && !hasEV) return null;

  return (
    <div style={{ margin: "0 20px 16px" }}>
      {override ? (
        <div style={{ background: "#0F1724", border: "1px solid #1F3045", borderRadius: 16, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "#70829B", fontWeight: 700, letterSpacing: 0.8, marginBottom: 4 }}>MANUAL CONTROL</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
              {override === "charge_now" ? "⚡ Battery charging" : override === "charge_ev" ? "🚗 EV charging" : "⏸ Gridly paused"}
            </div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>Running at {currentPence}p.</div>
          </div>
          <button onClick={() => setOverride(null)} style={{ background: "#182235", border: "1px solid #243247", borderRadius: 999, padding: "6px 12px", color: "#AAB6C5", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
            Stop
          </button>
        </div>
      ) : !expanded ? (
        <button onClick={() => setExpanded(true)} style={{ width: "100%", background: "#09101A", border: "1px solid #172236", borderRadius: 12, padding: "10px 14px", color: "#7C8BA0", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Manual control</span>
          <span style={{ fontSize: 11, color: "#526177" }}>{currentPence}p now</span>
        </button>
      ) : (
        <div style={{ background: "#0B1120", border: "1px solid #182235", borderRadius: 16, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#70829B", fontWeight: 700, letterSpacing: 0.8 }}>TEMPORARY OVERRIDE</div>
            <div style={{ fontSize: 12, color: "#7C8BA0", fontWeight: 700 }}>{currentPence}p now</div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {hasBattery && (
              <button onClick={() => handleOverride("charge_now")} style={{ background: "#0D1717", border: "1px solid #1A2B2B", borderRadius: 10, padding: "11px 13px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#B9D7C0", marginBottom: 2 }}>⚡ Charge battery</div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>Start now.</div>
              </button>
            )}
            {hasEV && (
              <button onClick={() => handleOverride("charge_ev")} style={{ background: "#0C1520", border: "1px solid #1B2B3E", borderRadius: 10, padding: "11px 13px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#B5CBDC", marginBottom: 2 }}>🚗 Charge EV</div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>Start now.</div>
              </button>
            )}
            <button onClick={() => handleOverride("pause")} style={{ background: "#111827", border: "1px solid #1F2937", borderRadius: 10, padding: "11px 13px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#B7BDC7", marginBottom: 2 }}>⏸ Pause Gridly</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>Stop schedules.</div>
            </button>
          </div>
          <button onClick={() => setExpanded(false)} style={{ marginTop: 10, background: "none", border: "none", color: "#5A6880", fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ── EV READY-BY ───────────────────────────────────────────────────────────
export function EVReadyBy() {
  const [targetPct, setTargetPct] = useState(80);
  const [readyByHour, setReadyByHour] = useState(7);
  const [chargingPowerKw, setChargingPowerKw] = useState(7.4);
  const [maxBudget, setMaxBudget] = useState(5);
  const [expanded, setExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const plan = calcEVPlan(targetPct, readyByHour);
  const hours = [1,2,3,4,5,6,7,8,9,10,11,12];
  const overBudget = plan.cost > maxBudget;
  const adjustedPlanCost = Number((plan.cost * (7.4 / chargingPowerKw)).toFixed(2));

  return (
    <div style={{ margin: "0 20px 16px", background: "#0D141E", border: "1px solid #223247", borderRadius: 16, overflow: "hidden" }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 10, color: "#7FA3C8", fontWeight: 700, letterSpacing: 0.8, marginBottom: 3 }}>EV READY</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
            🚗 {targetPct}% by {readyByHour}:00 · <span style={{ color: overBudget ? "#F59E0B" : "#22C55E" }}>£{adjustedPlanCost.toFixed(2)}</span>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1F2937" }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700, marginBottom: 8 }}>READY BY</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {hours.map(h => (
                <button key={h} onClick={() => setReadyByHour(h)} style={{ padding: "5px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, background: readyByHour === h ? "#38BDF8" : "#1F2937", color: readyByHour === h ? "#0D1117" : "#6B7280" }}>
                  {h}am
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700 }}>CHARGE TO</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#38BDF8" }}>{targetPct}%</span>
            </div>
            <input type="range" min={20} max={100} step={10} value={targetPct} onChange={e => setTargetPct(Number(e.target.value))} style={{ width: "100%", accentColor: "#38BDF8", cursor: "pointer" }} />
          </div>
          <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>Gridly plan</div>
            <div style={{ fontSize: 13, color: "#F9FAFB", lineHeight: 1.5 }}>
              Finish by <span style={{ color: "#38BDF8", fontWeight: 700 }}>{plan.finishTime}</span>. {plan.slots.length} low-cost slots.
            </div>
          </div>
          <button
            onClick={() => setShowAdvanced((value) => !value)}
            style={{ width: "100%", background: "none", border: "1px solid #1F2937", borderRadius: 8, padding: "8px 10px", color: "#6B7280", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginBottom: 10 }}
          >
            {showAdvanced ? "Hide advanced" : "Advanced"}
          </button>

          {showAdvanced && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700 }}>POWER</span>
                  <span style={{ fontSize: 12, color: "#38BDF8", fontWeight: 700 }}>{chargingPowerKw.toFixed(1)} kW</span>
                </div>
                <input type="range" min={3.6} max={11} step={0.2} value={chargingPowerKw} onChange={e => setChargingPowerKw(Number(e.target.value))} style={{ width: "100%", accentColor: "#38BDF8", cursor: "pointer" }} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700 }}>MAX COST</span>
                  <span style={{ fontSize: 12, color: overBudget ? "#F59E0B" : "#22C55E", fontWeight: 700 }}>£{maxBudget.toFixed(2)}</span>
                </div>
                <input type="range" min={1} max={10} step={0.5} value={maxBudget} onChange={e => setMaxBudget(Number(e.target.value))} style={{ width: "100%", accentColor: overBudget ? "#F59E0B" : "#22C55E", cursor: "pointer" }} />
              </div>
            </div>
          )}
          {overBudget && (
            <div style={{ fontSize: 11, color: "#F59E0B" }}>
              Above budget. Try a later ready time.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── BATTERY RESERVE ───────────────────────────────────────────────────────
export function BatteryReserve() {
  const [reserve, setReserve] = useState(20);
  const [expanded, setExpanded] = useState(false);

  const label = reserve <= 10
    ? "Lower reserve. More savings."
    : reserve <= 20
    ? "Balanced daily setting."
    : reserve <= 40
    ? "More backup for outages."
    : "Maximum backup.";

  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1F14", border: "1px solid #16A34A20", borderRadius: 16, overflow: "hidden" }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 11, color: "#22C55E", fontWeight: 700, letterSpacing: 0.8, marginBottom: 3 }}>BATTERY RESERVE</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
            🔋 Keep <span style={{ color: "#22C55E" }}>{reserve}%</span> in reserve
          </div>
        </div>
        {expanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1F2937" }}>
          <div style={{ paddingTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700 }}>MINIMUM RESERVE</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#22C55E" }}>{reserve}%</span>
            </div>
            <input type="range" min={0} max={50} step={5} value={reserve} onChange={e => setReserve(Number(e.target.value))} style={{ width: "100%", accentColor: "#22C55E", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#374151", marginTop: 2 }}>
              <span>0%</span><span>10%</span><span>20%</span><span>30%</span><span>40%</span><span>50%</span>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>{label}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SOLAR FORECAST CARD ───────────────────────────────────────────────────
export function SolarForecastCard() {
  const f = SANDBOX.solarForecast;
  const summary = f.kwh > 15
    ? "Strong solar tomorrow."
    : f.kwh > 8
    ? "Moderate solar tomorrow."
    : "Low solar tomorrow.";
  const nextMove = f.kwh > 15
    ? "Gridly will charge less overnight."
    : f.kwh > 8
    ? "Gridly will split overnight charging."
    : "Gridly will charge overnight.";

  return (
    <div style={{ margin: "0 20px 16px", background: "#0E1622", border: "1px solid #1E2A3D", borderRadius: 16, padding: "13px 16px" }}>
      <div style={{ fontSize: 10, color: "#8B9BB2", fontWeight: 700, letterSpacing: 0.8, marginBottom: 8 }}>TOMORROW</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 900, color: "#F9FAFB", letterSpacing: -0.4 }}>{f.icon} {f.kwh} kWh</div>
          <div style={{ fontSize: 11, color: "#7B8798", marginTop: 2 }}>{f.condition}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#5F6E83", marginBottom: 4 }}>vs today</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#22C55E" }}>+{f.deltaKwh} kWh ↑</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#A9B4C4", lineHeight: 1.45 }}>
        {summary} {nextMove}
      </div>
    </div>
  );
}


// ── CROSS-DEVICE COORDINATION ─────────────────────────────────────────────
export function CrossDeviceCoordination({ connectedDevices, currentPence }: { connectedDevices: DeviceConfig[]; currentPence: number }) {
  const hasBattery = connectedDevices.some(d => d.id === "battery");
  const hasEV = connectedDevices.some(d => d.id === "ev");
  if (!hasBattery || !hasEV) return null;
  const batteryPct = SANDBOX.solar.batteryPct;
  const isCheap = currentPence < 12;
  const decision = batteryPct >= 90
    ? { icon: "🚗", title: "Charging your EV instead", reason: `Battery is already at ${batteryPct}% — spare capacity going to your car tonight.`, color: "#38BDF8", bg: "#0D1521", border: "#38BDF820" }
    : batteryPct < 30
    ? { icon: "⚡", title: "Battery first, then EV", reason: `Battery at ${batteryPct}% — Gridly fills it first, then switches to the car.`, color: "#22C55E", bg: "#0D1F14", border: "#16A34A20" }
    : { icon: "⚡🚗", title: "Splitting charge tonight", reason: `Battery at ${batteryPct}% — Gridly splits the cheap slots between battery and EV for maximum value.`, color: "#F59E0B", bg: "#1A1200", border: "#F59E0B20" };
  return (
    <div style={{ margin: "0 20px 16px", background: decision.bg, border: `1px solid ${decision.border}`, borderRadius: 16, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: decision.color, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>JOINT OPTIMISATION</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#F9FAFB", marginBottom: 4 }}>{decision.icon} {decision.title}</div>
      <div style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.5 }}>{decision.reason}</div>
      {isCheap && <div style={{ marginTop: 8, fontSize: 11, color: decision.color, fontWeight: 600 }}>Now is a good slot — {currentPence}p/kWh</div>}
    </div>
  );
}

// ── BATTERY HEALTH SCORE ──────────────────────────────────────────────────
export function BatteryHealthScore() {
  const h = SANDBOX.batteryHealth;
  const [expanded, setExpanded] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const cyclePct = Math.round((h.cyclesUsed / h.cyclesTotal) * 100);
  const healthColor = h.capacityPct >= 90 ? "#22C55E" : h.capacityPct >= 75 ? "#F59E0B" : "#EF4444";
  const healthLabel = h.capacityPct >= 90 ? "Excellent" : h.capacityPct >= 75 ? "Good" : "Degraded";
  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1C2635", borderRadius: 16, overflow: "hidden" }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 10, color: "#7F8DA3", fontWeight: 700, letterSpacing: 0.8, marginBottom: 3 }}>BATTERY HEALTH</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
            🔋 <span style={{ color: healthColor }}>{healthLabel}</span> · {h.capacityPct}% capacity · {h.projectedLifeYears} yrs left
          </div>
        </div>
        {expanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1F2937" }}>
          <div style={{ paddingTop: 14, marginBottom: 10, fontSize: 12, color: "#AEB7C4", lineHeight: 1.45 }}>
            Battery health is strong. Gridly is protecting long-term performance.
          </div>
          <button
            onClick={() => setShowDetails((value) => !value)}
            style={{ width: "100%", background: "none", border: "1px solid #1F2937", borderRadius: 8, padding: "8px 10px", color: "#6B7280", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            {showDetails ? "Hide details" : "View details"}
          </button>

          {showDetails && (
            <div style={{ marginTop: 12 }}>
              <div style={{ paddingTop: 2, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>Capacity</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: healthColor }}>{h.capacityPct}%</span>
            </div>
            <div style={{ height: 6, background: "#1F2937", borderRadius: 99 }}>
              <div style={{ height: "100%", width: `${h.capacityPct}%`, background: healthColor, borderRadius: 99 }} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>Cycles used</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#F9FAFB" }}>{h.cyclesUsed} / {h.cyclesTotal.toLocaleString()}</span>
            </div>
            <div style={{ height: 6, background: "#1F2937", borderRadius: 99 }}>
              <div style={{ height: "100%", width: `${cyclePct}%`, background: "#6B7280", borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 10, color: "#4B5563", marginTop: 4 }}>{cyclePct}% used</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "#111827", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 3 }}>Avg cycles/week</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#F9FAFB" }}>{h.weeklyChargeCycles}</div>
            </div>
            <div style={{ background: "#111827", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 3 }}>Life left</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: healthColor }}>{h.projectedLifeYears} yrs</div>
            </div>
          </div>
          <div style={{ marginTop: 10, background: "#0D1F14", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#6B7280", lineHeight: 1.45 }}>
            Gridly protects battery life by avoiding unnecessary cycling.
          </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TARIFF SWITCHER ───────────────────────────────────────────────────────
export function TariffSwitcher({ connectedDevices }: { connectedDevices: DeviceConfig[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasEV = connectedDevices.some(d => d.id === "ev");
  const hasBattery = connectedDevices.some(d => d.id === "battery");

  const tariffs = SANDBOX.tariffs;
  const current = tariffs.find(t => t.current) ?? tariffs[0];
  const relevant = tariffs.filter(t => {
    if (t.id === "go" && !hasEV) return false;
    if (t.id === "flux" && !hasBattery) return false;
    return true;
  });

  if (relevant.length === 0) {
    return null;
  }

  const best = relevant.reduce((a, b) => (b.annualSaving > a.annualSaving ? b : a), relevant[0]);
  const uplift = current ? best.annualSaving - current.annualSaving : 0;

  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1C2635", borderRadius: 16, overflow: "hidden" }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 10, color: "#8F82C8", fontWeight: 700, letterSpacing: 0.8, marginBottom: 3 }}>TARIFF</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
            {uplift > 0
              ? <span>Save about <span style={{ color: "#22C55E" }}>+£{uplift}/yr</span></span>
              : <span>Current tariff is optimal</span>
            }
          </div>
        </div>
        {expanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1F2937" }}>
          <div style={{ paddingTop: 14, fontSize: 12, color: "#AEB7C4", lineHeight: 1.45 }}>
            {uplift > 0
              ? `${best.name} looks better for your home. Gridly estimates +£${uplift} each year.`
              : `${current.name} already fits your home well.`}
          </div>
          <div style={{ marginTop: 12, background: "#111827", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 2 }}>Annual estimate</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: uplift > 0 ? "#22C55E" : "#F9FAFB" }}>
                £{best.annualSaving}/yr
              </div>
            </div>
            <a href="https://octopus.energy/tariffs/" target="_blank" rel="noreferrer" style={{ background: "#1F2937", border: "1px solid #374151", borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#D1D5DB", textDecoration: "none" }}>
              Review tariff
            </a>
          </div>
        </div>
      )}
    </div>
  );
}


// ── CARBON TRACKER ────────────────────────────────────────────────────────
export function CarbonTracker({ connectedDevices }: { connectedDevices: DeviceConfig[] }) {
  const hasEV = connectedDevices.some(d => d.id === "ev");
  if (!hasEV) return null;
  const slotIdx = getCurrentSlotIndex();
  const current = SANDBOX.carbonIntensity[slotIdx];
  const min = Math.min(...SANDBOX.carbonIntensity);
  const max = Math.max(...SANDBOX.carbonIntensity);
  const pct = Math.round(((current - min) / (max - min)) * 100);
  const isGreen = current < 160;
  const color = current < 160 ? "#22C55E" : current < 190 ? "#F59E0B" : "#EF4444";
  const label = current < 160 ? "Very clean — great time to charge" : current < 190 ? "Moderate — Gridly will wait if possible" : "Dirty grid — Gridly avoiding where it can";
  const todaySessions = SANDBOX.chargeSessions.filter(s => s.date === "Today");
  const totalCarbonKg = todaySessions.reduce((s, c) => s + c.carbonG, 0) / 1000;

  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: `1px solid ${color}20`, borderRadius: 16, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>GRID CARBON</div>
      <div style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.5, marginBottom: 10 }}>
        Live grid cleanliness, so you can decide whether to charge now or let Gridly wait for a cleaner window.
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#F9FAFB", letterSpacing: -0.5 }}>
            <span style={{ color }}>{current}</span> <span style={{ fontSize: 13, fontWeight: 500, color: "#6B7280" }}>gCO₂/kWh</span>
          </div>
          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{label}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 2 }}>charged today</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#9CA3AF" }}>{totalCarbonKg.toFixed(1)} kg CO₂</div>
        </div>
      </div>
      <div style={{ height: 4, background: "#1F2937", borderRadius: 99 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: "width 0.3s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#374151", marginTop: 3 }}>
        <span>Cleanest: {min}g</span><span>Dirtiest: {max}g</span>
      </div>
    </div>
  );
}

// ── DEVICE HEALTH ALERTS ──────────────────────────────────────────────────
const DEVICE_FIX: Record<string, string> = {
  ev:      "Try unplugging your charger from the wall and plugging it back in.",
  battery: "Check the battery unit has power and your internet is working.",
  solar:   "Check your inverter has power and your internet is working.",
  grid:    "Check your smart meter is plugged in and your internet is working.",
};

export function DeviceHealthAlerts({ connectedDevices }: { connectedDevices: DeviceConfig[] }) {
  const alerts = connectedDevices.filter(d => {
    const h = (SANDBOX.deviceHealth as any)[d.id];
    return h && !h.ok;
  });
  if (alerts.length === 0) return null;
  return (
    <div style={{ margin: "0 20px 16px" }}>
      {alerts.map(device => {
        const h = (SANDBOX.deviceHealth as any)[device.id];
        const hrs = Math.floor(h.lastSeen / 60);
        const mins = h.lastSeen % 60;
        const ago = hrs > 0 ? `${hrs}h ${mins}m ago` : `${mins}m ago`;
        const fix = DEVICE_FIX[device.id] ?? "Check the device has power and your internet is working.";
        return (
          <div key={device.id} style={{ background: "#16140F", border: "1px solid #F59E0B24", borderRadius: 14, padding: "11px 14px", marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ fontSize: 16, flexShrink: 0 }}>⚠️</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#FCD34D", marginBottom: 3, letterSpacing: 0.2 }}>
                {device.name} offline · {ago}
              </div>
              <div style={{ fontSize: 11, color: "#C6D0DF", marginBottom: 3, lineHeight: 1.45 }}>
                {fix}
              </div>
              <div style={{ fontSize: 10, color: "#738197" }}>
                Gridly is paused for this device until it reconnects.
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── NIGHTLY REPORT CARD ───────────────────────────────────────────────────
export function NightlyReportCard() {
  const summaryLine = "Battery and EV charged in low-cost windows.";
  const nextLine = "Gridly prepared your home for today.";

  return (
    <div style={{ margin: "0 20px 16px", background: "#0E1724", border: "1px solid #1D2B40", borderRadius: 16, padding: "12px 16px" }}>
      <div style={{ fontSize: 10, color: "#7A8CA8", fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>LAST NIGHT</div>
      <div style={{ fontSize: 12, color: "#D3DCE8", lineHeight: 1.45 }}>{summaryLine}</div>
      <div style={{ fontSize: 12, color: "#A9B4C4", lineHeight: 1.45, marginTop: 2 }}>{nextLine}</div>
    </div>
  );
}

// ── CHARGE SESSION HISTORY ────────────────────────────────────────────────
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
        <button onClick={() => {
          const csv = [
            "Date,Start,End,kWh,Cost (£),Avg (p/kWh),Carbon (gCO2)",
            ...sessions.map(s =>
              `${s.date},${s.startTime},${s.endTime},${s.kwh},${s.cost},${s.avgPence},${s.carbonG}`
            )
          ].join("\n");
      
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = "gridly-sessions.csv"; a.click();
        }} style={{ background: "#1F2937", border: "none", borderRadius: 8, padding: "5px 10px", color: "#9CA3AF", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
          Export CSV
        </button>
      </div>
      <div>
        {shown.map((s, i) => (
          <div key={i} style={{ padding: "10px 16px", borderBottom: i < shown.length - 1 ? "1px solid #111827" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#F9FAFB", marginBottom: 2 }}>{s.date} · {s.startTime}–{s.endTime}</div>
              <div style={{ fontSize: 10, color: "#4B5563" }}>{s.kwh} kWh · avg {s.avgPence}p · {(s.carbonG/1000).toFixed(1)} kg CO₂</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#38BDF8" }}>£{s.cost}</div>
          </div>
        ))}
      </div>
      {sessions.length > 3 && (
        <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", background: "none", border: "none", borderTop: "1px solid #111827", padding: "10px", color: "#4B5563", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          {expanded ? "Show less" : `Show all ${sessions.length} sessions`}
        </button>
      )}
    </div>
  );
}

// ── BOOST BUTTON ──────────────────────────────────────────────────────────
// Prominent single-tap charge now — replaces buried manual override for EV
export function BoostButton({ connectedDevices, currentPence }: { connectedDevices: DeviceConfig[]; currentPence: number }) {
  const hasEV = connectedDevices.some(d => d.id === "ev");
  const [boosting, setBoosting] = useState(false);
  if (!hasEV) return null;

  return (
    <div style={{ margin: "0 20px 16px" }}>
      {boosting ? (
        <div style={{ background: "#0D1521", border: "1px solid #38BDF840", borderRadius: 14, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#38BDF8", marginBottom: 2 }}>🚗 Boost charging — {currentPence}p/kWh</div>
            <div style={{ fontSize: 11, color: "#6B7280" }}>Charging at full speed regardless of price</div>
          </div>
          <button onClick={() => setBoosting(false)} style={{ background: "#374151", border: "none", borderRadius: 8, padding: "5px 10px", color: "#9CA3AF", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Stop</button>
        </div>
      ) : (
        <button onClick={() => setBoosting(true)} style={{ width: "100%", background: "#0D1521", border: "2px solid #38BDF830", borderRadius: 14, padding: "13px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#38BDF8", marginBottom: 2 }}>⚡ Boost charge EV now</div>
            <div style={{ fontSize: 11, color: "#6B7280" }}>Override schedule — charge at full speed</div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#38BDF8" }}>{currentPence}p</div>
        </button>
      )}
    </div>
  );
}

// ── CHARGER LOCK ──────────────────────────────────────────────────────────
export function ChargerLock({ connectedDevices }: { connectedDevices: DeviceConfig[] }) {
  const hasEV = connectedDevices.some(d => d.id === "ev");
  const [locked, setLocked] = useState(false);
  if (!hasEV) return null;

  return (
    <div style={{ margin: "0 20px 16px" }}>
      <button
        onClick={() => setLocked(l => !l)}
        style={{
          width: "100%",
          background: "#0B1120",
          border: `1px solid ${locked ? "#3A2427" : "#182235"}`,
          borderRadius: 14,
          padding: "12px 16px",
          cursor: "pointer",
          fontFamily: "inherit",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#D7DEE8", marginBottom: 2 }}>
            Charger access
          </div>
          <div style={{ fontSize: 11, color: locked ? "#C48E94" : "#6B7280" }}>
            {locked ? "Gridly only" : "Ready to charge"}
          </div>
        </div>

        <div
          style={{
            width: 36,
            height: 20,
            background: locked ? "#7F1D1D" : "#2B3648",
            borderRadius: 99,
            position: "relative",
            flexShrink: 0,
            transition: "background 0.2s"
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 2,
              left: locked ? 18 : 2,
              width: 16,
              height: 16,
              background: "#F9FAFB",
              borderRadius: "50%",
              transition: "left 0.2s"
            }}
          />
        </div>
      </button>
    </div>
  );
}

// ── HOME TAB ──────────────────────────────────────────────────────────────


// ── MAIN ──────────────────────────────────────────────────────────────────
export default function SimplifiedDashboard() {
  const [tab, setTab] = useState<"home" | "plan" | "history">("home");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => {
      setNow(prev => {
        const n = new Date();
        if (n.getMinutes() !== prev.getMinutes()) return n;
        return prev;
      });
    }, 10000);
    return () => clearInterval(t);
  }, []);

  const selectedIds = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("devices")?.split(",").filter(Boolean) || ["solar", "battery"];
  }, []);

  const connectedDevices = ALL_DEVICES.filter(d => selectedIds.includes(d.id));

  const tabs = [
    { id: "home",    label: "Home",    icon: Home },
    { id: "plan",    label: "Plan",    icon: Calendar },
    { id: "history", label: "History", icon: Clock },
  ] as const;

  return (
    <div style={{ background: "#030712", minHeight: "100vh", color: "#F9FAFB", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto", maxWidth: 480, margin: "0 auto", paddingBottom: 80 }}>
      {/* Latest cycle heartbeat should eventually come from a shared runtime/journal source.
          Until that source exists, Home remains stable with this input omitted. */}
      {tab === "home"    && <HomeTab connectedDevices={connectedDevices} now={now} />}
      {tab === "plan"    && <PlanTab connectedDevices={connectedDevices} now={now} />}
      {tab === "history" && <HistoryTab connectedDevices={connectedDevices} now={now} />}

      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#030712", borderTop: "1px solid #111827", padding: "10px 0 20px", display: "flex", justifyContent: "space-around" }}>
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: "4px 24px" }}>
              <Icon size={22} color={active ? "#22C55E" : "#374151"} />
              <span style={{ fontSize: 10, fontWeight: 700, color: active ? "#22C55E" : "#374151", letterSpacing: 0.5 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
