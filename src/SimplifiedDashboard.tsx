import { useState, useEffect } from "react";
import {
  Sun,
  Battery,
  Zap,
  TrendingUp,
  PoundSterling,
  ChevronRight,
  AlertCircle,
  Wifi,
} from "lucide-react";

interface Device {
  id: string;
  name: string;
  connected: boolean;
  status: string;
  monthlyValue: number;
  icon: React.ElementType;
  color: string;
}

const ALL_DEVICES: Device[] = [
  {
    id: "solar",
    name: "Solar Inverter",
    connected: true,
    status: "2.8kW generating",
    monthlyValue: 35,
    icon: Sun,
    color: "#F59E0B",
  },
  {
    id: "battery",
    name: "Home Battery",
    connected: true,
    status: "62% charged",
    monthlyValue: 32,
    icon: Battery,
    color: "#16A34A",
  },
  {
    id: "ev",
    name: "EV Charger",
    connected: false,
    status: "Not connected",
    monthlyValue: 26,
    icon: Zap,
    color: "#38BDF8",
  },
];

export default function SimplifiedDashboard() {
  const [devices, setDevices] = useState(ALL_DEVICES);

  const connectedDevices = devices.filter((d) => d.connected);
  const currentMonthlyValue = connectedDevices.reduce(
    (sum, d) => sum + d.monthlyValue,
    0
  );
  const nextDevice = devices.find((d) => !d.connected);
  const nextDeviceValue = nextDevice ? nextDevice.monthlyValue : 0;

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #111827 0%, #0F1419 100%)",
        minHeight: "100vh",
        padding: "20px",
        color: "#F9FAFB",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 24, marginTop: 12 }}>
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 4,
            letterSpacing: -0.5,
          }}
        >
          Your Energy OS
        </div>
        <div style={{ fontSize: 14, color: "#6B7280" }}>
          {connectedDevices.length} of {ALL_DEVICES.length} devices connected
        </div>
      </div>

      {/* Main value card */}
      <div
        style={{
          background: "linear-gradient(135deg, #16A34A40 0%, #16A34A20 100%)",
          border: "1px solid #16A34A60",
          borderRadius: 16,
          padding: "20px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>
              Saving this month
            </div>
            <div
              style={{
                fontSize: 36,
                fontWeight: 800,
                color: "#22C55E",
                letterSpacing: -1,
              }}
            >
              £{currentMonthlyValue}
            </div>
          </div>
          <div
            style={{
              background: "#16A34A20",
              borderRadius: 8,
              padding: 8,
            }}
          >
            <TrendingUp size={24} color="#22C55E" />
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#9CA3AF" }}>
          {connectedDevices.length === 3 ? (
            <span>All devices optimised</span>
          ) : (
            <span>{3 - connectedDevices.length} more device{3 - connectedDevices.length !== 1 ? "s" : ""} available</span>
          )}
        </div>
      </div>

      {/* Device synergy: Current setup */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#9CA3AF",
            marginBottom: 10,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Connected Devices
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          {connectedDevices.map((device) => {
            const Icon = device.icon;
            return (
              <div
                key={device.id}
                style={{
                  background: "#1F2937",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  border: "1px solid #374151",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      background: `${device.color}20`,
                      borderRadius: 8,
                      padding: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={18} color={device.color} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#F9FAFB",
                        marginBottom: 2,
                      }}
                    >
                      {device.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#6B7280",
                      }}
                    >
                      {device.status}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: device.color,
                  }}
                >
                  +£{device.monthlyValue}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Device synergy: Next unlock */}
      {nextDevice && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#9CA3AF",
              marginBottom: 10,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Unlock More
          </div>
          <button
            style={{
              width: "100%",
              background: `${nextDevice.color}20`,
              border: `2px solid ${nextDevice.color}40`,
              borderRadius: 10,
              padding: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                `${nextDevice.color}30`;
              (e.currentTarget as HTMLElement).style.borderColor =
                `${nextDevice.color}60`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                `${nextDevice.color}20`;
              (e.currentTarget as HTMLElement).style.borderColor =
                `${nextDevice.color}40`;
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  background: `${nextDevice.color}40`,
                  borderRadius: 8,
                  padding: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AlertCircle size={18} color={nextDevice.color} />
              </div>
              <div style={{ textAlign: "left" }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#F9FAFB",
                    marginBottom: 2,
                  }}
                >
                  Add {nextDevice.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#9CA3AF",
                  }}
                >
                  Unlock +£{nextDevice.monthlyValue}/month
                </div>
              </div>
            </div>
            <ChevronRight size={20} color={nextDevice.color} />
          </button>
        </div>
      )}

      {/* Quick stats */}
      <div
        style={{
          background: "#111827",
          border: "1px solid #1F2937",
          borderRadius: 12,
          padding: "16px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#9CA3AF",
            marginBottom: 12,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          This Month at a Glance
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>
              Solar Generated
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#F59E0B",
              }}
            >
              98 kWh
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>
              Battery Cycled
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#16A34A",
              }}
            >
              26 kWh
            </div>
          </div>
        </div>
      </div>

      {/* Decision engine - what's happening now */}
      <div
        style={{
          background: "#0D1F14",
          border: "1px solid #16A34A40",
          borderRadius: 12,
          padding: "14px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "#16A34A",
            fontWeight: 700,
            letterSpacing: 1.2,
            marginBottom: 6,
          }}
        >
          GRIDLY DECISION
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: "#22C55E",
            marginBottom: 4,
            letterSpacing: -0.5,
          }}
        >
          HOLDING
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#9CA3AF",
          }}
        >
          Price 18.4p — waiting for cheaper slot at 10:30 (12.1p)
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
