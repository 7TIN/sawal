"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { parseFiles } from "@/lib/pdf";
import {
  deleteDocument,
  getDocument,
  getExtraction,
  saveDocument,
  saveExtraction,
} from "@/lib/storage";
import { mapQuestionsToAnswers } from "@/lib/ai/mapping";
import {
  DOCUMENT_IDS,
  type DocumentId,
  type PageImage,
  type SlotState,
  type StoredDocument,
  type Question,
  type Answer,
  type GradingSummary,
  type Grade,
  type BBox,
} from "@/lib/types";
import { UploadSlot } from "./upload-slot";
import { SheetViewer } from "./sheet-viewer";
import { QuestionList } from "./question-list";
import { GradeSummary } from "./grade-summary";
import { PipelineStepper, type PipelineStage } from "./pipeline-stepper";
import { ExtractionProgress } from "./extraction-progress";
import { type ProviderName } from "@/lib/ai/provider";

type SlotAction =
  | { type: "hydrate"; id: DocumentId; slot: SlotState }
  | { type: "progress"; id: DocumentId; fileName: string; done: number; total: number }
  | { type: "ready"; id: DocumentId; document: StoredDocument; pages: PageImage[] }
  | { type: "error"; id: DocumentId; fileName: string; message: string }
  | { type: "reset"; id: DocumentId };

type SlotState_ = Record<DocumentId, SlotState>;

const initialSlots: SlotState_ = {
  "question-paper": { status: "empty" },
  "answer-sheet": { status: "empty" },
};

function slotReducer(state: SlotState_, action: SlotAction): SlotState_ {
  switch (action.type) {
    case "hydrate":
      return { ...state, [action.id]: action.slot };
    case "ready":
      return {
        ...state,
        [action.id]: { status: "ready", document: action.document, pages: action.pages },
      };
    case "progress":
      return {
        ...state,
        [action.id]: { status: "parsing", fileName: action.fileName, done: action.done, total: action.total },
      };
    case "error":
      return {
        ...state,
        [action.id]: { status: "error", fileName: action.fileName, message: action.message },
      };
    case "reset":
      return { ...state, [action.id]: { status: "empty" } };
  }
}

type ExtractionState = {
  status: "idle" | "loading" | "done" | "error";
  stage?: string;
  error?: string;
  questions: Question[];
  answers: Answer[];
  provider?: ProviderName;
};

type GradingState = {
  status: "idle" | "loading" | "done" | "error";
  error?: string;
  summary?: GradingSummary;
};

const SLOT_META: Record<DocumentId, { title: string; description: string }> = {
  "question-paper": {
    title: "Question paper",
    description: "The printed exam paper. Questions are extracted in original order, including labelled sub-parts.",
  },
  "answer-sheet": {
    title: "Student answer sheet",
    description: "One handwritten submission. Answers are located on the page so you can jump to them from any question.",
  },
};

export function Workspace() {
  const [slots, dispatchSlot] = useReducer(slotReducer, initialSlots);
  const [extraction, setExtraction] = useState<ExtractionState>({
    status: "idle",
    questions: [],
    answers: [],
  });
  const [grading, setGrading] = useState<GradingState>({ status: "idle" });
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderName>("sarvam");
  const urlsRef = useRef<Record<DocumentId, string[]>>({
    "question-paper": [],
    "answer-sheet": [],
  });

  const revokeUrls = useCallback((id: DocumentId) => {
    for (const url of urlsRef.current[id]) URL.revokeObjectURL(url);
    urlsRef.current[id] = [];
  }, []);

  const buildPageImages = useCallback(
    async (id: DocumentId, pages: { blob: Blob; width?: number; height?: number }[]): Promise<PageImage[]> => {
      revokeUrls(id);
      urlsRef.current[id] = pages.map((page) => URL.createObjectURL(page.blob));
      return Promise.all(
        pages.map(async (page, index) => {
          let { width, height } = page;
          if (width == null || height == null) {
            const bitmap = await createImageBitmap(page.blob);
            width = bitmap.width;
            height = bitmap.height;
            bitmap.close();
          }
          return { index, url: urlsRef.current[id][index], width, height };
        }),
      );
    },
    [revokeUrls],
  );

  // Hydrate from IndexedDB on mount
  useEffect(() => {
    let cancelled = false;
    const hydrate = async (id: DocumentId) => {
      try {
        const stored = await getDocument(id);
        if (!stored || cancelled || stored.pages.length === 0) return;
        const pages = await buildPageImages(id, stored.pages.map((blob) => ({ blob })));
        if (cancelled) return;
        dispatchSlot({ type: "hydrate", id, slot: { status: "ready", document: stored, pages } });
      } catch {
        // Storage unavailable
      }
    };
    DOCUMENT_IDS.forEach(hydrate);

    // Hydrate extraction results
    const hydrateExtraction = async () => {
      try {
        const cached = await getExtraction<{
          questions: Question[];
          answers: Answer[];
          provider: ProviderName;
        }>("answer-sheet");
        if (!cancelled && cached) {
          setExtraction({
            status: "done",
            questions: cached.questions,
            answers: cached.answers,
            provider: cached.provider,
          });
        }
      } catch {
        // Ignore
      }
    };
    hydrateExtraction();

    return () => { cancelled = true; };
  }, [buildPageImages]);

  useEffect(() => {
    const currentUrls = urlsRef.current;
    return () => {
      DOCUMENT_IDS.forEach((id) => {
        for (const url of currentUrls[id]) URL.revokeObjectURL(url);
      });
    };
  }, []);

  const handleSelect = useCallback(
    async (id: DocumentId, files: File[]) => {
      const fileName = files.length === 1 ? files[0].name : `${files.length} images`;
      dispatchSlot({ type: "progress", id, fileName, done: 0, total: 0 });
      try {
        const pages = await parseFiles(files, (done, total) =>
          dispatchSlot({ type: "progress", id, fileName, done, total }),
        );
        const stored: StoredDocument = {
          id,
          fileName,
          mimeType: files[0].type,
          pages: pages.map((page) => page.blob),
          createdAt: new Date().toISOString(),
        };
        try { await saveDocument(stored); } catch { /* best-effort */ }
        const pageImages = await buildPageImages(id, pages);
        dispatchSlot({ type: "ready", id, document: stored, pages: pageImages });
      } catch (error) {
        dispatchSlot({
          type: "error",
          id,
          fileName,
          message: error instanceof Error ? error.message : "Something went wrong while reading the file.",
        });
      }
    },
    [buildPageImages],
  );

  const handleRemove = useCallback(
    (id: DocumentId) => {
      revokeUrls(id);
      deleteDocument(id).catch(() => undefined);
      dispatchSlot({ type: "reset", id });
      setExtraction({ status: "idle", questions: [], answers: [] });
      setGrading({ status: "idle" });
    },
    [revokeUrls],
  );

  const readyCount = DOCUMENT_IDS.filter((id) => slots[id].status === "ready").length;
  const bothReady = readyCount === DOCUMENT_IDS.length;
  const hasExtraction = extraction.status === "done" && extraction.questions.length > 0;
  const hasGrading = grading.status === "done" && grading.summary;

  const currentStage: PipelineStage = hasGrading
    ? "grade"
    : hasExtraction
      ? "review"
      : extraction.status === "loading"
        ? "extract"
        : "upload";

  // Build overlays for sheet viewer
  const overlays = useMemo(() => {
    if (!hasExtraction) return [];
    const result: Array<{ id: string; page: number; bbox: BBox; label?: string }> = [];

    for (const answer of extraction.answers) {
      for (const region of answer.regions) {
        result.push({
          id: answer.id,
          page: region.page,
          bbox: region.bbox,
          label: answer.label,
        });
      }
    }

    return result;
  }, [extraction, hasExtraction]);

  // Build status maps for question list
  const questionStatuses = useMemo(() => {
    if (!hasExtraction) return {};
    const mapped = mapQuestionsToAnswers(extraction.questions, extraction.answers);
    const statuses: Record<string, import("@/lib/types").MatchStatus> = {};
    const grades: Record<string, Grade> = {};

    for (const item of mapped) {
      statuses[item.question.id] = item.status;
      if (item.grade) grades[item.question.id] = item.grade;
    }

    return { statuses, grades, mapped };
  }, [extraction, hasExtraction]);

  const handleExtract = useCallback(async () => {
    if (!bothReady) return;

    setExtraction({ status: "loading", stage: "Uploading documents...", questions: [], answers: [] });
    setGrading({ status: "idle" });
    setActiveQuestionId(null);

    try {
      const qpDoc = slots["question-paper"];
      const asDoc = slots["answer-sheet"];
      if (qpDoc.status !== "ready" || asDoc.status !== "ready") throw new Error("Documents not ready");

      const formData = new FormData();

      // Send question paper pages as a combined PDF-like blob
      // or as individual image files
      const qpBlobs = qpDoc.document.pages;
      const asBlobs = asDoc.document.pages;

      // For simplicity, send the first blob of each (PDFs are single blob)
      // If multi-image, combine them
      if (qpBlobs.length === 1) {
        formData.append("questionPaper", qpBlobs[0], "question-paper");
      } else {
        // Combine images into a single blob (treat as images)
        const combined = new Blob(qpBlobs, { type: "image/jpeg" });
        formData.append("questionPaper", combined, "question-paper");
      }

      if (asBlobs.length === 1) {
        formData.append("answerSheet", asBlobs[0], "answer-sheet");
      } else {
        const combined = new Blob(asBlobs, { type: "image/jpeg" });
        formData.append("answerSheet", combined, "answer-sheet");
      }

      formData.append("provider", provider);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Extraction failed (${response.status})`);
      }

      const result = await response.json();

      // Flatten answersByPage into a flat answers array
      const answersByPage = result.answersByPage ?? result.answers ?? {};
      const flatAnswers: Answer[] = [];
      for (const answers of Object.values(answersByPage)) {
        if (Array.isArray(answers)) {
          for (const a of answers) {
            flatAnswers.push({
              id: a.id,
              label: a.label,
              text: a.text,
              regions: a.regions ?? [],
            });
          }
        }
      }

      const newExtraction: ExtractionState = {
        status: "done",
        questions: result.questions ?? [],
        answers: flatAnswers,
        provider: result.provider ?? provider,
      };

      setExtraction(newExtraction);

      // Persist extraction results
      try {
        await saveExtraction("answer-sheet", {
          questions: newExtraction.questions,
          answers: newExtraction.answers,
          provider: newExtraction.provider,
        });
      } catch {
        // Best-effort
      }
    } catch (error) {
      setExtraction((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "Extraction failed",
      }));
    }
  }, [bothReady, slots, provider]);

  const handleGrade = useCallback(async () => {
    if (!hasExtraction || extraction.questions.length === 0) return;

    setGrading({ status: "loading" });

    try {
      const mapped = mapQuestionsToAnswers(extraction.questions, extraction.answers);

      const response = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: mapped,
          provider: extraction.provider ?? provider,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Grading failed (${response.status})`);
      }

      const result = await response.json();

      setGrading({
        status: "done",
        summary: result.summary,
      });
    } catch (error) {
      setGrading((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "Grading failed",
      }));
    }
  }, [hasExtraction, extraction, provider]);

  const handleReset = useCallback(() => {
    setExtraction({ status: "idle", questions: [], answers: [] });
    setGrading({ status: "idle" });
    setActiveQuestionId(null);
  }, []);

  return (
    <div className="mt-8">
      {/* Pipeline Stepper */}
      <div className="mb-5 flex items-center justify-between">
        <PipelineStepper
          current={currentStage}
          extracting={extraction.status === "loading"}
        />
        {extraction.status === "loading" && (
          <span className="text-xs text-muted-foreground">{extraction.stage}</span>
        )}
      </div>

      {/* Upload Grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {DOCUMENT_IDS.map((id) => (
          <UploadSlot
            key={id}
            id={id}
            title={SLOT_META[id].title}
            description={SLOT_META[id].description}
            state={slots[id]}
            onSelect={(files) => void handleSelect(id, files)}
            onRemove={() => handleRemove(id)}
          />
        ))}
      </div>

      {/* Provider selector + CTA */}
      <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {bothReady
              ? hasExtraction
                ? "Extraction complete. Review results below."
                : "Both documents ready. Start extraction."
              : `Upload both documents to continue — ${readyCount}/${DOCUMENT_IDS.length} added.`}
          </p>
          {bothReady && !hasExtraction && (
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderName)}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              <option value="sarvam">Sarvam DocAI</option>
              <option value="gemini">Gemini Flash Lite</option>
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasExtraction && !hasGrading && (
            <button
              type="button"
              onClick={handleReset}
              className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </button>
          )}
          {!hasExtraction && (
            <button
              type="button"
              disabled={!bothReady || extraction.status === "loading"}
              onClick={handleExtract}
              className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
            >
              {extraction.status === "loading" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Extract questions & answers
              <ArrowRight className="size-4" />
            </button>
          )}
          {hasExtraction && !hasGrading && (
            <button
              type="button"
              disabled={grading.status === "loading"}
              onClick={handleGrade}
              className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
            >
              {grading.status === "loading" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Grade answers
              <ArrowRight className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Extraction in progress */}
      {extraction.status === "loading" && (
        <div className="mt-5">
          <ExtractionProgress stage={extraction.stage ?? "Processing..."} />
        </div>
      )}

      {/* Extraction error */}
      {extraction.status === "error" && (
        <div className="mt-5">
          <ExtractionProgress
            stage=""
            error={extraction.error}
            onRetry={handleExtract}
          />
        </div>
      )}

      {/* Grading in progress */}
      {grading.status === "loading" && (
        <div className="mt-5">
          <ExtractionProgress stage="Grading matched answers..." />
        </div>
      )}

      {/* Grading error */}
      {grading.status === "error" && (
        <div className="mt-5">
          <ExtractionProgress
            stage=""
            error={grading.error}
            onRetry={handleGrade}
          />
        </div>
      )}

      {/* Grade summary */}
      {hasGrading && grading.summary && (
        <div className="mt-5">
          <GradeSummary summary={grading.summary} onReset={handleReset} />
        </div>
      )}

      {/* Results: Question List + Sheet Viewer */}
      {hasExtraction && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
          {/* Left: Question List */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-medium">
                {extraction.questions.length} Questions
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Click a question to highlight its answer on the sheet.
              </p>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <QuestionList
                questions={extraction.questions}
                statuses={questionStatuses.statuses ?? {}}
                grades={questionStatuses.grades ?? {}}
                activeId={activeQuestionId}
                onSelect={(id) =>
                  setActiveQuestionId((prev) => (prev === id ? null : id))
                }
              />
            </div>
          </div>

          {/* Right: Sheet Viewer */}
          <div className="rounded-xl border bg-card p-4">
            <SheetViewer
              pages={
                slots["answer-sheet"].status === "ready"
                  ? slots["answer-sheet"].pages
                  : []
              }
              overlays={overlays}
              activeId={activeQuestionId}
              currentPage={0}
            />
          </div>
        </div>
      )}

      {/* Unmatched answers bucket */}
      {hasExtraction && questionStatuses.mapped && (() => {
        const unmatched = questionStatuses.mapped.filter(
          (i) => i.status === "unmatched" && i.answer,
        );
        if (unmatched.length === 0) return null;
        return (
          <div className="mt-5 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-medium">
              {unmatched.length} Unmatched {unmatched.length === 1 ? "Answer" : "Answers"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              These answers could not be matched to any question.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {unmatched.map((item) => (
                <div
                  key={item.answer!.id}
                  className="rounded-md border bg-secondary/50 px-2.5 py-1.5 text-xs"
                >
                  <span className="font-medium">{item.answer!.label}</span>
                  <span className="ml-1.5 text-muted-foreground">
                    (page {(item.answer!.regions[0]?.page ?? 0) + 1})
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
