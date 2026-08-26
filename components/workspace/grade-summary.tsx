"use client";

import { Award, TrendingUp, AlertTriangle, XCircle } from "lucide-react";
import type { GradingSummary } from "@/lib/types";

type GradeSummaryProps = {
  summary: GradingSummary;
  onReset?: () => void;
};

export function GradeSummary({ summary, onReset }: GradeSummaryProps) {
  const ratio = summary.maxScore > 0 ? summary.totalScore / summary.maxScore : 0;
  const percent = Math.round(ratio * 100);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-secondary">
            <Award className="size-5 text-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Grading Complete</h3>
            <p className="text-xs text-muted-foreground">{summary.overallFeedback}</p>
          </div>
        </div>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Start over
          </button>
        )}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold tracking-tight">{percent}%</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {summary.totalScore} / {summary.maxScore} marks
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-1.5 text-xs">
            <TrendingUp className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">Correct</span>
            <span className="ml-auto text-muted-foreground">{summary.counts.correct}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
            <span className="font-medium">Partial</span>
            <span className="ml-auto text-muted-foreground">{summary.counts.partial}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <XCircle className="size-3.5 text-red-600 dark:text-red-400" />
            <span className="font-medium">Incorrect</span>
            <span className="ml-auto text-muted-foreground">{summary.counts.incorrect}</span>
          </div>
        </div>

        <div className="flex items-center justify-center rounded-lg border">
          <div className="text-center">
            <div
              className="inline-flex size-16 items-center justify-center rounded-full border-4"
              style={{
                borderColor:
                  ratio >= 0.8
                    ? "var(--color-emerald-500)"
                    : ratio >= 0.5
                      ? "var(--color-amber-500)"
                      : "var(--color-red-500)",
              }}
            >
              <span className="text-lg font-bold">{percent}</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {ratio >= 0.8 ? "Excellent" : ratio >= 0.5 ? "Average" : "Needs work"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
