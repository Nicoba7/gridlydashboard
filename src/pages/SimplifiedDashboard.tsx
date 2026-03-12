import { getGridlyMode } from "../lib/gridlyEngine";
import { buildGridlyPlan } from "../lib/gridlyPlan";
import { useState, useEffect, useMemo } from "react";
import { Sun, Battery, Zap, Grid3X3, TrendingUp, Home, Calendar, Clock, ChevronDown, ChevronUp } from "lucide-react";
import TomorrowForecast from "./TomorrowForecast";

// ── DEVICE CONFIG ─────────────────────────────────────────────────────────
const ALL_DEVICES = [
  { id: "solar",   name: "Solar Inverter", status: "2.8kW generating", monthlyValue: 35, icon: Sun,      color: "#F59E0B", historyColor: "#F59E0B" },
  { id: "battery", name: "Home Battery",   status: "62% charged",      monthlyValue: 32, icon: Battery,  color: "#22C55E", historyColor: "#22C55E" },
  { id: "ev",      name: "EV Charger",     status: "Connected",        monthlyValue: 26, icon: Zap,      color: "#38BDF8", historyColor: "#38BDF8" },
  { id: "grid",    name: "Smart Meter",    status: "Live pricing",     monthlyValue: 15, icon: Grid3X3,  color: "#A78BFA", historyColor: "#A78BFA" },
];

// ── SANDBOX DATA ──────────────────────────────────────────────────────────
const SANDBOX = {
  savedToday: 3.76,
  earnedToday: 1.52,
  allTime: 713.67,
  allTimeSince: "March 2024",
  solar: { w: 2840, batteryPct: 62, gridW: 420, homeW: 1200 },
  solarForecast: { kwh: 18.4, confidence: 82, condition: "Mostly sunny", icon: "🌤️", deltaKwh: 2.1 },
  batteryHealth: { cyclesUsed: 312, cyclesTotal: 6000, capacityPct: 97, projectedLifeYears: 14.2, weeklyChargeCycles: 4.2 },
  tariffs: [
    { id: "agile",   name: "Octopus Agile",         annualSaving: 713,  current: true,  badge: "You're on this" },
    { id: "go",      name: "Intelligent Octopus Go",  annualSaving: 1041, current: false, badge: "Best for EV" },
    { id: "flux",    name: "Octopus Flux",            annualSaving: 892,  current: false, badge: "Best for battery" },
    { id: "cosy",    name: "Cosy Octopus",            annualSaving: 634,  current: false, badge: null },
  ],
  history: [
    { day: "Mon", solar: 1.24, battery: 0.98, ev: 0.63, grid: 0.18 },
    { day: "Tue", solar: 2.11, battery: 1.42, ev: 1.21, grid: 0.31 },
    { day: "Wed", solar: 0.94, battery: 0.87, ev: 0.44, grid: 0.12 },
    { day: "Thu", solar: 2.64, battery: 1.84, ev: 1.84, grid: 0.47 },
    { day: "Fri", solar: 1.52, battery: 1.21, ev: 0.97, grid: 0.22 },
    { day: "Sat", solar: 3.41, battery: 2.31, ev: 2.31, grid: 0.58 },
    { day: "Sun", solar: 2.18, battery: 1.52, ev: 1.52, grid: 0.34 },
  ],
  plan: [
    { time: "11:30pm", action: "CHARGE", title: "Charging your battery",    reason: "Cheapest rate of the night",        price: 4.8,  color: "#22C55E", requires: ["battery"] },
    { time: "2:00am",  action: "HOLD",   title: "Resting overnight",        reason: "Nothing to do — holding steady",   price: 5.1,  color: "#6B7280", requires: [] },
    { time: "8:00am",  action: "EXPORT", title: "Selling to the grid",      reason: "High price — earning for you",     price: 31.2, color: "#F59E0B", requires: ["battery", "grid"] },
    { time: "11:00am", action: "SOLAR",  title: "Solar powering your home", reason: "Free electricity from your panels",price: 9.6,  color: "#F59E0B", requires: ["solar"] },
    { time: "5:30pm",  action: "EXPORT", title: "Peak earnings window",     reason: "Best price of the day",            price: 38.6, color: "#F59E0B", requires: ["battery", "grid"] },
    { time: "8:00pm",  action: "CHARGE", title: "Topping up for tomorrow",  reason: "Price dropping — refilling now",   price: 11.8, color: "#22C55E", requires: ["battery"] },
  ],
  // Carbon intensity (gCO2/kWh) — 48 half-hour slots. Source: National Grid ESO API
  carbonIntensity: [
    210,198,187,176,165,158,152,148,144,141,139,142,
    148,156,168,182,194,203,211,218,222,219,214,208,
    201,195,188,182,176,171,167,164,162,160,159,158,
    162,168,176,184,192,198,203,206,208,207,204,200,
  ],
  // Charging sessions — last 10
  chargeSessions: [
    { date: "Today",     startTime: "03:00", endTime: "05:30", kwh: 18.5, cost: 1.42, avgPence: 7.7,  carbonG: 2868 },
    { date: "Yesterday", startTime: "02:30", endTime: "06:00", kwh: 22.1, cost: 1.89, avgPence: 8.6,  carbonG: 3271 },
    { date: "Mon",       startTime: "03:00", endTime: "05:00", kwh: 14.8, cost: 1.11, avgPence: 7.5,  carbonG: 2186 },
    { date: "Sun",       startTime: "01:30", endTime: "04:30", kwh: 22.2, cost: 1.64, avgPence: 7.4,  carbonG: 3196 },
    { date: "Sat",       startTime: "02:00", endTime: "05:00", kwh: 22.2, cost: 1.71, avgPence: 7.7,  carbonG: 3152 },
    { date: "Fri",       startTime: "03:30", endTime: "05:30", kwh: 14.8, cost: 1.32, avgPence: 8.9,  carbonG: 2149 },
    { date: "Thu",       startTime: "02:30", endTime: "05:00", kwh: 18.5, cost: 1.46, avgPence: 7.9,  carbonG: 2701 },
    { date: "Wed",       startTime: "03:00", endTime: "04:30", kwh: 11.1, cost: 0.84, avgPence: 7.6,  carbonG: 1598 },
    { date: "Tue",       startTime: "02:00", endTime: "05:30", kwh: 25.9, cost: 2.01, avgPence: 7.8,  carbonG: 3782 },
    { date: "Mon",       startTime: "03:00", endTime: "06:00", kwh: 22.2, cost: 1.71, avgPence: 7.7,  carbonG: 3219 },
  ],
  // Device health — last reported timestamps
  deviceHealth: {
    solar:   { lastSeen: 2,   ok: true  },   // minutes ago
    battery: { lastSeen: 2,   ok: true  },
    ev:      { lastSeen: 847, ok: false },   // 14hrs ago — simulate Lynne's problem
    grid:    { lastSeen: 4,   ok: true  },
  },
  // Nightly report card
  nightlyReport: "Last night Gridly charged your battery at 4.8p, your EV at 5.1p, and exported 8kWh at 38.6p. Total earned: £4.21. Today looks strong — 18kWh of solar forecast and peak prices above 35p this evening.",
};

// ── AGILE RATES ───────────────────────────────────────────────────────────
const AGILE_RATES = [
  { time: "00:00", pence: 7.2 }, { time: "00:30", pence: 6.8 },
  { time: "01:00", pence: 6.1 }, { time: "01:30", pence: 5.9 },
  { time: "02:00", pence: 5.4 }, { time: "02:30", pence: 5.1 },
  { time: "03:00", pence: 4.8 }, { time: "03:30", pence: 4.6 },
  { time: "04:00", pence: 4.9 }, { time: "04:30", pence: 5.3 },
  { time: "05:00", pence: 6.2 }, { time: "05:30", pence: 8.1 },
  { time: "06:00", pence: 12.4 }, { time: "06:30", pence: 18.7 },
  { time: "07:00", pence: 24.3 }, { time: "07:30", pence: 28.9 },
  { time: "08:00", pence: 31.2 }, { time: "08:30", pence: 29.4 },
  { time: "09:00", pence: 24.1 }, { time: "09:30", pence: 19.8 },
  { time: "10:00", pence: 16.2 }, { time: "10:30", pence: 13.4 },
  { time: "11:00", pence: 11.8 }, { time: "11:30", pence: 10.2 },
  { time: "12:00", pence: 9.6 },  { time: "12:30", pence: 8.9 },
  { time: "13:00", pence: 9.1 },  { time: "13:30", pence: 10.4 },
  { time: "14:00", pence: 11.2 }, { time: "14:30", pence: 12.8 },
  { time: "15:00", pence: 14.6 }, { time: "15:30", pence: 17.3 },
  { time: "16:00", pence: 22.1 }, { time: "16:30", pence: 27.8 },
  { time: "17:00", pence: 34.2 }, { time: "17:30", pence: 38.6 },
  { time: "18:00", pence: 35.4 }, { time: "18:30", pence: 29.7 },
  { time: "19:00", pence: 22.3 }, { time: "19:30", pence: 17.6 },
  { time: "20:00", pence: 14.2 }, { time: "20:30", pence: 11.8 },
  { time: "21:00", pence: 10.1 }, { time: "21:30", pence: 9.4 },
  { time: "22:00", pence: 8.7 },  { time: "22:30", pence: 8.1 },
  { time: "23:00", pence: 7.6 },  { time: "23:30", pence: 7.1 },
];

// ── INTELLIGENCE ENGINE ───────────────────────────────────────────────────
function getCurrentSlotIndex() {
  const now = new Date();
  return Math.min(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30), 47);
}

function getBestChargeSlot() {
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

const MODE_CONFIG = {
  CHARGE: { icon: "⚡", label: "CHARGING", color: "#22C55E", bg: "#0D1F14", border: "#16A34A30",
    description: (_: any, current: number) => `Buying at ${current}p — filling your battery now while prices are low.` },
  EXPORT: { icon: "💰", label: "EXPORTING", color: "#F59E0B", bg: "#1A1200", border: "#F59E0B30",
    description: (_: any, current: number) => `Selling to the grid at ${current}p — peak price, earning for you now.` },
  HOLD:   { icon: "⏸", label: "HOLDING",   color: "#9CA3AF", bg: "#0D1117", border: "#1F2937",
    description: (best: any, current: number) => `Price is ${current}p — waiting for cheaper slot at ${best.time} (${best.price}p).` },
};

// ── FLOW DOTS ─────────────────────────────────────────────────────────────
function FlowDot({ active, color }: { active: boolean; color: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick(n => (n + 1) % 3), 500);
    return () => clearInterval(t);
  }, [active]);
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: active && i === tick ? color : `${color}25`, transition: "background 0.2s" }} />
      ))}
    </div>
  );
}

// ── MANUAL OVERRIDE ───────────────────────────────────────────────────────
function ManualOverride({ currentPence, connectedDevices }: { currentPence: number; connectedDevices: typeof ALL_DEVICES }) {
  const [override, setOverride] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const hasBattery = connectedDevices.some(d => d.id === "battery");
  const hasEV = connectedDevices.some(d => d.id === "ev");
  const isExpensive = currentPence > 20;

  const handleOverride = (action: string) => {
    setOverride(override === action ? null : action);
    setExpanded(false);
  };

  if (!hasBattery && !hasEV) return null;

  return (
    <div style={{ margin: "0 20px 16px" }}>
      {override ? (
        <div style={{ background: "#1A1A2E", border: "1px solid #38BDF840", borderRadius: 16, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "#38BDF8", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>MANUAL OVERRIDE ACTIVE</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
              {override === "charge_now" ? "⚡ Charging battery" : override === "charge_ev" ? "🚗 Charging EV" : "⏸ Paused"}
            </div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>
              {isExpensive ? `Currently ${currentPence}p — not cheapest but charging as requested` : `Currently ${currentPence}p — good time to charge`}
            </div>
          </div>
          <button onClick={() => setOverride(null)} style={{ background: "#374151", border: "none", borderRadius: 8, padding: "6px 12px", color: "#9CA3AF", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, marginLeft: 12 }}>
            Cancel
          </button>
        </div>
      ) : !expanded ? (
        <button onClick={() => setExpanded(true)} style={{ width: "100%", background: "none", border: "1px dashed #374151", borderRadius: 12, padding: "10px 16px", color: "#6B7280", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Manual override</span>
          <span style={{ fontSize: 11, color: "#4B5563" }}>Now: {currentPence}p/kWh</span>
        </button>
      ) : (
        <div style={{ background: "#111827", border: "1px solid #374151", borderRadius: 16, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: 1 }}>OVERRIDE GRIDLY</div>
            <div style={{ fontSize: 12, color: isExpensive ? "#EF4444" : "#22C55E", fontWeight: 700 }}>{currentPence}p/kWh now</div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {hasBattery && (
              <button onClick={() => handleOverride("charge_now")} style={{ background: "#16A34A15", border: "1px solid #16A34A30", borderRadius: 10, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#22C55E", marginBottom: 2 }}>⚡ Charge battery now</div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>Force charge regardless of price</div>
              </button>
            )}
            {hasEV && (
              <button onClick={() => handleOverride("charge_ev")} style={{ background: "#38BDF815", border: "1px solid #38BDF830", borderRadius: 10, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#38BDF8", marginBottom: 2 }}>🚗 Charge EV now</div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>Start charging at {currentPence}p/kWh</div>
              </button>
            )}
            <button onClick={() => handleOverride("pause")} style={{ background: "#37415115", border: "1px solid #37415130", borderRadius: 10, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#9CA3AF", marginBottom: 2 }}>⏸ Pause Gridly</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>Stop all automated actions temporarily</div>
            </button>
          </div>
          <button onClick={() => setExpanded(false)} style={{ marginTop: 10, background: "none", border: "none", color: "#4B5563", fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── EV READY-BY ───────────────────────────────────────────────────────────
function EVReadyBy() {
  const [targetPct, setTargetPct] = useState(80);
  const [readyByHour, setReadyByHour] = useState(7);
  const [expanded, setExpanded] = useState(false);
  const plan = calcEVPlan(targetPct, readyByHour);
  const hours = [1,2,3,4,5,6,7,8,9,10,11,12];

  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1521", border: "1px solid #38BDF820", borderRadius: 16, overflow: "hidden" }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 11, color: "#38BDF8", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>EV READY-BY</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
            🚗 {targetPct}% by {readyByHour}:00am · <span style={{ color: "#22C55E" }}>£{plan.cost.toFixed(2)}</span>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1F2937" }}>
          <div style={{ paddingTop: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700 }}>CHARGE TO</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#38BDF8" }}>{targetPct}%</span>
            </div>
            <input type="range" min={20} max={100} step={10} value={targetPct} onChange={e => setTargetPct(Number(e.target.value))} style={{ width: "100%", accentColor: "#38BDF8", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#374151", marginTop: 2 }}>
              <span>20%</span><span>50%</span><span>80%</span><span>100%</span>
            </div>
          </div>
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
          <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>Gridly's plan</div>
            <div style={{ fontSize: 13, color: "#F9FAFB", lineHeight: 1.6 }}>
              Charge during the <span style={{ color: "#22C55E", fontWeight: 700 }}>{plan.slots.length} cheapest slots</span> overnight. Done by <span style={{ color: "#38BDF8", fontWeight: 700 }}>{plan.finishTime}</span>. Cost: <span style={{ color: "#22C55E", fontWeight: 700 }}>£{plan.cost.toFixed(2)}</span>.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BATTERY RESERVE ───────────────────────────────────────────────────────
function BatteryReserve() {
  const [reserve, setReserve] = useState(20);
  const [expanded, setExpanded] = useState(false);

  const label = reserve <= 10
    ? "Maximise earnings — Gridly uses almost everything"
    : reserve <= 20
    ? "Balanced — enough left for a short power cut"
    : reserve <= 40
    ? "Safety buffer — covers most outages"
    : "Conservative — prioritising backup over savings";

  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1F14", border: "1px solid #16A34A20", borderRadius: 16, overflow: "hidden" }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 11, color: "#22C55E", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>BATTERY RESERVE</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
            🔋 Always keep <span style={{ color: "#22C55E" }}>{reserve}%</span> — never touch it
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
function SolarForecastCard() {
  const f = SANDBOX.solarForecast;
  const advice = f.kwh > 15
    ? "Good solar tomorrow — Gridly will export more today and charge less overnight. Free energy incoming."
    : f.kwh > 8
    ? "Moderate solar tomorrow — Gridly will partially charge overnight and top up from your panels."
    : "Low solar tomorrow — Gridly will fully charge your battery overnight at the cheapest rate.";

  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #F59E0B20", borderRadius: 16, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: "#F59E0B", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>TOMORROW'S SOLAR</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#F9FAFB", letterSpacing: -0.5 }}>{f.icon} {f.kwh} kWh</div>
          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{f.condition} · {f.confidence}% confidence</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 4 }}>vs today</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#22C55E" }}>+{f.deltaKwh} kWh ↑</div>
        </div>
      </div>
      <div style={{ background: "#111827", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#9CA3AF", lineHeight: 1.5 }}>
        {advice}
      </div>
    </div>
  );
}


// ── CROSS-DEVICE COORDINATION ─────────────────────────────────────────────
function CrossDeviceCoordination({ connectedDevices, currentPence }: { connectedDevices: typeof ALL_DEVICES; currentPence: number }) {
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
function BatteryHealthScore() {
  const h = SANDBOX.batteryHealth;
  const [expanded, setExpanded] = useState(false);
  const cyclePct = Math.round((h.cyclesUsed / h.cyclesTotal) * 100);
  const healthColor = h.capacityPct >= 90 ? "#22C55E" : h.capacityPct >= 75 ? "#F59E0B" : "#EF4444";
  const healthLabel = h.capacityPct >= 90 ? "Excellent" : h.capacityPct >= 75 ? "Good" : "Degraded";
  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, overflow: "hidden" }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>BATTERY HEALTH</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
            🔋 <span style={{ color: healthColor }}>{healthLabel}</span> · {h.capacityPct}% capacity · {h.projectedLifeYears} yrs left
          </div>
        </div>
        {expanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1F2937" }}>
          <div style={{ paddingTop: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>Remaining capacity</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: healthColor }}>{h.capacityPct}%</span>
            </div>
            <div style={{ height: 6, background: "#1F2937", borderRadius: 99 }}>
              <div style={{ height: "100%", width: `${h.capacityPct}%`, background: healthColor, borderRadius: 99 }} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>Charge cycles used</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#F9FAFB" }}>{h.cyclesUsed} / {h.cyclesTotal.toLocaleString()}</span>
            </div>
            <div style={{ height: 6, background: "#1F2937", borderRadius: 99 }}>
              <div style={{ height: "100%", width: `${cyclePct}%`, background: "#6B7280", borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 10, color: "#4B5563", marginTop: 4 }}>{cyclePct}% of rated cycle life used</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "#111827", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 3 }}>Avg cycles/week</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#F9FAFB" }}>{h.weeklyChargeCycles}</div>
            </div>
            <div style={{ background: "#111827", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 3 }}>Est. life remaining</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: healthColor }}>{h.projectedLifeYears} yrs</div>
            </div>
          </div>
          <div style={{ marginTop: 10, background: "#0D1F14", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#6B7280", lineHeight: 1.5 }}>
            💡 Gridly avoids unnecessary cycles — only charging when prices make it worthwhile. This extends your battery life.
          </div>
        </div>
      )}
    </div>
  );
}

// ── TARIFF SWITCHER ───────────────────────────────────────────────────────
function TariffSwitcher({ connectedDevices }: { connectedDevices: typeof ALL_DEVICES }) {
  const [expanded, setExpanded] = useState(false);
  const hasEV = connectedDevices.some(d => d.id === "ev");
  const hasBattery = connectedDevices.some(d => d.id === "battery");
  const tariffs = SANDBOX.tariffs;
  const current = tariffs.find(t => t.current)!;
  const relevant = tariffs.filter(t => {
    if (t.id === "go" && !hasEV) return false;
    if (t.id === "flux" && !hasBattery) return false;
    return true;
  });
  const best = relevant.reduce((a, b) => b.annualSaving > a.annualSaving ? b : a);
  const uplift = best.annualSaving - current.annualSaving;
  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #A78BFA20", borderRadius: 16, overflow: "hidden" }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", background: "none", border: "none", padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 11, color: "#A78BFA", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>TARIFF OPTIMISER</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>
            {uplift > 0
              ? <span>💡 Switch to <span style={{ color: "#A78BFA" }}>{best.name}</span> · save <span style={{ color: "#22C55E" }}>+£{uplift}/yr more</span></span>
              : <span>✓ You are on the best tariff for your setup</span>
            }
          </div>
        </div>
        {expanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1F2937" }}>
          <div style={{ paddingTop: 14, marginBottom: 10, fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>
            Based on your devices and usage, here is what each tariff would earn you per year with Gridly:
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {relevant.map(t => {
              const diff = t.annualSaving - current.annualSaving;
              const isBest = t.id === best.id;
              return (
                <div key={t.id} style={{ background: t.current ? "#0D1F14" : isBest ? "#1A0F2E" : "#111827", border: `1px solid ${t.current ? "#16A34A30" : isBest ? "#A78BFA30" : "#1F2937"}`, borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#F9FAFB", marginBottom: 2 }}>{t.name}</div>
                      {t.badge && <div style={{ fontSize: 10, color: t.current ? "#22C55E" : isBest ? "#A78BFA" : "#6B7280", fontWeight: 700 }}>{t.badge}</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: t.current ? "#22C55E" : "#F9FAFB" }}>£{t.annualSaving}/yr</div>
                      {!t.current && <div style={{ fontSize: 11, fontWeight: 700, color: diff > 0 ? "#22C55E" : "#EF4444" }}>{diff > 0 ? `+£${diff} more` : `£${Math.abs(diff)} less`}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {uplift > 0 && (
            <a href="https://octopus.energy/tariffs/" target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 12, background: "#A78BFA", borderRadius: 10, padding: "11px 14px", textAlign: "center", fontSize: 13, fontWeight: 700, color: "#0D1117", textDecoration: "none" }}>
              Switch on Octopus →
            </a>
          )}
        </div>
      )}
    </div>
  );
}



// ── CARBON TRACKER ────────────────────────────────────────────────────────
function CarbonTracker({ connectedDevices }: { connectedDevices: typeof ALL_DEVICES }) {
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
function DeviceHealthAlerts({ connectedDevices }: { connectedDevices: typeof ALL_DEVICES }) {
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
        return (
          <div key={device.id} style={{ background: "#1A0A0A", border: "1px solid #EF444430", borderRadius: 14, padding: "12px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 18, flexShrink: 0 }}>⚠️</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#FCA5A5", marginBottom: 2 }}>
                {device.name} not reporting
              </div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>Last seen {ago} — Gridly has paused automated actions for this device</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── NIGHTLY REPORT CARD ───────────────────────────────────────────────────
function NightlyReportCard() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 8) return null; // Only show morning window 6-8am; hide otherwise for cleanliness — swap to always-show for demo
  return (
    <div style={{ margin: "0 20px 16px", background: "linear-gradient(135deg, #0D1F14, #0D1521)", border: "1px solid #22C55E20", borderRadius: 16, padding: "16px" }}>
      <div style={{ fontSize: 11, color: "#22C55E", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>LAST NIGHT</div>
      <div style={{ fontSize: 13, color: "#D1FAE5", lineHeight: 1.7 }}>{SANDBOX.nightlyReport}</div>
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
function BoostButton({ connectedDevices, currentPence }: { connectedDevices: typeof ALL_DEVICES; currentPence: number }) {
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
function ChargerLock({ connectedDevices }: { connectedDevices: typeof ALL_DEVICES }) {
  const hasEV = connectedDevices.some(d => d.id === "ev");
  const [locked, setLocked] = useState(false);
  if (!hasEV) return null;

  return (
    <div style={{ margin: "0 20px 16px" }}>
      <button onClick={() => setLocked(l => !l)} style={{ width: "100%", background: locked ? "#1A0A0A" : "#111827", border: `1px solid ${locked ? "#EF444430" : "#1F2937"}`, borderRadius: 14, padding: "12px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: locked ? "#FCA5A5" : "#9CA3AF", marginBottom: 2 }}>
            {locked ? "🔒 Charger locked" : "🔓 Charger unlocked"}
          </div>
          <div style={{ fontSize: 11, color: "#4B5563" }}>{locked ? "No one can start a charge without Gridly" : "Tap to lock your charger remotely"}</div>
        </div>
        <div style={{ width: 36, height: 20, background: locked ? "#EF4444" : "#374151", borderRadius: 99, position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
          <div style={{ position: "absolute", top: 2, left: locked ? 18 : 2, width: 16, height: 16, background: "#F9FAFB", borderRadius: "50%", transition: "left 0.2s" }} />
        </div>
      </button>
    </div>
  );
}

// ── HOME TAB ──────────────────────────────────────────────────────────────
function HomeTab({ connectedDevices, now }: { connectedDevices: typeof ALL_DEVICES; now: Date }) {
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const slotIndex = getCurrentSlotIndex();
  const currentPence = AGILE_RATES[slotIndex].pence;
  const mode = getGridlyMode({
    price: currentPence,
    solarW: s.w,
    batteryPct: s.batteryPct,
    hasBattery,
    hasSolar,
    hasEV,
    hasGrid: connectedDevices.some(d => d.id === "grid"),
  });
  const best = getBestChargeSlot();
  const cfg = MODE_CONFIG[mode];
  const s = SANDBOX.solar;
  const isExporting = s.gridW > 0;
  const isCharging = mode === "CHARGE";
  const hasBattery = connectedDevices.some(d => d.id === "battery");
  const hasEV = connectedDevices.some(d => d.id === "ev");
  const hasSolar = connectedDevices.some(d => d.id === "solar");

  return (
    <div>
      <div style={{ padding: "44px 24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginBottom: 2 }}>{greeting}</div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>
          {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>

      {/* All-time counter */}
      <div style={{ margin: "0 20px 16px", background: "linear-gradient(135deg, #0a0a0a, #111827)", border: "1px solid #1F2937", borderRadius: 20, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: "#4B5563", letterSpacing: 1, fontWeight: 700, marginBottom: 6 }}>ALL TIME</div>
          <div style={{ fontSize: 40, fontWeight: 900, color: "#22C55E", letterSpacing: -2, lineHeight: 1 }}>+£{SANDBOX.allTime}</div>
          <div style={{ fontSize: 11, color: "#4B5563", marginTop: 6 }}>since {SANDBOX.allTimeSince}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#4B5563", marginBottom: 4 }}>Today</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#22C55E" }}>+£{SANDBOX.savedToday}</div>
          <div style={{ fontSize: 11, color: "#F59E0B", marginTop: 2 }}>£{SANDBOX.earnedToday} exported</div>
        </div>
      </div>

      {/* Device health alerts — top priority */}
      <DeviceHealthAlerts connectedDevices={connectedDevices} />

      {/* Nightly report card */}
      <NightlyReportCard />

      {/* Mode card */}
      <div style={{ margin: "0 20px 16px", background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 16, padding: "16px 20px" }}>
        <div style={{ fontSize: 10, color: cfg.color, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>RIGHT NOW</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: cfg.color, letterSpacing: -0.5, marginBottom: 4 }}>{cfg.icon} {cfg.label}</div>
        <div style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.5 }}>{cfg.description(best, currentPence)}</div>
      </div>

      {/* Manual override */}
      {/* Boost button — prominent single-tap charge */}
      <BoostButton connectedDevices={connectedDevices} currentPence={currentPence} />

      {/* Charger lock */}
      <ChargerLock connectedDevices={connectedDevices} />

      {/* Carbon tracker */}
      <CarbonTracker connectedDevices={connectedDevices} />

      <ManualOverride currentPence={currentPence} connectedDevices={connectedDevices} />

      {/* EV Ready-by */}
      {hasEV && <EVReadyBy />}

      {/* Battery reserve */}
      {hasBattery && <BatteryReserve />}

      {/* Solar forecast */}
      {hasSolar && <SolarForecastCard />}

      {/* Cross-device coordination — battery + EV joint plan */}
      <CrossDeviceCoordination connectedDevices={connectedDevices} currentPence={currentPence} />

      {/* Energy flow — only connected devices */}
      <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "20px" }}>
        <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 20 }}>LIVE ENERGY FLOW</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {connectedDevices.some(d => d.id === "solar") && <>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 52, height: 52, background: "#F59E0B15", border: "1.5px solid #F59E0B30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
                <Sun size={22} color="#F59E0B" />
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>{(s.w / 1000).toFixed(1)}kW</div>
              <div style={{ fontSize: 10, color: "#6B7280" }}>Solar</div>
            </div>
            <FlowDot active={s.w > 0} color="#F59E0B" />
          </>}
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 52, height: 52, background: "#ffffff10", border: "1.5px solid #ffffff20", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
              <Home size={22} color="#E5E7EB" />
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>{(s.homeW / 1000).toFixed(1)}kW</div>
            <div style={{ fontSize: 10, color: "#6B7280" }}>Home</div>
          </div>
          {connectedDevices.some(d => d.id === "battery") && <>
            <FlowDot active={isCharging} color="#16A34A" />
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 52, height: 52, background: "#16A34A15", border: "1.5px solid #16A34A30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
                <Battery size={22} color="#22C55E" />
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>{s.batteryPct}%</div>
              <div style={{ fontSize: 10, color: "#6B7280" }}>Battery</div>
            </div>
          </>}
          {connectedDevices.some(d => d.id === "ev") && <>
            <FlowDot active={isCharging} color="#38BDF8" />
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 52, height: 52, background: "#38BDF815", border: "1.5px solid #38BDF830", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
                <Zap size={22} color="#38BDF8" />
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#38BDF8" }}>Charging</div>
              <div style={{ fontSize: 10, color: "#6B7280" }}>EV</div>
            </div>
          </>}
          {connectedDevices.some(d => d.id === "grid") && <>
            <FlowDot active={isExporting} color="#F59E0B" />
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 52, height: 52, background: isExporting ? "#F59E0B15" : "#ffffff05", border: `1.5px solid ${isExporting ? "#F59E0B30" : "#ffffff10"}`, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
                <TrendingUp size={22} color={isExporting ? "#F59E0B" : "#374151"} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: isExporting ? "#F59E0B" : "#374151" }}>
                {isExporting ? `${(s.gridW / 1000).toFixed(1)}kW` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "#6B7280" }}>{isExporting ? "Exporting" : "Grid"}</div>
            </div>
          </>}
        </div>
      </div>

      {/* Battery health — only if battery connected */}
      {hasBattery && <BatteryHealthScore />}

      {/* Tariff switcher */}
      <TariffSwitcher connectedDevices={connectedDevices} />

      {/* Connected devices */}
      <div style={{ margin: "0 20px" }}>
        <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>CONNECTED</div>
        <div style={{ display: "grid", gap: 8 }}>
          {connectedDevices.map(device => {
            const Icon = device.icon;
            return (
              <div key={device.id} style={{ background: "#111827", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #1F2937" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Icon size={16} color={device.color} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#F9FAFB" }}>{device.name}</div>
                    <div style={{ fontSize: 11, color: "#4B5563" }}>{device.status}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: device.color }}>+£{device.monthlyValue}/mo</div>
              </div>
            );
          })}
        </div>
        <button onClick={() => window.location.href = '/onboarding'} style={{ width: "100%", marginTop: 10, background: "none", border: "1px dashed #374151", borderRadius: 12, padding: "12px 16px", color: "#4B5563", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          + Add another device
        </button>
      </div>
    </div>
  );
}

// ── PLAN TAB ──────────────────────────────────────────────────────────────
function PlanTab({ connectedDevices }: { connectedDevices: typeof ALL_DEVICES }) {
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

      {/* Price chart */}
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
            <div key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "pointer" }}>
              <div style={{ width: "100%", height: Math.max(2, (r.pence / maxPence) * 72), background: r.pence === minPence ? "#22C55E" : i === currentSlot ? "#fff" : getBarColor(r.pence), opacity: hovered !== null && hovered !== i ? 0.3 : 1, borderRadius: "2px 2px 0 0", transition: "opacity 0.1s" }} />
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

      {/* Schedule */}
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

// ── HISTORY TAB ───────────────────────────────────────────────────────────
function HistoryTab({ connectedDevices }: { connectedDevices: typeof ALL_DEVICES }) {
  const [activeDevice, setActiveDevice] = useState<string>("all");

  const values = SANDBOX.history.map(d => {
    if (activeDevice === "all") return d.solar + d.battery + d.ev + d.grid;
    return (d as any)[activeDevice] ?? 0;
  });

  const maxVal = Math.max(...values);
  const weekTotal = values.reduce((s, v) => s + v, 0).toFixed(2);

  const activeColor = activeDevice === "all"
    ? "#22C55E"
    : ALL_DEVICES.find(d => d.id === activeDevice)?.historyColor ?? "#22C55E";

  const deviceTotals = connectedDevices.map(device => ({
    ...device,
    total: SANDBOX.history.reduce((s, d) => s + ((d as any)[device.id] ?? 0), 0).toFixed(2),
  }));

  return (
    <div style={{ padding: "44px 0 0" }}>
      <div style={{ padding: "0 24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginBottom: 2 }}>Your savings</div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>Every penny Gridly has made you</div>
      </div>

      <div style={{ margin: "0 20px 16px" }}>
        <ChargeSessionHistory />
      </div>

      <div style={{ margin: "0 20px 16px", background: "linear-gradient(135deg, #0a0a0a, #111827)", border: "1px solid #1F2937", borderRadius: 20, padding: "24px", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#4B5563", letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>ALL TIME</div>
        <div style={{ fontSize: 52, fontWeight: 900, color: "#22C55E", letterSpacing: -3, lineHeight: 1 }}>+£{SANDBOX.allTime}</div>
        <div style={{ fontSize: 12, color: "#4B5563", marginTop: 8 }}>since {SANDBOX.allTimeSince}</div>
      </div>

      <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>THIS WEEK</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: activeColor }}>
              £{weekTotal}
              <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, marginLeft: 6 }}>
                {activeDevice === "all" ? "all devices" : ALL_DEVICES.find(d => d.id === activeDevice)?.name}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          <button onClick={() => setActiveDevice("all")} style={{ padding: "4px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, background: activeDevice === "all" ? "#22C55E" : "#1F2937", color: activeDevice === "all" ? "#111827" : "#6B7280" }}>All</button>
          {connectedDevices.map(device => (
            <button key={device.id} onClick={() => setActiveDevice(device.id)} style={{ padding: "4px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, background: activeDevice === device.id ? device.historyColor : "#1F2937", color: activeDevice === device.id ? "#111827" : "#6B7280" }}>
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
                {isToday && <div style={{ fontSize: 9, color: activeColor, fontWeight: 700, marginBottom: 2 }}>£{val.toFixed(2)}</div>}
                <div style={{ width: "100%", height: h, background: isToday ? activeColor : `${activeColor}40`, borderRadius: "3px 3px 0 0" }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {SANDBOX.history.map((d, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: i === SANDBOX.history.length - 1 ? "#F9FAFB" : "#4B5563", fontWeight: i === SANDBOX.history.length - 1 ? 700 : 400 }}>
              {i === SANDBOX.history.length - 1 ? "Today" : d.day}
            </div>
          ))}
        </div>
      </div>

      <div style={{ margin: "0 20px" }}>
        <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>THIS WEEK BY DEVICE</div>
        <div style={{ display: "grid", gap: 8 }}>
          {deviceTotals.map(device => {
            const Icon = device.icon;
            const pct = Math.round((parseFloat(device.total) / parseFloat(weekTotal === "0.00" ? "1" : weekTotal)) * 100);
            return (
              <div key={device.id} style={{ background: "#111827", borderRadius: 12, padding: "12px 16px", border: "1px solid #1F2937" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon size={15} color={device.color} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#F9FAFB" }}>{device.name}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: device.color }}>£{device.total}</div>
                </div>
                <div style={{ height: 3, background: "#1F2937", borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: device.color, borderRadius: 2, transition: "width 0.4s ease" }} />
                </div>
                <div style={{ fontSize: 10, color: "#4B5563", marginTop: 4 }}>{pct}% of total savings</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

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
      {tab === "home"    && <HomeTab connectedDevices={connectedDevices} now={now} />}
      {tab === "plan"    && <PlanTab connectedDevices={connectedDevices} />}
      {tab === "history" && <HistoryTab connectedDevices={connectedDevices} />}

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
