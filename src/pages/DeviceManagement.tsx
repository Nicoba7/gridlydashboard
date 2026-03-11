import { Sun, Battery, Zap, CheckCircle2, ChevronRight, ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Device {
  id: string;
  name: string;
  connected: boolean;
  icon: React.ElementType;
  color: string;
  monthlyValue: number;
  description: string;
}

const DEVICES: Device[] = [
  { id: "solar", name: "Solar Inverter", connected: true, icon: Sun, color: "#F59E0B", monthlyValue: 35, description: "Generating and using your own electricity" },
  { id: "battery", name: "Home Battery", connected: true, icon: Battery, color: "#16A34A", monthlyValue: 32, description: "Storing cheap electricity for peak hours" },
  { id: "ev", name: "EV Charger", connected: false, icon: Zap, color: "#38BDF8", monthlyValue: 26, description: "Charging your car when electricity is cheapest" },
];

export default function DeviceManagement() {
  const navigate = useNavigate();
  const connected = DEVICES.filter(d => d.connected);
  const available = DEVICES.filter(d => !d.connected);
  const currentMonthly = connected.reduce((s, d) => s + d.monthlyValue, 0);
  const potentialMonthly = DEVICES.reduce((s, d) => s + d.monthlyValue, 0);

  return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      color: "#F9FAFB", maxWidth: 420, margin: "0 auto", paddingBottom: 40,
    }}>
      {/* Header */}
      <div style={{ padding: "48px 20px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => navigate("/")} style={{
          background: "#111827", border: "1px solid #1F2937", borderRadius: 10, padding: 8, cursor: "pointer", display: "flex"
        }}>
          <ChevronLeft size={18} color="#9CA3AF" />
        </button>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>Your Devices</div>
          <div style={{ fontSize: 13, color: "#9CA3AF" }}>{connected.length} connected · saving £{currentMonthly}/month</div>
        </div>
      </div>

      {/* Summary */}
      <div style={{ margin: "0 20px 20px", background: "#0D1F14", border: "1px solid #16A34A40", borderRadius: 16, padding: 20, display: "flex", justifyContent: "space-around", textAlign: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>You're saving</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#22C55E" }}>£{currentMonthly}</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>per month</div>
        </div>
        <div style={{ width: 1, background: "#16A34A30" }} />
        <div>
          <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>Full potential</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#F59E0B" }}>£{potentialMonthly}</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>per month</div>
        </div>
      </div>

      {/* Connected */}
      <div style={{ margin: "0 20px 24px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>Connected</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {connected.map(device => {
            const Icon = device.icon;
            return (
              <div key={device.id} style={{
                background: "#111827", border: `1px solid ${device.color}30`, borderRadius: 14,
                padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ background: `${device.color}20`, borderRadius: 10, padding: 8 }}>
                    <Icon size={20} color={device.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB", marginBottom: 2 }}>{device.name}</div>
                    <div style={{ fontSize: 12, color: "#9CA3AF" }}>{device.description}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#22C55E" }}>+£{device.monthlyValue}</span>
                  <CheckCircle2 size={18} color="#22C55E" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Available to connect */}
      {available.length > 0 && (
        <div style={{ margin: "0 20px 24px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>Unlock more savings</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {available.map(device => {
              const Icon = device.icon;
              return (
                <button key={device.id} style={{
                  background: `${device.color}08`, border: `2px solid ${device.color}30`, borderRadius: 14,
                  padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer", width: "100%", textAlign: "left"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ background: `${device.color}20`, borderRadius: 10, padding: 8 }}>
                      <Icon size={20} color={device.color} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB", marginBottom: 2 }}>Add {device.name}</div>
                      <div style={{ fontSize: 12, color: "#9CA3AF" }}>{device.description}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: device.color, marginTop: 4 }}>Worth +£{device.monthlyValue}/month</div>
                    </div>
                  </div>
                  <ChevronRight size={20} color={device.color} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Projected savings */}
      <div style={{ margin: "0 20px", background: "#0D1F14", border: "1px solid #16A34A40", borderRadius: 16, padding: 20 }}>
        <div style={{ fontSize: 10, color: "#16A34A", fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>ANNUAL PROJECTION</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#22C55E", letterSpacing: -1 }}>£{potentialMonthly * 12}</div>
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>with all devices connected</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#6B7280" }}>Current</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#22C55E" }}>£{currentMonthly * 12}/yr</div>
          </div>
        </div>
      </div>
    </div>
  );
}
