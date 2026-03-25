import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// Partner logos as clean SVG wordmarks — no external dependencies
function SolaxLogo() {
  return (
    <svg width="52" height="16" viewBox="0 0 52 16" fill="none">
      <text x="0" y="13" fontFamily="'SF Pro Display', -apple-system, sans-serif" fontSize="13" fontWeight="700" fill="#6B7280" letterSpacing="-0.3">SOLAX</text>
    </svg>
  );
}

function OctopusLogo() {
  return (
    <svg width="68" height="16" viewBox="0 0 68 16" fill="none">
      <text x="0" y="13" fontFamily="'SF Pro Display', -apple-system, sans-serif" fontSize="13" fontWeight="700" fill="#6B7280" letterSpacing="-0.3">OCTOPUS</text>
    </svg>
  );
}

function MyenergiLogo() {
  return (
    <svg width="66" height="16" viewBox="0 0 66 16" fill="none">
      <text x="0" y="13" fontFamily="'SF Pro Display', -apple-system, sans-serif" fontSize="13" fontWeight="700" fill="#6B7280" letterSpacing="-0.3">MYENERGI</text>
    </svg>
  );
}

function GivEnergyLogo() {
  return (
    <svg width="74" height="16" viewBox="0 0 74 16" fill="none">
      <text x="0" y="13" fontFamily="'SF Pro Display', -apple-system, sans-serif" fontSize="13" fontWeight="700" fill="#6B7280" letterSpacing="-0.3">GIVENERGY</text>
    </svg>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [btnHover, setBtnHover] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{
      background: "#030712",
      minHeight: "100vh",
      color: "#F9FAFB",
      fontFamily: "-apple-system, 'SF Pro Display', BlinkMacSystemFont, 'Segoe UI', sans-serif",
      maxWidth: 480,
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      padding: "0 28px",
      position: "relative",
      overflow: "hidden",
    }}>

      {/* Subtle radial glow behind headline */}
      <div style={{
        position: "absolute",
        top: "18%",
        left: "50%",
        transform: "translateX(-50%)",
        width: 320,
        height: 320,
        borderRadius: "50%",
        background: "radial-gradient(circle, #22C55E08 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Wordmark */}
      <div style={{
        paddingTop: 56,
        marginBottom: 72,
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : "translateY(8px)",
        transition: "opacity 0.5s ease, transform 0.5s ease",
      }}>
        <div style={{
          fontSize: 17,
          fontWeight: 700,
          letterSpacing: 3,
          color: "#22C55E",
          textTransform: "uppercase",
        }}>
          Aveum
        </div>
      </div>

      {/* Hero */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        paddingBottom: 40,
      }}>

        {/* Headline */}
        <div style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "none" : "translateY(16px)",
          transition: "opacity 0.6s ease 0.1s, transform 0.6s ease 0.1s",
          marginBottom: 20,
        }}>
          <div style={{
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: -1.5,
            lineHeight: 1.08,
            color: "#F9FAFB",
          }}>
            Your energy.<br />
            <span style={{ color: "#22C55E" }}>Working harder.</span>
          </div>
        </div>

        {/* Subline */}
        <div style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "none" : "translateY(12px)",
          transition: "opacity 0.6s ease 0.2s, transform 0.6s ease 0.2s",
          marginBottom: 48,
        }}>
          <div style={{
            fontSize: 16,
            color: "#6B7280",
            lineHeight: 1.6,
            fontWeight: 400,
            maxWidth: 300,
          }}>
            One platform. Every device. Automatically optimised.
          </div>
        </div>

        {/* Stat */}
        <div style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "none" : "translateY(12px)",
          transition: "opacity 0.6s ease 0.3s, transform 0.6s ease 0.3s",
          marginBottom: 48,
        }}>
          <div style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 6,
            background: "#0D1F14",
            border: "1px solid #16A34A20",
            borderRadius: 12,
            padding: "10px 16px",
          }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: "#22C55E", letterSpacing: -1 }}>£1,400</span>
            <span style={{ fontSize: 13, color: "#4B5563", fontWeight: 500 }}>saved per year, per household</span>
          </div>
        </div>

        {/* Partners */}
        <div style={{
          opacity: visible ? 1 : 0,
          transition: "opacity 0.6s ease 0.4s",
          marginBottom: 52,
        }}>
          <div style={{ fontSize: 10, color: "#374151", fontWeight: 700, letterSpacing: 1.5, marginBottom: 14, textTransform: "uppercase" }}>
            Works with
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            {["Octopus", "Solax", "GivEnergy", "myenergi", "Zappi", "Ohme", "Wallbox"].map(name => (
              <span key={name} style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: 0.3 }}>{name}</span>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "none" : "translateY(8px)",
          transition: "opacity 0.6s ease 0.5s, transform 0.6s ease 0.5s",
        }}>
          <button
            onClick={() => navigate("/onboarding")}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              width: "100%",
              background: btnHover ? "#16A34A" : "#22C55E",
              border: "none",
              borderRadius: 14,
              padding: "17px 24px",
              color: "#030712",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: -0.3,
              transition: "background 0.15s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            Connect my system
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="#030712" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>


        </div>

      </div>

      {/* Bottom rule */}
      <div style={{
        paddingBottom: 36,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.6s ease 0.6s",
      }}>
        <div style={{
          height: 1,
          background: "linear-gradient(90deg, transparent, #1F2937, transparent)",
          marginBottom: 20,
        }} />
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "#374151",
        }}>
          <span>No hardware changes required</span>
          <span>Built in London</span>
        </div>
      </div>

    </div>
  );
}
