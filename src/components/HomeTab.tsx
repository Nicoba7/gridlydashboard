import FlowDot from "./FlowDot";
import { getGridlyMode, getModeDescription } from "../lib/gridlyEngine";
import { Battery, Home, Sun, TrendingUp, Zap } from "lucide-react";
import TomorrowForecast from "../pages/TomorrowForecast";
import { buildOptimizationActions } from "../lib/optimizationCoach";
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

export default function HomeTab({ connectedDevices, now }: { connectedDevices: DeviceConfig[]; now: Date }) {
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

  const optimizationActions = buildOptimizationActions({
    connectedDevices,
    currentPence,
    bestSlotPrice: best.price,
    solarKw: s.w / 1000,
    gridExportW: s.gridW,
  });
  const monthlyPotential = optimizationActions.reduce((sum, action) => sum + action.impactMonthly, 0);

  return (
    <div>
      <div style={{ padding: "44px 24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginBottom: 2 }}>{greeting}</div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>
          {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </div>
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

      {/* Device health alerts — top priority */}
      <DeviceHealthAlerts connectedDevices={connectedDevices} />

      {/* Nightly report card */}
      <NightlyReportCard />

      {/* Mode card */}
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


      {optimizationActions.length > 0 && (
        <div style={{ margin: "0 20px 16px", background: "#101826", border: "1px solid #1E3A8A40", borderRadius: 16, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#60A5FA", fontWeight: 700, letterSpacing: 1 }}>OPTIMISATION COACH</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#22C55E" }}>+£{monthlyPotential.toFixed(2)}/mo</div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {optimizationActions.map(action => (
              <div key={action.title} style={{ background: "#0D1117", border: "1px solid #1F2937", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#F9FAFB" }}>{action.title}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: action.type === "earning" ? "#F59E0B" : "#22C55E", flexShrink: 0 }}>+£{action.impactMonthly.toFixed(2)}</div>
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4, lineHeight: 1.5 }}>{action.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}
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
