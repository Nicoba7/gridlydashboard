import { useState, useEffect, useCallback } from "react";
import { Sun, Zap, Battery, PoundSterling, TrendingUp, RefreshCw, Wifi, WifiOff, ChevronRight, AlertCircle, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AveumSetup from "./AveumSetup";
import {
  buildIndexOptimizerInput,
  buildIndexUiViewModel,
  optimize,
  type IndexConnectedDeviceId,
} from "../optimizer";
import { buildCanonicalValueLedger } from "../application/runtime/buildCanonicalValueLedger";

// ── SANDBOX DATA ──────────────────────────────────────────────────────────
const SANDBOX = {
  givenergy: {
    solarW: 2840, batteryPct: 62, batteryKwh: 8.1, batteryCapKwh: 13.5,
    gridImportW: 0, gridExportW: 420, consumptionW: 1200,
    todaySolarKwh: 12.0, todayExportKwh: 4.2, todayImportKwh: 0.8,
  },
  zappi: {
    evPct: 85, evKwh: 40, evCapKwh: 77,
    status: "COMPLETE" as const, mode: "ECO+" as const, sessionKwh: 24.5,
  },
};

// ── PRICING ───────────────────────────────────────────────────────────────
interface Rate { from: Date; to: Date; pence: number; }

async function fetchAgileRates(): Promise<Rate[]> {
  const now = new Date();
  const rates: Rate[] = [];
  const basePrices = [
    8.2, 7.1, 6.8, 5.2, 4.9, 6.1, 12.3, 18.5, 24.1, 28.4, 26.2, 22.1,
    18.4, 16.2, 15.8, 17.2, 19.4, 24.8, 31.2, 34.5, 28.1, 22.4, 16.2, 12.1,
    9.8, 8.4, 7.2, 6.9, 6.1, 5.8, 7.2, 11.4, 16.8, 22.1, 19.4, 17.2,
    15.8, 14.2, 13.1, 12.8, 14.2, 18.4, 26.1, 32.4, 29.8, 24.1, 18.4, 13.2
  ];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  basePrices.forEach((pence, i) => {
    const from = new Date(start.getTime() + i * 30 * 60 * 1000);
    const to = new Date(from.getTime() + 30 * 60 * 1000);
    rates.push({ from, to, pence });
  });
  return rates;
}

function getCurrentRate(rates: Rate[]): Rate | null {
  const now = new Date();
  return rates.find((r) => now >= r.from && now < r.to) || null;
}

function getNextRates(rates: Rate[], n = 6): Rate[] {
  const now = new Date();
  return rates.filter((r) => r.from > now).slice(0, n);
}

function actionToColor(action?: string): string {
  switch (action) {
    case "charge":
      return "#22C55E";
    case "export":
      return "#F59E0B";
    case "discharge":
      return "#38BDF8";
    case "import":
      return "#38BDF8";
    default:
      return "#6B7280";
  }
}

function actionToLabel(action?: string): string {
  switch (action) {
    case "charge":
      return "CHARGING";
    case "export":
      return "SELLING";
    case "discharge":
      return "DISCHARGING";
    case "import":
      return "IMPORTING";
    case "hold":
    default:
      return "HOLDING";
  }
}
// ── HELPERS ───────────────────────────────────────────────────────────────
function calcTodaySavings(g: typeof SANDBOX.givenergy) {
  const exportEarned = g.todayExportKwh * 0.15;
  const importAvoided = g.todaySolarKwh * 0.28;
  return (exportEarned + importAvoided).toFixed(2);
}

// ── DEVICES CONFIG ────────────────────────────────────────────────────────
const ALL_DEVICES = [
  { id: "solar", name: "Solar Inverter", icon: Sun, color: "#F59E0B", monthlyValue: 35, connected: true },
  { id: "battery", name: "Home Battery", icon: Battery, color: "#16A34A", monthlyValue: 32, connected: true },
  { id: "ev", name: "EV Charger", icon: Zap, color: "#38BDF8", monthlyValue: 26, connected: false },
];

// ── PRICE BAR ─────────────────────────────────────────────────────────────
function PriceBar({ rate, isNow }: { rate: Rate; isNow: boolean }) {
  const max = 35;
  const pct = Math.max(0, Math.min(100, ((rate.pence + 5) / (max + 5)) * 100));
  const color = rate.pence < 0 ? "#16A34A" : rate.pence < 15 ? "#22C55E" : rate.pence < 25 ? "#F59E0B" : "#EF4444";
  const h = rate.from.getHours().toString().padStart(2, "0");
  const m = rate.from.getMinutes().toString().padStart(2, "0");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1 }}>
      <span style={{ fontSize: 9, color: isNow ? "#fff" : "#9CA3AF", fontWeight: isNow ? 700 : 400 }}>
        {rate.pence.toFixed(0)}p
      </span>
      <div style={{ width: "100%", height: 48, background: "#1F2937", borderRadius: 4, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: `${pct}%`, background: color,
          borderRadius: "3px 3px 0 0", opacity: isNow ? 1 : 0.5, transition: "height 0.5s ease",
        }} />
        {isNow && <div style={{ position: "absolute", inset: 0, border: `1.5px solid ${color}`, borderRadius: 4 }} />}
      </div>
      <span style={{ fontSize: 9, color: isNow ? "#fff" : "#6B7280" }}>{h}:{m}</span>
    </div>
  );
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────
const Index = () => {
  const [setupComplete, setSetupComplete] = useState(false);
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());
  const navigate = useNavigate();

  const g = SANDBOX.givenergy;
  const z = SANDBOX.zappi;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAgileRates();
      setRates(r); setLastUpdated(new Date());
    } catch {
      setError("Could not load prices");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  if (!setupComplete) {
    return <AveumSetup onComplete={() => setSetupComplete(true)} />;
  }

  const currentRate = getCurrentRate(rates);
  const nextRates = getNextRates(rates, 8);
  const displayRates = currentRate ? [currentRate, ...nextRates] : nextRates;
  const connectedDeviceIds: IndexConnectedDeviceId[] = ALL_DEVICES
    .filter((device) => device.connected)
    .map((device) => device.id)
    .filter((id): id is IndexConnectedDeviceId => id === "solar" || id === "battery" || id === "ev" || id === "grid");

  const optimizerInput = buildIndexOptimizerInput({
    now,
    rates,
    connectedDeviceIds,
    batteryStartPct: g.batteryPct,
    batteryCapacityKwh: g.batteryCapKwh,
    householdPowerW: g.consumptionW,
    solarForecastKwh: g.todaySolarKwh,
  });
  const optimizerOutput = optimize(optimizerInput);
  const valueLedger = buildCanonicalValueLedger({
    optimizationMode: optimizerInput.constraints.mode,
    optimizerOutput,
    forecasts: optimizerInput.forecasts,
    tariffSchedule: optimizerInput.tariffSchedule,
  });
  const indexView = buildIndexUiViewModel(optimizerOutput, valueLedger);

  const opt = {
    action: actionToLabel(indexView.currentRecommendation.action),
    reason: indexView.subheadline || "Aveum is evaluating the best time to act.",
    color: actionToColor(indexView.currentRecommendation.action),
  };  
  const savedToday = calcTodaySavings(g);
  const connectedDevices = ALL_DEVICES.filter(d => d.connected);
  const nextDevice = ALL_DEVICES.find(d => !d.connected);
  const monthlyTotal = connectedDevices.reduce((s, d) => s + d.monthlyValue, 0);

  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      color: "#F9FAFB", maxWidth: 420, margin: "0 auto", paddingBottom: 40,
    }}>

      {/* Header */}
      <div style={{ padding: "48px 20px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>{greeting} 👋</div>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 2 }}>Here's how you're saving today</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => navigate("/devices")} style={{ background: "#111827", border: "1px solid #1F2937", borderRadius: 10, padding: "8px 10px", cursor: "pointer" }}>
            <Settings size={14} color="#9CA3AF" />
          </button>
          <button onClick={load} style={{ background: "#111827", border: "1px solid #1F2937", borderRadius: 10, padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {loading
              ? <RefreshCw size={14} color="#6B7280" style={{ animation: "spin 1s linear infinite" }} />
              : error ? <WifiOff size={14} color="#EF4444" /> : <Wifi size={14} color="#16A34A" />}
            <span style={{ fontSize: 11, color: "#9CA3AF" }}>{loading ? "…" : error ? "Offline" : "Live"}</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{ margin: "0 20px 12px", background: "#1F1010", border: "1px solid #7F1D1D", borderRadius: 12, padding: "10px 14px", display: "flex", gap: 8, alignItems: "center" }}>
          <AlertCircle size={14} color="#EF4444" />
          <span style={{ fontSize: 11, color: "#FCA5A5" }}>{error}</span>
        </div>
      )}

      {/* TODAY'S SAVINGS — Hero card */}
      <div style={{ margin: "0 20px 16px", background: "linear-gradient(135deg, #0D1F14 0%, #071510 100%)", border: "1px solid #16A34A40", borderRadius: 20, padding: "24px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Saved today</div>
        <div style={{ fontSize: 48, fontWeight: 800, color: "#22C55E", letterSpacing: -2, lineHeight: 1 }}>£{savedToday}</div>
        <div style={{ fontSize: 12, color: "#4B5563", marginTop: 8 }}>
          {g.todaySolarKwh} kWh solar · {g.todayExportKwh} kWh exported
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PoundSterling size={14} color="#16A34A" />
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#F9FAFB" }}>£{monthlyTotal}</div>
              <div style={{ fontSize: 10, color: "#6B7280" }}>this month</div>
            </div>
          </div>
          <div style={{ width: 1, background: "#1F2937" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <TrendingUp size={14} color="#F59E0B" />
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#F9FAFB" }}>£{monthlyTotal * 12}</div>
              <div style={{ fontSize: 10, color: "#6B7280" }}>projected/yr</div>
            </div>
          </div>
        </div>
      </div>

      {/* GRIDLY DECISION */}
      <div style={{ margin: "0 20px 16px", background: "#111827", border: `1px solid ${opt.color}40`, borderRadius: 16, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: opt.color, fontWeight: 700, letterSpacing: 1.5 }}>RIGHT NOW</span>
          <span style={{ fontSize: 10, color: "#4B5563" }}>Auto-updates every 30 min</span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: opt.color, letterSpacing: -0.5 }}>
           {indexView.headline}
        </div>
        <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 3 }}>
            {indexView.subheadline || opt.reason}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          {indexView.savingsEstimate > 0 && (
            <span style={{ fontSize: 11, color: "#22C55E", fontWeight: 700 }}>
              Saving est. £{indexView.savingsEstimate.toFixed(2)}
            </span>
          )}
          {indexView.confidenceLabel && (
            <span style={{ fontSize: 11, color: "#9CA3AF" }}>
              {indexView.confidenceLabel}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#6B7280" }}>
            {indexView.actionCount} planned actions
          </span>
        </div>
      </div>

      {/* NEXT UNLOCK — the one clear CTA */}
      {nextDevice && (
        <button onClick={() => navigate("/devices")} style={{
          margin: "0 20px 16px", width: "calc(100% - 40px)",
          background: `${nextDevice.color}10`, border: `2px solid ${nextDevice.color}30`,
          borderRadius: 16, padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", textAlign: "left"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ background: `${nextDevice.color}20`, borderRadius: 12, padding: 10 }}>
              <nextDevice.icon size={22} color={nextDevice.color} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB" }}>Add your {nextDevice.name}</div>
              <div style={{ fontSize: 12, color: "#9CA3AF" }}>Worth an extra <span style={{ color: nextDevice.color, fontWeight: 700 }}>£{nextDevice.monthlyValue}/month</span></div>
            </div>
          </div>
          <ChevronRight size={20} color={nextDevice.color} />
        </button>
      )}

      {/* CONNECTED DEVICES — compact list */}
      <div style={{ margin: "0 20px 16px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>Connected devices</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {connectedDevices.map(device => (
            <div key={device.id} style={{
              background: "#111827", border: "1px solid #1F2937", borderRadius: 12,
              padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <device.icon size={16} color={device.color} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#E5E7EB" }}>{device.name}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#22C55E" }}>+£{device.monthlyValue}/mo</span>
            </div>
          ))}
        </div>
      </div>

      {/* PRICE CHART */}
      <div style={{ margin: "0 20px 16px", background: "#111827", border: "1px solid #1F2937", borderRadius: 16, padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Electricity price</div>
            <div style={{ fontSize: 10, color: "#6B7280", marginTop: 1 }}>
              {currentRate ? `Now: ${currentRate.pence.toFixed(0)}p/kWh` : "Loading…"}
            </div>
          </div>
          {currentRate && (
            <div style={{
              background: currentRate.pence < 15 ? "#16A34A20" : currentRate.pence > 28 ? "#EF444420" : "#F59E0B20",
              borderRadius: 8, padding: "4px 10px"
            }}>
              <span style={{
                fontSize: 14, fontWeight: 800,
                color: currentRate.pence < 15 ? "#22C55E" : currentRate.pence > 28 ? "#EF4444" : "#F59E0B"
              }}>
                {currentRate.pence.toFixed(0)}p
              </span>
            </div>
          )}
        </div>
        {loading && !rates.length ? (
          <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: "#4B5563", fontSize: 12 }}>
            Loading prices…
          </div>
        ) : displayRates.length > 0 ? (
          <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
            {displayRates.map((r, i) => (
              <PriceBar key={r.from.toISOString()} rate={r} isNow={i === 0 && !!currentRate} />
            ))}
          </div>
        ) : (
          <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: "#4B5563", fontSize: 12 }}>
            No data
          </div>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          {([["#22C55E", "Cheap"], ["#F59E0B", "Mid"], ["#EF4444", "Peak"]] as const).map(([c, l]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: 2, background: c }} />
              <span style={{ fontSize: 10, color: "#6B7280" }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "#374151" }}>
        Aveum · {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Connecting…"}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default Index;
