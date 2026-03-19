import { useEffect, useMemo, useState } from "react";
import { OptimisationModeViewModel } from "./planViewModels";
import { OptimisationMode } from "../../types/planCompat";

export default function OptimisationModeSelector({
  viewModel,
  onChange,
}: {
  viewModel: OptimisationModeViewModel;
  onChange: (mode: OptimisationMode) => void;
}) {
  const [previewMode, setPreviewMode] = useState<OptimisationMode | null>(null);

  useEffect(() => {
    if (previewMode === viewModel.mode) {
      setPreviewMode(null);
    }
  }, [previewMode, viewModel.mode]);

  const previewOption = useMemo(
    () => viewModel.options.find((option) => option.id === previewMode),
    [viewModel.options, previewMode]
  );

  return (
    <div style={{ margin: "0 20px 12px" }}>
      <div style={{ display: "flex", gap: 7 }}>
        {viewModel.options.map((option) => {
          const active = viewModel.mode === option.id;
          return (
            <button
              key={option.id}
              onMouseEnter={() => {
                if (!active) {
                  setPreviewMode(option.id);
                }
              }}
              onMouseLeave={() => {
                setPreviewMode((current) => (current === option.id ? null : current));
              }}
              onFocus={() => {
                if (!active) {
                  setPreviewMode(option.id);
                }
              }}
              onBlur={() => {
                setPreviewMode((current) => (current === option.id ? null : current));
              }}
              onClick={() => {
                if (active) {
                  return;
                }

                if (previewMode !== option.id) {
                  setPreviewMode(option.id);
                  return;
                }

                setPreviewMode(null);
                onChange(option.id);
              }}
              style={{
                flex: 1,
                background: active ? "#141F31" : "#09101A",
                color: active ? "#C1D2E7" : "#677486",
                border: active ? "1px solid #2D4A6D" : "1px solid #141E2C",
                boxShadow: active ? "0 0 0 1px rgba(88, 128, 174, 0.24)" : "none",
                borderRadius: 10,
                padding: "9px 8px",
                fontSize: 11.5,
                fontWeight: active ? 650 : 500,
                cursor: "pointer",
                textAlign: "center",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <span>{option.label}</span>
                {active && (
                  <span
                    style={{
                      fontSize: 8,
                      color: "#8FAED0",
                      border: "1px solid #2D4A6D",
                      borderRadius: 999,
                      padding: "1px 5px",
                      letterSpacing: 0.2,
                      lineHeight: 1.35,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Current plan
                  </span>
                )}
              </div>
              <div style={{ fontSize: 9.8, color: active ? "#89A5C0" : "#4F5D70", marginTop: 2, fontWeight: 500, lineHeight: 1.3 }}>
                {option.description}
              </div>
              <div style={{ fontSize: 9.2, color: active ? "#7F9DBC" : "#4A596E", marginTop: 1, fontWeight: 500, lineHeight: 1.25 }}>
                {option.behaviorSignal}
              </div>
            </button>
          );
        })}
      </div>

      {previewOption && previewOption.id !== viewModel.mode && (
        <div
          style={{
            marginTop: 8,
            borderTop: "1px solid #162235",
            paddingTop: 7,
            color: "#6F819B",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 3 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.2, color: "#4A6080" }}>
              Mode preview
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#8BA4C0" }}>
              {previewOption.label}
            </div>
          </div>
          <div style={{ fontSize: 10.5, lineHeight: 1.35 }}>• {previewOption.description}</div>
          <div style={{ fontSize: 10.5, lineHeight: 1.35 }}>• {previewOption.behaviorSignal}</div>
        </div>
      )}
    </div>
  );
}
