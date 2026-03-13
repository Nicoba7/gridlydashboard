import { Sun, Battery, Zap, TrendingUp, Home } from "lucide-react";

type Props = {
  connectedDevices: any[];
  s: {
    w: number;
    batteryPct: number;
    gridW: number;
    homeW: number;
  };
  isCharging: boolean;
  isExporting: boolean;
  FlowDot: any;
};

export default function EnergyFlow({
  connectedDevices,
  s,
  isCharging,
  isExporting,
  FlowDot,
}: Props) {
  return (
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
              <div style={{ width: 52, height: 52, background: "#F59E0B15", border: "1.5px solid #F59E0B30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
                <Sun size={22} color="#F59E0B" />
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>{(s.w / 1000).toFixed(1)}kW</div>
              <div style={{ fontSize: 10, color: "#6B7280" }}>Solar</div>
            </div>
            <FlowDot active={s.w > 0} color="#F59E0B" />
          </>
        )}

        <div style={{ textAlign: "center" }}>
          <div style={{ width: 52, height: 52, background: "#ffffff10", border: "1.5px solid #ffffff20", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
            <Home size={22} color="#E5E7EB" />
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>{(s.homeW / 1000).toFixed(1)}kW</div>
          <div style={{ fontSize: 10, color: "#6B7280" }}>Home</div>
        </div>

        {connectedDevices.some(d => d.id === "battery") && (
          <>
            <FlowDot active={isCharging} color="#16A34A" />
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 52, height: 52, background: "#16A34A15", border: "1.5px solid #16A34A30", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
                <Battery size={22} color="#22C55E" />
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#F9FAFB" }}>{s.batteryPct}%</div>
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
              <div style={{ fontSize: 13, fontWeight: 800, color: "#38BDF8" }}>Charging</div>
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
              <div style={{ fontSize: 10, color: "#6B7280" }}>{isExporting ? "Exporting" : "Grid"}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
