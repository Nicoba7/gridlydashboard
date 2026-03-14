import { useMemo, useState } from "react";
import FlowDot from "./FlowDot";
import { optimizePlan } from "../engine/core/optimizePlan";
import { explainPlan } from "../engine/core/explainPlan";
import { mapEngineToHome } from "../features/home/mapEngineToHome";
import {
  buildAiRecommendation,
  recordAiFeedback,
  type OptimisationGoal,
} from "../lib/aiCopilot";
import { Battery, Home, Sun, TrendingUp, Zap } from "lucide-react";
import TomorrowForecast from "../pages/TomorrowForecast";
import { buildDayPlan } from "../lib/dayPlanner";
import {
  AGILE_RATES,
  SANDBOX,
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

function actionToColor(action?: string): string {
  const normalized = action?.toLowerCase().trim();
  if (normalized === "charge" || normalized === "charging") return "#22C55E";
  if (normalized === "export" || normalized === "exporting") return "#10B981";
  return "#9CA3AF";
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

function actionToFriendlyLabel(action?: string): string {
  switch (action) {
    case "charge":
      return "Charging";
    case "export":
      return "Exporting";
    case "discharge":
      return "Discharging";
    case "import":
      return "Importing";
    case "hold":
    default:
      return "Holding";
  }
}

function shortenReason(reason?: string): string {
  if (!reason) return "";
  if (reason.includes("Strong solar is expected soon")) return "Solar expected soon — delaying charge";
  if (reason.includes("Import price is in a cheap window")) return "Cheap import window";
  if (reason.includes("Export price is high")) return "Peak export value";
  // Truncate long reasons
  if (reason.length > 50) return reason.substring(0, 47) + "...";
  return reason;
}

function mergeConsecutiveTimeline(timeline: any[]): TimelineRow[] {
  const result: TimelineRow[]  = [];
  for (const item of timeline) {
    const friendlyAction = actionToFriendlyLabel(item.action);
    const shortReason = shortenReason(item.reason);
    const last = result[result.length - 1];
    if (last && last.friendlyAction === friendlyAction && last.shortReason === shortReason) {
      // Skip duplicate
    } else {
      result.push({ ...item, friendlyAction, shortReason });
    }
  }
  return result;
}

function slotToTimeLabel(slot: number): string {
  const hours = Math.floor(slot / 2);
  const minutes = slot % 2 === 0 ? "00" : "30";
  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

function actionToIcon(action?: string): string {
  switch (action) {
    case "charge":
      return "⚡";
    case "export":
      return "↗";
    case "hold":
    default:
      return "⏸";
  }
}

type TimelineRow = {
  slot: number;
  action: string;
  reason: string;
  friendlyAction: string;
  shortReason: string;
};

type HeroViewModel = {
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  border: string;
  bg: string;
  savingsText?: string;
  confidenceText?: string;
  plannedActionsText: string;
};

type TimelineViewModel = {
  rows: TimelineRow[];
  currentSlot: number;
};

type BriefViewModel = {
  title: string;
  reason: string;
  confidence: number;
  expectedSavings: string;
  status: string;
};

type BriefProps = {
  viewModel: BriefViewModel;
  showHelp: boolean;
  showControls: boolean;
  optimisationGoal: OptimisationGoal;
  minBatteryReserve: number;
  setShowHelp: (value: boolean) => void;
  setShowControls: (value: boolean) => void;
  setOptimisationGoal: (goal: OptimisationGoal) => void;
  setMinBatteryReserve: (value: number) => void;
};

const GOAL_OPTIONS: { id: OptimisationGoal; label: string; hint: string }[] = [
  { id: "MAX_SAVINGS", label: "Save most", hint: "Prioritise lowest cost and export value" },
  { id: "LOWEST_CARBON", label: "Lowest carbon", hint: "Shift usage into cleaner grid windows" },
  { id: "BATTERY_CARE", label: "Battery care", hint: "Reduce deep cycling to extend lifespan" },
  { id: "EV_READY", label: "EV ready", hint: "Prioritise hitting your ready-by target" },
];

export default function HomeTab({ connectedDevices, now }: { connectedDevices: DeviceConfig[]; now: Date }) {
  const [optimisationGoal, setOptimisationGoal] = useState<OptimisationGoal>("MAX_SAVINGS");
  const [minBatteryReserve, setMinBatteryReserve] = useState(20);
  const [copilotStatus, setCopilotStatus] = useState("No manual action taken yet.");
  const [showControls, setShowControls] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showAllTime, setShowAllTime] = useState(false);
  const [showConnected, setShowConnected] = useState(false);
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

  const engineInput = {
    batterySocPercent: s.batteryPct,
    forecastLoadKwh: Array.from({ length: 8 }, () => Math.max((s.homeW ?? 1200) / 2000, 0.4)),
    forecastSolarKwh: Array.from({ length: 8 }, (_, i) => {
      if (!hasSolar) return 0;
      if (i >= 2 && i <= 4) return 2.8;
      if (i === 1 || i === 5) return 1.4;
      return 0.4;
    }),
    importPrice: Array.from({ length: 8 }, (_, i) => Math.max(0.05, (currentPence + i * 0.01) / 100)),
    exportPrice: Array.from({ length: 8 }, (_, i) => Math.max(0.05, (currentPence + i * 0.015) / 100)),
  };

const engineOutput = optimizePlan(engineInput);
const rawTimeline = engineOutput.timeline || [];
const cleanedTimeline = mergeConsecutiveTimeline(rawTimeline).slice(0, 4);
const homeView = mapEngineToHome(engineOutput);
const explanation = explainPlan(engineOutput);
const primaryRecommendation = engineOutput.recommendations[0];

// Derived UI state
const heroHeadlineText = (homeView.headline ?? actionToLabel(primaryRecommendation?.action) ?? "").toLowerCase().trim();

const heroColor =
  heroHeadlineText.includes("charging") || heroHeadlineText.includes("charge")
    ? "#22C55E"
    : heroHeadlineText.includes("export")
    ? "#059669"
    : heroHeadlineText.includes("holding") || heroHeadlineText.includes("hold")
    ? "#9CA3AF"
    : actionToColor(primaryRecommendation?.action);

const heroAction = primaryRecommendation?.action?.toLowerCase().trim();

const cfg = {
  color: heroColor,
  border: `${heroColor}40`,
  bg: "#111827",
  icon:
    heroAction === "charge" || heroAction === "charging"
      ? "⚡"
      : heroAction === "export" || heroAction === "exporting"
      ? "↗"
      : "⏸",
  label: homeView.headline ?? actionToLabel(primaryRecommendation?.action),
};
const isCharging = primaryRecommendation?.action === "charge";
const isExporting = primaryRecommendation?.action === "export";

const heroViewModel = {
  title: cfg.label,
  subtitle: homeView.subheadline ?? explanation.shortReason ?? "Gridly is evaluating the best time to act.",
  icon: cfg.icon,
  color: cfg.color,
  border: cfg.border,
  bg: cfg.bg,
  savingsText: homeView.savings !== undefined ? `Saving est. £${homeView.savings.toFixed(2)}` : undefined,
  confidenceText: explanation.confidenceLabel,
  plannedActionsText: `${homeView.actionCount} planned actions`,
};

const timelineViewModel = {
  rows: cleanedTimeline,
  currentSlot: slotIndex,
};

  const planner = useMemo(() => {
    const pricesPence = AGILE_RATES.map((rate) => rate.pence);
    const loadKwh = AGILE_RATES.map((_, i) => {
      const hour = Math.floor(i / 2);
      if (hour >= 17 && hour <= 21) return 0.95;
      if (hour >= 6 && hour <= 8) return 0.75;
      return 0.55;
    });
    const solarKwh = AGILE_RATES.map((_, i) => {
      const hour = i / 2;
      const daylightShape = Math.max(0, 1 - Math.abs(hour - 13) / 5);
      return Number((daylightShape * 0.8).toFixed(2));
    });

    return buildDayPlan({
      pricesPence,
      loadKwh,
      solarKwh,
      currentSlot: slotIndex,
      batteryCapacityKwh: 13.5,
      socStartKwh: (s.batteryPct / 100) * 13.5,
      minReserveKwh: (minBatteryReserve / 100) * 13.5,
      maxChargePerSlotKwh: 2.7,
      maxDischargePerSlotKwh: 2.7,
      chargeEfficiency: 0.92,
      dischargeEfficiency: 0.92,
      exportEnabled: hasGrid,
    });
  }, [slotIndex, s.batteryPct, minBatteryReserve, hasGrid]);

  const recommendation = buildAiRecommendation({
    mode: primaryRecommendation?.action === "charge"
      ? "CHARGE"
      : primaryRecommendation?.action === "export"
      ? "EXPORT"
      :"HOLD",
    currentPence,
    bestSlotPence: best.price,
    hasBattery,
    hasGrid,
    hasEV,
    optimisationGoal,
    projectedDayPlanSavings: Math.max(0, planner.projectedSavingsPounds),
  });

  const briefViewModel = {
    title: recommendation.title,
    reason: recommendation.reason,
    confidence: recommendation.confidence,
    expectedSavings: Math.max(0, planner.projectedSavingsPounds).toFixed(2),
    status: copilotStatus,
  };

  const renderRightNowCard = (heroVM: HeroViewModel) => (
    <div style={{ margin: "0 20px 20px", background: heroVM.bg, border: `1px solid ${heroVM.border}`, borderRadius: 16, padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: heroVM.color, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>RIGHT NOW</div>
      <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4, lineHeight: 1.2 }}>
        <span style={{ color: heroVM.color, marginLeft: 16 }}>
          {heroVM.icon} {heroVM.title}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.5 }}>
        <>
          {heroVM.subtitle}
          <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            {heroVM.savingsText && (
              <span style={{ fontSize: 11, color: "#22C55E", fontWeight: 700 }}>
                {heroVM.savingsText}
              </span>
            )}
            {heroVM.confidenceText && (
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                {heroVM.confidenceText}
              </span>
            )}
            <span style={{ fontSize: 11, color: "#6B7280" }}>
              {heroVM.plannedActionsText}
            </span>
          </div>
        </>
      </div>
    </div>
  );

  const renderTimelineCard = (timelineVM: TimelineViewModel) => (
    <div style={{ margin: "0 20px 20px", background: "#111827", border: "1px solid #1F2937", borderRadius: 16, padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "#93C5FD", fontWeight: 700, letterSpacing: 1.5, marginBottom: 12 }}>WHAT GRIDLY WILL DO NEXT</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {timelineVM.rows.map((item, index) => (
          <div
            key={`${item.slot}-${index}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              ...(item.slot === timelineVM.currentSlot
                ? {
                    background: "rgba(31, 41, 55, 0.7)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    margin: "-6px -10px",
                  }
                : {}),
            }}
          >
            <div style={{ fontSize: 11, color: "#6B7280", minWidth: 40, fontVariantNumeric: "tabular-nums" }}>
              {slotToTimeLabel(item.slot)}
              {item.slot === timelineVM.currentSlot && <span style={{ fontSize: 9, color: "#93C5FD", marginLeft: 4 }}>NOW</span>}
            </div>
            <div style={{ fontSize: 12, color: actionToColor(item.action), fontWeight: 700, minWidth: 76 }}>
              <span style={{ marginRight: 6 }}>{actionToIcon(item.action)}</span>
              {item.friendlyAction}
            </div>
            <div style={{ fontSize: 11, color: "#9CA3AF", flex: 1 }}>{item.shortReason}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderGridlyBriefCard = (props: BriefProps) => (
    <div style={{ margin: "0 20px 20px", background: "#0E1726", border: "1px solid #374151", borderRadius: 16, padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: "#93C5FD", fontWeight: 700, letterSpacing: 1.2 }}>GRIDLY BRIEF</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => props.setShowHelp(!props.showHelp)}
            style={{ background: "none", border: "none", color: "#93C5FD", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            {showHelp ? "Close help" : "Help"}
          </button>
          <button
            onClick={() => props.setShowControls(!props.showControls)}
            style={{ background: "none", border: "none", color: "#60A5FA", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            {showControls ? "Done" : "Optimise for"}
          </button>
        </div>
      </div>

      {props.showHelp && (
        <div style={{ marginBottom: 10, background: "#0F172A", border: "1px solid #1E293B", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 12, color: "#E2E8F0", fontWeight: 700, marginBottom: 6 }}>How this works</div>
          <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.5 }}>
             Gridly watches price and your devices, then suggests one best move right now. Use <span style={{ color: "#E2E8F0" }}>Do it now</span> to accept or <span style={{ color: "#E2E8F0" }}>Not now</span> to skip. Tap <span style={{ color: "#E2E8F0" }}>Tune</span> only if you want to change your goal or reserve level. <span style={{ color: "#E2E8F0" }}>AI confidence</span> tells you how strong today&apos;s signal is for this action, and <span style={{ color: "#E2E8F0" }}>Trust</span> reflects how consistently this recommendation pattern has worked for you over time.
          </div>
        </div>
      )}

      <div style={{ fontSize: 18, fontWeight: 800, color: "#F9FAFB", marginBottom: 4 }}>{props.viewModel.title}</div>
      <div style={{ fontSize: 13, color: "#64748B", marginBottom: 8 }}>
        {props.viewModel.reason} · AI confidence: {props.viewModel.confidence}% · Expected savings: £{props.viewModel.expectedSavings}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          onClick={() => {
            recordAiFeedback("accepted");
            setCopilotStatus(`Applied: ${props.viewModel.title}`);
          }}
          style={{ background: "#16A34A20", border: "1px solid #16A34A50", color: "#86EFAC", borderRadius: 10, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          Do it now
        </button>
        <button
          onClick={() => {
            recordAiFeedback("skipped");
            setCopilotStatus(`Skipped: ${props.viewModel.title}`);
          }}
          style={{ background: "#0F172A", border: "1px solid #334155", color: "#94A3B8", borderRadius: 10, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          Not now
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#64748B" }}>{props.viewModel.status}</div>

      {props.showControls && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1E293B", display: "grid", gap: 8 }}>
          <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, marginBottom: 6 }}>Optimise for</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => props.setOptimisationGoal("MAX_SAVINGS")}
              style={{
                background: props.optimisationGoal === "MAX_SAVINGS" ? "#60A5FA" : "#0F172A",
                color: props.optimisationGoal === "MAX_SAVINGS" ? "#FFFFFF" : "#94A3B8",
                border: "1px solid #334155",
                borderRadius: 20,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit"
              }}
            >
              Save more
            </button>
            <button
              onClick={() => props.setOptimisationGoal("LOWEST_CARBON")}
              style={{
                background: props.optimisationGoal === "LOWEST_CARBON" ? "#60A5FA" : "#0F172A",
                color: props.optimisationGoal === "LOWEST_CARBON" ? "#FFFFFF" : "#94A3B8",
                border: "1px solid #334155",
                borderRadius: 20,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit"
              }}
            >
              Greener
            </button>
            <button
              onClick={() => props.setOptimisationGoal("BATTERY_CARE")}
              style={{
                background: props.optimisationGoal === "BATTERY_CARE" ? "#60A5FA" : "#0F172A",
                color: props.optimisationGoal === "BATTERY_CARE" ? "#FFFFFF" : "#94A3B8",
                border: "1px solid #334155",
                borderRadius: 20,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit"
              }}
            >
              Protect battery
            </button>
            <button
              onClick={() => props.setOptimisationGoal("EV_READY")}
              style={{
                background: props.optimisationGoal === "EV_READY" ? "#60A5FA" : "#0F172A",
                color: props.optimisationGoal === "EV_READY" ? "#FFFFFF" : "#94A3B8",
                border: "1px solid #334155",
                borderRadius: 20,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit"
              }}
            >
              EV ready
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.4 }}>
            {props.optimisationGoal === "MAX_SAVINGS" && "Gridly will favour cheaper charging windows and strong export value."}
            {props.optimisationGoal === "LOWEST_CARBON" && "Gridly will shift usage into cleaner grid periods where possible."}
            {props.optimisationGoal === "BATTERY_CARE" && "Gridly will reduce deep cycling and preserve reserve."}
            {props.optimisationGoal === "EV_READY" && "Gridly will prioritise reaching your ready-by target."}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>Reserve {props.minBatteryReserve}%</div>
            <input
              type="range"
              min={10}
              max={50}
              step={5}
              value={props.minBatteryReserve}
              onChange={(event) => props.setMinBatteryReserve(Number(event.target.value))}
              style={{ width: 140 }}
            />
          </div>
        </div>
      )}
    </div>
  );

  const renderLiveEnergyFlowCard = () => (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "20px" }}>
      <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
        LIVE ENERGY FLOW
      </div>
      <div style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.5, marginBottom: 16 }}>
        A real-time map of where power is moving across home, solar, battery, EV, and grid.
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>

        {connectedDevices.some(d => d.id === "solar") && (
          <>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 52, height: 52, background: "#F59E0B15", border: "1.5px solid #F59E0B30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px", boxShadow: s.w > 0 ? "0 0 12px rgba(245, 158, 11, 0.4)" : "none" }}>
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
              <div style={{ width: 52, height: 52, background: "#16A34A15", border: "1.5px solid #16A34A30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px", boxShadow: isCharging ? "0 0 12px rgba(34, 197, 94, 0.4)" : "none" }}>
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
              <div style={{ width: 52, height: 52, background: "#38BDF815", border: "1.5px solid #38BDF830", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px", boxShadow: isCharging ? "0 0 12px rgba(56, 189, 248, 0.4)" : "none" }}>
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
              <div style={{ width: 52, height: 52, background: isExporting ? "#F59E0B15" : "#ffffff05", border: `1.5px solid ${isExporting ? "#F59E0B30" : "#ffffff10"}`, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px", boxShadow: isExporting ? "0 0 12px rgba(245, 158, 11, 0.4)" : "none" }}>
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
  );

  const renderInsightsSection = () => (
    <>
      {/* Carbon tracker */}
      <CarbonTracker connectedDevices={connectedDevices} />

      {/* All-time counter */}
      <div style={{ margin: "0 20px 12px", background: "linear-gradient(135deg, #0a0a0a, #111827)", border: "1px solid #374151", borderRadius: 20, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div onClick={() => setShowAllTime(!showAllTime)} style={{ fontSize: 10, color: "#6B7280", letterSpacing: 1, fontWeight: 700, marginBottom: 6, cursor: "pointer" }}>
            ALL TIME {showAllTime ? '▼' : '▶'}
          </div>
          {showAllTime && (
            <>
              <div style={{ fontSize: 40, fontWeight: 900, color: "#22C55E", letterSpacing: -2, lineHeight: 1 }}>+£{SANDBOX.allTime}</div>
              <div style={{ fontSize: 11, color: "#4B5563", marginTop: 6 }}>since {SANDBOX.allTimeSince}</div>
            </>
          )}
        </div>
        {showAllTime && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#4B5563", marginBottom: 4 }}>Today</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#22C55E" }}>+£{SANDBOX.savedToday}</div>
            <div style={{ fontSize: 11, color: "#F59E0B", marginTop: 2 }}>£{SANDBOX.earnedToday} exported</div>
          </div>
        )}
      </div>

      {/* Nightly report card */}
      <NightlyReportCard />

      {/* Manual override */}
      {/* Boost button — prominent single-tap charge */}
      <BoostButton connectedDevices={connectedDevices} currentPence={currentPence} />

      {/* Charger lock */}
      <ChargerLock connectedDevices={connectedDevices} />

      <ManualOverride currentPence={currentPence} connectedDevices={connectedDevices} />

      {/* EV Ready-by */}
      {hasEV && <EVReadyBy />}

      {/* Battery reserve */}
      {hasBattery && <BatteryReserve />}

      {/* Solar forecast */}
      {hasSolar && <SolarForecastCard />}

      {/* Cross-device coordination — battery + EV joint plan */}
      <CrossDeviceCoordination connectedDevices={connectedDevices} currentPence={currentPence} />

      {/* Battery health — only if battery connected */}
      {hasBattery && <BatteryHealthScore />}

      {/* Tariff switcher */}
      <TariffSwitcher connectedDevices={connectedDevices} />

      {/* Connected devices */}
      <div style={{ margin: "0 20px 12px" }}>
        <div onClick={() => setShowConnected(!showConnected)} style={{ fontSize: 9, color: "#6B7280", fontWeight: 700, letterSpacing: 1, marginBottom: 10, cursor: "pointer" }}>
          CONNECTED {showConnected ? '▼' : '▶'}
        </div>
        {showConnected && (
          <>
            <div style={{ display: "grid", gap: 8 }}>
              {connectedDevices.map(device => {
                const Icon = device.icon;
                return (
                  <div key={device.id} style={{ background: "#111827", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #374151" }}>
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
            <button onClick={() => window.location.href = '/onboarding'} style={{ width: "100%", marginTop: 10, background: "none", border: "1px dashed #374151", borderRadius: 12, padding: "12px 16px", color: "#4B3", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              + Add another device
            </button>
          </>
        )}
      </div>
    </>
  );

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
      {renderRightNowCard(heroViewModel)}

      {/* What Gridly will do next timeline */}
      {renderTimelineCard(timelineViewModel)}

      {renderGridlyBriefCard({ viewModel: briefViewModel, showHelp, showControls, optimisationGoal, minBatteryReserve, setShowHelp, setShowControls, setOptimisationGoal, setMinBatteryReserve })}

      {/* Energy flow — only connected devices */}
      {renderLiveEnergyFlowCard()}

      <div style={{ margin: "0 20px 16px", textAlign: "center" }}>
        <button
          onClick={() => setShowMore(!showMore)}
          style={{
            background: "#0E1726",
            border: "1px solid #1E293B",
            color: "#93C5FD",
            borderRadius: 10,
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit"
          }}
        >
          {showMore ? "Hide insights" : "Show more insights"}
        </button>
      </div>

      {showMore && renderInsightsSection()}

    </div> 
  );
}
