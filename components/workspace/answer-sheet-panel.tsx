"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { PageImage } from "@/lib/types";
import { SheetViewer, type OverlayBox } from "./sheet-viewer";

type AnswerSheetPanelProps = {
  pages: PageImage[];
  overlays: OverlayBox[];
  activeIds?: Set<string> | null;
  activePage?: number | null;
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

export function AnswerSheetPanel({
  pages,
  overlays,
  activeIds,
  activePage,
}: AnswerSheetPanelProps) {
  const [zoom, setZoom] = useState(1);
  const [visiblePage, setVisiblePage] = useState(0);
  const [manualNav, setManualNav] = useState<number | null>(null);
  const [prevActivePage, setPrevActivePage] = useState<number | null>(null);

  // When a question is selected, its page takes over navigation and any
  // earlier manual page jump is dropped. Compared against a state snapshot,
  // so this runs exactly once per new activePage and cannot loop.
  if (activePage != null && activePage !== prevActivePage) {
    setPrevActivePage(activePage);
    setManualNav(null);
    setVisiblePage(activePage);
  }

  const scrollTarget = manualNav ?? activePage;

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));

  const goToPage = (page: number) => {
    const next = Math.max(0, Math.min(pages.length - 1, page));
    setManualNav(next);
    setVisiblePage(next);
  };

  const lastPage = pages.length - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 bg-neutral-800 text-neutral-50">
        <div className="text-sm font-semibold tracking-tight">Answer Sheet</div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-0.75 sm:gap-1.5 rounded-lg bg-neutral-700 px-2 py-1">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom out"
              className="rounded p-1 cursor-pointer text-neutral-200 transition-colors hover:text-white disabled:pointer-events-none disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-11 text-center text-xs font-medium tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom in"
              className="rounded p-1 cursor-pointer text-neutral-200 transition-colors hover:text-white disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <div className="inline-flex items-center sm:gap-1.5 rounded-lg bg-neutral-700 px-2 py-1">
            <button
              type="button"
              onClick={() => goToPage(visiblePage - 1)}
              disabled={pages.length === 0 || visiblePage <= 0}
              aria-label="Previous page"
              className="rounded p-1 cursor-pointer text-neutral-200 hover:text-white transition-colors disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="w-24 whitespace-nowrap text-center text-xs font-medium">
              Page {Math.min(visiblePage + 1, pages.length || 0)} of {pages.length}
            </span>
            <button
              type="button"
              onClick={() => goToPage(visiblePage + 1)}
              disabled={pages.length === 0 || visiblePage >= lastPage}
              aria-label="Next page"
              className="rounded p-1 cursor-pointer text-neutral-200 hover:text-white transition-colors disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        <SheetViewer
          pages={pages}
          overlays={overlays}
          activeIds={activeIds}
          activePage={scrollTarget}
          zoom={zoom}
          onPageVisible={setVisiblePage}
        />
        {pages.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            No answer sheet pages to show.
          </p>
        )}
      </div>
    </div>
  );
}