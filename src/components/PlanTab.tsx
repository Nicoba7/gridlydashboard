import { useAgileRates } from "../hooks/useAgileRates";
import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SANDBOX, DeviceConfig } from "../pages/SimplifiedDashboard";
import {
  buildOptimizerInputFromLegacyPlanContext,
  optimizeForLegacyPlanUi,
  type LegacyConnectedDeviceId,
  type LegacyPlanningStyle,
} from "../optimizer";
import {
  buildAIInsightViewModel,
  buildPlanHeroViewModel,
  buildPlanSummaryViewModel,
  buildPlanTimelineViewModel,
  buildOptimisationModeViewModel,
  buildPriceWindowsViewModel,
  groupDisplaySessions,
  selectDisplaySessions,
} from "./plan/planViewModels";
import AIInsightCard from "./plan/AIInsightCard";
import AIPlanSummaryCard from "./plan/AIPlanSummaryCard";
import OptimisationModeSelector from "./plan/OptimisationModeSelector";
import PlanHeroCard from "./plan/PlanHeroCard";
import PlanTimelineCard from "./plan/PlanTimelineCard";
import PlanEnergyFlowCard from "./plan/PlanEnergyFlowCard";
import PriceWindowsCard from "./plan/PriceWindowsCard";

const ENABLE_PLAN_SIMULATION = import.meta.env.DEV;

function buildLivePlanContext(now: Date, baseSolarForecastKwh: number, baseBatteryPct: number) {
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const dayProgress = minuteOfDay / 1440;
  const dayPhase = dayProgress * Math.PI * 2;

  const forecastDrift = Math.sin(dayPhase * 1.7) * 1.8;
  const solarForecastKwh = Math.max(2, Number((baseSolarForecastKwh + forecastDrift).toFixed(1)));

  const batteryDrift = Math.sin(dayPhase - 0.9) * 9;
  const batteryStartPct = Math.max(12, Math.min(96, Math.round(baseBatteryPct + batteryDrift)));

  return {
    solarForecastKwh,
    batteryStartPct,
  };
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
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "16px 20px",
          cursor: "pointer",
          fontFamily: "inherit",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 550, color: "#8795AA", letterSpacing: 0.18 }}>{label}</span>
        {open ? (
          <ChevronUp size={14} color="#445066" strokeWidth={2.2} />
        ) : (
          <ChevronDown size={14} color="#445066" strokeWidth={2.2} />
        )}
      </button>
      {open && <div style={{ paddingBottom: 8 }}>{children}</div>}
    </div>
  );
}

export default function PlanTab({ connectedDevices, now }: { connectedDevices: DeviceConfig[]; now: Date }) {
  const { rates, loading, status } = useAgileRates();
  const currentSlot = Math.min(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30), 47);
  const [optimisationMode, setOptimisationMode] = useState<LegacyPlanningStyle>("BALANCED");
  const planningStyle = optimisationMode;

  const baseForecastKwh = SANDBOX?.solarForecast?.kwh ?? 0;
  const baseBatteryPct = SANDBOX?.solar?.batteryPct ?? 55;
  const livePlanContext = useMemo(
    () => buildLivePlanContext(now, baseForecastKwh, baseBatteryPct),
    [now, baseForecastKwh, baseBatteryPct]
  );

  const forecastKwh = ENABLE_PLAN_SIMULATION ? livePlanContext.solarForecastKwh : baseForecastKwh;
  const batteryStartPct = ENABLE_PLAN_SIMULATION ? livePlanContext.batteryStartPct : baseBatteryPct;
  const connectedDeviceIds = useMemo(() => {
    const allowed = new Set<LegacyConnectedDeviceId>(["solar", "battery", "ev", "grid"]);
    return connectedDevices
      .map((device) => device.id)
      .filter((id): id is LegacyConnectedDeviceId => allowed.has(id as LegacyConnectedDeviceId));
  }, [connectedDevices]);

  const connectedDeviceKey = connectedDeviceIds.join("|");

  const { plan, summary, gridlySummary } = useMemo(() => {
    const optimizerInput = buildOptimizerInputFromLegacyPlanContext({
      now,
      rates,
      connectedDeviceIds,
      planningStyle,
      solarForecastKwh: forecastKwh,
      batteryStartPct,
      batteryCapacityKwh: 10,
      batteryReservePct: planningStyle === "GREENEST" ? 35 : planningStyle === "BALANCED" ? 30 : 22,
      maxBatteryCyclesPerDay: planningStyle === "GREENEST" ? 1 : 2,
      evTargetKwh: 16,
      evReadyBy: "07:00",
      exportPriceRatio: 0.72,
      carbonIntensity: SANDBOX?.carbonIntensity,
    });

    return optimizeForLegacyPlanUi(optimizerInput);
  }, [
    rates,
    connectedDeviceIds,
    connectedDeviceKey,
    forecastKwh,
    planningStyle,
    currentSlot,
    batteryStartPct,
    now,
  ]);

  const groupedDisplaySessions = useMemo(() => {
    const sessions = plan.sessions;
    const displaySessions = selectDisplaySessions(sessions);
    return groupDisplaySessions(displaySessions);
  }, [plan.sessions, planningStyle]);

  if (import.meta.env.DEV) {
    console.log("Gridly sessions:", groupedDisplaySessions);
  }

  const hasSolar = connectedDeviceIds.includes("solar");
  const hasBattery = connectedDeviceIds.includes("battery");
  const hasEV = connectedDeviceIds.includes("ev");
  const hasGrid = connectedDeviceIds.includes("grid");
  const solarForecastKwh = forecastKwh;
  const hasBatteryCharge = groupedDisplaySessions.some((s) => s.type === "battery_charge");
  const projectedBatteryPct = hasBattery
    ? Math.min(100, batteryStartPct + (hasBatteryCharge ? 28 : 0))
    : 0;

  const heroViewModel = buildPlanHeroViewModel({
    summary,
    gridlySummary,
    sessions: groupedDisplaySessions,
    pricingStatus: status,
    loading,
    solarForecastKwh: forecastKwh,
  });

  const timelineViewModel = buildPlanTimelineViewModel(groupedDisplaySessions, connectedDeviceIds, planningStyle, {
    solarForecastKwh: forecastKwh,
    cheapestPrice: summary.cheapestPrice,
    peakPrice: summary.peakPrice,
    cheapestWindow: summary.cheapestSlot,
    peakWindow: summary.peakSlot,
    evReadyBy: summary.evReadyBy,
  });
  const priceWindowsViewModel = buildPriceWindowsViewModel(summary, plan.find((s) => s.action === "SOLAR"), forecastKwh);
  const planSummaryViewModel = buildPlanSummaryViewModel({
    summary,
    gridlySummary,
    sessions: groupedDisplaySessions,
  });
  const insightViewModel = buildAIInsightViewModel({
    gridlySummary,
    summary,
    pricingStatus: status,
    mode: planningStyle,
  });
  const optimisationModeViewModel = buildOptimisationModeViewModel(planningStyle);

  return (
    <div style={{ background: "#060A12", minHeight: "100vh", paddingBottom: 40 }}>

      <PlanHeroCard viewModel={heroViewModel} />
      <PlanEnergyFlowCard
        hasSolar={hasSolar}
        hasBattery={hasBattery}
        hasEV={hasEV}
        hasGrid={hasGrid}
        solarForecastKwh={solarForecastKwh}
        projectedBatteryPct={projectedBatteryPct}
        sessions={groupedDisplaySessions}
      />
      <PlanTimelineCard viewModel={timelineViewModel} nowDate={now} />

      <div style={{ margin: "24px 0 0" }}>
        {gridlySummary.showPriceChart && (
          <div style={{ borderTop: "1px solid #0A1020" }}>
            <CollapsibleSection label="Price Outlook">
              <PriceWindowsCard
                viewModel={priceWindowsViewModel}
                rates={rates}
                currentSlot={currentSlot}
                sessions={groupedDisplaySessions}
              />
            </CollapsibleSection>
          </div>
        )}

        <div style={{ borderTop: "1px solid #0A1020" }}>
          <CollapsibleSection label="Why this plan wins">
            <AIPlanSummaryCard viewModel={planSummaryViewModel} />
            {insightViewModel && <AIInsightCard viewModel={insightViewModel} />}
          </CollapsibleSection>
        </div>

        <div style={{ borderTop: "1px solid #0A1020" }}>
          <CollapsibleSection label="Planning Style">
            <OptimisationModeSelector viewModel={optimisationModeViewModel} onChange={setOptimisationMode} />
          </CollapsibleSection>
        </div>
      </div>

    </div>
  );
}

