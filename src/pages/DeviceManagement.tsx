import { useState } from "react";
import {
  Sun,
  Battery,
  Zap,
  Grid3X3,
  CheckCircle2,
  Circle,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

interface DeviceStatus {
  id: string;
  name: string;
  category: string;
  connected: boolean;
  connectedAt?: Date;
  brand?: string;
  icon: React.ElementType;
  color: string;
  monthlyValue: number;
  setupUrl?: string;
  errorMessage?: string;
}

const DEVICES_STATUS: DeviceStatus[] = [
  {
    id: "solar",
    name: "Solar Inverter",
    category: "Generation",
    connected: true,
    connectedAt: new Date("2024-01-15"),
    brand: "GivEnergy",
    icon: Sun,
    color: "#F59E0B",
    monthlyValue: 35,
  },
  {
    id: "battery",
    name: "Home Battery",
    category: "Storage",
    connected: true,
    connectedAt: new Date("2024-01-15"),
    brand: "GivEnergy",
    icon: Battery,
    color: "#16A34A",
    monthlyValue: 32,
  },
  {
    id: "ev",
    name: "EV Charger",
    category: "Transport",
    connected: false,
    icon: Zap,
    color: "#38BDF8",
    monthlyValue: 26,
    setupUrl: "/setup/ev",
  },
  {
    id: "grid",
    name: "Smart Pricing",
    category: "Grid",
    connected: false,
    icon: Grid3X3,
    color: "#A78BFA",
    monthlyValue: 15,
    setupUrl: "/setup/grid",
  },
];

export default function DeviceManagement() {
  const [devices, setDevices] = useState(DEVICES_STATUS);
  const connectedCount = devices.filter((d) => d.connected).length;
  const totalValue = devices
    .filter((d) => d.connected)
    .reduce((sum, d) => sum + d.monthlyValue, 0);
  const potentialValue = devices.reduce((sum, d) => sum + d.monthlyValue, 0);

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
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 8,
            letterSpacing: -0.5,
          }}
        >
          Your Devices
        </h1>
        <p style={{ fontSize: 14, color: "#9CA3AF" }}>
          Manage your energy system
        </p>
      </div>

      {/* Progress summary */}
      <div
        style={{
          background: "#1F2937",
          border: "1px solid #374151",
          borderRadius: 12,
          padding: "16px",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>
              Connected
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#22C55E",
              }}
            >
              {connectedCount}/{DEVICES_STATUS.length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>
              Current Value
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#16A34A",
              }}
            >
              £{totalValue}
            </div>
            <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>
              per month
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>
              Full Potential
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#F59E0B",
              }}
            >
              £{potentialValue}
            </div>
            <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>
              per month
            </div>
          </div>
        </div>
      </div>

      {/* Connected devices section */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#9CA3AF",
            marginBottom: 12,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Connected
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          {devices
            .filter((d) => d.connected)
            .map((device) => {
              const Icon = device.icon;
              return (
                <div
                  key={device.id}
                  style={{
                    background: "#1F2937",
                    border: `1px solid ${device.color}40`,
                    borderRadius: 10,
                    padding: "14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                      <Icon size={20} color={device.color} />
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
                        {device.brand} · Connected{" "}
                        {device.connectedAt?.toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: device.color,
                      }}
                    >
                      +£{device.monthlyValue}
                    </div>
                    <CheckCircle2 size={20} color={device.color} />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Disconnected devices section */}
      {devices.filter((d) => !d.connected).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#9CA3AF",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Available to Connect
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            {devices
              .filter((d) => !d.connected)
              .map((device) => {
                const Icon = device.icon;
                return (
                  <button
                    key={device.id}
                    style={{
                      background: "#1F2937",
                      border: "1px solid #374151",
                      borderRadius: 10,
                      padding: "14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "#111827";
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "#4B5563";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "#1F2937";
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "#374151";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
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
                        <Icon size={20} color={device.color} />
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
                          {device.name}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#9CA3AF",
                          }}
                        >
                          Unlock +£{device.monthlyValue}/month
                        </div>
                      </div>
                    </div>
                    <ExternalLink
                      size={18}
                      color={device.color}
                      style={{ opacity: 0.6 }}
                    />
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Roadmap section */}
      <div
        style={{
          background: "#0D1F14",
          border: "1px solid #16A34A40",
          borderRadius: 12,
          padding: "16px",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "#16A34A",
            fontWeight: 700,
            letterSpacing: 1.2,
            marginBottom: 12,
            textTransform: "uppercase",
          }}
        >
          Your Roadmap
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          {/* Phase 1 */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#22C55E",
                marginBottom: 8,
              }}
            >
              Phase 1: Foundation
            </div>
            <div style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.6 }}>
              You've set up solar + battery. Next step: connect your EV charger
              for peak-rate management and smart charging from solar or cheap
              grid hours.
            </div>
          </div>

          {/* Phase 2 */}
          <div
            style={{
              paddingTop: 12,
              borderTop: "1px solid #16A34A20",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#F59E0B",
                marginBottom: 8,
              }}
            >
              Phase 2: Optimization
            </div>
            <div style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.6 }}>
              Full system active. Your home is now:
              <ul style={{ marginTop: 8, paddingLeft: 16, marginBottom: 0 }}>
                <li>Avoiding peak pricing</li>
                <li>Capturing arbitrage opportunities</li>
                <li>Exporting excess at peak rates</li>
              </ul>
            </div>
          </div>

          {/* Phase 3 */}
          <div
            style={{
              paddingTop: 12,
              borderTop: "1px solid #16A34A20",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#A78BFA",
                marginBottom: 8,
              }}
            >
              Phase 3: Grid Services (Coming 2025)
            </div>
            <div style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.6 }}>
              Once aggregated with other homes, your system joins the National
              Grid's flexibility market for additional revenue streams.
            </div>
          </div>
        </div>
      </div>

      {/* Help section */}
      <div
        style={{
          background: "#1F2937",
          border: "1px solid #374151",
          borderRadius: 12,
          padding: "14px",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <AlertCircle size={18} color="#6B7280" style={{ marginTop: 2 }} />
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#F9FAFB",
                marginBottom: 4,
              }}
            >
              Questions about setup?
            </div>
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>
              Check our{" "}
              <span
                style={{
                  color: "#22C55E",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                setup guide
              </span>
              {" "}or{" "}
              <span
                style={{
                  color: "#22C55E",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                email support
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
