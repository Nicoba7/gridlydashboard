import { useAgileRates } from "../hooks/useAgileRates";
import { useState } from "react";
import TomorrowForecast from "../pages/TomorrowForecast";
import { SANDBOX, DeviceConfig } from "../pages/SimplifiedDashboard";
import { buildGridlyPlan, ConnectedDeviceId, OptimisationMode } from "../lib/gridlyPlan";
import {
  buildAIInsightViewModel,
  buildPlanHeroViewModel,
  buildPlanSummaryViewModel,
  buildPlanTimelineViewModel,
  buildOptimisationModeViewModel,
  buildPriceWindowsViewModel,
  selectDisplaySessions,
} from "./plan/planViewModels";
import AIInsightCard from "./plan/AIInsightCard";
import AIPlanSummaryCard from "./plan/AIPlanSummaryCard";
import AskGridlyCard from "./plan/AskGridlyCard";
import OptimisationModeSelector from "./plan/OptimisationModeSelector";
import PlanHeroCard from "./plan/PlanHeroCard";
import PlanTimelineCard from "./plan/PlanTimelineCard";
import PriceWindowsCard from "./plan/PriceWindowsCard";

function getCurrentSlotIndex() {
  const now = new Date();
  return Math.min(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30), 47);
}

export default function PlanTab({ connectedDevices }: { connectedDevices: DeviceConfig[] }) {
  const { rates, loading, error, status } = useAgileRates();
  const currentSlot = getCurrentSlotIndex();
  const [optimisationMode, setOptimisationMode] = useState<OptimisationMode>("BALANCED");

  const pricingStatus = status;
  const forecastKwh = SANDBOX?.solarForecast?.kwh ?? 0;

  const connectedDeviceIds = connectedDevices.map((d) => d.id) as ConnectedDeviceId[];
  const { plan, summary, gridlySummary } = buildGridlyPlan(rates, connectedDeviceIds, forecastKwh, optimisationMode, {
    batteryCapacityKwh: 10,
    batteryStartPct: SANDBOX?.solar?.batteryPct ?? 55,
    batteryReservePct: optimisationMode === "GREENEST" ? 35 : optimisationMode === "BALANCED" ? 30 : 22,
    maxBatteryCyclesPerDay: optimisationMode === "GREENEST" ? 1 : 2,
    evTargetKwh: 16,
    evReadyBy: "07:00",
    exportPriceRatio: 0.72,
    nowSlotIndex: currentSlot,
    carbonIntensity: SANDBOX?.carbonIntensity,
  });
  const sessions = plan.sessions;
  const displaySessions = selectDisplaySessions(sessions);

  if (import.meta.env.DEV) {
    console.log("Gridly sessions:", displaySessions);
  }

  const heroViewModel = buildPlanHeroViewModel({
    summary,
    gridlySummary,
    sessions: displaySessions,
    pricingStatus,
    loading,
  });

  const timelineViewModel = buildPlanTimelineViewModel(displaySessions, connectedDeviceIds, optimisationMode);
  const priceWindowsViewModel = buildPriceWindowsViewModel(summary, plan.find((s) => s.action === "SOLAR"), forecastKwh);
  const planSummaryViewModel = buildPlanSummaryViewModel({
    summary,
    gridlySummary,
    sessions: displaySessions,
  });
  const insightViewModel = buildAIInsightViewModel({
    gridlySummary,
    summary,
    pricingStatus,
    mode: optimisationMode,
  });
  const optimisationModeViewModel = buildOptimisationModeViewModel(optimisationMode);

  return (
    <div style={{ padding: "44px 0 0" }}>
      <div style={{ padding: "0 24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginBottom: 2 }}>Tonight's plan</div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>Already sorted — nothing you need to do</div>
      </div>

      <PlanHeroCard viewModel={heroViewModel} />
      {gridlySummary.showPriceChart && <PriceWindowsCard viewModel={priceWindowsViewModel} rates={rates} currentSlot={currentSlot} />}
      <div style={{ margin: "0 20px" }}>
        <TomorrowForecast />
      </div>
      <AIPlanSummaryCard viewModel={planSummaryViewModel} />
      <OptimisationModeSelector viewModel={optimisationModeViewModel} onChange={setOptimisationMode} />
      <PlanTimelineCard viewModel={timelineViewModel} />
      {insightViewModel && <AIInsightCard viewModel={insightViewModel} />}
      <AskGridlyCard />
    </div>
  );
}
