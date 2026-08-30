export function VedaMark({ className }: { className?: string }) {
  return (
    <div
      className={`flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-[#303030] ${className ?? ""}`}
    >
      <div className="relative h-[24px] w-[24px]">
        <span className="absolute left-[5px] top-[2px] h-[14px] w-[8px] rotate-[35deg] rounded-[2px] bg-white" />
        <span className="absolute right-[4px] top-[3px] h-[19px] w-[8px] rotate-[-35deg] rounded-[2px] bg-white" />
      </div>
    </div>
  );
}