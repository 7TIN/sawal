"use client";

import { AlertTriangle, LoaderCircle } from "lucide-react";

type ExtractionProgressProps = {
  stage: string;
  error?: string;
  onRetry?: () => void;
};

export function ExtractionProgress({
  stage,
  error,
  onRetry,
}: ExtractionProgressProps) {
  if (error) {
    return (
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="text-sm font-medium">Extraction failed</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-3">
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Extracting...</p>
          <p className="text-xs text-muted-foreground">{stage}</p>
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/40" />
      </div>
    </div>
  );
}
