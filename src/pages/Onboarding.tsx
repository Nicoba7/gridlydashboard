import { useState } from "react";
import { ChevronRight, Sun, Battery, Zap, Grid3X3 } from "lucide-react";

interface Device {
  id: string;
  name: string;
  icon: React.ElementType;
  color: string;
  description: string;
  saves: string;
}

const DEVICES: Device[] = [
  {
    id: "solar",
    name: "Solar Inverter",
    icon: Sun,
    color: "#F59E0B",
    description: "Solar panels & inverter",
    saves: "£420/yr",
  },
  {
    id: "battery",
    name: "Home Battery",
    icon: Battery,
    color: "#16A34A",
    description: "Battery storage system",
    saves: "£380/yr",
  },
  {
    id: "ev",
    name: "EV Charger",
    icon: Zap,
    color: "#38BDF8",
    description: "Electric vehicle charger",
    saves: "£310/yr",
  },
  {
    id: "grid",
    name: "Smart Meter",
    icon: Grid3X3,
    color: "#A78BFA",
    description: "Grid connection & pricing",
    saves: "£180/yr",
  },
];

interface OnboardingProps {
  onComplete?: (devices: string[]) => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);

  const toggleDevice = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const totalSavings = DEVICES.filter((d) => selected.includes(d.id))
    .reduce((sum, d) => sum + parseInt(d.saves), 0);

  const handleNext = () => {
    if (step === 1) {
      if (selected.length > 0) setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleComplete = () => {
    onComplete?.(selected);
  };

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #111827 0%, #0F1419 100%)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "20px",
        color: "#F9FAFB",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 40, marginTop: 20 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 8,
            letterSpacing: -0.5,
          }}
        >
          {step === 1 && "What do you have?"}
          {step === 2 && "Let's connect them"}
          {step === 3 && "You're all set"}
        </h1>
        <p style={{ fontSize: 14, color: "#9CA3AF" }}>
          {step === 1 && "Select your energy devices"}
          {step === 2 && "We'll sync your system"}
          {step === 3 && `Annual value unlocked: £${totalSavings}`}
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 32, display: "flex", gap: 8 }}>
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            style={{
              height: 3,
              flex: 1,
              background: s <= step ? "#22C55E" : "#1F2937",
              borderRadius: 2,
              transition: "background 0.3s ease",
            }}
          />
        ))}
      </div>

      {/* Step 1: Device Selection */}
      {step === 1 && (
        <div style={{ flex: 1, marginBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            {DEVICES.map((device) => {
              const Icon = device.icon;
              const isSelected = selected.includes(device.id);
              return (
                <button
                  key={device.id}
                  onClick={() => toggleDevice(device.id)}
                  style={{
                    background: isSelected ? "#16A34A40" : "#1F2937",
                    border: isSelected
                      ? "2px solid #22C55E"
                      : "2px solid #374151",
                    borderRadius: 12,
                    padding: "16px",
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "#4B5563";
                      (e.currentTarget as HTMLElement).style.background =
                        "#111827";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "#374151";
                      (e.currentTarget as HTMLElement).style.background =
                        "#1F2937";
                    }
                  }}
                >
                  <div
                    style={{
                      background: `${device.color}20`,
                      borderRadius: 8,
                      padding: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={24} color={device.color} />
                  </div>
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#F9FAFB",
                        marginBottom: 2,
                      }}
                    >
                      {device.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#9CA3AF",
                        marginBottom: 4,
                      }}
                    >
                      {device.description}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: device.color,
                      }}
                    >
                      {device.saves} value
                    </div>
                  </div>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      background: isSelected ? "#22C55E" : "#374151",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isSelected && (
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          background: "#111827",
                          borderRadius: 2,
                        }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2: Connection Instructions */}
      {step === 2 && (
        <div style={{ flex: 1, marginBottom: 24 }}>
          <div
            style={{
              background: "#0D1F14",
              border: "1px solid #16A34A40",
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#16A34A",
                marginBottom: 12,
                letterSpacing: 1,
              }}
            >
              CONNECTING YOUR DEVICES
            </div>
            <div style={{ fontSize: 14, color: "#E5E7EB", lineHeight: 1.6 }}>
              <p style={{ marginBottom: 12 }}>
                We'll securely sync with your device providers and read live data
                every 30 minutes.
              </p>
              <p style={{ marginBottom: 12 }}>
                <strong>No manual setup needed.</strong> Just provide your account
                details and we handle the rest.
              </p>
              <p>
                Your data stays yours. We never store passwords or make changes
                without your explicit request.
              </p>
            </div>
          </div>

          {/* Device connection preview */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#9CA3AF",
                marginBottom: 12,
              }}
            >
              You're connecting:
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {DEVICES.filter((d) => selected.includes(d.id)).map((device) => {
                const Icon = device.icon;
                return (
                  <div
                    key={device.id}
                    style={{
                      background: "#1F2937",
                      borderRadius: 8,
                      padding: 12,
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <Icon size={20} color={device.color} />
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#F9FAFB",
                      }}
                    >
                      {device.name}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Success */}
      {step === 3 && (
        <div style={{ flex: 1, marginBottom: 24, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              width: 80,
              height: 80,
              background: "#16A34A20",
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                background: "#22C55E",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
              }}
            >
              ✓
            </div>
          </div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            Connected & optimising
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "#9CA3AF",
              textAlign: "center",
              marginBottom: 24,
              maxWidth: 280,
              lineHeight: 1.6,
            }}
          >
            Your system is now live. We're reading prices every 30 minutes and
            optimising your energy.
          </p>
          <div
            style={{
              background: "#0D1F14",
              border: "1px solid #16A34A40",
              borderRadius: 12,
              padding: 16,
              width: "100%",
              textAlign: "center",
              marginBottom: 20,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "#6B7280",
                marginBottom: 4,
              }}
            >
              Annual value unlocked
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 800,
                color: "#22C55E",
                letterSpacing: -1,
              }}
            >
              £{totalSavings}
            </div>
          </div>
        </div>
      )}

      {/* Footer buttons */}
      <div
        style={{
          display: "flex",
          gap: 12,
          paddingBottom: 20,
        }}
      >
        {step > 1 && (
          <button
            onClick={() => setStep(step - 1)}
            style={{
              flex: 1,
              background: "#1F2937",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "12px 16px",
              color: "#F9FAFB",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#111827";
              (e.currentTarget as HTMLElement).style.borderColor = "#4B5563";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#1F2937";
              (e.currentTarget as HTMLElement).style.borderColor = "#374151";
            }}
          >
            Back
          </button>
        )}
        <button
          onClick={step === 3 ? handleComplete : handleNext}
          disabled={step === 1 && selected.length === 0}
          style={{
            flex: 1,
            background: step === 1 && selected.length === 0 ? "#4B5563" : "#22C55E",
            border: "none",
            borderRadius: 8,
            padding: "12px 16px",
            color: step === 1 && selected.length === 0 ? "#6B7280" : "#111827",
            fontSize: 14,
            fontWeight: 600,
            cursor:
              step === 1 && selected.length === 0 ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            if (step === 1 && selected.length === 0) return;
            (e.currentTarget as HTMLElement).style.background = "#16A34A";
          }}
          onMouseLeave={(e) => {
            if (step === 1 && selected.length === 0) return;
            (e.currentTarget as HTMLElement).style.background = "#22C55E";
          }}
        >
          {step === 3 ? "Go to Dashboard" : "Next"}
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
