import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";

interface UserSettings {
  userName?: string;
  notifyEmail?: string;
  departureTime?: string;
  targetChargePct?: number;
}

const FIELD: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  color: "#6B7280",
};

const INPUT: React.CSSProperties = {
  background: "#0B1120",
  border: "1px solid #1F2937",
  borderRadius: 10,
  padding: "12px 14px",
  color: "#F9FAFB",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export default function Settings() {
  const navigate = useNavigate();
  const userId =
    typeof window !== "undefined" ? localStorage.getItem("aveum_user_id") : null;

  const [settings, setSettings] = useState<UserSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current settings
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    fetch(`/api/user?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.user) setSettings(data.user);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/user", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          departureTime: settings.departureTime || undefined,
          targetChargePct: settings.targetChargePct
            ? Number(settings.targetChargePct)
            : undefined,
          notifyEmail: settings.notifyEmail || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  if (!userId) {
    return (
      <div
        style={{
          background: "#030712",
          minHeight: "100vh",
          color: "#F9FAFB",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto",
          maxWidth: 480,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 12,
          padding: 24,
        }}
      >
        <div style={{ fontSize: 14, color: "#6B7280", textAlign: "center" }}>
          No account found. Complete onboarding first.
        </div>
        <button
          onClick={() => navigate("/onboarding")}
          style={{
            background: "#22C55E",
            border: "none",
            borderRadius: 10,
            padding: "10px 20px",
            color: "#030712",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Get started
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#030712",
        minHeight: "100vh",
        color: "#F9FAFB",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto",
        maxWidth: 480,
        margin: "0 auto",
        paddingBottom: 40,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "20px 20px 0",
          marginBottom: 28,
        }}
      >
        <button
          onClick={() => navigate("/dashboard")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "#6B7280",
            display: "flex",
            alignItems: "center",
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.8,
              color: "#6B7280",
              marginBottom: 2,
            }}
          >
            AVEUM
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#F9FAFB" }}>
            Settings
          </div>
        </div>
      </div>

      {loading ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            color: "#4B5563",
            fontSize: 13,
          }}
        >
          Loading…
        </div>
      ) : (
        <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 0 }}>
          {/* Account section */}
          <div
            style={{
              background: "#0B1120",
              border: "1px solid #1F2937",
              borderRadius: 16,
              padding: "16px 16px",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.8,
                color: "#4B5563",
                marginBottom: 12,
              }}
            >
              ACCOUNT
            </div>
            <div style={{ fontSize: 14, color: "#9CA3AF" }}>
              {settings.userName || "—"}
            </div>
          </div>

          {/* EV settings */}
          <div
            style={{
              background: "#0B1120",
              border: "1px solid #1F2937",
              borderRadius: 16,
              padding: "16px 16px",
              marginBottom: 12,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.8,
                color: "#4B5563",
              }}
            >
              EV CHARGING
            </div>

            <div style={FIELD}>
              <label style={LABEL}>DEPARTURE TIME</label>
              <input
                type="time"
                value={settings.departureTime ?? "07:30"}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, departureTime: e.target.value }))
                }
                style={INPUT}
              />
              <div style={{ fontSize: 11, color: "#4B5563" }}>
                Aveum finishes charging before this time each morning.
              </div>
            </div>

            <div style={FIELD}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <label style={LABEL}>TARGET CHARGE</label>
                <span
                  style={{ fontSize: 14, fontWeight: 800, color: "#38BDF8" }}
                >
                  {settings.targetChargePct ?? 80}%
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={100}
                step={5}
                value={settings.targetChargePct ?? 80}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    targetChargePct: Number(e.target.value),
                  }))
                }
                style={{ width: "100%", accentColor: "#38BDF8", cursor: "pointer" }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10,
                  color: "#374151",
                }}
              >
                <span>20%</span>
                <span>60%</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div
            style={{
              background: "#0B1120",
              border: "1px solid #1F2937",
              borderRadius: 16,
              padding: "16px 16px",
              marginBottom: 24,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.8,
                color: "#4B5563",
              }}
            >
              NOTIFICATIONS
            </div>

            <div style={FIELD}>
              <label style={LABEL}>MORNING REPORT EMAIL</label>
              <input
                type="email"
                value={settings.notifyEmail ?? ""}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, notifyEmail: e.target.value }))
                }
                placeholder="you@example.com"
                style={INPUT}
              />
              <div style={{ fontSize: 11, color: "#4B5563" }}>
                Aveum sends a daily summary after each optimisation run.
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                background: "#1C0A0A",
                border: "1px solid #7F1D1D",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 12,
                color: "#FCA5A5",
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving || saved}
            style={{
              width: "100%",
              background: saved ? "#166534" : "#22C55E",
              border: "none",
              borderRadius: 12,
              padding: "14px",
              color: saved ? "#86EFAC" : "#030712",
              fontSize: 14,
              fontWeight: 800,
              cursor: saving || saved ? "default" : "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "background 0.2s",
            }}
          >
            {saved ? (
              <>
                <Check size={16} />
                Saved
              </>
            ) : saving ? (
              "Saving…"
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
