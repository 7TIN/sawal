"use client";

import { useRef, useState } from "react";
import {
  File,
  FileText,
  FileUp,
  LoaderCircle,
  ScrollText,
  TriangleAlert,
  X,
} from "lucide-react";
import type { DocumentId, SlotState } from "@/lib/types";
import { isProd } from "@/lib/env";
import { PdfIcon } from "../ui/icon";

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
}: UploadSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);

    const files = Array.from(event.dataTransfer.files);

    if (files.length > 0) {
      onSelect(files);
    }
  };

  const totalSize =
    state.status === "ready"
      ? state.document.pages.reduce((sum, page) => sum + page.size, 0)
      : 0;

  return (
    <section className="relative flex h-[181px] w-full max-w-[374.5px] flex-col overflow-hidden rounded-[20px] border border-dashed border-[#CECECE] bg-white px-[10px] py-[10px] shadow-none">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple={id === "answer-sheet"}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);

          // Allow selecting the same file again.
          event.target.value = "";

          if (files.length > 0) {
            onSelect(files);
          }
        }}
      />

      {/* Empty */}
      {state.status === "empty" && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={[
            "flex h-full w-full flex-col items-center justify-center rounded-[18px] border border-dashed border-transparent transition-colors",
            dragging ? "bg-[#F8F8F8]" : "bg-white",
          ].join(" ")}
        >
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-[#F6F6F6] text-[#2B2B2B]">
            <FileUp className="size-5" />
          </div>

          <p className="text-center text-sm font-medium text-[#2B2B2B]">
            Drag & drop, or{" "}
            <button
              type="button"
              onClick={openPicker}
              className="font-semibold text-[#2B2B2B] underline-offset-4 hover:underline"
            >
              browse files
            </button>
          </p>

          <p className="mt-1 text-xs text-[#5E5E5E]/80">
            PDF · PNG · JPG · WEBP
          </p>
        </div>
      )}

      {/* Parsing */}
      {state.status === "parsing" && (
        <div className="flex h-full w-full flex-col justify-center rounded-[18px] bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />

            {state.total === 0
              ? "Reading file…"
              : `Rendering page ${Math.min(state.done + 1, state.total)} of ${state.total}…`}
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-[#F0F0F0]">
            <div
              className="h-full rounded-full bg-[#2B2B2B] transition-all duration-300"
              style={{
               width:
                 state.total === 0
                   ? "25%"
                   : `${Math.round((state.done / state.total) * 100)}%`,
              }}
            />
          </div>

          <p className="mt-3 truncate text-xs text-muted-foreground">{state.fileName}</p>
        </div>
      )}

      {/* Error */}
      {state.status === "error" && (
        <div className="flex h-full w-full flex-col justify-center rounded-[18px] bg-white p-4">
          <div className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="leading-6 text-[#2B2B2B]">{state.message}</p>
          </div>

          <button
            type="button"
            onClick={openPicker}
            className="mt-4 w-fit rounded-md border border-[#D9D9D9] bg-[#F7F7F7] px-3 py-1.5 text-sm font-medium text-[#2B2B2B] transition-colors hover:bg-[#F0F0F0]"
          >
            Try again
          </button>

          <p className="mt-3 truncate text-xs text-muted-foreground">{state.fileName}</p>
        </div>
      )}

      {/* Ready */}
      {state.status === "ready" && (
        <div className="h-full w-full rounded-[18px] bg-white">

          <div className="flex h-full flex-col items-center justify-center gap-3 px-2 py-3">
            
            <div className="flex relative w-full max-w-[261px] items-center gap-3 rounded-xl bg-[#F6F6F6] px-4 py-3">
                       <button
            type="button"
            onClick={openPicker}
            className="absolute -right-1 -top-1 z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#2B2B2B]/80 text-white shadow-[0_4px_11.4px_rgba(0,0,0,0.25)] transition-colors hover:bg-[#2B2B2B]"
            aria-label={`Replace ${title}`}
          >
            <X className="size-3.5" />
          </button>

              <PdfIcon className="size-9 shrink-0" />

              <div className="min-w-0 flex-1">
               <p className="truncate text-base font-bold leading-[1.4] tracking-[-0.04em] text-[#2B2B2B]">
                 {state.document.fileName}
               </p>

               <div className="mt-0.5 flex items-center gap-1.5 text-center text-xs leading-[1.4] tracking-[-0.04em] text-[#5E5E5E]/80">
                 <span>{formatBytes(totalSize)}</span>
                 <span className="text-base leading-none">•</span>
                 <span>
                   {state.pages.length} {state.pages.length === 1 ? "page" : "pages"}
                 </span>
               </div>
              </div>
            </div>

            {!isProd && (
              <div className="flex w-full max-w-[263px] gap-2 overflow-x-auto pb-1">
               {state.pages.slice(0, READY_THUMBNAIL_LIMIT).map((page) => (
                 <img
                   key={page.index}
                   src={page.url}
                   alt={`Page ${page.index + 1}`}
                   className="h-24 w-auto shrink-0 rounded-md border border-[#EAEAEA] object-cover"
                   loading="lazy"
                 />
               ))}

               {state.pages.length > READY_THUMBNAIL_LIMIT && (
                 <div className="flex h-24 w-14 shrink-0 items-center justify-center rounded-md border border-[#EAEAEA] bg-[#F6F6F6] text-xs font-medium text-[#5E5E5E]">
                   +{state.pages.length - READY_THUMBNAIL_LIMIT}
                 </div>
               )}
              </div>
            )}

            {state.pages.length > PAGE_COUNT_WARNING && (
              <p className="flex items-center gap-1.5 text-center text-[11px] text-amber-600 dark:text-amber-400">
               <TriangleAlert className="size-3.5 shrink-0" />
               Large document — extraction may take a while.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
