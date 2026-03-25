import { PlanHeroViewModel } from "./planViewModels";

export default function PlanHeroCard({ viewModel }: { viewModel: PlanHeroViewModel }) {
  const accentColor = "#22C55E";

  return (
    <div
      className="mx-4 mt-5 overflow-hidden rounded-[20px] border border-[#182235] bg-[#0A111D] shadow-[0_14px_34px_rgba(1,7,20,0.32)]"
    >
      <div style={{ height: 1, background: `linear-gradient(90deg, ${accentColor}90, ${accentColor}20)` }} />
      <div className="px-5 pb-5 pt-[18px]">
        <div className="mb-3 flex items-center gap-2">
          <div
            style={{ background: accentColor, boxShadow: `0 0 8px ${accentColor}95` }}
            className="h-[5px] w-[5px] rounded-full"
          />
          <span className="text-[10px] font-semibold tracking-[0.9px] text-[#566279]">TOMORROW</span>
          {viewModel.statusNote && (
            <span className="ml-auto rounded-full border border-[#1C283D] bg-[#0C1524] px-2 py-[2px] text-[10px] text-[#6E809A]">
              {viewModel.statusNote}
            </span>
          )}
        </div>

        <div className="mb-2 text-[28px] font-[820] leading-[1.1] tracking-[-0.8px] text-[#F3F7FF]">
          {viewModel.title}
        </div>

        <div className="mb-[15px] max-w-[92%] text-[12px] leading-[1.45] text-[#7C8BA2]">
          {viewModel.subline}
        </div>

        <div className="mb-3 text-[11px] leading-[1.45] text-[#8AA0BA]">
          {viewModel.trustNote}
        </div>

        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full border border-[#1B2A40] bg-[#0C1627] px-[7px] py-[2px] text-[10px] font-semibold tracking-[0.3px] text-[#95ABC6]">
            {viewModel.confidencePct ? `Confidence: ${viewModel.confidencePct}%` : viewModel.confidenceLabel}
          </span>
          {viewModel.confidenceReason && (
            <span className="text-[10px] text-[#697D96]">{viewModel.confidenceReason}</span>
          )}
        </div>

        {viewModel.whatChanged && (
          <div className="mb-3 rounded-[10px] border border-[#162436] bg-[#0B1422] px-3 py-[7px] text-[10.5px] leading-[1.4] text-[#8095B0]">
            {viewModel.whatChanged}
          </div>
        )}

        <div className="flex items-end gap-4 border-t border-[#162235] pt-3 tabular-nums">
          {viewModel.projectedSavings > 0 && (
            <div className="min-w-[96px]">
              <div className="mb-[3px] text-[10px] font-semibold tracking-[0.45px] text-[#566279]">Saved by Aveum tomorrow</div>
              <div className="text-[18px] font-extrabold tracking-[-0.4px] text-[#22C55E]">+£{viewModel.projectedSavings.toFixed(2)}</div>
            </div>
          )}
          {viewModel.projectedEarnings > 0 && (
            <div className="min-w-[108px]">
              <div className="mb-[3px] text-[10px] font-semibold tracking-[0.45px] text-[#566279]">Earned by Aveum tomorrow</div>
              <div className="text-[18px] font-extrabold tracking-[-0.4px] text-[#F59E0B]">+£{viewModel.projectedEarnings.toFixed(2)}</div>
            </div>
          )}
          {viewModel.cheapestPrice > 0 && (
            <div className="ml-auto min-w-[72px] text-right">
              <div className="mb-[3px] text-[10px] font-semibold tracking-[0.45px] text-[#566279]">Lowest price</div>
              <div className="text-[18px] font-extrabold tracking-[-0.4px] text-[#22C55E]">{viewModel.cheapestPrice.toFixed(1)}p</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
