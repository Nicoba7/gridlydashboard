import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildHomeOptimizerInput,
  buildHomeUiViewModel,
  optimize,
  type HomeConnectedDeviceId,
} from "../optimizer";
import { buildCanonicalValueLedger } from "../application/runtime/buildCanonicalValueLedger";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AGILE_RATES } from "../data/agileRates";
import {
  SANDBOX,
  NightlyReportCard,
  ChargerLock,
  ManualOverride,
  EVReadyBy,
  BatteryReserve,
  SolarForecastCard,
  BatteryHealthScore,
  TariffSwitcher,
  DeviceConfig,
} from "../pages/SimplifiedDashboard";
import { ENERGY_COLORS } from "./energyColors";
import { DemoBadge } from "./FirstRunBanner";
import { FlowConnector, FlowNode } from "./flowPrimitives";
import { TIMELINE_EMPHASIS_TOKENS, timelineDotGlow } from "./timelineEmphasisTokens";
import DecisionExplanationSheet from "./DecisionExplanationSheet";
import { buildRuntimeGroundedExplanationLines } from "../lib/decisionExplanationPresentation";
import { buildDecisionExplanation } from "../lib/decisionExplanation";
import { buildDecisionFreshnessViewModel, DECISION_FRESHNESS_TOOLTIP } from "../lib/decisionFreshness";
import { buildHomeRuntimeReadModel } from "../features/home/homeRuntimeReadModel";
import type { CycleHeartbeatEntry, DecisionExplainedJournalEntry } from "../journal/executionJournal";

const ENABLE_HOME_SIMULATION = import.meta.env.DEV;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildLiveSolarState(
  now: Date,
  base: { w: number; batteryPct: number; gridW: number; homeW: number },
  options: { hasSolar: boolean; hasBattery: boolean; hasGrid: boolean }
) {
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const dayProgress = minuteOfDay / 1440;
  const dayPhase = dayProgress * Math.PI * 2;
  const daylightCurve = Math.max(0, Math.sin(((minuteOfDay - 360) / 720) * Math.PI));

  const solarW = options.hasSolar
    ? Math.round((500 + 2600 * daylightCurve) * (0.95 + 0.05 * Math.sin(dayPhase * 3)))
    : 0;

  const eveningBoost = minuteOfDay >= 17 * 60 && minuteOfDay <= 21 * 60 ? 220 : 0;
  const homeW = Math.round(clamp(base.homeW + 220 * Math.sin(dayPhase - 1.1) + eveningBoost, 700, 2600));

  const batteryPct = options.hasBattery
    ? Math.round(clamp(base.batteryPct + 10 * Math.sin(dayPhase - 0.8), 12, 96))
    : 0;

  const batteryContribution = options.hasBattery ? Math.round((batteryPct - 50) * 8) : 0;
  const gridRaw = homeW - solarW - batteryContribution;
  const gridW = options.hasGrid ? Math.round(clamp(gridRaw, -3200, 3200)) : 0;

  return {
    w: solarW,
    batteryPct,
    gridW,
    homeW,
  };
}

function buildLiveDeviceHealth(
  now: Date,
  base: Record<string, { ok: boolean; lastSeen: number }>
) {
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const result: Record<string, { ok: boolean; lastSeen: number }> = {
    ...base,
  };

  const ev = result.ev;
  if (ev) {
    const cycleMinutes = 90;
    const offlineWindowMinutes = 25;
    const cyclePosition = minuteOfDay % cycleMinutes;
    const evOffline = cyclePosition < offlineWindowMinutes;
    result.ev = {
      ok: !evOffline,
      lastSeen: evOffline ? 5 + cyclePosition : 2,
    };
  }

  if (result.solar) result.solar = { ok: true, lastSeen: 1 + (minuteOfDay % 3) };
  if (result.battery) result.battery = { ok: true, lastSeen: 1 + ((minuteOfDay + 1) % 3) };
  if (result.grid) result.grid = { ok: true, lastSeen: 1 + ((minuteOfDay + 2) % 4) };

  return result;
}

function slotToTime(slot: number): string {
  const h = Math.floor(slot / 2).toString().padStart(2, "0");
  const m = slot % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
}

function actionColor(action?: string): string {
  const normalized = action?.toLowerCase().trim();
  if (normalized === "charge" || normalized === "charging") return ENERGY_COLORS.battery;
  if (normalized === "export" || normalized === "exporting") return ENERGY_COLORS.solar;
  return "#6B7280";
}


function homeActionLabel({
  action,
  reason,
  hasEV,
}: {
  action?: string;
  reason?: string;
  hasEV: boolean;
}): string {
  const normalized = action?.toLowerCase().trim();
  const normalizedReason = (reason ?? "").toLowerCase();

  switch (normalized) {
    case "charge":
      return hasEV ? "Charging EV now" : "Charging now";
    case "export":
      return "Exporting at strong rates";
    case "discharge":
      return "Powering your home from battery";
    case "import":
      return "Importing from grid";
    case "hold":
    default:
      if (normalizedReason.includes("strong solar is expected soon")) {
        return "Holding until solar arrives";
      }
      return "Holding steady";
  }
}

function shortenReason(reason?: string): string {
  if (!reason) return "";
  if (reason.includes("Strong solar is expected soon")) return "Solar incoming";
  if (reason.includes("Import price is in a cheap window")) return "Cheap tariff";
  if (reason.includes("Export price is high")) return "High export";
  if (reason.length > 22) return `${reason.substring(0, 20)}…`;
  return reason;
}

function hasBalancedParentheses(value: string): boolean {
  let depth = 0;

  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }

  return depth === 0;
}

function isReadableSummaryHeadline(summary: string): boolean {
  const trimmed = summary.trim();
  if (!trimmed) return false;
  if (trimmed.length > 72) return false;
  if (/\.\.\.|…/.test(trimmed)) return false;
  if (!hasBalancedParentheses(trimmed)) return false;
  if (/[0-9]/.test(trimmed)) return false;
  if (/\b(p\/kwh|kwh|£|%|marginal|effective|stored-energy|opportunity)\b/i.test(trimmed)) return false;
  if (/^decision\b/i.test(trimmed)) return false;
  return true;
}

function mapActionHeadline(params: {
  decisionType?: string;
  canonicalAction?: string;
}): string | undefined {
  const decisionType = params.decisionType?.toLowerCase().trim() ?? "";
  const canonicalAction = params.canonicalAction?.toLowerCase().trim() ?? "";

  if (decisionType.includes("charge") || canonicalAction === "charge") return "Charging battery";
  if (decisionType.includes("discharge") || canonicalAction === "discharge") return "Powering home from battery";
  if (decisionType.includes("solar") || decisionType.includes("export") || canonicalAction === "export") {
    return "Running home on solar";
  }
  if (canonicalAction === "import") return "Importing from grid";
  if (decisionType.startsWith("rejected_") || canonicalAction === "hold") return "System is idle";

  return undefined;
}

function chooseHeadlineText(params: {
  summary: string;
  decisionType?: string;
  canonicalAction?: string;
}): string {
  if (isReadableSummaryHeadline(params.summary)) {
    return params.summary.trim();
  }

  return mapActionHeadline({
    decisionType: params.decisionType,
    canonicalAction: params.canonicalAction,
  }) ?? "System is idle";
}

type TimelineItem = {
  slot: number;
  action: string;
  label: string;
  reason: string;
  reasoning: string[];
  liveLabel?: "Now" | "Up next";
};

export type HomeTimelineEmphasis = "active" | "soon" | "planned" | "default";

function forwardSlotDistance(currentSlot: number, rowSlot: number) {
  const normalizedCurrent = ((currentSlot % 48) + 48) % 48;
  const normalizedRow = ((rowSlot % 48) + 48) % 48;
  return normalizedRow >= normalizedCurrent
    ? normalizedRow - normalizedCurrent
    : (normalizedRow + 48) - normalizedCurrent;
}

function isMeaningfulHomeAction(row: { action: string }) {
  const action = row.action.toLowerCase().trim();
  return action !== "hold";
}

export function deriveHomeTimelineEmphasis(
  rows: Array<{ slot: number; action: string; label: string }>,
  currentSlot: number
): HomeTimelineEmphasis[] {
  if (!rows.length) return [];

  const withDistance = rows.map((row, index) => ({
    row,
    index,
    distance: forwardSlotDistance(currentSlot, row.slot),
  }));

  const activeIndex = withDistance.find((entry) => entry.distance === 0)?.index ?? -1;
  if (activeIndex >= 0) {
    return rows.map((_, index) => (index === activeIndex ? "active" : "default"));
  }

  const soonIndex = withDistance.find((entry) => entry.distance > 0 && entry.distance <= 1)?.index ?? -1;
  if (soonIndex >= 0) {
    return rows.map((_, index) => (index === soonIndex ? "soon" : "default"));
  }

  const plannedEntry = withDistance
    .filter((entry) => entry.distance > 0 && isMeaningfulHomeAction(entry.row))
    .sort((a, b) => a.distance - b.distance)[0]
    ?? withDistance.find((entry) => isMeaningfulHomeAction(entry.row));

  const plannedIndex = plannedEntry?.index ?? -1;
  if (plannedIndex >= 0) {
    return rows.map((_, index) => (index === plannedIndex ? "planned" : "default"));
  }

  return rows.map(() => "default");
}

export function mergeTimeline(
  timeline: Array<{ slot: number; action: string; reason?: string | null }>,
  context: {
    solarForecastKwh: number;
    currentPence: number;
    hasEV: boolean;
  },
  currentSlot: number,
  slotOffset = 0
): TimelineItem[] {
  const normalized = timeline
    .map((item) => ({
      slot: (((Number(item.slot ?? 0) + slotOffset) % 48) + 48) % 48,
      action: String(item.action ?? "hold"),
      reason: String(item.reason ?? ""),
    }))
    .filter((item) => Number.isFinite(item.slot))
    .sort((a, b) => a.slot - b.slot);

  const segments: TimelineItem[] = [];
  for (const item of normalized) {
    const label = homeActionLabel({
      action: item.action,
      reason: item.reason,
      hasEV: context.hasEV,
    });
    const reason = shortenReason(item.reason);
    const pseudoType = item.action?.toLowerCase() === "export"
      ? "export"
      : item.action?.toLowerCase() === "charge"
      ? context.hasEV
        ? "ev_charge"
        : "battery_charge"
      : item.action?.toLowerCase() === "discharge"
      ? "solar_use"
      : "hold";

    const start = slotToTime(item.slot);
    const end = slotToTime((item.slot + 1) % 48);
    const basePrice = Number(context.currentPence.toFixed(1));
    const reasoning = buildDecisionExplanation(
      {
        type: pseudoType,
        start,
        end,
        priceRange: `${Math.max(0.1, basePrice - 1.2).toFixed(1)}–${(basePrice + 1.8).toFixed(1)}p`,
        priceMin: Math.max(0.1, basePrice - 1.2),
        priceMax: basePrice + 1.8,
        color: actionColor(item.action),
        highlight: false,
        slotCount: 1,
      },
      {
        solarForecastKwh: context.solarForecastKwh,
        evReadyBy: context.hasEV ? "07:00" : undefined,
      },
      {
        cheapestPrice: Math.max(0.1, basePrice - 2.5),
        peakPrice: basePrice + 12,
        gridCondition: "Live grid conditions remain stable for this period.",
      }
    );

    const last = segments[segments.length - 1];
    if (last && last.label === label && last.reason === reason) continue;
    segments.push({ slot: item.slot, action: item.action, label, reason, reasoning });
  }

  if (!segments.length) return [];

  const isActiveAtSlot = (segmentIndex: number) => {
    const start = segments[segmentIndex].slot;
    const next = segments[segmentIndex + 1];
    if (!next) return currentSlot >= start;
    if (start === next.slot) return currentSlot === start;
    return currentSlot >= start && currentSlot < next.slot;
  };

  const activeIndex = segments.findIndex((_, index) => isActiveAtSlot(index));
  const futureByDistance = segments
    .map((row, index) => ({
      row,
      index,
      distance: row.slot - currentSlot,
    }))
    .filter((entry) => entry.distance > 0)
    .sort((a, b) => a.distance - b.distance);

  const chosen: TimelineItem[] = [];

  if (activeIndex >= 0) {
    chosen.push({ ...segments[activeIndex], liveLabel: "Now" });

    const nextMeaningful = futureByDistance.find((entry) => isMeaningfulHomeAction(entry.row));
    if (nextMeaningful) {
      chosen.push({ ...nextMeaningful.row, liveLabel: "Up next" });
    }
    return chosen.slice(0, 2);
  }

  const meaningfulFuture = futureByDistance.filter((entry) => isMeaningfulHomeAction(entry.row));
  const firstFuture = meaningfulFuture[0] ?? futureByDistance[0];
  if (!firstFuture) return [];

  chosen.push({ ...firstFuture.row, liveLabel: "Now" });

  const secondMeaningful = meaningfulFuture.find((entry) => entry.index !== firstFuture.index);
  if (secondMeaningful) {
    chosen.push({ ...secondMeaningful.row, liveLabel: "Up next" });
  }

  return chosen.slice(0, 2);
}

function CollapsibleSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "18px 20px",
          cursor: "pointer",
          fontFamily: "inherit",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: "#8994A6", letterSpacing: 0.15 }}>{label}</span>
        {open ? <ChevronUp size={14} color="#445066" strokeWidth={2.2} /> : <ChevronDown size={14} color="#445066" strokeWidth={2.2} />}
      </button>
      {open && <div style={{ paddingBottom: 8 }}>{children}</div>}
    </div>
  );
}

function SystemHealthCard({
  connectedDevices,
  deviceHealth,
}: {
  connectedDevices: DeviceConfig[];
  deviceHealth: Record<string, { ok: boolean; lastSeen: number }>;
}) {
  const followUpByDevice: Record<string, string> = {
    ev: "Action needed only if you need EV charging immediately.",
    battery: "Action needed only if you need a higher backup reserve right now.",
    solar: "Action needed only if you are expecting live solar generation now.",
    grid: "Action needed only if live tariff tracking stays unavailable.",
  };

  const alerts = connectedDevices
    .map((device) => {
      const health = deviceHealth[device.id];
      if (!health || health.ok) return null;
      const hrs = Math.floor(health.lastSeen / 60);
      const mins = health.lastSeen % 60;
      const ago = hrs > 0 ? `${hrs}h ${mins}m ago` : `${mins}m ago`;
      return { device, ago };
    })
    .filter((value): value is { device: DeviceConfig; ago: string } => value !== null);

  if (alerts.length === 0) return null;

  return (
    <div style={{ margin: "10px 16px 12px", background: "#111722", borderRadius: 16, border: "1px solid #2A3345", padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: "#8FA1B9", fontWeight: 700, letterSpacing: 0.7, marginBottom: 8 }}>WHEN SOMETHING CHANGED</div>
      <div style={{ display: "grid", gap: 8 }}>
        {alerts.map(({ device, ago }) => (
          <div key={device.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: "#D3DCE8", fontWeight: 700, marginBottom: 2 }}>{device.name} offline</div>
              <div style={{ fontSize: 11, color: "#8A9DB8", lineHeight: 1.4 }}>
                Last seen {ago}. Aveum continues optimising safely with remaining systems. {followUpByDevice[device.id] ?? "No action needed unless you want immediate manual control."}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EnergyFlowSVG({
  hasSolar,
  hasBattery,
  hasEV,
  hasGrid,
  solarW,
  homeW,
  batteryPct,
  gridW,
  isCharging,
  isExporting,
}: {
  hasSolar: boolean;
  hasBattery: boolean;
  hasEV: boolean;
  hasGrid: boolean;
  solarW: number;
  homeW: number;
  batteryPct: number;
  gridW: number;
  isCharging: boolean;
  isExporting: boolean;
}) {
  const HOME = { x: 170, y: 128 };
  const SOLAR = { x: 170, y: 26 };
  const BATT = { x: 296, y: 128 };
  const EV = { x: 170, y: 226 };
  const GRID = { x: 44, y: 128 };
  const nodeRadius = 28;
  const homeRadius = 34;

  const solarOn = hasSolar && solarW > 100;
  const batteryChargeOn = hasBattery && isCharging;
  const batteryDischargeOn = hasBattery && !isCharging && batteryPct > 20;
  const evOn = hasEV;
  const gridImport = hasGrid && !isExporting;
  const gridExport = hasGrid && isExporting;

  const solarToHome = `M ${SOLAR.x},${SOLAR.y + nodeRadius + 2} L ${HOME.x},${HOME.y - homeRadius - 2}`;
  const homeToBattery = `M ${HOME.x + homeRadius + 2},${HOME.y} L ${BATT.x - nodeRadius - 2},${BATT.y}`;
  const batteryToHome = `M ${BATT.x - nodeRadius - 2},${BATT.y} L ${HOME.x + homeRadius + 2},${HOME.y}`;
  const homeToEv = `M ${HOME.x},${HOME.y + homeRadius + 2} L ${EV.x},${EV.y - nodeRadius - 2}`;
  const gridToHome = `M ${GRID.x + nodeRadius + 2},${GRID.y} L ${HOME.x - homeRadius - 2},${HOME.y}`;
  const homeToGrid = `M ${HOME.x - homeRadius - 2},${HOME.y} L ${GRID.x + nodeRadius + 2},${GRID.y}`;

  return (
    <svg viewBox="0 0 340 253" style={{ width: "100%", maxHeight: 226 }}>
      {hasSolar && <FlowConnector x1={SOLAR.x} y1={SOLAR.y + nodeRadius} x2={HOME.x} y2={HOME.y - homeRadius} active={solarOn} color={ENERGY_COLORS.solar} intensity="home" />}
      {hasBattery && <FlowConnector x1={HOME.x + homeRadius} y1={HOME.y} x2={BATT.x - nodeRadius} y2={BATT.y} active={batteryChargeOn || batteryDischargeOn} color={ENERGY_COLORS.battery} intensity="home" />}
      {hasEV && <FlowConnector x1={HOME.x} y1={HOME.y + homeRadius} x2={EV.x} y2={EV.y - nodeRadius} active={evOn} color={ENERGY_COLORS.ev} intensity="home" />}
      {hasGrid && <FlowConnector x1={GRID.x + nodeRadius} y1={GRID.y} x2={HOME.x - homeRadius} y2={HOME.y} active={gridImport || gridExport} color={ENERGY_COLORS.grid} intensity="home" />}

      {solarOn && <circle r="3" fill={ENERGY_COLORS.solar}><animateMotion dur="1.4s" repeatCount="indefinite" path={solarToHome} /></circle>}
      {batteryChargeOn && <circle r="3" fill={ENERGY_COLORS.battery}><animateMotion dur="1.4s" repeatCount="indefinite" path={homeToBattery} /></circle>}
      {batteryDischargeOn && !batteryChargeOn && <circle r="3" fill={ENERGY_COLORS.battery}><animateMotion dur="1.4s" repeatCount="indefinite" path={batteryToHome} /></circle>}
      {evOn && <circle r="3" fill={ENERGY_COLORS.ev}><animateMotion dur="1.4s" repeatCount="indefinite" path={homeToEv} /></circle>}
      {gridImport && <circle r="3" fill={ENERGY_COLORS.grid}><animateMotion dur="1.4s" repeatCount="indefinite" path={gridToHome} /></circle>}
      {gridExport && <circle r="3" fill={ENERGY_COLORS.grid}><animateMotion dur="1.4s" repeatCount="indefinite" path={homeToGrid} /></circle>}

      <circle cx={HOME.x} cy={HOME.y} r={homeRadius + 10} fill="none" stroke="#1A253514" strokeWidth="14" />
      <circle cx={HOME.x} cy={HOME.y} r={homeRadius} fill="#0C1422" stroke="#1A2535" strokeWidth="1.5" />
      <text x={HOME.x} y={HOME.y - 4} textAnchor="middle" fontSize="12" fontWeight="800" fill={ENERGY_COLORS.home} fontFamily="system-ui, -apple-system, sans-serif">{(homeW / 1000).toFixed(1)}kW</text>
      <text x={HOME.x} y={HOME.y + 10} textAnchor="middle" fontSize="8" fill="#4E5E75" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.4">Home</text>

      {hasSolar && (
        <FlowNode
          x={SOLAR.x}
          y={SOLAR.y}
          radius={nodeRadius}
          active={solarOn}
          color={ENERGY_COLORS.solar}
          value={`${(solarW / 1000).toFixed(1)}kW`}
          label="Solar"
        />
      )}

      {hasBattery && (
        <FlowNode
          x={BATT.x}
          y={BATT.y}
          radius={nodeRadius}
          active={batteryChargeOn}
          color={ENERGY_COLORS.battery}
          value={`${batteryPct}%`}
          valueActiveColor={ENERGY_COLORS.battery}
          valueInactiveColor="#D1D5DB"
          label="Battery"
        />
      )}

      {hasEV && (
        <FlowNode
          x={EV.x}
          y={EV.y}
          radius={nodeRadius}
          active={evOn}
          color={ENERGY_COLORS.ev}
          value="38%"
          valueFontSize={10}
          valueActiveColor={ENERGY_COLORS.ev}
          valueInactiveColor={ENERGY_COLORS.ev}
          label="EV"
        />
      )}

      {hasGrid && (
        <>
          <FlowNode
            x={GRID.x}
            y={GRID.y}
            radius={nodeRadius}
            active={true}
            color={ENERGY_COLORS.grid}
            value={`${Math.abs(gridW / 1000).toFixed(1)}kW`}
            valueFontSize={9}
            valueActiveColor={ENERGY_COLORS.grid}
            valueInactiveColor={ENERGY_COLORS.grid}
            label=""
            labelLetterSpacing="0"
            showHalo={false}
          />
          <text x={GRID.x} y={GRID.y + 10} textAnchor="middle" fontSize="7" fill="#374151" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.4">{gridExport ? "Export" : "Grid"}</text>
        </>
      )}
    </svg>
  );
}

function DeviceRow({ device, isDemo }: { device: DeviceConfig; isDemo?: boolean }) {
  const Icon = device.icon;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: "1px solid #0A1020" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: `${device.color}10`, border: `1px solid ${device.color}22` }}>
          <Icon size={15} color={device.color} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#D1D5DB" }}>{device.name}</div>
          <div style={{ fontSize: 11, color: "#4B5563", marginTop: 1 }}>{device.status}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#22C55E", display: "flex", alignItems: "center" }}>
        +£{device.monthlyValue}/mo{isDemo && <DemoBadge />}
      </div>
    </div>
  );
}

export interface HomeTabProps {
  connectedDevices: DeviceConfig[];
  now: Date;
  latestCycleHeartbeat?: CycleHeartbeatEntry;
  recentDecisionExplanations?: DecisionExplainedJournalEntry[];
  isDemo?: boolean;
}

export default function HomeTab({
  connectedDevices,
  now,
  latestCycleHeartbeat,
  recentDecisionExplanations = [],
  isDemo = false,
}: HomeTabProps) {
  const [freshnessNowMs, setFreshnessNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = globalThis.setInterval(() => {
      setFreshnessNowMs(Date.now());
    }, 5000);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, []);

  const hasBattery = connectedDevices.some((device) => device.id === "battery");
  const hasEV = connectedDevices.some((device) => device.id === "ev");
  const hasSolar = connectedDevices.some((device) => device.id === "solar");
  const hasGrid = connectedDevices.some((device) => device.id === "grid");

  const simulatedDeviceHealth = useMemo(
    () => buildLiveDeviceHealth(now, SANDBOX.deviceHealth as Record<string, { ok: boolean; lastSeen: number }>),
    [now]
  );

  const simulatedSolar = useMemo(
    () => buildLiveSolarState(now, SANDBOX.solar, { hasSolar, hasBattery, hasGrid }),
    [now, hasSolar, hasBattery, hasGrid]
  );

  const deviceHealth = ENABLE_HOME_SIMULATION
    ? simulatedDeviceHealth
    : (SANDBOX.deviceHealth as Record<string, { ok: boolean; lastSeen: number }>);

  const s = ENABLE_HOME_SIMULATION ? simulatedSolar : SANDBOX.solar;

  const slotIndex = Math.min(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30), 47);
  const currentPence = AGILE_RATES[slotIndex].pence;
  const connectedDeviceIds = useMemo(() => {
    const allowed = new Set<HomeConnectedDeviceId>(["solar", "battery", "ev", "grid"]);
    return connectedDevices
      .map((device) => device.id)
      .filter((id): id is HomeConnectedDeviceId => allowed.has(id as HomeConnectedDeviceId));
  }, [connectedDevices]);

  const optimizerInput = useMemo(() => {
    return buildHomeOptimizerInput({
      now,
      connectedDeviceIds,
      rates: AGILE_RATES,
      planningMode: "balanced",
      batteryStartPct: s.batteryPct,
      batteryCapacityKwh: 13.5,
      batteryReservePct: 30,
      maxBatteryCyclesPerDay: 2,
      evReadyBy: "07:00",
      evTargetSocPercent: 85,
      solarForecastKwh: SANDBOX?.solarForecast?.kwh,
      carbonIntensity: SANDBOX?.carbonIntensity,
      exportPriceRatio: 0.72,
    });
  }, [now, connectedDeviceIds, s.batteryPct]);

  const optimizerOutput = useMemo(() => optimize(optimizerInput), [optimizerInput]);

  const valueLedger = useMemo(
    () =>
      buildCanonicalValueLedger({
        optimizationMode: optimizerInput.constraints.mode,
        optimizerOutput,
        forecasts: optimizerInput.forecasts,
        tariffSchedule: optimizerInput.tariffSchedule,
      }),
    [optimizerInput, optimizerOutput],
  );
  const homeOptimizerView = useMemo(
    () => buildHomeUiViewModel(optimizerOutput, valueLedger),
    [optimizerOutput, valueLedger],
  );
  const homeRuntimeReadModel = useMemo(
    // Heartbeat truth is produced outside the UI and passed in here.
    // Home only renders canonical runtime/journal outputs; it must not initiate execution.
    () => buildHomeRuntimeReadModel({ optimizerOutput, latestCycleHeartbeat }),
    [optimizerOutput, latestCycleHeartbeat],
  );

  const timeline = mergeTimeline(homeOptimizerView.timeline, {
    solarForecastKwh: SANDBOX?.solarForecast?.kwh ?? 0,
    currentPence,
    hasEV,
  }, slotIndex);
  const [selectedTimelineItem, setSelectedTimelineItem] = useState<TimelineItem | null>(null);
  const isCharging = homeOptimizerView.currentAction === "charge";
  const isExporting = homeOptimizerView.currentAction === "export";

  const heroColor = isCharging ? "#22C55E" : isExporting ? "#F59E0B" : "#6B7280";
  const latestDecisionExplanationEntry = recentDecisionExplanations.find(
    (entry) => Array.isArray(entry.explanation?.drivers) && entry.explanation.drivers.length >= 2,
  ) ?? recentDecisionExplanations.find(
    (entry) => Array.isArray(entry.explanation?.drivers) && entry.explanation.drivers.length > 0,
  );
  const latestDecisionExplanation = latestDecisionExplanationEntry?.explanation;
  const explanationSummaryRaw = latestDecisionExplanation?.summary ?? homeRuntimeReadModel.currentDecisionReason;
  const explanationSummary = chooseHeadlineText({
    summary: explanationSummaryRaw,
    decisionType: latestDecisionExplanationEntry?.decision,
    canonicalAction: homeOptimizerView.currentAction,
  });
  const explanationDrivers = latestDecisionExplanation?.drivers ?? [];
  const runtimeGroundedExplanationLines = buildRuntimeGroundedExplanationLines({
    drivers: explanationDrivers,
  });
  const freshnessViewModel = buildDecisionFreshnessViewModel(
    latestDecisionExplanationEntry?.timestamp,
    freshnessNowMs,
    "last-decision"
  );
  const homeValueSavings = homeOptimizerView.value.savingsToday > 0
    ? homeOptimizerView.value.savingsToday
    : SANDBOX.savedToday;
  const homeValueEarnings = homeOptimizerView.value.earningsToday > 0
    ? homeOptimizerView.value.earningsToday
    : SANDBOX.earnedToday;
  // Pass-through of runtime planner truth. Components must not derive substitute
  // meanings for confidence/caution signals outside canonical runtime outputs.
  // Presentation-only label. Canonical meaning comes from runtime read model truth.
  const confidenceBadge = latestDecisionExplanation?.confidence
    ? `Confidence: ${latestDecisionExplanation.confidence}`
    : homeRuntimeReadModel.conservativeAdjustmentApplied
      ? "Running conservatively"
    : homeRuntimeReadModel.planningConfidenceLabel
      ? `Confidence: ${homeRuntimeReadModel.planningConfidenceLabel}`
      : `Confidence: ${homeOptimizerView.trust.confidenceLabel}`;
  // Presentation-only label. Canonical caution signal comes from runtime heartbeat.
  const cycleCautionBadge = homeRuntimeReadModel.nextCycleExecutionCaution
    ? `Caution: ${homeRuntimeReadModel.nextCycleExecutionCaution}`
    : undefined;

  return (
    <div style={{ background: "#060A12", minHeight: "100vh", paddingBottom: 30 }}>
      <div style={{ margin: "14px 14px 0", background: "#0A111D", borderRadius: 20, border: "1px solid #182235", overflow: "hidden", boxShadow: "0 16px 30px rgba(1, 7, 20, 0.3)" }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, ${heroColor}, ${heroColor}30)` }} />
        <div style={{ padding: "12px 18px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: heroColor, boxShadow: `0 0 8px ${heroColor}, 0 0 16px ${heroColor}50` }} />
            <span style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: 0.8 }}>CURRENT DECISION</span>
            <div
              title={DECISION_FRESHNESS_TOOLTIP}
              aria-label={DECISION_FRESHNESS_TOOLTIP}
              style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}
            >
              <span
                style={{
                  fontSize: 8.5,
                  color: "#5E6E85",
                  border: "1px solid #1B293D",
                  borderRadius: 999,
                  padding: "2px 7px",
                  letterSpacing: 0.25,
                }}
              >
                {freshnessViewModel.label}
              </span>
            </div>
            <span style={{ fontSize: 9, color: "#6E819B", border: "1px solid #1B293D", borderRadius: 999, padding: "2px 8px" }}>
              {confidenceBadge}
            </span>
          </div>

          <div style={{ fontSize: 28, fontWeight: 810, color: "#F3F7FF", letterSpacing: -0.55, lineHeight: 1.15, marginBottom: 10 }}>
            {explanationSummary}
          </div>

          <div style={{ marginBottom: runtimeGroundedExplanationLines.length > 0 ? 2 : 0 }}>
            <div style={{ fontSize: 10, color: "#6F819B", fontWeight: 600, letterSpacing: 0.4, marginBottom: 4 }}>
              Key signals
            </div>
          </div>

          {runtimeGroundedExplanationLines.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, color: "#A8BAD2", fontSize: 12, lineHeight: 1.35 }}>
              {runtimeGroundedExplanationLines.map((line, index) => (
                <li key={`${line}-${index}`} style={{ marginBottom: index < runtimeGroundedExplanationLines.length - 1 ? 3 : 0 }}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={{ margin: "8px 14px 0", background: "#09101A", borderRadius: 20, border: "1px solid #172236", padding: "14px 14px 10px", boxShadow: "0 6px 12px rgba(1, 7, 20, 0.16)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 9.5, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.1, opacity: 0.84 }}>ENERGY FLOW</div>
          <div style={{ fontSize: 10, color: "#5E7088" }}>Current flow</div>
        </div>
        <EnergyFlowSVG
          hasSolar={hasSolar}
          hasBattery={hasBattery}
          hasEV={hasEV}
          hasGrid={hasGrid}
          solarW={s.w}
          homeW={s.homeW}
          batteryPct={s.batteryPct}
          gridW={s.gridW}
          isCharging={isCharging}
          isExporting={isExporting}
        />
      </div>

      <div style={{ margin: "8px 14px 0", background: "#0A1220", borderRadius: 16, border: "1px solid #18263D", padding: "8px 12px" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: 10, color: "#6F819B", fontWeight: 600, letterSpacing: 0.6, marginBottom: 2 }}>SAVED TODAY</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#22C55E", display: "flex", alignItems: "center" }}>
              +£{homeValueSavings}{isDemo && <DemoBadge />}
            </div>
          </div>
          {homeValueEarnings > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "#6F819B", fontWeight: 600, letterSpacing: 0.6, marginBottom: 2 }}>EARNED TODAY</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#F59E0B", display: "flex", alignItems: "center" }}>
                +£{homeValueEarnings}{isDemo && <DemoBadge />}
              </div>
            </div>
          )}
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#6F819B", fontWeight: 600, letterSpacing: 0.6, marginBottom: 2 }}>LIVE RATE</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: currentPence < 15 ? "#22C55E" : currentPence < 25 ? "#F59E0B" : "#EF4444" }}>
              {currentPence.toFixed(1)}p
            </div>
          </div>
        </div>
      </div>

      {timeline.length > 0 && (
        <div style={{ margin: "10px 14px 0", background: "#0B1120", borderRadius: 18, border: "1px solid #152238", padding: "10px 14px", boxShadow: "none" }}>
          <div style={{ fontSize: 9.5, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.0, marginBottom: 8, opacity: 0.8 }}>NEXT</div>
          {(() => {
            const emphasisByIndex = deriveHomeTimelineEmphasis(timeline, slotIndex);
            return timeline.map((item, index) => {
              const tokenState = emphasisByIndex[index] ?? "default";
              const token = TIMELINE_EMPHASIS_TOKENS[tokenState];
              const dot = actionColor(item.action);
              const statusLabel = item.liveLabel ?? (index === 0 ? "Now" : "Up next");
              const dotGlow = timelineDotGlow(tokenState, dot, index === 0);

              return (
                <button
                  type="button"
                  onClick={() => setSelectedTimelineItem(item)}
                  key={`${item.slot}-${index}`}
                  data-emphasis={tokenState}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    paddingTop: 8,
                    paddingLeft: 8,
                    paddingRight: 8,
                    paddingBottom: 12,
                    marginBottom: index < timeline.length - 1 ? 12 : 0,
                    borderBottom: index < timeline.length - 1 ? "1px solid #111A2B" : "none",
                    borderRadius: 10,
                    background: token.background,
                    boxShadow: token.boxShadow,
                    borderLeft: token.borderLeft,
                    borderTop: "none",
                    borderRight: "none",
                    width: "100%",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#64738A", minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{slotToTime(item.slot)}</div>
                  <div
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: dot,
                      boxShadow: dotGlow,
                    }}
                  />
                  <div
                    style={{
                      fontSize: 12.5,
                      flex: 1,
                      fontWeight: token.fontWeight,
                      color: token.textColor,
                    }}
                  >
                    {item.label}
                  </div>
                  <div style={{ fontSize: 10, color: "#68788F", textAlign: "right", width: 76, fontVariantNumeric: "tabular-nums" }}>
                    {statusLabel}
                  </div>
                </button>
              );
            });
          })()}
        </div>
      )}

      <SystemHealthCard connectedDevices={connectedDevices} deviceHealth={deviceHealth} />

      <DecisionExplanationSheet
        open={Boolean(selectedTimelineItem)}
        title="Why Aveum chose this"
        subtitle={selectedTimelineItem ? `${selectedTimelineItem.label} · ${selectedTimelineItem.reason || "Aveum action"}` : undefined}
        reasoning={selectedTimelineItem?.reasoning ?? []}
        onClose={() => setSelectedTimelineItem(null)}
      />
    </div>
  );
}