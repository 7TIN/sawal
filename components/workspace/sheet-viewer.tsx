"use client";

import { useEffect, useState, useRef } from "react";
import type { PageImage, BBox } from "@/lib/types";

export type OverlayBox = {
  id: string;
  page: number;
  bbox: BBox;
  label?: string;
};

type SheetViewerProps = {
  pages: PageImage[];
  overlays?: OverlayBox[];
  activeIds?: Set<string> | null;
  activePage?: number | null;
  zoom?: number;
  onPageVisible?: (page: number) => void;
};

export function SheetViewer({
  pages,
  overlays = [],
  activeIds,
  activePage,
  zoom = 1,
  onPageVisible,
}: SheetViewerProps) {
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [naturalSizes, setNaturalSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    if (activePage != null) {
      pageRefs.current.get(activePage)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activePage]);

  useEffect(() => {
    if (!onPageVisible || pages.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best: { index: number; ratio: number } | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.page);
          if (!Number.isFinite(index)) continue;
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { index, ratio: entry.intersectionRatio };
          }
        }
        if (best) onPageVisible(best.index);
      },
      { threshold: [0.2, 0.5, 0.8] },
    );

    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pages, onPageVisible]);

  const hasActive = activeIds != null && activeIds.size > 0;

  const toPct = (bbox: BBox, page: PageImage): BBox => {
    const looksUnsized =
      bbox.x <= 0 && bbox.y <= 0 && bbox.w <= 0 && bbox.h <= 0;
    const looksPixels =
      bbox.x > 1.2 || bbox.y > 1.2 || bbox.w > 1.2 || bbox.h > 1.2;
    const nat = naturalSizes[page.index] ?? { w: page.width, h: page.height };

    let x = bbox.x;
    let y = bbox.y;
    let w = bbox.w;
    let h = bbox.h;

    if (!looksUnsized && looksPixels && nat && nat.w > 0 && nat.h > 0) {
      x = bbox.x / nat.w;
      y = bbox.y / nat.h;
      w = bbox.w / nat.w;
      h = bbox.h / nat.h;
    }

    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const cx = clamp01(x);
    const cy = clamp01(y);
    return {
      x: cx,
      y: cy,
      w: clamp01(w) - Math.max(0, cx + clamp01(w) - 1),
      h: clamp01(h) - Math.max(0, cy + clamp01(h) - 1),
    };
  };

  return (
    <div className="flex flex-col gap-4">
      {pages.map((page) => {
        const pageOverlays = overlays.filter((o) => o.page === page.index);

        return (
          <div
            key={page.index}
            ref={(el) => {
              if (el) {
                el.dataset.page = String(page.index);
                pageRefs.current.set(page.index, el);
              }
            }}
            className="relative inline-block rounded-md"
            style={{ width: `${zoom * 100}%` }}
          >
            <img
              src={page.url}
              alt={`Page ${page.index + 1}`}
              onLoad={(event) => {
                const img = event.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setNaturalSizes((sizes) =>
                    sizes[page.index]?.w === img.naturalWidth && sizes[page.index]?.h === img.naturalHeight
                      ? sizes
                      : { ...sizes, [page.index]: { w: img.naturalWidth, h: img.naturalHeight } },
                  );
                }
              }}
              className="w-full rounded-md border"
            />
            <div className="absolute inset-0">
              {pageOverlays.map((overlay) => {
                const isActive = hasActive && activeIds!.has(overlay.id);
                const isHovered = hoveredId === overlay.id;
                if (
                  !Number.isFinite(overlay.bbox.x) ||
                  !Number.isFinite(overlay.bbox.y) ||
                  !Number.isFinite(overlay.bbox.w) ||
                  !Number.isFinite(overlay.bbox.h) ||
                  overlay.bbox.w <= 0 ||
                  overlay.bbox.h <= 0
                ) {
                  return null;
                }
                const bbox = toPct(overlay.bbox, page);
                const unsized = bbox.w <= 0 || bbox.h <= 0;
                if (!hasActive || !isActive) return null;
                if (unsized) return null;

                return (
                  <div
                    key={overlay.id}
                    onMouseEnter={() => setHoveredId(overlay.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      left: `${bbox.x * 100}%`,
                      top: `${bbox.y * 100}%`,
                      width: `${bbox.w * 100}%`,
                      height: `${bbox.h * 100}%`,
                    }}
                    title={overlay.label}
                    className={`absolute box-border rounded-lg transition-all duration-200 ${
                      isActive
                        ? "border-2 border-dotted border-emerald-500 bg-emerald-500/15 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]"
                        : isHovered
                          ? "border border-dashed border-emerald-400/70 bg-emerald-500/10"
                          : "border border-dashed border-emerald-400/40 bg-emerald-500/5"
                    }`}
                  >
                    {isActive && (
                      <span className="absolute -top-5 left-1 whitespace-nowrap rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {overlay.label ?? "Answer"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
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
