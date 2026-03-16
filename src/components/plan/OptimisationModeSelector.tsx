import { OptimisationModeViewModel } from "./planViewModels";
import { OptimisationMode } from "../../types/planCompat";

export default function OptimisationModeSelector({
  viewModel,
  onChange,
}: {
  viewModel: OptimisationModeViewModel;
  onChange: (mode: OptimisationMode) => void;
}) {
  return (
    <div style={{ margin: "0 20px 12px" }}>
      <div style={{ fontSize: 11, color: "#5D6B80", marginBottom: 8 }}>Change only if tomorrow needs a different priority.</div>
      <div style={{ display: "flex", gap: 7 }}>
        {viewModel.options.map((option) => {
          const active = viewModel.mode === option.id;
          return (
            <button
              key={option.id}
              onClick={() => onChange(option.id)}
              style={{
                flex: 1,
                background: active ? "#141F31" : "#09101A",
                color: active ? "#C1D2E7" : "#677486",
                border: active ? "1px solid #22364F" : "1px solid #141E2C",
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
              <div>{option.label}</div>
              <div style={{ fontSize: 10, color: active ? "#89A5C0" : "#4F5D70", marginTop: 2, fontWeight: 400 }}>
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
