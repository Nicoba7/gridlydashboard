import { useState } from "react";
import FlowDot from "./FlowDot";
import { getGridlyMode, getModeDescription } from "../lib/gridlyEngine";
import { Battery, Home, Sun, TrendingUp, Zap } from "lucide-react";
import TomorrowForecast from "../pages/TomorrowForecast";
import {
  AGILE_RATES,
  SANDBOX,
  MODE_CONFIG,
  getCurrentSlotIndex,
  getBestChargeSlot,
  DeviceHealthAlerts,
  NightlyReportCard,
  BoostButton,
  ChargerLock,
  CarbonTracker,
  ManualOverride,
  EVReadyBy,
  BatteryReserve,
  SolarForecastCard,
  CrossDeviceCoordination,
  BatteryHealthScore,
  TariffSwitcher,
  DeviceConfig,
} from "../pages/SimplifiedDashboard";


type OptimisationGoal = "MAX_SAVINGS" | "LOWEST_CARBON" | "BATTERY_CARE" | "EV_READY";

const GOAL_OPTIONS: { id: OptimisationGoal; label: string; hint: string }[] = [
  { id: "MAX_SAVINGS", label: "Save most", hint: "Prioritise lowest cost and export value" },
  { id: "LOWEST_CARBON", label: "Lowest carbon", hint: "Shift usage into cleaner grid windows" },
  { id: "BATTERY_CARE", label: "Battery care", hint: "Reduce deep cycling to extend lifespan" },
  { id: "EV_READY", label: "EV ready", hint: "Prioritise hitting your ready-by target" },
];

type CopilotAction = "START_CHARGE" | "DELAY_90" | "PAUSE_UNTIL_CHEAP" | "EXPORT_NOW" | "HOLD";

type CopilotRecommendation = {
  title: string;
  reason: string;
  impact: string;
  action: CopilotAction;
};

function buildCopilotRecommendation({
  mode,
  currentPence,
  bestSlotPence,
  hasBattery,
  hasGrid,
  hasEV,
  optimisationGoal,
}: {
  mode: ReturnType<typeof getGridlyMode>;
  currentPence: number;
  bestSlotPence: number;
  hasBattery: boolean;
  hasGrid: boolean;
  hasEV: boolean;
  optimisationGoal: OptimisationGoal;
}): CopilotRecommendation {
  if (mode === "EXPORT" && hasBattery && hasGrid) {
    return {
      title: "Export now",
      reason: "Current price is in a premium window, so this is a strong earning slot.",
      impact: "Estimated +£0.45 this hour",
      action: "EXPORT_NOW",
    };
  }

  if (currentPence - bestSlotPence >= 4 && (hasBattery || hasEV)) {
    return {
      title: "Delay charging by 90 minutes",
      reason: `A cheaper slot is coming (${bestSlotPence.toFixed(1)}p). Waiting captures better value.`,
      impact: `Estimated saving ~£${((currentPence - bestSlotPence) * 0.08).toFixed(2)}`,
      action: "DELAY_90",
    };
  }

  if (optimisationGoal === "EV_READY" && hasEV) {
    return {
      title: "Start EV charging now",
      reason: "EV-ready mode prioritises hitting your target on time.",
      impact: "Higher readiness confidence by departure time",
      action: "START_CHARGE",
    };
  }

  if (optimisationGoal === "LOWEST_CARBON") {
    return {
      title: "Pause until cleaner window",
      reason: "Lowest-carbon mode shifts usage to greener grid periods.",
      impact: "Lower CO₂ intensity for this session",
      action: "PAUSE_UNTIL_CHEAP",
    };
  }

  return {
    title: "Hold current plan",
    reason: "Gridly is already in a near-optimal state for your selected goal.",
    impact: "No major change expected",
    action: "HOLD",
  };
}

type ExplainabilityInput = {
  mode: ReturnType<typeof getGridlyMode>;
  currentPence: number;
  batteryPct: number;
  solarW: number;
  evPct: number;
  evTargetPct: number;
  hasBattery: boolean;
  hasEV: boolean;
  hasSolar: boolean;
  hasGrid: boolean;
  optimisationGoal: OptimisationGoal;
  minBatteryReserve: number;
};

function buildExplainability(input: ExplainabilityInput) {
  const {
    mode,
    currentPence,
    batteryPct,
    solarW,
    evPct,
    evTargetPct,
    hasBattery,
    hasEV,
    hasSolar,
    hasGrid,
    optimisationGoal,
    minBatteryReserve,
  } = input;

  const expensive = currentPence >= 30;
  const cheap = currentPence <= 8;
  const strongSolar = hasSolar && solarW > 2000;
  const batteryHealthy = hasBattery && batteryPct > 40;
  const evGap = Math.max(0, evTargetPct - evPct);

  let confidence = 62;
  if (cheap || expensive) confidence += 14;
  if (strongSolar) confidence += 10;
  if (batteryHealthy) confidence += 6;
  if (hasEV && evGap > 20) confidence += 4;
  confidence = Math.min(96, confidence);

  let alternativeAction = "HOLD";
  if (mode === "EXPORT") alternativeAction = "HOLD";
  else if (mode === "SOLAR") alternativeAction = hasEV ? "EV_CHARGE" : "HOLD";
  else if (mode === "CHARGE") alternativeAction = hasEV && evGap > 0 ? "EV_CHARGE" : "HOLD";
  else if (mode === "EV_CHARGE" || mode === "SPLIT_CHARGE") alternativeAction = hasBattery ? "CHARGE" : "HOLD";
  else if (mode === "HOLD" && cheap && hasBattery) alternativeAction = "CHARGE";

  const altImpact =
    mode === "EXPORT"
      ? "~£0.40 lower earnings this hour"
      : mode === "HOLD"
      ? "~£0.22 higher import cost likely"
      : "~£0.18 less value captured this hour";

  const doNothingImpact =
    mode === "HOLD"
      ? "Very similar outcome. Gridly is already preserving flexibility."
      : mode === "EXPORT"
      ? "You'd miss a peak-export window while prices are elevated."
      : "You'd likely import more at higher prices later today.";

  const signals = [
    `Live price: ${currentPence.toFixed(1)}p/kWh`,
    `Battery: ${hasBattery ? `${batteryPct}%` : "Not connected"}`,
    `Solar: ${hasSolar ? `${(solarW / 1000).toFixed(1)}kW` : "Not connected"}`,
    `EV target gap: ${hasEV ? `${evGap}%` : "No EV connected"}`,
    `Export path: ${hasGrid ? "Available" : "Unavailable"}`,
    `Goal: ${GOAL_OPTIONS.find((goal) => goal.id === optimisationGoal)?.label ?? "Custom"}`,
    `Min battery reserve: ${minBatteryReserve}%`,
  ];

  return { confidence, alternativeAction, altImpact, doNothingImpact, signals };
}

export default function HomeTab({ connectedDevices, now }: { connectedDevices: DeviceConfig[]; now: Date }) {
  const [optimisationGoal, setOptimisationGoal] = useState<OptimisationGoal>("MAX_SAVINGS");
  const [minBatteryReserve, setMinBatteryReserve] = useState(20);
  const [copilotStatus, setCopilotStatus] = useState("No manual action taken yet.");
  const [showControls, setShowControls] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const slotIndex = getCurrentSlotIndex();
  const currentPence = AGILE_RATES[slotIndex].pence;
  const best = getBestChargeSlot();
  const s = SANDBOX.solar;

  const hasBattery = connectedDevices.some(d => d.id === "battery");
  const hasEV = connectedDevices.some(d => d.id === "ev");
  const hasSolar = connectedDevices.some(d => d.id === "solar");
  const hasGrid = connectedDevices.some(d => d.id === "grid");

  const evState = {
    connected: hasEV,
    pct: 38,
    targetPct: 80,
    readyByHour: 7,
  };

  const mode = getGridlyMode({
    price: currentPence,
    solarW: s.w,
    batteryPct: s.batteryPct,
    hasBattery,
    hasSolar,
    hasEV,
    hasGrid,
    evConnected: evState.connected,
    evPct: evState.pct,
    evTargetPct: evState.targetPct,
    readyByHour: evState.readyByHour,
  });

  const cfg = MODE_CONFIG[mode];
  const isExporting = mode === "EXPORT" || s.gridW > 0;
  const isCharging =
    mode === "CHARGE" ||
    mode === "EV_CHARGE" ||
    mode === "SPLIT_CHARGE";
  const recommendation = buildCopilotRecommendation({
    mode,
    currentPence,
    bestSlotPence: best.pence,
    hasBattery,
    hasGrid,
    hasEV,
    optimisationGoal,
  });

  return (
    <div>
      <div style={{ padding: "44px 24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginBottom: 2 }}>{greeting}</div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>
          {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>

      {/* Device health alerts — top priority */}
      <DeviceHealthAlerts connectedDevices={connectedDevices} />

      {/* Mode card — hero, first thing user sees */}
      <div style={{ margin: "0 20px 16px", background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 16, padding: "16px 20px" }}>
        <div style={{ fontSize: 10, color: cfg.color, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>RIGHT NOW</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: cfg.color, letterSpacing: -0.5, marginBottom: 4 }}>{cfg.icon} {cfg.label}</div>
        <div style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.5 }}>
          {getModeDescription(mode, {
            price: currentPence,
            solarW: s.w,
            batteryPct: s.batteryPct,
            hasBattery,
            hasSolar,
            hasEV,
            hasGrid,
            evConnected: evState.connected,
            evPct: evState.pct,
            evTargetPct: evState.targetPct,
            readyByHour: evState.readyByHour,
          })}
        </div>
      </div>

      <div style={{ margin: "0 20px 16px", background: "#0E1726", border: "1px solid #1E293B", borderRadius: 16, padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "#93C5FD", fontWeight: 700, letterSpacing: 1.2 }}>GRIDLY BRIEF</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => setShowHelp((v) => !v)}
              style={{ background: "none", border: "none", color: "#93C5FD", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >
              {showHelp ? "Close help" : "Help"}
            </button>
            <button
              onClick={() => setShowControls((v) => !v)}
              style={{ background: "none", border: "none", color: "#60A5FA", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >
              {showControls ? "Done" : "Tune"}
            </button>
          </div>
        </div>

        {showHelp && (
          <div style={{ marginBottom: 10, background: "#0F172A", border: "1px solid #1E293B", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, color: "#E2E8F0", fontWeight: 700, marginBottom: 6 }}>How this works</div>
            <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.5 }}>
              Gridly watches price and your devices, then suggests one best move right now. Use <span style={{ color: "#E2E8F0" }}>Do it now</span> to accept or <span style={{ color: "#E2E8F0" }}>Not now</span> to skip. Tap <span style={{ color: "#E2E8F0" }}>Tune</span> only if you want to change your goal or reserve level.
            </div>
          </div>
        )}

        <div style={{ fontSize: 18, fontWeight: 800, color: "#F9FAFB", marginBottom: 4 }}>{recommendation.title}</div>
        <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8 }}>{recommendation.impact}</div>

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            onClick={() => setCopilotStatus(`Applied: ${recommendation.title}`)}
            style={{ background: "#16A34A20", border: "1px solid #16A34A50", color: "#86EFAC", borderRadius: 10, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Do it now
          </button>
          <button
            onClick={() => setCopilotStatus(`Skipped: ${recommendation.title}`)}
            style={{ background: "#0F172A", border: "1px solid #334155", color: "#94A3B8", borderRadius: 10, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Not now
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#64748B" }}>{copilotStatus}</div>

        {showControls && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1E293B", display: "grid", gap: 8 }}>
            <label style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700 }}>
              Goal
              <select
                value={optimisationGoal}
                onChange={(event) => setOptimisationGoal(event.target.value as OptimisationGoal)}
                style={{ marginLeft: 8, background: "#0F172A", color: "#E2E8F0", border: "1px solid #334155", borderRadius: 8, padding: "4px 8px", fontFamily: "inherit", fontSize: 12 }}
              >
                {GOAL_OPTIONS.map((goal) => (
                  <option key={goal.id} value={goal.id}>{goal.label}</option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 11, color: "#94A3B8" }}>Reserve {minBatteryReserve}%</div>
              <input
                type="range"
                min={10}
                max={50}
                step={5}
                value={minBatteryReserve}
                onChange={(event) => setMinBatteryReserve(Number(event.target.value))}
                style={{ width: 140 }}
              />
            </div>
          </div>
        )}
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

      {/* Nightly report card */}
      <NightlyReportCard />

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
  <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 20 }}>
    LIVE ENERGY FLOW
  </div>

  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>

    {connectedDevices.some(d => d.id === "solar") && (
      <>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 52, height: 52, background: "#F59E0B15", border: "1.5px solid #F59E0B30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
            <Sun size={22} color="#F59E0B" />
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>
            {(s.w / 1000).toFixed(1)}kW
          </div>
          <div style={{ fontSize: 10, color: "#6B7280" }}>Solar</div>
        </div>

        <FlowDot active={s.w > 0} color="#F59E0B" />
      </>
    )}

    <div style={{ textAlign: "center" }}>
      <div style={{ width: 52, height: 52, background: "#ffffff10", border: "1.5px solid #ffffff20", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
        <Home size={22} color="#E5E7EB" />
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>
        {(s.homeW / 1000).toFixed(1)}kW
      </div>
      <div style={{ fontSize: 10, color: "#6B7280" }}>Home</div>
    </div>

    {connectedDevices.some(d => d.id === "battery") && (
      <>
        <FlowDot active={isCharging} color="#16A34A" />

        <div style={{ textAlign: "center" }}>
          <div style={{ width: 52, height: 52, background: "#16A34A15", border: "1.5px solid #16A34A30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
            <Battery size={22} color="#22C55E" />
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>
            {s.batteryPct}%
          </div>
          <div style={{ fontSize: 10, color: "#6B7280" }}>Battery</div>
        </div>
      </>
    )}

    {connectedDevices.some(d => d.id === "ev") && (
      <>
        <FlowDot active={isCharging} color="#38BDF8" />

        <div style={{ textAlign: "center" }}>
          <div style={{ width: 52, height: 52, background: "#38BDF815", border: "1.5px solid #38BDF830", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
            <Zap size={22} color="#38BDF8" />
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#38BDF8" }}>
            Charging
          </div>
          <div style={{ fontSize: 10, color: "#6B7280" }}>EV</div>
        </div>
      </>
    )}

    {connectedDevices.some(d => d.id === "grid") && (
      <>
        <FlowDot active={isExporting} color="#F59E0B" />

        <div style={{ textAlign: "center" }}>
          <div style={{ width: 52, height: 52, background: isExporting ? "#F59E0B15" : "#ffffff05", border: `1.5px solid ${isExporting ? "#F59E0B30" : "#ffffff10"}`, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
            <TrendingUp size={22} color={isExporting ? "#F59E0B" : "#374151"} />
          </div>

          <div style={{ fontSize: 13, fontWeight: 800, color: isExporting ? "#F59E0B" : "#374151" }}>
            {isExporting ? `${(s.gridW / 1000).toFixed(1)}kW` : "—"}
          </div>

          <div style={{ fontSize: 10, color: "#6B7280" }}>
            {isExporting ? "Exporting" : "Grid"}
          </div>
        </div>
      </>
    )}

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
