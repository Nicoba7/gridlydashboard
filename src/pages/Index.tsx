import { useState, useEffect, useCallback } from "react";
import { Sun, Zap, Battery, ArrowUpRight, PoundSterling, TrendingUp, RefreshCw, Wifi, WifiOff, ChevronRight, AlertCircle } from "lucide-react";

// ── SANDBOX DATA (replace with real API keys when ready) ──────────────────
const SANDBOX = {
  givenergy: {
    solarW: 2840,
    batteryPct: 62,
    batteryKwh: 8.1,
    batteryCapKwh: 13.5,
    gridImportW: 0,
    gridExportW: 420,
    consumptionW: 1200,
    todaySolarKwh: 12.0,
    todayExportKwh: 4.2,
    todayImportKwh: 0.8,
  },
  zappi: {
    evPct: 85,
    evKwh: 40,
    evCapKwh: 77,
    status: "COMPLETE" as const,
    mode: "ECO+" as const,
    sessionKwh: 24.5,
  },
};

// ── OCTOPUS AGILE LIVE PRICES ─────────────────────────────────────────────
interface Rate {
  from: Date;
  to: Date;
  pence: number;
}

async function fetchAgileRates(): Promise<Rate[]> {
  const url = `https://api.allorigins.win/get?url=${encodeURIComponent('https://api.octopus.energy/v1/products/AGILE-FLEX-22-11-25/electricity-tariffs/E-1R-AGILE-FLEX-22-11-25-C/standard-unit-rates/?page_size=50')}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Octopus API error");
  const data = JSON.parse((await res.json()).contents);
  return data.results
    .map((r: any) => ({
      from: new Date(r.valid_from),
      to: new Date(r.valid_to),
      pence: r.value_inc_vat,
    }))
    .sort((a: Rate, b: Rate) => a.from.getTime() - b.from.getTime());
}

function getCurrentRate(rates: Rate[]): Rate | null {
  const now = new Date();
  return rates.find((r) => now >= r.from && now < r.to) || null;
}

function getNextRates(rates: Rate[], n = 6): Rate[] {
  const now = new Date();
  return rates.filter((r) => r.from > now).slice(0, n);
}

// ── OPTIMISATION ENGINE ───────────────────────────────────────────────────
function optimise({ currentRate, nextRates, battery, ev }: {
  currentRate: Rate | null;
  nextRates: Rate[];
  battery: { pct: number };
  ev: { pct: number };
}) {
  if (!currentRate) return { action: "HOLD", reason: "Waiting for price data", color: "#6B7280" };

  const p = currentRate.pence;
  const avgNext = nextRates.length
    ? nextRates.reduce((s, r) => s + r.pence, 0) / nextRates.length
    : p;
  const batteryLow = battery.pct < 20;
  const batteryFull = battery.pct > 90;
  const evNeeded = ev.pct < 80;

  if (p < 0) return { action: "CHARGE MAX", reason: `Negative price — free electricity (${p.toFixed(1)}p)`, color: "#16A34A" };
  if (p < 10 && !batteryFull) return { action: "CHARGE BATTERY", reason: `Cheap rate ${p.toFixed(1)}p — filling battery`, color: "#22C55E" };
  if (p < 15 && evNeeded) return { action: "CHARGE EV", reason: `Good rate ${p.toFixed(1)}p — charging EV`, color: "#38BDF8" };
  if (p > 28 && !batteryLow) return { action: "EXPORT", reason: `High price ${p.toFixed(1)}p — exporting to grid`, color: "#F59E0B" };
  if (p > avgNext + 5 && !batteryLow) return { action: "EXPORT", reason: `Price ${p.toFixed(1)}p above avg — exporting`, color: "#F59E0B" };
  return { action: "HOLD", reason: `Price ${p.toFixed(1)}p — holding, no action needed`, color: "#6B7280" };
}

// ── HELPERS ───────────────────────────────────────────────────────────────
function fmt(n: number, d = 1) { return n.toFixed(d); }
function fmtP(p: number) { return p < 0 ? `${fmt(p)}p ⚡` : `${fmt(p)}p`; }
function calcTodaySavings(givenergy: typeof SANDBOX.givenergy, _currentRate: Rate | null) {
  const exportEarned = givenergy.todayExportKwh * 0.15;
  const importAvoided = givenergy.todaySolarKwh * 0.28;
  return (exportEarned + importAvoided).toFixed(2);
}

// ── COMPONENTS ────────────────────────────────────────────────────────────

function PriceBar({ rate, isNow }: { rate: Rate; isNow: boolean }) {
  const max = 35;
  const pct = Math.max(0, Math.min(100, ((rate.pence + 5) / (max + 5)) * 100));
  const color = rate.pence < 0 ? "#16A34A" : rate.pence < 15 ? "#22C55E" : rate.pence < 25 ? "#F59E0B" : "#EF4444";
  const h = rate.from.getHours().toString().padStart(2, "0");
  const m = rate.from.getMinutes().toString().padStart(2, "0");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1 }}>
      <span style={{ fontSize: 9, color: isNow ? "#fff" : "#9CA3AF", fontWeight: isNow ? 700 : 400 }}>
        {fmtP(rate.pence)}
      </span>
      <div style={{ width: "100%", height: 48, background: "#1F2937", borderRadius: 4, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: `${pct}%`, background: color,
          borderRadius: "3px 3px 0 0",
          opacity: isNow ? 1 : 0.5,
          transition: "height 0.5s ease",
        }} />
        {isNow && <div style={{ position: "absolute", inset: 0, border: `1.5px solid ${color}`, borderRadius: 4 }} />}
      </div>
      <span style={{ fontSize: 9, color: isNow ? "#fff" : "#6B7280" }}>{h}:{m}</span>
    </div>
  );
}

function CircleGauge({ pct, color, label, sub }: { pct: number; color: string; label: string; sub: string }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: 88, height: 88 }}>
        <svg width={88} height={88} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={44} cy={44} r={r} fill="none" stroke="#1F2937" strokeWidth={7} />
          <circle cx={44} cy={44} r={r} fill="none" stroke={color} strokeWidth={7}
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 1s ease" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#F9FAFB", lineHeight: 1 }}>{pct}%</span>
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#E5E7EB" }}>{label}</span>
      <span style={{ fontSize: 10, color: "#6B7280" }}>{sub}</span>
    </div>
  );
}

function InlineStatCard({ icon: Icon, bg, iconColor, label, value, unit, sub }: {
  icon: React.ElementType;
  bg: string;
  iconColor: string;
  label: string;
  value: string | number;
  unit: string;
  sub?: string;
}) {
  return (
    <div style={{ background: "#111827", border: "1px solid #1F2937", borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
      <div style={{ background: bg, borderRadius: 12, padding: 8, flexShrink: 0 }}>
        <Icon size={18} color={iconColor} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#F9FAFB", lineHeight: 1.1 }}>
          {value} <span style={{ fontSize: 12, fontWeight: 400, color: "#9CA3AF" }}>{unit}</span>
        </div>
        {sub && <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────
const Index = () => {
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());

  const g = SANDBOX.givenergy;
  const z = SANDBOX.zappi;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchAgileRates();
      setRates(r);
      setLastUpdated(new Date());
    } catch (e) {
      setError("Could not load live prices — showing last known data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const currentRate = getCurrentRate(rates);
  const nextRates = getNextRates(rates, 8);
  const displayRates = currentRate ? [currentRate, ...nextRates] : nextRates;
  const opt = optimise({ currentRate, nextRates, battery: { pct: g.batteryPct }, ev: { pct: z.evPct } });
  const savedToday = calcTodaySavings(g, currentRate);
  const exportEarned = (g.todayExportKwh * 0.15).toFixed(2);

  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div style={{
      minHeight: "100vh",
      background: "#030712",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      color: "#F9FAFB",
      maxWidth: 420,
      margin: "0 auto",
      paddingBottom: 40,
    }}>

      {/* Header */}
      <div style={{ padding: "48px 20px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>{dateStr}</div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>{greeting} ☀️</div>
            <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 2 }}>Your home energy at a glance</div>
          </div>
          <button onClick={load} style={{ background: "#111827", border: "1px solid #1F2937", borderRadius: 10, padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {loading
              ? <RefreshCw size={14} color="#6B7280" style={{ animation: "spin 1s linear infinite" }} />
              : error
                ? <WifiOff size={14} color="#EF4444" />
                : <Wifi size={14} color="#16A34A" />}
            <span style={{ fontSize: 11, color: "#9CA3AF" }}>
              {loading ? "Loading…" : error ? "Offline" : "Live"}
            </span>
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ margin: "0 20px 12px", background: "#1F1010", border: "1px solid #7F1D1D", borderRadius: 12, padding: "10px 14px", display: "flex", gap: 8, alignItems: "center" }}>
          <AlertCircle size={14} color="#EF4444" />
          <span style={{ fontSize: 11, color: "#FCA5A5" }}>{error}</span>
        </div>
      )}

      {/* Optimisation decision */}
      <div style={{ margin: "0 20px 16px", background: "#0D1F14", border: `1px solid ${opt.color}40`, borderRadius: 16, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: opt.color, fontWeight: 700, letterSpacing: 1.5 }}>GRIDLY DECISION</span>
          <span style={{ fontSize: 10, color: "#4B5563" }}>Updates every 30 min</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: opt.color, letterSpacing: -0.5 }}>{opt.action}</div>
        <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 3 }}>{opt.reason}</div>
      </div>

      {/* Savings summary */}
      <div style={{ margin: "0 20px 16px", background: "#111827", border: "1px solid #1F2937", borderRadius: 16, padding: "16px", display: "flex", gap: 12 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: "#16A34A20", borderRadius: 12, padding: 8 }}>
            <PoundSterling size={18} color="#16A34A" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6B7280" }}>Saved today</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#F9FAFB" }}>£{savedToday}</div>
          </div>
        </div>
        <div style={{ width: 1, background: "#1F2937" }} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: "#F59E0B20", borderRadius: 12, padding: 8 }}>
            <TrendingUp size={18} color="#F59E0B" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6B7280" }}>Earned (export)</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#F9FAFB" }}>£{exportEarned}</div>
          </div>
        </div>
      </div>

      {/* Battery gauges */}
      <div style={{ margin: "0 20px 16px", background: "#111827", border: "1px solid #1F2937", borderRadius: 16, padding: "20px", display: "flex", justifyContent: "space-around" }}>
        <CircleGauge pct={z.evPct} color="#38BDF8" label="EV Battery" sub={`${z.evKwh} kWh charged`} />
        <CircleGauge pct={g.batteryPct} color="#16A34A" label="Home Battery" sub={`${g.batteryKwh} / ${g.batteryCapKwh} kWh`} />
      </div>

      {/* Stat grid */}
      <div style={{ margin: "0 20px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <InlineStatCard icon={Sun} bg="#F59E0B20" iconColor="#F59E0B" label="Solar Generated" value={fmt(g.todaySolarKwh)} unit="kWh" sub="Peak at 12:15pm" />
        <InlineStatCard icon={Zap} bg="#38BDF820" iconColor="#38BDF8" label="EV Charging" value={z.evKwh} unit="kWh" sub={z.status === "COMPLETE" ? "Fully charged ✓" : `${z.mode} mode`} />
        <InlineStatCard icon={Battery} bg="#16A34A20" iconColor="#16A34A" label="Battery Stored" value={fmt(g.batteryKwh)} unit="kWh" sub={`${g.batteryPct}% capacity`} />
        <InlineStatCard icon={ArrowUpRight} bg="#A78BFA20" iconColor="#A78BFA" label="Grid Export" value={fmt(g.todayExportKwh)} unit="kWh" sub={`£${exportEarned} earned`} />
      </div>

      {/* Agile price chart */}
      <div style={{ margin: "0 20px 16px", background: "#111827", border: "1px solid #1F2937", borderRadius: 16, padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Octopus Agile Prices</div>
            <div style={{ fontSize: 10, color: "#6B7280", marginTop: 1 }}>
              {currentRate ? `Now: ${fmtP(currentRate.pence)} · ` : ""}Live half-hourly
            </div>
          </div>
          {currentRate && (
            <div style={{ background: currentRate.pence < 15 ? "#16A34A20" : currentRate.pence > 28 ? "#EF444420" : "#F59E0B20", borderRadius: 8, padding: "4px 10px" }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: currentRate.pence < 15 ? "#22C55E" : currentRate.pence > 28 ? "#EF4444" : "#F59E0B" }}>
                {fmtP(currentRate.pence)}
              </span>
            </div>
          )}
        </div>

        {loading && !rates.length ? (
          <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: "#4B5563", fontSize: 12 }}>
            Loading live prices…
          </div>
        ) : displayRates.length > 0 ? (
          <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
            {displayRates.map((r, i) => (
              <PriceBar key={r.from.toISOString()} rate={r} isNow={i === 0 && !!currentRate} />
            ))}
          </div>
        ) : (
          <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: "#4B5563", fontSize: 12 }}>
            No price data available
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          {([["#22C55E", "< 15p Cheap"], ["#F59E0B", "15–28p Mid"], ["#EF4444", "> 28p Peak"]] as const).map(([c, l]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
              <span style={{ fontSize: 10, color: "#6B7280" }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Energy flow summary */}
      <div style={{ margin: "0 20px 16px", background: "#111827", border: "1px solid #1F2937", borderRadius: 16, padding: "16px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Live Energy Flow</div>
        {[
          { label: "Solar generation", value: `${(g.solarW / 1000).toFixed(1)} kW`, color: "#F59E0B", pct: (g.solarW / 4000) * 100 },
          { label: "Home consumption", value: `${(g.consumptionW / 1000).toFixed(1)} kW`, color: "#6366F1", pct: (g.consumptionW / 4000) * 100 },
          { label: "Grid export", value: `${(g.gridExportW / 1000).toFixed(2)} kW`, color: "#A78BFA", pct: (g.gridExportW / 4000) * 100 },
        ].map((row) => (
          <div key={row.label} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>{row.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: row.color }}>{row.value}</span>
            </div>
            <div style={{ height: 4, background: "#1F2937", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${row.pct}%`, background: row.color, borderRadius: 99, transition: "width 1s ease" }} />
            </div>
          </div>
        ))}
      </div>

      {/* Annual projection */}
      <div style={{ margin: "0 20px", background: "#0D1F14", border: "1px solid #16A34A40", borderRadius: 16, padding: "16px" }}>
        <div style={{ fontSize: 10, color: "#16A34A", fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>ANNUAL PROJECTION</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#22C55E", letterSpacing: -1 }}>£1,400</div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>combined savings & grid earnings</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#6B7280" }}>vs unoptimised</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#4B5563", textDecoration: "line-through" }}>£400</div>
          </div>
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #1A3D26" }}>
          {[
            ["Solar self-consumption", "£420"],
            ["Battery arbitrage", "£380"],
            ["EV smart charging", "£310"],
            ["Grid export income", "£180"],
            ["Demand Flexibility (Phase 2)", "£110"],
          ].map(([label, val]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: "#6B7280" }}>{label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#22C55E" }}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", marginTop: 32, fontSize: 10, color: "#374151" }}>
        Gridly · Household Energy OS · {lastUpdated ? `Prices updated ${lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Connecting…"}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default Index;
