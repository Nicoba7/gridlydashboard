import { useMemo, useState, type ReactNode } from "react";
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
import { FlowConnector, FlowNode } from "./flowPrimitives";
import { TIMELINE_EMPHASIS_TOKENS, timelineDotGlow } from "./timelineEmphasisTokens";
import DecisionExplanationSheet from "./DecisionExplanationSheet";
import { buildDecisionExplanation } from "../lib/decisionExplanation";
import { buildHomeRuntimeReadModel } from "../features/home/homeRuntimeReadModel";
import type { CycleHeartbeatEntry } from "../journal/executionJournal";

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

function conciseHeroHeadline(): string {
  return "Optimising quietly";
}

function buildHomeReassuranceNote({
  hasEV,
  hasBattery,
  hasSolar,
  solarForecastKwh,
  batteryPct,
  slotIndex,
}: {
  hasEV: boolean;
  hasBattery: boolean;
  hasSolar: boolean;
  solarForecastKwh: number;
  batteryPct: number;
  slotIndex: number;
}) {
  const options: string[] = [];

  if (hasEV) options.push("EV ready by target time remains on track.");
  if (hasBattery) {
    options.push(batteryPct >= 25
      ? "Battery reserve is protected for higher-cost periods."
      : "Battery reserve is being rebuilt to protect evening demand.");
  }
  if (hasSolar && solarForecastKwh >= 10) {
    options.push("Solar is expected to cover most daytime demand.");
  }

  if (!options.length) return "Gridly is continuously adapting to keep your home stable and efficient.";
  return options[slotIndex % options.length];
}

function buildFlowInterpretation({
  hasSolar,
  hasBattery,
  hasEV,
  isCharging,
  isExporting,
}: {
  hasSolar: boolean;
  hasBattery: boolean;
  hasEV: boolean;
  isCharging: boolean;
  isExporting: boolean;
}) {
  if (isExporting && hasBattery) return "Your home is powered while Gridly exports at stronger rates.";
  if (hasSolar && hasBattery && !isCharging) return "Most demand is being covered by solar and battery right now.";
  if (hasEV && isCharging) return "Gridly is charging your EV now while keeping home comfort protected.";
  if (hasBattery && isCharging) return "Gridly is topping up storage now to protect later higher-cost periods.";
  return "Gridly is continuously routing energy to keep your home efficient and stable.";
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
                Last seen {ago}. Gridly continues optimising safely with remaining systems. {followUpByDevice[device.id] ?? "No action needed unless you want immediate manual control."}
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
  const HOME = { x: 160, y: 110 };
  const SOLAR = { x: 160, y: 28 };
  const BATT = { x: 270, y: 110 };
  const EV = { x: 160, y: 192 };
  const GRID = { x: 50, y: 110 };
  const nodeRadius = 26;
  const homeRadius = 30;

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
    <svg viewBox="0 0 320 220" style={{ width: "100%", maxHeight: 232 }}>
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
      <text x={HOME.x} y={HOME.y - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={ENERGY_COLORS.home} fontFamily="system-ui, -apple-system, sans-serif">{(homeW / 1000).toFixed(1)}kW</text>
      <text x={HOME.x} y={HOME.y + 10} textAnchor="middle" fontSize="8" fill="#374151" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.6">HOME</text>

      {hasSolar && (
        <FlowNode
          x={SOLAR.x}
          y={SOLAR.y}
          radius={nodeRadius}
          active={solarOn}
          color={ENERGY_COLORS.solar}
          value={`${(solarW / 1000).toFixed(1)}kW`}
          label="SOLAR"
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
          label="BATT"
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
          <text x={GRID.x} y={GRID.y + 10} textAnchor="middle" fontSize="7" fill="#374151" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.4">{gridExport ? "PEAK PERIOD" : "IMPORT"}</text>
        </>
      )}
    </svg>
  );
}

function DeviceRow({ device }: { device: DeviceConfig }) {
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
      <div style={{ fontSize: 12, fontWeight: 700, color: "#22C55E" }}>+£{device.monthlyValue}/mo</div>
    </div>
  );
}

export interface HomeTabProps {
  connectedDevices: DeviceConfig[];
  now: Date;
  latestCycleHeartbeat?: CycleHeartbeatEntry;
}

export default function HomeTab({ connectedDevices, now, latestCycleHeartbeat }: HomeTabProps) {
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
  const heroLabel = conciseHeroHeadline();
  // Render canonical runtime decision rationale directly.
  // UI must not reinterpret or rewrite economic/accounting meaning.
  const heroReason = homeRuntimeReadModel.currentDecisionReason;
  const homeReassuranceNote = buildHomeReassuranceNote({
    hasEV,
    hasBattery,
    hasSolar,
    solarForecastKwh: SANDBOX?.solarForecast?.kwh ?? 0,
    batteryPct: s.batteryPct,
    slotIndex,
  });
  const flowInterpretation = buildFlowInterpretation({
    hasSolar,
    hasBattery,
    hasEV,
    isCharging,
    isExporting,
  });
  const homeValueSavings = homeOptimizerView.value.savingsToday > 0
    ? homeOptimizerView.value.savingsToday
    : SANDBOX.savedToday;
  const homeValueEarnings = homeOptimizerView.value.earningsToday > 0
    ? homeOptimizerView.value.earningsToday
    : SANDBOX.earnedToday;
  // Pass-through of runtime planner truth. Components must not derive substitute
  // meanings for confidence/caution signals outside canonical runtime outputs.
  const confidenceBadge = homeRuntimeReadModel.conservativeAdjustmentApplied
    ? "Runtime posture: Conservative"
    : homeRuntimeReadModel.planningConfidenceLabel
      ? `Planner confidence: ${homeRuntimeReadModel.planningConfidenceLabel}`
      : `Confidence: ${homeOptimizerView.trust.confidenceLabel}`;
  const confidenceCopy = homeRuntimeReadModel.conservativeAdjustmentReason
    ? homeRuntimeReadModel.conservativeAdjustmentReason
    : `${homeOptimizerView.trust.explanation} ${homeOptimizerView.nextStepLabel}`;
  const cycleCautionBadge = homeRuntimeReadModel.nextCycleExecutionCaution
    ? `Cycle caution: ${homeRuntimeReadModel.nextCycleExecutionCaution}`
    : undefined;

  return (
    <div style={{ background: "#060A12", minHeight: "100vh", paddingBottom: 40 }}>
      <div style={{ margin: "18px 16px 0", background: "#0A111D", borderRadius: 20, border: "1px solid #182235", overflow: "hidden", boxShadow: "0 18px 42px rgba(1, 7, 20, 0.35)" }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, ${heroColor}, ${heroColor}30)` }} />
        <div style={{ padding: "20px 20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: heroColor, boxShadow: `0 0 8px ${heroColor}, 0 0 16px ${heroColor}50` }} />
            <span style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: 0.8 }}>QUIETLY IN CONTROL</span>
            <span style={{ fontSize: 10, color: "#7B8EA8", marginLeft: "auto", border: "1px solid #1D2B40", borderRadius: 999, padding: "2px 8px" }}>
              {confidenceBadge}
            </span>
            {cycleCautionBadge && (
              <span style={{ fontSize: 10, color: "#7B8EA8", border: "1px solid #1D2B40", borderRadius: 999, padding: "2px 8px" }}>
                {cycleCautionBadge}
              </span>
            )}
          </div>

          <div style={{ fontSize: 34, fontWeight: 850, color: "#F3F7FF", letterSpacing: -1.2, lineHeight: 1.05, marginBottom: 8 }}>{heroLabel}</div>

          <div style={{ fontSize: 12, color: "#72829A", lineHeight: 1.4, marginBottom: 14 }}>{heroReason}</div>

          <div style={{ display: "flex", gap: 18, borderTop: "1px solid #162235", paddingTop: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "#506077", fontWeight: 600, letterSpacing: 0.6, marginBottom: 3 }}>SAVED BY GRIDLY TODAY</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: "#22C55E", letterSpacing: -0.5 }}>+£{homeValueSavings}</div>
            </div>
            {homeValueEarnings > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "#506077", fontWeight: 600, letterSpacing: 0.6, marginBottom: 3 }}>EARNED BY GRIDLY TODAY</div>
                <div style={{ fontSize: 19, fontWeight: 800, color: "#F59E0B", letterSpacing: -0.5 }}>+£{homeValueEarnings}</div>
              </div>
            )}
            <div style={{ marginLeft: "auto" }}>
              <div style={{ fontSize: 10, color: "#506077", fontWeight: 600, letterSpacing: 0.6, marginBottom: 3 }}>LIVE RATE</div>
              <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.5, color: currentPence < 15 ? "#22C55E" : currentPence < 25 ? "#F59E0B" : "#EF4444" }}>{currentPence.toFixed(1)}p</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ margin: "10px 16px 0", background: "#09101A", borderRadius: 22, border: "1px solid #172236", padding: "18px 20px 10px", boxShadow: "0 26px 48px rgba(1, 7, 20, 0.38)" }}>
        <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.2, marginBottom: 2 }}>ENERGY FLOW</div>
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
        <div style={{ fontSize: 11, color: "#71839C", lineHeight: 1.45, paddingBottom: 8 }}>{flowInterpretation}</div>
      </div>

      {timeline.length > 0 && (
        <div style={{ margin: "14px 16px 0", background: "#0B1120", borderRadius: 20, border: "1px solid #152238", padding: "14px 20px" }}>
          <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.05, marginBottom: 12 }}>NEXT</div>
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

      <div style={{ margin: "12px 16px 0", background: "#0A1220", borderRadius: 16, border: "1px solid #18263D", padding: "11px 14px" }}>
        <div style={{ fontSize: 10, color: "#7B8EA8", fontWeight: 700, letterSpacing: 0.75, marginBottom: 4 }}>SYSTEM CONFIDENCE</div>
        <div style={{ fontSize: 12, color: "#A5B4C7", lineHeight: 1.45 }}>{hasDeviceAlerts ? homeReassuranceNote : confidenceCopy}</div>
      </div>

      <SystemHealthCard connectedDevices={connectedDevices} deviceHealth={deviceHealth} />

      <DecisionExplanationSheet
        open={Boolean(selectedTimelineItem)}
        title="Why Gridly chose this"
        subtitle={selectedTimelineItem ? `${selectedTimelineItem.label} · ${selectedTimelineItem.reason || "Gridly action"}` : undefined}
        reasoning={selectedTimelineItem?.reasoning ?? []}
        onClose={() => setSelectedTimelineItem(null)}
      />

      <div style={{ margin: "24px 0 0" }}>
        <div style={{ borderTop: "1px solid #0A1020" }}>
          <CollapsibleSection label="Insights">
            <NightlyReportCard />
            {hasSolar && <SolarForecastCard />}
            {hasBattery && <BatteryHealthScore />}
            <TariffSwitcher connectedDevices={connectedDevices} />
          </CollapsibleSection>
        </div>

        <div style={{ borderTop: "1px solid #0A1020" }}>
          <CollapsibleSection label="Home settings">
            {connectedDevices.map((device) => (
              <DeviceRow key={device.id} device={device} />
            ))}
            <button
              onClick={() => {
                window.location.href = "/onboarding";
              }}
              style={{ width: "100%", background: "none", border: "none", padding: "14px 20px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#2D3A4A", fontWeight: 500, textAlign: "left" }}
            >
              Add device
            </button>
          </CollapsibleSection>
        </div>

        <div style={{ borderTop: "1px solid #0A1020" }}>
          <CollapsibleSection label="Manual controls (if needed)">
            {hasEV && <EVReadyBy />}
            {hasBattery && <BatteryReserve />}
            <ManualOverride currentPence={currentPence} connectedDevices={connectedDevices} />
            <ChargerLock connectedDevices={connectedDevices} />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}