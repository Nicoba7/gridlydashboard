import { useEffect, useState } from "react";
import { Sun, Cloud, CloudRain, TrendingUp, Zap, Battery } from "lucide-react";
import type { GridlyPlanSession } from "../types/planCompat";
import { getSessionActionLabel } from "../components/plan/planViewModels";

// ── SANDBOX FORECAST DATA ─────────────────────────────────────────────────
// In production: Solcast API for solar, Octopus API for tomorrow's Agile prices
const FORECAST = {
  solar: {
    expectedKwh: 14.2,
    peakW: 3100,
    peakHour: "12:30pm",
    confidence: 87,
    weather: "sunny" as "sunny" | "cloudy" | "rainy",
    weatherLabel: "Sunny with light cloud",
  },
  prices: {
    cheapestSlot: { time: "3:00am", pence: 4.2 },
    peakSlot: { time: "5:30pm", pence: 36.8 },
    avgPence: 14.6,
    cheapWindows: ["1:00am–5:00am", "11:00am–2:00pm"],
  },
  forecast: {
    savedTomorrow: 4.18,
    earnedTomorrow: 2.31,
    totalTomorrow: 6.49,
    batteryFullBy: "4:30am",
    exportWindow: "5:00pm–7:00pm",
    evChargeBy: "6:00am",
  },
};

// ── WEATHER ICON ──────────────────────────────────────────────────────────
function WeatherIcon({ type, size = 20 }: { type: string; size?: number }) {
  if (type === "sunny") return <Sun size={size} color="#F59E0B" />;
  if (type === "rainy") return <CloudRain size={size} color="#60A5FA" />;
  return <Cloud size={size} color="#9CA3AF" />;
}

// ── MINI PRICE BARS (tomorrow's prices) ──────────────────────────────────
const TOMORROW_RATES = [
  6.8, 6.1, 5.4, 4.8, 4.2, 4.6, 5.9, 9.2, 16.4, 22.1, 18.4, 14.2,
  11.8, 10.2, 9.6, 9.1, 10.4, 14.6, 22.1, 28.4, 34.2, 36.8, 31.2, 22.4,
  18.2, 14.6, 12.1, 10.8, 9.4, 8.7, 8.1, 7.6, 7.1, 6.8, 6.4, 6.1,
  5.8, 5.4, 5.1, 4.8, 6.2, 8.4, 12.6, 18.2, 24.4, 28.8, 22.4, 14.2,
];

function getBarColor(p: number) {
  if (p < 10) return "#22C55E";
  if (p < 20) return "#F59E0B";
  if (p < 30) return "#F97316";
  return "#EF4444";
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────
function sessionLabel(session: GridlyPlanSession) {
  return getSessionActionLabel(session.type);
}

function sessionIcon(session: GridlyPlanSession) {
  if (session.type === "battery_charge") return <Battery size={15} color="#22C55E" />;
  if (session.type === "ev_charge") return <Zap size={15} color="#38BDF8" />;
  if (session.type === "export") return <TrendingUp size={15} color="#F59E0B" />;
  if (session.type === "solar_use") return <Sun size={15} color="#F59E0B" />;
  return <Cloud size={15} color="#9CA3AF" />;
}

function sessionStyles(session: GridlyPlanSession) {
  if (session.type === "battery_charge") return { bg: "#16A34A10", border: "#16A34A20" };
  if (session.type === "ev_charge") return { bg: "#38BDF810", border: "#38BDF820" };
  if (session.type === "export") return { bg: "#F59E0B10", border: "#F59E0B20" };
  if (session.type === "solar_use") return { bg: "#F59E0B08", border: "#F59E0B15" };
  return { bg: "#6B728010", border: "#6B728020" };
}

export default function TomorrowForecast({ sessions }: { sessions: GridlyPlanSession[] }) {
  const [revealed, setRevealed] = useState(false);
  const maxPence = Math.max(...TOMORROW_RATES);
  const f = FORECAST;

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ background: "#0D1117", border: "1px solid #1F2937", borderRadius: 12, padding: "16px", marginBottom: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", letterSpacing: 1, marginBottom: 4 }}>TOMORROW'S FORECAST</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <WeatherIcon type={f.solar.weather} size={16} />
            <span style={{ fontSize: 13, color: "#9CA3AF" }}>{f.solar.weatherLabel}</span>
          </div>
        </div>
        <div style={{ background: "#16A34A15", border: "1px solid #16A34A30", borderRadius: 8, padding: "4px 10px", textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 1 }}>confidence</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#22C55E" }}>{f.solar.confidence}%</div>
        </div>
      </div>

      {/* Big number */}
      <div style={{ background: "linear-gradient(135deg, #0D1F14, #071510)", border: "1px solid #16A34A25", borderRadius: 14, padding: "20px", marginBottom: 14, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Gridly expects to make you</div>
        <div style={{
          fontSize: 48, fontWeight: 900, color: "#22C55E", letterSpacing: -2, lineHeight: 1,
          opacity: revealed ? 1 : 0, transform: revealed ? "translateY(0)" : "translateY(8px)",
          transition: "all 0.6s ease",
        }}>
          +£{f.forecast.totalTomorrow}
        </div>
        <div style={{ fontSize: 12, color: "#4B5563", marginTop: 6 }}>tomorrow</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#22C55E" }}>£{f.forecast.savedTomorrow}</div>
            <div style={{ fontSize: 10, color: "#6B7280" }}>saved</div>
          </div>
          <div style={{ width: 1, background: "#1F2937" }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#F59E0B" }}>£{f.forecast.earnedTomorrow}</div>
            <div style={{ fontSize: 10, color: "#6B7280" }}>earned</div>
          </div>
        </div>
      </div>

      {/* What Gridly will do */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>WHAT GRIDLY WILL DO</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions.map((session, index) => {
            const style = sessionStyles(session);
            return (
              <div
                key={`${session.type}-${session.start}-${session.end}-${index}`}
                style={{ display: "flex", alignItems: "center", gap: 10, background: style.bg, border: `1px solid ${style.border}`, borderRadius: 10, padding: "10px 12px" }}
              >
                {sessionIcon(session)}
                <span style={{ fontSize: 13, color: "#E5E7EB" }}>
                  {sessionLabel(session)} <strong style={{ color: session.color }}>{session.start}–{session.end}</strong>
                  {session.priceRange ? ` at ${session.priceRange}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tomorrow's price chart */}
      <div>
        <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>TOMORROW'S PRICES</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5, height: 48 }}>
          {TOMORROW_RATES.map((p, i) => (
            <div key={i} style={{ flex: 1, height: Math.max(2, (p / maxPence) * 48), background: getBarColor(p), borderRadius: "1px 1px 0 0", opacity: 0.8 }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#374151" }}>
          <span>12am</span>
          <span>6am</span>
          <span>12pm</span>
          <span>6pm</span>
          <span>11pm</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "#6B7280" }}>
          <span>Cheapest: <span style={{ color: "#22C55E", fontWeight: 700 }}>{f.prices.cheapestSlot.pence}p</span> at {f.prices.cheapestSlot.time}</span>
          <span>Peak: <span style={{ color: "#EF4444", fontWeight: 700 }}>{f.prices.peakSlot.pence}p</span> at {f.prices.peakSlot.time}</span>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #1F2937", fontSize: 10, color: "#374151", textAlign: "center" }}>
        Forecast uses Solcast solar prediction + Octopus Agile prices · Updates at midnight
      </div>
    </div>
  );
}
