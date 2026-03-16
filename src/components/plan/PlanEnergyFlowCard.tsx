import type { GridlyPlanSession } from "../../types/planCompat";
import { ENERGY_COLORS } from "../energyColors";
import { FlowConnector, FlowNode } from "../flowPrimitives";

type Props = {
  hasSolar: boolean;
  hasBattery: boolean;
  hasEV: boolean;
  hasGrid: boolean;
  solarForecastKwh: number;
  projectedBatteryPct: number;
  sessions: GridlyPlanSession[];
};

function buildFlowExplanation({
  hasSolar,
  hasBattery,
  hasEV,
  hasExport,
  hasBatteryCharge,
  projectedBatteryPct,
  hasSolarSession,
}: {
  hasSolar: boolean;
  hasBattery: boolean;
  hasEV: boolean;
  hasExport: boolean;
  hasBatteryCharge: boolean;
  projectedBatteryPct: number;
  hasSolarSession: boolean;
}) {
  if (hasSolar && hasSolarSession && hasBattery && projectedBatteryPct >= 60 && hasExport) {
    return "Solar is expected to carry most daytime demand while Gridly keeps battery flexibility for evening export.";
  }

  if (hasSolar && hasSolarSession && hasBattery && projectedBatteryPct >= 55) {
    return "Solar should cover most daytime demand, with battery reserve held for the evening peak.";
  }

  if (hasEV && hasBatteryCharge) {
    return "Gridly is using cheaper overnight charging so your EV is ready by morning without pushing cost into peak hours.";
  }

  if (hasBattery && hasExport) {
    return "Gridly is holding battery energy for later, when export value is strongest.";
  }

  if (!hasSolar && hasBatteryCharge) {
    return "With limited solar expected, Gridly tops up overnight to keep tomorrow stable through higher-price periods.";
  }

  if (hasEV) {
    return "EV charging is placed in lower-price windows so morning readiness stays efficient.";
  }

  return hasSolar
    ? "Solar should cover a meaningful share of tomorrow’s demand, with Gridly balancing the rest automatically."
    : "Gridly will balance import and storage through the day to keep tomorrow steady and cost-aware.";
}

export default function PlanEnergyFlowCard({
  hasSolar,
  hasBattery,
  hasEV,
  hasGrid,
  solarForecastKwh,
  projectedBatteryPct,
  sessions,
}: Props) {
  const hasBatteryCharge = sessions.some((s) => s.type === "battery_charge");
  const hasEvCharge = sessions.some((s) => s.type === "ev_charge");
  const hasExport = sessions.some((s) => s.type === "export");
  const hasSolarSession = sessions.some((s) => s.type === "solar_use") || solarForecastKwh > 5;
  const flowExplanation = buildFlowExplanation({
    hasSolar,
    hasBattery,
    hasEV,
    hasExport,
    hasBatteryCharge,
    projectedBatteryPct,
    hasSolarSession,
  });

  // Identical node layout to Home's EnergyFlowSVG
  const HOME = { x: 160, y: 110 };
  const SOLAR = { x: 160, y: 28 };
  const BATT = { x: 270, y: 110 };
  const EV = { x: 160, y: 192 };
  const GRID = { x: 50, y: 110 };
  const nodeRadius = 26;
  const homeRadius = 30;

  const solarActive = hasSolar && hasSolarSession;
  const battActive = hasBattery && hasBatteryCharge;
  const evActive = hasEV && hasEvCharge;
  const exportActive = hasGrid && hasExport;
  const gridImport = hasGrid && !hasExport;

  return (
    <div className="mx-4 mt-3 rounded-[22px] border border-[#172236] bg-[#09101A] px-5 pb-2 pt-4 shadow-[0_18px_36px_rgba(1,7,20,0.34)]">
      <div className="mb-[6px] flex items-center justify-between">
        <div className="text-[10px] font-bold tracking-[1.15px] text-[#4E5E75]">PROJECTED FLOW</div>
        <div className="text-[10px] text-[#62738B]">By 07:00</div>
      </div>

      <svg viewBox="0 0 320 220" style={{ width: "100%", maxHeight: 232 }}>
        {/* Connection lines — static dashes, no animation */}
        {hasSolar && (
          <FlowConnector
            x1={SOLAR.x} y1={SOLAR.y + nodeRadius}
            x2={HOME.x} y2={HOME.y - homeRadius}
            active={solarActive}
            color={ENERGY_COLORS.solar}
            intensity="plan"
          />
        )}
        {hasBattery && (
          <FlowConnector
            x1={HOME.x + homeRadius} y1={HOME.y}
            x2={BATT.x - nodeRadius} y2={BATT.y}
            active={battActive}
            color={ENERGY_COLORS.battery}
            intensity="plan"
          />
        )}
        {hasEV && (
          <FlowConnector
            x1={HOME.x} y1={HOME.y + homeRadius}
            x2={EV.x} y2={EV.y - nodeRadius}
            active={evActive}
            color={ENERGY_COLORS.ev}
            intensity="plan"
          />
        )}
        {hasGrid && (
          <FlowConnector
            x1={GRID.x + nodeRadius} y1={GRID.y}
            x2={HOME.x - homeRadius} y2={HOME.y}
            active={exportActive || gridImport}
            color={ENERGY_COLORS.grid}
            intensity="plan"
          />
        )}

        {/* HOME node */}
        <circle cx={HOME.x} cy={HOME.y} r={homeRadius + 10} fill="none" stroke="#1A253514" strokeWidth="14" />
        <circle cx={HOME.x} cy={HOME.y} r={homeRadius} fill="#0C1422" stroke="#1A2535" strokeWidth="1.5" />
        <text x={HOME.x} y={HOME.y - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={ENERGY_COLORS.home} fontFamily="system-ui, -apple-system, sans-serif">~1kW</text>
        <text x={HOME.x} y={HOME.y + 10} textAnchor="middle" fontSize="8" fill="#49586C" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.6">HOME</text>

        {/* SOLAR node */}
        {hasSolar && (
          <FlowNode
            x={SOLAR.x}
            y={SOLAR.y}
            radius={nodeRadius}
            active={solarActive}
            color={ENERGY_COLORS.solar}
            value={solarForecastKwh > 0 ? `${Math.round(solarForecastKwh)}kWh` : "0kWh"}
            valueFontSize={10}
            valueActiveColor={ENERGY_COLORS.solar}
            valueInactiveColor="#6B7280"
            label="SOLAR"
            labelColor="#49586C"
          />
        )}

        {/* BATTERY node */}
        {hasBattery && (
          <FlowNode
            x={BATT.x}
            y={BATT.y}
            radius={nodeRadius}
            active={battActive}
            color={ENERGY_COLORS.battery}
            value={`${projectedBatteryPct}%`}
            valueFontSize={11}
            valueActiveColor={ENERGY_COLORS.battery}
            valueInactiveColor="#D1D5DB"
            label="BATTERY"
            labelColor="#49586C"
          />
        )}

        {/* EV node */}
        {hasEV && (
          <FlowNode
            x={EV.x}
            y={EV.y}
            radius={nodeRadius}
            active={evActive}
            color={ENERGY_COLORS.ev}
            value="80%"
            valueFontSize={10}
            valueActiveColor={ENERGY_COLORS.ev}
            valueInactiveColor={ENERGY_COLORS.ev}
            label="EV"
            labelColor="#49586C"
          />
        )}

        {/* GRID node */}
        {hasGrid && (
          <>
            <FlowNode
              x={GRID.x}
              y={GRID.y}
              radius={nodeRadius}
              active={true}
              color={ENERGY_COLORS.grid}
              value="GRID"
              valueFontSize={9}
              valueActiveColor={ENERGY_COLORS.grid}
              valueInactiveColor={ENERGY_COLORS.grid}
              label=""
              labelColor="#49586C"
              labelLetterSpacing="0"
              showHalo={false}
            />
            <text x={GRID.x} y={GRID.y + 10} textAnchor="middle" fontSize="7" fill="#49586C" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.4">{exportActive ? "PEAK PERIOD" : "IMPORT"}</text>
          </>
        )}
      </svg>

      <div className="pb-2 text-[11px] leading-[1.45] text-[#71839C]">
        {flowExplanation}
      </div>
    </div>
  );
}
