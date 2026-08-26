"use client";

import { useRef, useState } from "react";
import {
  Check,
  FileText,
  FileUp,
  LoaderCircle,
  ScrollText,
  TriangleAlert,
  X,
} from "lucide-react";
import type { DocumentId, SlotState } from "@/lib/types";

const ACCEPTED_TYPES = "application/pdf,image/png,image/jpeg,image/webp";
const READY_THUMBNAIL_LIMIT = 12;
const PAGE_COUNT_WARNING = 15;

const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

type UploadSlotProps = {
  id: DocumentId;
  title: string;
  description: string;
  state: SlotState;
  onSelect: (files: File[]) => void;
  onRemove: () => void;
};

export function UploadSlot({
  id,
  title,
  description,
  state,
  onSelect,
  onRemove,
}: UploadSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onSelect(files);
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            {id === "question-paper" ? (
              <ScrollText className="size-4" />
            ) : (
              <FileText className="size-4" />
            )}
          </span>
          <h2 className="text-sm font-medium">{title}</h2>
        </div>
        {state.status === "ready" && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Remove ${title}`}
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple={id === "answer-sheet"}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) onSelect(files);
        }}
      />

      {state.status === "empty" && (
        <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex h-36 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed transition-colors ${
              dragging ? "border-ring bg-accent" : "border-border"
            }`}
          >
            <FileUp className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drag & drop, or{" "}
              <button
                type="button"
                onClick={openPicker}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                browse files
              </button>
            </p>
            <p className="text-xs text-muted-foreground">PDF · PNG · JPG · WEBP</p>
          </div>
        </div>
      )}

      {state.status === "parsing" && (
        <div className="flex flex-col gap-3 px-5 pb-6 pt-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {state.total === 0
              ? "Reading file…"
              : `Rendering page ${Math.min(state.done + 1, state.total)} of ${state.total}…`}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width:
                  state.total === 0
                    ? "25%"
                    : `${Math.round((state.done / state.total) * 100)}%`,
              }}
            />
          </div>
          <p className="truncate text-xs text-muted-foreground">{state.fileName}</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col gap-3 px-5 pb-6 pt-5">
          <div className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="leading-6">{state.message}</p>
          </div>
          <div>
            <button
              type="button"
              onClick={openPicker}
              className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              Try again
            </button>
          </div>
          <p className="truncate text-xs text-muted-foreground">{state.fileName}</p>
        </div>
      )}

      {state.status === "ready" && (
        <div className="flex flex-col gap-3 px-5 pb-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="truncate font-medium">{state.document.fileName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {state.pages.length} {state.pages.length === 1 ? "page" : "pages"} ·{" "}
                {formatBytes(state.document.pages.reduce((sum, b) => sum + b.size, 0))}
              </span>
            </div>
            <button
              type="button"
              onClick={openPicker}
              className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Replace
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {state.pages.slice(0, READY_THUMBNAIL_LIMIT).map((page) => (
              <img
                key={page.index}
                src={page.url}
                alt={`Page ${page.index + 1}`}
                className="h-24 w-auto shrink-0 rounded-md border object-cover"
                loading="lazy"
              />
            ))}
            {state.pages.length > READY_THUMBNAIL_LIMIT && (
              <div className="flex h-24 w-14 shrink-0 items-center justify-center rounded-md border bg-secondary text-xs font-medium text-muted-foreground">
                +{state.pages.length - READY_THUMBNAIL_LIMIT}
              </div>
            )}
          </div>

          {state.pages.length > PAGE_COUNT_WARNING && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <TriangleAlert className="size-3.5 shrink-0" />
              Large document — extraction may take a while.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
