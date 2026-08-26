"use client";

import { useEffect, useRef } from "react";
import type { PageImage, BBox } from "@/lib/types";

type OverlayBox = {
  id: string;
  page: number;
  bbox: BBox;
  label?: string;
};

type SheetViewerProps = {
  pages: PageImage[];
  overlays?: OverlayBox[];
  activeId?: string | null;
  currentPage?: number;
  onPageChange?: (page: number) => void;
};

export function SheetViewer({
  pages,
  overlays = [],
  activeId,
  currentPage = 0,
}: SheetViewerProps) {
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const el = pageRefs.current.get(currentPage);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [currentPage]);

  const activeOverlays = activeId
    ? overlays.filter((o) => o.id === activeId)
    : [];

  return (
    <div className="flex flex-col gap-4">
      {pages.map((page) => {
        const pageOverlays =
          activeId
            ? activeOverlays.filter((o) => o.page === page.index)
            : overlays.filter((o) => o.page === page.index);

        return (
          <div
            key={page.index}
            ref={(el) => {
              if (el) pageRefs.current.set(page.index, el);
            }}
            className="relative inline-block w-full"
          >
            <img
              src={page.url}
              alt={`Page ${page.index + 1}`}
              className="w-full rounded-md border"
            />
            {pageOverlays.length > 0 && (
              <div className="absolute inset-0">
                {pageOverlays.map((overlay) => (
                  <div
                    key={overlay.id}
                    className="absolute rounded-sm border-2 border-blue-500 bg-blue-500/10 transition-all duration-200"
                    style={{
                      left: `${overlay.bbox.x * 100}%`,
                      top: `${overlay.bbox.y * 100}%`,
                      width: `${overlay.bbox.w * 100}%`,
                      height: `${overlay.bbox.h * 100}%`,
                    }}
                  >
                    {overlay.label && (
                      <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {overlay.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {pages.length > 1 && (
              <div className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
                {page.index + 1} / {pages.length}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SheetPageNav({
  pages,
  currentPage,
  onPageChange,
}: {
  pages: PageImage[];
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  if (pages.length <= 1) return null;

  return (
    <div className="flex items-center gap-1">
      {pages.map((page) => (
        <button
          key={page.index}
          type="button"
          onClick={() => onPageChange(page.index)}
          className={`h-6 w-6 rounded text-[11px] font-medium transition-colors ${
            page.index === currentPage
              ? "bg-foreground text-background"
              : "bg-secondary text-muted-foreground hover:bg-secondary/80"
          }`}
        >
          {page.index + 1}
        </button>
      ))}
    </div>
  );
}
