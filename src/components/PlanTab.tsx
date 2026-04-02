import { useEffect, useMemo, useRef, useState } from "react";
import { useAgileRates } from "../hooks/useAgileRates";
import { replaceRuntimeTruthSnapshot } from "../journal/latestCycleHeartbeatSource";
import type { CycleHeartbeatEntry, DecisionExplainedJournalEntry, ExecutionJournalEntry } from "../journal/executionJournal";
import { SANDBOX, type DeviceConfig } from "../pages/SimplifiedDashboard";
import {
  buildOptimizerInputFromLegacyPlanContext,
  optimizeForLegacyPlanUi,
  type LegacyConnectedDeviceId,
  type LegacyPlanningStyle,
} from "../optimizer";
import { buildRuntimeGroundedExplanationLines } from "../lib/decisionExplanationPresentation";
import { buildDecisionFreshnessViewModel, DECISION_FRESHNESS_TOOLTIP } from "../lib/decisionFreshness";
import { buildOptimisationModeViewModel, buildPriceWindowsViewModel, groupDisplaySessions, selectDisplaySessions } from "./plan/planViewModels";
import PlanEnergyFlowCard from "./plan/PlanEnergyFlowCard";
import PriceWindowsCard from "./plan/PriceWindowsCard";
import OptimisationModeSelector from "./plan/OptimisationModeSelector";

interface PlanTabProps {
  connectedDevices: DeviceConfig[];
  now: Date;
  latestCycleHeartbeat?: CycleHeartbeatEntry;
  recentDecisionExplanations: DecisionExplainedJournalEntry[];
  recentExecutionOutcomes: ExecutionJournalEntry[];
}

interface PlanningStyleApiResponse {
  planningStyle: "cheapest" | "balanced" | "greenest";
}

interface UpcomingDecisionViewModel {
  key: string;
  actionHeadline: string;
  drivers: string[];
  confidence: string;
  timestamp: string;
  observedAt: string;
}

function toTimestamp(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function formatDecisionTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return "Time unavailable";
  }

  return new Date(parsed).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isReadableHeadline(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return !/^[a-z_]+$/.test(trimmed);
}

function mapDecisionToHeadline(decision: string): string {
  switch (decision.trim().toLowerCase()) {
    case "charge_battery":
      return "Charging battery";
    case "discharge_battery":
      return "Powering home from battery";
    case "discharge_ev_to_home":
      return "EV powering your home";
    case "divert_solar_to_ev":
      return "Diverting solar to EV";
    case "divert_solar_to_battery":
      return "Diverting solar to battery";
    case "charge_ev":
    case "start_charging":
      return "Charging EV";
    case "stop_charging":
      return "Stopping EV charging";
    case "export_to_grid":
      return "Exporting to grid";
    case "consume_solar":
      return "Running home on solar";
    case "hold":
      return "System is idle";
    default:
      if (decision.trim().toLowerCase().startsWith("rejected_")) {
        return "System is idle";
      }

      return "Action scheduled";
  }
}

function resolveActionHeadline(summary: string, decision: string): string {
  if (isReadableHeadline(summary)) {
    return summary.trim();
  }

  return mapDecisionToHeadline(decision);
}

function mapCanonicalPlanningStyleToLegacy(value: PlanningStyleApiResponse["planningStyle"]): LegacyPlanningStyle {
  if (value === "cheapest") return "CHEAPEST";
  if (value === "greenest") return "GREENEST";
  return "BALANCED";
}

function mapLegacyPlanningStyleToCanonical(value: LegacyPlanningStyle): PlanningStyleApiResponse["planningStyle"] {
  if (value === "CHEAPEST") return "cheapest";
  if (value === "GREENEST") return "greenest";
  return "balanced";
}

function mapRuntimePlanningStyleToLegacy(value: string | undefined): LegacyPlanningStyle | undefined {
  if (value === "cheapest") return "CHEAPEST";
  if (value === "balanced") return "BALANCED";
  if (value === "greenest") return "GREENEST";
  return undefined;
}

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

function buildUpcomingDecisionViewModels(
  explanations: DecisionExplainedJournalEntry[],
  executionOutcomes: ExecutionJournalEntry[],
  now: Date
): UpcomingDecisionViewModel[] {
  const nowMs = now.getTime();

  const executionByOpportunity = new Map<string, ExecutionJournalEntry[]>();
  executionOutcomes.forEach((entry) => {
    if (!entry.opportunityId) {
      return;
    }

    const existing = executionByOpportunity.get(entry.opportunityId) ?? [];
    existing.push(entry);
    executionByOpportunity.set(entry.opportunityId, existing);
  });

  const viewModels = explanations.map((entry, index) => {
    const matchingEntries = executionByOpportunity.get(entry.opportunityId) ?? [];
    const matchingEntry = matchingEntries
      .slice()
      .sort((left, right) => toTimestamp(right.recordedAt, 0) - toTimestamp(left.recordedAt, 0))[0];

    const canonicalWindowStart = matchingEntry?.canonicalCommand.effectiveWindow.startAt;
    const timestamp = canonicalWindowStart ?? entry.timestamp;

    return {
      key: `${entry.opportunityId}:${entry.timestamp}:${index}`,
      actionHeadline: resolveActionHeadline(entry.explanation.summary, entry.decision),
      drivers: entry.explanation.drivers,
      confidence: entry.explanation.confidence,
      timestamp,
      observedAt: entry.timestamp,
    } satisfies UpcomingDecisionViewModel;
  });

  const upcoming = viewModels
    .filter((entry) => toTimestamp(entry.timestamp, 0) >= nowMs)
    .sort((left, right) => toTimestamp(left.timestamp, nowMs) - toTimestamp(right.timestamp, nowMs));

  if (upcoming.length > 0) {
    return upcoming.slice(0, 6);
  }

  return viewModels
    .sort((left, right) => toTimestamp(right.timestamp, 0) - toTimestamp(left.timestamp, 0))
    .slice(0, 6);
}

async function forceRefreshRuntimeTruthSnapshot(): Promise<void> {
  if (typeof globalThis.fetch !== "function") {
    return;
  }

  const response = await globalThis.fetch(`/api/runtime-truth?refresh=${Date.now()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to refresh runtime truth");
  }

  const payload = await response.json() as {
    latestCycleHeartbeat?: CycleHeartbeatEntry;
    recentCycleHeartbeats?: CycleHeartbeatEntry[];
    recentExecutionOutcomes?: ExecutionJournalEntry[];
    recentDecisionExplanations?: DecisionExplainedJournalEntry[];
  };

  replaceRuntimeTruthSnapshot({
    latestCycleHeartbeat: payload.latestCycleHeartbeat,
    recentCycleHeartbeats: Array.isArray(payload.recentCycleHeartbeats) ? payload.recentCycleHeartbeats : [],
    recentExecutionOutcomes: Array.isArray(payload.recentExecutionOutcomes) ? payload.recentExecutionOutcomes : [],
    recentDecisionExplanations: Array.isArray(payload.recentDecisionExplanations) ? payload.recentDecisionExplanations : [],
  });
}

export default function PlanTab({
  connectedDevices,
  now,
  latestCycleHeartbeat,
  recentDecisionExplanations,
  recentExecutionOutcomes,
}: PlanTabProps) {
  const { rates } = useAgileRates();
  const planningStyleControlsRef = useRef<HTMLDivElement | null>(null);
  const currentSlot = Math.min(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30), 47);
  const [configuredPlanningStyle, setConfiguredPlanningStyle] = useState<LegacyPlanningStyle>("BALANCED");
  const [isRunningUpdatedPlan, setIsRunningUpdatedPlan] = useState(false);
  const [freshnessNowMs, setFreshnessNowMs] = useState(() => Date.now());
  const primaryDecision = useMemo(
    () => {
      const latestExplanation = recentDecisionExplanations[0];
      if (!latestExplanation) {
        return undefined;
      }

      const matchingEntry = recentExecutionOutcomes
        .filter((entry) => entry.opportunityId === latestExplanation.opportunityId)
        .slice()
        .sort((left, right) => toTimestamp(right.recordedAt, 0) - toTimestamp(left.recordedAt, 0))[0];

      return {
        key: `${latestExplanation.opportunityId}:${latestExplanation.timestamp}`,
        actionHeadline: resolveActionHeadline(latestExplanation.explanation.summary, latestExplanation.decision),
        drivers: latestExplanation.explanation.drivers,
        confidence: latestExplanation.explanation.confidence,
        timestamp: matchingEntry?.canonicalCommand.effectiveWindow.startAt ?? latestExplanation.timestamp,
        observedAt: latestExplanation.timestamp,
      } satisfies UpcomingDecisionViewModel;
    },
    [recentDecisionExplanations, recentExecutionOutcomes]
  );
  const runtimeAppliedPlanningStyle = mapRuntimePlanningStyleToLegacy(latestCycleHeartbeat?.economicSnapshot?.planningStyle);
  const planningStyle = runtimeAppliedPlanningStyle ?? configuredPlanningStyle;
  const runtimeGroundedExplanationLines = primaryDecision
    ? buildRuntimeGroundedExplanationLines({
      drivers: primaryDecision.drivers,
      confidence: primaryDecision.confidence,
    })
    : [];
  const freshnessViewModel = buildDecisionFreshnessViewModel(primaryDecision?.observedAt, freshnessNowMs, "last-decision");

  useEffect(() => {
    if (typeof globalThis.fetch !== "function") {
      return;
    }

    let cancelled = false;

    void globalThis.fetch("/api/planning-style", {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          return undefined;
        }

        return response.json() as Promise<PlanningStyleApiResponse>;
      })
      .then((payload) => {
        if (!payload || cancelled) {
          return;
        }

        setConfiguredPlanningStyle(mapCanonicalPlanningStyleToLegacy(payload.planningStyle));
      })
      .catch(() => {
        // Keep the last displayed selector value when the local settings bridge is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const intervalId = globalThis.setInterval(() => {
      setFreshnessNowMs(Date.now());
    }, 5000);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const root = planningStyleControlsRef.current;
    if (!root) {
      return;
    }

    const selectorButtons = root.querySelectorAll("button:not([type])");
    selectorButtons.forEach((button) => {
      button.setAttribute("type", "button");
    });
  }, [configuredPlanningStyle]);

  const handlePlanningStyleControlsClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.closest("a")) {
      event.preventDefault();
    }
  };

  const handlePlanningStyleChange = (nextStyle: LegacyPlanningStyle) => {
    setConfiguredPlanningStyle(nextStyle);

    if (typeof globalThis.fetch !== "function") {
      return;
    }

    const canonicalPlanningStyle = mapLegacyPlanningStyleToCanonical(nextStyle);

    const runUpdatedPlan = async () => {
      if (!import.meta.env.DEV || typeof globalThis.fetch !== "function") {
        return;
      }

      setIsRunningUpdatedPlan(true);

      try {
        const response = await globalThis.fetch("/api/dev/run-single-run", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ planningStyle: canonicalPlanningStyle }),
        });

        if (!response.ok) {
          throw new Error("Failed to run updated plan");
        }
      } finally {
        setIsRunningUpdatedPlan(false);
      }
    };

    void globalThis.fetch("/api/planning-style", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ planningStyle: canonicalPlanningStyle }),
    })
      .then(async () => {
        await runUpdatedPlan();
        await forceRefreshRuntimeTruthSnapshot();
      })
      .catch(() => {
        // Selection persistence is best-effort; runtime remains the source of applied policy.
      });
  };

  const handleRunUpdatedPlan = () => {
    if (!import.meta.env.DEV || typeof globalThis.fetch !== "function") {
      return;
    }

    const canonicalPlanningStyle = mapLegacyPlanningStyleToCanonical(configuredPlanningStyle);

    setIsRunningUpdatedPlan(true);

    void globalThis.fetch("/api/dev/run-single-run", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ planningStyle: canonicalPlanningStyle }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to run updated plan");
        }

        await forceRefreshRuntimeTruthSnapshot();
      })
      .catch(() => {
        // Keep selector state and existing runtime truth if local dev run fails.
      })
      .finally(() => {
        setIsRunningUpdatedPlan(false);
      });
  };
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

  const { plan, summary } = useMemo(() => {
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
    now,
    rates,
    connectedDeviceIds,
    connectedDeviceKey,
    planningStyle,
    forecastKwh,
    batteryStartPct,
  ]);

  const groupedDisplaySessions = useMemo(() => {
    const displaySessions = selectDisplaySessions(plan.sessions);
    return groupDisplaySessions(displaySessions);
  }, [plan.sessions]);

  const priceWindowsViewModel = useMemo(
    () => buildPriceWindowsViewModel(summary, plan.find((session) => session.action === "SOLAR"), forecastKwh),
    [summary, plan, forecastKwh]
  );
  const optimisationModeViewModel = useMemo(
    () => buildOptimisationModeViewModel(configuredPlanningStyle),
    [configuredPlanningStyle]
  );
  const hasSolar = connectedDeviceIds.includes("solar");
  const hasBattery = connectedDeviceIds.includes("battery");
  const hasEV = connectedDeviceIds.includes("ev");
  const hasGrid = connectedDeviceIds.includes("grid");
  const hasBatteryCharge = groupedDisplaySessions.some((session) => session.type === "battery_charge");
  const projectedBatteryPct = hasBattery
    ? Math.min(100, batteryStartPct + (hasBatteryCharge ? 28 : 0))
    : 0;

  return (
    <div style={{ background: "#060A12", minHeight: "100vh", padding: "16px 16px 40px" }}>
      <div
        style={{
          background: "#0D141E",
          border: "1px solid #1F3045",
          borderRadius: 16,
          padding: "16px 14px",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 10, color: "#7FA3C8", fontWeight: 700, letterSpacing: 0.8, marginBottom: 6 }}>
          PLAN
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#F9FAFB", marginBottom: 4 }}>UPCOMING DECISIONS</div>
      </div>

      {primaryDecision === undefined ? (
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1F2937",
            borderRadius: 14,
            padding: "14px 12px",
            color: "#9CA3AF",
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          No upcoming decisions are available yet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <div
            key={primaryDecision.key}
            style={{
              background: "#0F1724",
              border: "1px solid #243247",
              borderRadius: 16,
              padding: "12px 12px 12px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700, letterSpacing: 0.6 }}>
                {formatDecisionTimestamp(primaryDecision.timestamp)}
              </div>
              <div
                title={DECISION_FRESHNESS_TOOLTIP}
                aria-label={DECISION_FRESHNESS_TOOLTIP}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <div
                  style={{
                    fontSize: 8.5,
                    fontWeight: 700,
                    color: "#5E6E85",
                    border: "1px solid #1B293D",
                    borderRadius: 999,
                    padding: "2px 7px",
                    letterSpacing: 0.25,
                  }}
                >
                  {freshnessViewModel.label}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#6E819B",
                    border: "1px solid #1B293D",
                    borderRadius: 999,
                    padding: "2px 8px",
                    letterSpacing: 0.35,
                  }}
                >
                  Confidence: {primaryDecision.confidence}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 22, fontWeight: 810, color: "#F3F7FF", letterSpacing: -0.35, lineHeight: 1.15, marginBottom: 8 }}>
              {primaryDecision.actionHeadline}
            </div>

            <div style={{ marginBottom: runtimeGroundedExplanationLines.length > 0 ? 2 : 0 }}>
              <div style={{ fontSize: 10, color: "#6F819B", fontWeight: 700, letterSpacing: 0.8, marginBottom: 4 }}>
                WHY THIS DECISION
              </div>
            </div>

            {runtimeGroundedExplanationLines.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, color: "#A8BAD2", fontSize: 12, lineHeight: 1.45 }}>
                {runtimeGroundedExplanationLines.slice(0, 4).map((line, index) => (
                  <li key={`${primaryDecision.key}:driver:${index}`} style={{ marginBottom: index < Math.min(runtimeGroundedExplanationLines.length, 4) - 1 ? 6 : 0 }}>
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <PlanEnergyFlowCard
          hasSolar={hasSolar}
          hasBattery={hasBattery}
          hasEV={hasEV}
          hasGrid={hasGrid}
          solarForecastKwh={forecastKwh}
          projectedBatteryPct={projectedBatteryPct}
          sessions={groupedDisplaySessions}
        />
      </div>

      <div style={{ marginTop: 4 }}>
        <PriceWindowsCard
          viewModel={priceWindowsViewModel}
          rates={rates}
          currentSlot={currentSlot}
          sessions={groupedDisplaySessions}
        />
      </div>

      <div
        style={{
          margin: "4px 16px 0",
          background: "#0A111D",
          border: "1px solid #182235",
          borderRadius: 18,
          padding: "14px 0 10px",
        }}
      >
        <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 0.95, margin: "0 20px 10px" }}>
          PLANNING STYLE
        </div>
        <div ref={planningStyleControlsRef} onClickCapture={handlePlanningStyleControlsClickCapture}>
          <OptimisationModeSelector viewModel={optimisationModeViewModel} onChange={handlePlanningStyleChange} />
        </div>
        {import.meta.env.DEV && (
          <div style={{ margin: "8px 20px 0" }}>
            <button
              type="button"
              onClick={handleRunUpdatedPlan}
              disabled={isRunningUpdatedPlan}
              style={{
                width: "100%",
                borderRadius: 10,
                border: "1px solid #243247",
                background: isRunningUpdatedPlan ? "#0C1523" : "#0F1C2D",
                color: "#B8C7DB",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.3,
                padding: "9px 12px",
                cursor: isRunningUpdatedPlan ? "default" : "pointer",
                opacity: isRunningUpdatedPlan ? 0.75 : 1,
              }}
            >
              {isRunningUpdatedPlan ? "Running updated plan..." : "Run updated plan"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

