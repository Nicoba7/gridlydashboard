import { CheckCircle } from "lucide-react";

interface FirstRunBannerProps {
  userName: string;
}

export function DemoBadge() {
  return (
    <span style={{
      display: "inline-block",
      fontSize: 8.5,
      fontWeight: 700,
      letterSpacing: 0.4,
      color: "#6B7280",
      background: "#111827",
      border: "1px solid #1F2937",
      borderRadius: 4,
      padding: "1px 5px",
      marginLeft: 5,
      verticalAlign: "middle",
      lineHeight: 1.6,
      textTransform: "uppercase",
    }}>
      Demo
    </span>
  );
}

export function FirstRunBanner({ userName }: FirstRunBannerProps) {
  return (
    <div style={{
      margin: "14px 14px 0",
      background: "linear-gradient(135deg, #052014 0%, #071A10 100%)",
      border: "1px solid #14532D40",
      borderRadius: 18,
      padding: "18px 18px 14px",
    }}>
      {/* Checkmark + heading */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: "#052E16",
          border: "1.5px solid #16A34A50",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <CheckCircle size={22} color="#22C55E" strokeWidth={2} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#F9FAFB", lineHeight: 1.2 }}>
            You're all set{userName ? `, ${userName}` : ""}
          </div>
          <div style={{ fontSize: 12, color: "#4ADE80", marginTop: 2, fontWeight: 500 }}>
            Aveum runs its first optimisation tonight at 1am
          </div>
        </div>
      </div>

      {/* Bullet points */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 0 10px 4px", borderTop: "1px solid #14532D30", borderBottom: "1px solid #14532D30", margin: "0 0 10px" }}>
        {[
          "We'll charge your devices in the cheapest window",
          "You'll get an email tomorrow morning with your savings",
          "Check back here to see your history build up",
        ].map(text => (
          <div key={text} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#22C55E", marginTop: 5.5, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.5 }}>{text}</span>
          </div>
        ))}
      </div>

      {/* Bottom note */}
      <div style={{ fontSize: 10.5, color: "#374151", lineHeight: 1.5 }}>
        All figures shown below are illustrative until your first run completes.
      </div>
    </div>
  );
}
