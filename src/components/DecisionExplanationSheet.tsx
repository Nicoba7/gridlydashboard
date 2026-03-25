import { useEffect, useRef } from "react";
import { BrainCircuit } from "lucide-react";

export default function DecisionExplanationSheet({
  open,
  title = "Why Aveum chose this",
  subtitle,
  reasoning,
  onClose,
}: {
  open: boolean;
  title?: string;
  subtitle?: string;
  reasoning: string[];
  onClose: () => void;
}) {
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(1, 6, 16, 0.68)",
        zIndex: 60,
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => {
          touchStartY.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(event) => {
          if (touchStartY.current == null) return;
          const delta = (event.touches[0]?.clientY ?? 0) - touchStartY.current;
          if (delta > 80) {
            touchStartY.current = null;
            onClose();
          }
        }}
        onTouchEnd={() => {
          touchStartY.current = null;
        }}
        style={{
          width: "100%",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          background: "#0B1120",
          borderTop: "1px solid #1B2A42",
          boxShadow: "0 -20px 45px rgba(2, 8, 21, 0.55)",
          padding: "10px 18px 24px",
        }}
      >
        <div style={{ width: 42, height: 4, borderRadius: 999, background: "#26364D", margin: "0 auto 12px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 999, border: "1px solid #2A3A53", background: "#111A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <BrainCircuit size={12} color="#8CA3C3" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#E6EDF8", letterSpacing: -0.2 }}>{title}</div>
        </div>

        {subtitle && <div style={{ fontSize: 12, color: "#8A9BB3", marginBottom: 10 }}>{subtitle}</div>}

        <div style={{ height: 1, background: "#16233A", marginBottom: 12 }} />

        <div style={{ display: "grid", gap: 10 }}>
          {reasoning.slice(0, 4).map((point) => (
            <div key={point} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ width: 5, height: 5, marginTop: 6, borderRadius: "50%", background: "#4C617E", flexShrink: 0 }} />
              <div style={{ fontSize: 12.5, color: "#C7D3E5", lineHeight: 1.45 }}>{point}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
