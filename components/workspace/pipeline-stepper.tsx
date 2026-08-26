"use client";

import { Check, LoaderCircle } from "lucide-react";

export type PipelineStage = "upload" | "extract" | "review" | "grade";

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "extract", label: "Extract" },
  { key: "review", label: "Review" },
  { key: "grade", label: "Grade" },
];

export function PipelineStepper({
  current,
  extracting,
}: {
  current: PipelineStage;
  extracting?: boolean;
}) {
  const currentIndex = STAGES.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;
        const isActive = stage.key === "extract" && extracting;

        return (
          <div key={stage.key} className="flex items-center gap-1">
            <div
              className={`flex size-5 items-center justify-center rounded-full text-[10px] font-medium ${
                isComplete
                  ? "bg-emerald-600 text-white dark:bg-emerald-500"
                  : isCurrent || isActive
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground"
              }`}
            >
              {isComplete ? (
                <Check className="size-3" />
              ) : isActive ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                i + 1
              )}
            </div>
            <span
              className={`text-xs ${
                isCurrent || isActive
                  ? "font-medium text-foreground"
                  : isComplete
                    ? "text-foreground"
                    : "text-muted-foreground"
              }`}
            >
              {stage.label}
            </span>
            {i < STAGES.length - 1 && (
              <div className="mx-1 h-px w-4 bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}
