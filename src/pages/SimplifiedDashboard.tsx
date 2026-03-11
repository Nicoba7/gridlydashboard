import { useState, useEffect, useMemo } from "react";
import { Sun, Battery, Zap, Grid3X3, TrendingUp, Home, Calendar, Clock } from "lucide-react";
import TomorrowForecast from "./TomorrowForecast";

// ── DEVICE CONFIG ─────────────────────────────────────────────────────────
const ALL_DEVICES = [
  { id: "solar", name: "Solar Inverter", status: "2.8kW generating", monthlyValue: 35, icon: Sun, color: "#F59E0B" },
  { id: "battery", name: "Home Battery", status: "62% charged", monthlyValue: 32, icon: Battery, color: "#16A34A" },
  { id: "ev", name: "EV Charger", status: "Connected", monthlyValue: 26, icon: Zap, color: "#38BDF8" },
  { id: "grid", name: "Smart Meter", status: "Live pricing", monthlyValue: 15, icon: Grid3X3, color: "#A78BFA" },
];

// ── SANDBOX DATA ──────────────────────────────────────────────────────────
const SANDBOX = {
  savedToday: 3.76,
  earnedToday: 1.52,
  allTime: 713.67,
  allTimeSince: "March 2024",
  solar: { w: 2840, batteryPct: 62, gridW: 420, homeW: 1200 },
  history: [
    { day: "Mon", saved: 2.14, earned: 0.63 },
    { day: "Tue", saved: 3.42, earned: 1.21 },
    { day: "Wed", saved: 1.87, earned: 0.44 },
    { day: "Thu", saved: 4.11, earned: 1.84 },
    { day: "Fri", saved: 2.93, earned: 0.97 },
    { day: "Sat", saved: 5.24, earned: 2.31 },
    { day: "Sun", saved: 3.76, earned: 1.52 },
  ],
  plan: [
    { time: "11:30pm", action: "CHARGE", title: "Charging your battery", reason: "Cheapest rate of the night", price: 4.8, color: "#22C55E" },
    { time: "2:00am",  action: "HOLD",   title: "Resting overnight",     reason: "Nothing to do — battery full", price: 5.1, color: "#6B7280" },
    { time: "8:00am",  action: "EXPORT", title: "Selling to the grid",   reason: "High price — earning for you", price: 31.2, color: "#F59E0B" },
    { time: "11:00am", action: "SOLAR",  title: "Solar powering your home", reason: "Free electricity from your panels", price: 9.6, color: "#F59E0B" },
    { time: "5:30pm",  action: "EXPORT", title: "Peak earnings window",  reason: "Best price of the day", price: 38.6, color: "#F59E0B" },
    { time: "8:00pm",  action: "CHARGE", title: "Topping up for tomorrow", reason: "Price dropping — refilling now", price: 11.8, color: "#22C55E" },
  ],
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

// ── ENGINE FUNCTIONS ──────────────────────────────────────────────────────
function getCurrentSlotIndex() {
  const now = new Date();
  return Math.min(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30), 47);
}

function getBestChargeSlot() {
  return AGILE_RATES.reduce(
    (min, r, i) => (r.pence < min.price ? { index: i, price: r.pence, time: r.time } : min),
    { index: 0, price: AGILE_RATES[0].pence, time: AGILE_RATES[0].time }
  );
}

function getGridlyMode(pence: number): "CHARGE" | "EXPORT" | "HOLD" | "SOLAR" {
  if (pence < 8) return "CHARGE";
  if (pence > 30) return "EXPORT";
  if (SANDBOX.solar.w > 1000) return "SOLAR";
  return "HOLD";
}

function calculateProjectedValue() {
  const peak = Math.max(...AGILE_RATES.map(r => r.pence));
  const cheap = Math.min(...AGILE_RATES.map(r => r.pence));
  const batterySize = 10;
  return (((peak - cheap) / 100) * batterySize).toFixed(2);
}

function getBarColor(p: number) {
  if (p < 10) return "#22C55E";
  if (p < 20) return "#F59E0B";
  if (p < 30) return "#F97316";
  return "#EF4444";
}

const MODE_CONFIG = {
  CHARGE: { icon: "⚡", label: "CHARGING",  color: "#22C55E", bg: "#0D1F14", border: "#16A34A30", description: (best: string, cheap: number, current: number) => `Buying cheap electricity now at ${current}p — saving ${(cheap > 0 ? (current - cheap) : 0).toFixed(1)}p/kWh versus peak.` },
  EXPORT: { icon: "💰", label: "EXPORTING", color: "#F59E0B", bg: "#1A1200",  border: "#F59E0B30", description: (best: string, cheap: number, current: number) => `Selling to the grid at ${current}p — peak earnings window. Battery holding for more.` },
  HOLD:   { icon: "⏸", label: "HOLDING",   color: "#9CA3AF", bg: "#0D1117",  border: "#37415130", description: (best: string, cheap: number, current: number) => `Price is ${current}p — waiting for cheaper slot at ${best} (${cheap}p). Saving battery.` },
  SOLAR:  { icon: "☀️", label: "SOLAR",     color: "#F59E0B", bg: "#1A1000",  border: "#F59E0B25", description: (best: string, cheap: number, current: number) => `Solar covering your home right now. Storing surplus in battery for tonight.` },
};

// ── ENERGY FLOW DOTS ──────────────────────────────────────────────────────
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

// ── HOME TAB ──────────────────────────────────────────────────────────────
function HomeTab({ connectedDevices, now }: { connectedDevices: typeof ALL_DEVICES; now: Date }) {
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const currentSlot = AGILE_RATES[getCurrentSlotIndex()];
  const bestSlot = getBestChargeSlot();
  const mode = getGridlyMode(currentSlot.pence);
  const cfg = MODE_CONFIG[mode];
  const s = SANDBOX.solar;

  return (
    <div>
      {/* Greeting */}
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

      {/* Dynamic Gridly decision */}
      <div style={{ margin: "0 20px 16px", background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 16, padding: "16px 20px" }}>
        <div style={{ fontSize: 10, color: cfg.color, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8, opacity: 0.7 }}>RIGHT NOW</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: cfg.color, letterSpacing: -0.5, marginBottom: 6 }}>
          {cfg.icon} {cfg.label}
        </div>
        <div style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.6 }}>
          {cfg.description(bestSlot.time, bestSlot.price, currentSlot.pence)}
        </div>
      </div>

      {/* Energy flow */}
      <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "20px" }}>
        <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 20 }}>LIVE ENERGY FLOW</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 52, height: 52, background: "#F59E0B15", border: "1.5px solid #F59E0B30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
              <Sun size={22} color="#F59E0B" />
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>{(s.w / 1000).toFixed(1)}kW</div>
            <div style={{ fontSize: 10, color: "#6B7280" }}>Solar</div>
          </div>
          <FlowDot active={s.w > 0} color="#F59E0B" />
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 52, height: 52, background: "#ffffff10", border: "1.5px solid #ffffff20", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
              <Home size={22} color="#E5E7EB" />
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>{(s.homeW / 1000).toFixed(1)}kW</div>
            <div style={{ fontSize: 10, color: "#6B7280" }}>Home</div>
          </div>
          <FlowDot active={s.batteryPct < 100} color="#16A34A" />
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 52, height: 52, background: "#16A34A15", border: "1.5px solid #16A34A30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
              <Battery size={22} color="#22C55E" />
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>{s.batteryPct}%</div>
            <div style={{ fontSize: 10, color: "#6B7280" }}>Battery</div>
          </div>
          <FlowDot active={s.gridW > 0} color="#F59E0B" />
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 52, height: 52, background: "#F59E0B15", border: "1.5px solid #F59E0B30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
              <TrendingUp size={22} color="#F59E0B" />
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: s.gridW > 0 ? "#F59E0B" : "#9CA3AF" }}>
              {(s.gridW / 1000).toFixed(1)}kW
            </div>
            <div style={{ fontSize: 10, color: "#6B7280" }}>{s.gridW > 0 ? "Exporting" : "Importing"}</div>
          </div>
        </div>
      </div>

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
        <button
          onClick={() => window.location.href = '/onboarding'}
          style={{ width: "100%", marginTop: 10, background: "none", border: "1px dashed #374151", borderRadius: 12, padding: "12px 16px", color: "#4B5563", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        >
          + Add another device
        </button>
      </div>
    </div>
  );
}

// ── PLAN TAB ──────────────────────────────────────────────────────────────
function PlanTab() {
  const currentSlot = getCurrentSlotIndex();
  const maxPence = Math.max(...AGILE_RATES.map(r => r.pence));
  const minPence = Math.min(...AGILE_RATES.map(r => r.pence));
  const [hovered, setHovered] = useState<number | null>(null);
  const projectedValue = calculateProjectedValue();

  return (
    <div style={{ padding: "44px 0 0" }}>
      <div style={{ padding: "0 24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginBottom: 2 }}>Tonight's plan</div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>Already sorted — nothing you need to do</div>
      </div>

      {/* Tomorrow forecast */}
      <div style={{ margin: "0 20px" }}>
        <TomorrowForecast />
      </div>

      {/* Projected value */}
      <div style={{ margin: "0 20px 16px", background: "#0D1F14", border: "1px solid #16A34A30", borderRadius: 16, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, color: "#9CA3AF" }}>Projected value today</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#22C55E" }}>+£{projectedValue}</div>
      </div>

      {/* Price chart */}
      <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1 }}>PRICES TODAY</div>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>Now: <span style={{ color: getBarColor(AGILE_RATES[currentSlot].pence), fontWeight: 700 }}>{AGILE_RATES[currentSlot].pence}p</span></div>
        </div>
        {hovered !== null && (
          <div style={{ fontSize: 11, color: "#F9FAFB", background: "#1F2937", borderRadius: 6, padding: "3px 8px", display: "inline-block", marginBottom: 6 }}>
            {AGILE_RATES[hovered].time} · <span style={{ color: getBarColor(AGILE_RATES[hovered].pence), fontWeight: 700 }}>{AGILE_RATES[hovered].pence}p</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 72 }}>
          {AGILE_RATES.map((r, i) => (
            <div key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
              style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "pointer" }}>
              <div style={{
                width: "100%",
                height: Math.max(2, (r.pence / maxPence) * 72),
                background: r.pence === minPence ? "#22C55E" : i === currentSlot ? "#fff" : getBarColor(r.pence),
                opacity: hovered !== null && hovered !== i ? 0.3 : 1,
                borderRadius: "2px 2px 0 0",
                transition: "opacity 0.1s",
              }} />
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
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "#6B7280" }}>
          <span>Cheapest: <span style={{ color: "#22C55E", fontWeight: 700 }}>{minPence}p</span></span>
          <span>Peak: <span style={{ color: "#EF4444", fontWeight: 700 }}>{maxPence}p</span></span>
        </div>
      </div>

      {/* Plan timeline */}
      <div style={{ margin: "0 20px" }}>
        <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 12 }}>GRIDLY'S SCHEDULE</div>
        {SANDBOX.plan.map((slot, i) => {
          const isLast = i === SANDBOX.plan.length - 1;
          const isExport = slot.action === "EXPORT";
          const isCharge = slot.action === "CHARGE";
          return (
            <div key={i} style={{ display: "flex", gap: 14, position: "relative" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 36, flexShrink: 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: `${slot.color}15`, border: `1.5px solid ${slot.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
                  {isCharge ? "⚡" : isExport ? "💰" : slot.action === "SOLAR" ? "☀️" : "⏸"}
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
function HistoryTab() {
  const [view, setView] = useState<"saved" | "earned" | "net">("saved");
  const values = SANDBOX.history.map(d =>
    view === "saved" ? d.saved : view === "earned" ? d.earned : d.saved + d.earned
  );
  const maxVal = Math.max(...values);
  const total = values.reduce((s, v) => s + v, 0).toFixed(2);
  const color = view === "saved" ? "#22C55E" : view === "earned" ? "#F59E0B" : "#A78BFA";
  const weekTotal = SANDBOX.history.reduce((s, d) => s + d.saved + d.earned, 0).toFixed(2);

  return (
    <div style={{ padding: "44px 0 0" }}>
      <div style={{ padding: "0 24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginBottom: 2 }}>Your savings</div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>Every penny Gridly has made you</div>
      </div>

      <div style={{ margin: "0 20px 16px", background: "linear-gradient(135deg, #0a0a0a, #111827)", border: "1px solid #1F2937", borderRadius: 20, padding: "24px", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#4B5563", letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>ALL TIME</div>
        <div style={{ fontSize: 52, fontWeight: 900, color: "#22C55E", letterSpacing: -3, lineHeight: 1 }}>+£{SANDBOX.allTime}</div>
        <div style={{ fontSize: 12, color: "#4B5563", marginTop: 8 }}>since {SANDBOX.allTimeSince}</div>
      </div>

      <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>THIS WEEK</div>
            <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: -0.5 }}>
              £{total}
              <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, marginLeft: 6 }}>{view}</span>
            </div>
          </div>
          <div style={{ display: "flex", background: "#111827", borderRadius: 8, padding: 3, gap: 2 }}>
            {(["saved", "earned", "net"] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{ padding: "5px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", background: view === v ? (v === "saved" ? "#22C55E" : v === "earned" ? "#F59E0B" : "#A78BFA") : "transparent", color: view === v ? "#111827" : "#6B7280", fontSize: 11, fontWeight: 700 }}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 72, marginBottom: 8 }}>
          {SANDBOX.history.map((d, i) => {
            const val = values[i];
            const h = Math.max(4, (val / maxVal) * 72);
            const isToday = i === SANDBOX.history.length - 1;
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                {isToday && <div style={{ fontSize: 9, color, fontWeight: 700, marginBottom: 2 }}>£{val.toFixed(2)}</div>}
                <div style={{ width: "100%", height: h, background: isToday ? color : `${color}40`, borderRadius: "3px 3px 0 0" }} />
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

      <div style={{ margin: "0 20px", background: "#111827", border: "1px solid #1F2937", borderRadius: 16, padding: "16px 20px", display: "flex", justifyContent: "space-around" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#22C55E" }}>£{SANDBOX.history.reduce((s, d) => s + d.saved, 0).toFixed(2)}</div>
          <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>saved</div>
        </div>
        <div style={{ width: 1, background: "#1F2937" }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#F59E0B" }}>£{SANDBOX.history.reduce((s, d) => s + d.earned, 0).toFixed(2)}</div>
          <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>earned</div>
        </div>
        <div style={{ width: 1, background: "#1F2937" }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#A78BFA" }}>£{weekTotal}</div>
          <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>total</div>
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
    { id: "home", label: "Home", icon: Home },
    { id: "plan", label: "Plan", icon: Calendar },
    { id: "history", label: "History", icon: Clock },
  ] as const;

  return (
    <div style={{ background: "#030712", minHeight: "100vh", color: "#F9FAFB", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto", maxWidth: 480, margin: "0 auto", paddingBottom: 80 }}>
      {tab === "home" && <HomeTab connectedDevices={connectedDevices} now={now} />}
      {tab === "plan" && <PlanTab />}
      {tab === "history" && <HistoryTab />}

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
