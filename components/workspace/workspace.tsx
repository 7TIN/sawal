"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowRight, Database, Download, LoaderCircle, RotateCcw, ScrollText, Sparkles, Trash2 } from "lucide-react";
import { parseFiles } from "@/lib/pdf";
import {
  deleteDocument,
  getDocument,
  getExtraction,
  saveDocument,
  saveExtraction,
  deleteExtraction,
  saveLog,
  getAllLogs,
  clearLogs,
  getRawExtraction,
  getRawExtractionSummaries,
  saveRawExtraction,
  deleteRawExtraction,
  type ApiLog,
  type RawExtractionSummary,
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
  type MatchStatus,
  type MappedItem,
} from "@/lib/types";
import { UploadSlot } from "./upload-slot";
import { AnswerSheetPanel } from "./answer-sheet-panel";
import { QuestionList } from "./question-list";
import { GradeSummary } from "./grade-summary";
import { PipelineStepper, type PipelineStage } from "./pipeline-stepper";
import { ExtractionProgress } from "./extraction-progress";
import { type ProviderName } from "@/lib/ai/provider";
import { isProd, showDebugPanels } from "@/lib/env";

function FullScreenLoading({ title }: { title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      <Sparkles className="size-14 animate-pulse text-primary" />
      <p className="mt-8 text-4xl font-semibold tracking-tight">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">This may take a while</p>
    </div>
  );
}

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
      return { ...state, [action.id]: { status: "ready", document: action.document, pages: action.pages } };
    case "progress":
      return { ...state, [action.id]: { status: "parsing", fileName: action.fileName, done: action.done, total: action.total } };
    case "error":
      return { ...state, [action.id]: { status: "error", fileName: action.fileName, message: action.message } };
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
  rawQuestionText?: string;
};

type GradingState = {
  status: "idle" | "loading" | "done" | "error";
  error?: string;
  summary?: GradingSummary;
};

const SLOT_META: Record<DocumentId, { title: string }> = {
  "question-paper": {
    title: "Question paper",
  },
  "answer-sheet": {
    title: "Student answer sheet",
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
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const originalFilesRef = useRef<Partial<Record<DocumentId, File[]>>>({});
  const urlsRef = useRef<Record<DocumentId, string[]>>({
    "question-paper": [],
    "answer-sheet": [],
  });
  const mappingLoggedFor = useRef<string>("");
  const [savedResponses, setSavedResponses] = useState<RawExtractionSummary[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [usingSaved, setUsingSaved] = useState<string | null>(null);
  const [gradedItems, setGradedItems] = useState<Awaited<ReturnType<typeof mapQuestionsToAnswers>>>([]);
  const prodAutoGradedRef = useRef(false);

  const refreshSavedResponses = useCallback(() => {
    getRawExtractionSummaries().then(setSavedResponses).catch(() => undefined);
  }, []);

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

    const hydrateExtraction = async () => {
      try {
        const cached = await getExtraction<{
          version?: number;
          questions: Question[];
          answers: Answer[];
          provider: ProviderName;
        }>("answer-sheet");
        if (!cancelled && cached && cached.version === 22 && cached.questions.length > 0) {
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

    getAllLogs().then((entries) => {
      if (!cancelled) setLogs(entries);
    }).catch(() => undefined);

    refreshSavedResponses();

    return () => { cancelled = true; };
  }, [buildPageImages, refreshSavedResponses]);

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
      originalFilesRef.current[id] = files;
      dispatchSlot({ type: "progress", id, fileName, done: 0, total: 0 });
      if (id === "answer-sheet" || id === "question-paper") {
        deleteExtraction(id).catch(() => undefined);
        setExtraction({ status: "idle", questions: [], answers: [] });
        setGrading({ status: "idle" });
        setGradedItems([]);
        prodAutoGradedRef.current = false;
        setActiveQuestionId(null);
      }
      try {
        const pages = await parseFiles(files, (done, total) =>
          dispatchSlot({ type: "progress", id, fileName, done, total }),
        );
        const stored: StoredDocument = {
          id,
          fileName,
          mimeType: files[0].type,
          pages: pages.map((page) => page.blob),
          originalFile: files.length === 1 ? files[0] : new Blob(files, { type: "image/jpeg" }),
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
      delete originalFilesRef.current[id];
      dispatchSlot({ type: "reset", id });
      setExtraction({ status: "idle", questions: [], answers: [] });
      setGrading({ status: "idle" });
      setGradedItems([]);
      prodAutoGradedRef.current = false;
      setActiveQuestionId(null);
    },
    [revokeUrls],
  );

  const refreshLogs = useCallback(() => {
    getAllLogs().then(setLogs).catch(() => undefined);
  }, []);

  const handleClearLogs = useCallback(() => {
    clearLogs().then(refreshLogs).catch(() => undefined);
  }, [refreshLogs]);

  const bothReady = DOCUMENT_IDS.every((id) => slots[id].status === "ready");
  const hasExtraction = extraction.status === "done";
  const hasGrading = grading.status === "done" && grading.summary;
  const extractedEmpty =
    hasExtraction && extraction.questions.length === 0 && extraction.answers.length === 0;

  const currentStage: PipelineStage = hasGrading
    ? "grade"
    : hasExtraction
      ? "review"
      : extraction.status === "loading"
        ? "extract"
        : "upload";

  // Build overlays + mapped data
  const { overlays, mapped } = useMemo(() => {
    if (!hasExtraction) return { overlays: [] as Array<{ id: string; page: number; bbox: BBox; label?: string }>, mapped: [] as Awaited<ReturnType<typeof mapQuestionsToAnswers>> };

    const result: Array<{ id: string; page: number; bbox: BBox; label?: string }> = [];
    for (const answer of extraction.answers) {
      for (const region of answer.regions) {
        if (
          !Number.isFinite(region.bbox.x) ||
          !Number.isFinite(region.bbox.y) ||
          !Number.isFinite(region.bbox.w) ||
          !Number.isFinite(region.bbox.h) ||
          region.bbox.w <= 0 ||
          region.bbox.h <= 0
        ) {
          continue;
        }
        result.push({
          id: answer.id,
          page: region.page,
          bbox: region.bbox,
          label: answer.matchedQuestionNumber ? `Q${answer.matchedQuestionNumber}` : answer.label,
        });
      }
    }

    return { overlays: result, mapped: mapQuestionsToAnswers(extraction.questions, extraction.answers) };
  }, [extraction, hasExtraction]);

  // Ids of the answer regions belonging to the currently active question
  const activeAnswerIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeQuestionId) return ids;
    for (const item of mapped) {
      if (item.question.id === activeQuestionId && item.answer) {
        ids.add(item.answer.id);
      }
    }
    return ids;
  }, [activeQuestionId, mapped]);

  // Degenerate region guard: if every answer region collapsed to nearly the same spot,
  // the provider returned broken coordinates — surface it instead of silently misdrawing.
  const degenerateRegions = useMemo(() => {
    if (overlays.length < 2) return null;
    const sigs = new Set(
      overlays.map((o) => `${Math.round((o.bbox.x ?? 0) * 16)},${Math.round((o.bbox.y ?? 0) * 16)},${o.page}`),
    );
    if (sigs.size >= 3) return null;
    const first = overlays[0].bbox;
    return { x: first.x, y: first.y, w: first.w, h: first.h, count: overlays.length, unique: sigs.size };
  }, [overlays]);

  // Persist the mapping result once per extraction, along with fresh answersById/status data
  useEffect(() => {
    if (!hasExtraction) return;
    const signature = `${extraction.questions.length}|${extraction.answers.length}`;
    if (mappingLoggedFor.current === signature) return;
    mappingLoggedFor.current = signature;
    const mappedSummary = mapped.map((item) => ({
      questionId: item.question.id,
      questionNumber: item.question.number,
      questionText: item.question.text.slice(0, 120),
      status: item.status,
      matchedAnswerId: item.answer?.id ?? null,
      matchedAnswerLabel: item.answer?.label ?? null,
      answerPage: item.answer?.regions[0]?.page ?? null,
    }));
    saveLog("mapping", { questionsCount: extraction.questions.length, answersCount: extraction.answers.length, items: mappedSummary, answers: extraction.answers.map((a) => ({ id: a.id, label: a.label, text: a.text.slice(0, 120), regions: a.regions })) })
      .then(refreshLogs)
      .catch(() => undefined);
  }, [hasExtraction, mapped, extraction.questions.length, extraction.answers, refreshLogs]);

  const { statuses, grades, answersById } = useMemo(() => {
    const statuses: Record<string, MatchStatus> = {};
    const grades: Record<string, Grade> = {};
    const answersById: Record<string, Answer | null> = {};
    const idToAnswer = new Map<string, Answer>();
    for (const a of extraction.answers) idToAnswer.set(a.id, a);

    const items = gradedItems.length > 0 ? gradedItems : mapped;
    for (const item of items) {
      statuses[item.question.id] = item.status;
      if (item.grade) grades[item.question.id] = item.grade;
      answersById[item.question.id] = item.answer ? idToAnswer.get(item.answer.id) ?? item.answer : null;
    }

    return { statuses, grades, answersById };
  }, [gradedItems, mapped, extraction.answers]);

  // When a question is clicked, find its active page to scroll to
  const activePage = useMemo(() => {
    if (!activeQuestionId || !hasExtraction) return null;
    const item = mapped.find((i) => i.question.id === activeQuestionId && i.answer);
    return item?.answer?.regions[0]?.page ?? null;
  }, [activeQuestionId, hasExtraction, mapped]);

  const getOriginalFile = useCallback((id: DocumentId): Blob | null => {
    const slot = slots[id];
    if (slot.status !== "ready") return null;
    return slot.document.originalFile ?? null;
  }, [slots]);

  const applyExtractionResult = useCallback(
    async (result: {
      answersByPage?: unknown;
      questions?: unknown;
      rawQuestionText?: string;
      answerLayout?: unknown;
      provider?: string;
    }, source: "live" | "offline") => {
      const answersByPage = (result.answersByPage ?? {}) as Record<string, unknown>;
      const flatAnswers: Answer[] = [];
      for (const answersArr of Object.values(answersByPage)) {
        if (!Array.isArray(answersArr)) continue;
        for (const a of answersArr) {
          flatAnswers.push({
            id: a.id,
            label: a.label ?? "",
            text: a.text ?? "",
            regions: Array.isArray(a.regions) ? a.regions : [],
          });
        }
      }

      const newExtraction: ExtractionState = {
        status: "done",
        questions: (Array.isArray(result.questions) ? result.questions : []).map((q: Question) => q),
        answers: flatAnswers,
        provider: (result.provider ?? provider) as ProviderName,
        rawQuestionText: result.rawQuestionText,
      };

      setExtraction(newExtraction);
      mappingLoggedFor.current = "";

      saveLog("extract", {
        provider: newExtraction.provider,
        source,
        questionsCount: newExtraction.questions.length,
        answersCount: newExtraction.answers.length,
        answerPages: flatAnswers.reduce((acc, a) => {
          const p = a.regions[0]?.page ?? 0;
          acc[p] = (acc[p] ?? 0) + 1;
          return acc;
        }, {} as Record<number, number>),
        questions: newExtraction.questions.map((q) => ({ id: q.id, number: q.number, text: q.text.slice(0, 150), options: q.options })),
        answers: flatAnswers.map((a) => ({ id: a.id, label: a.label, text: a.text.slice(0, 400), regions: a.regions })),
        rawQuestionText: newExtraction.rawQuestionText,
        answerLayout: result.answerLayout ?? [],
      })
        .then(refreshLogs)
        .catch(() => undefined);

      try {
        await saveExtraction("answer-sheet", {
          version: 22,
          questions: newExtraction.questions,
          answers: newExtraction.answers,
          provider: newExtraction.provider,
        });
      } catch { /* best-effort */ }

      return newExtraction;
    },
    [provider, refreshLogs],
  );

  const handleExtract = useCallback(async () => {
    if (!bothReady) return;

    setExtraction({ status: "loading", stage: "Uploading documents...", questions: [], answers: [] });
    setGrading({ status: "idle" });
    setActiveQuestionId(null);

    try {
      const qpFile = getOriginalFile("question-paper");
      const asFile = getOriginalFile("answer-sheet");
      if (!qpFile || !asFile) throw new Error("Original documents are not available. Please re-upload.");

      const qpSlot = slots["question-paper"];
      const asSlot = slots["answer-sheet"];

      const formData = new FormData();
      const qpName = qpSlot.status === "ready" ? qpSlot.document.fileName : "question-paper.pdf";
      const asName = asSlot.status === "ready" ? asSlot.document.fileName : "answer-sheet.pdf";
      formData.append("questionPaper", qpFile, qpName);
      formData.append("answerSheet", asFile, asName);
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
      await applyExtractionResult(result, "live");

      const rawData = result.rawData as
        | { qpDigitise: string[]; asExtract: unknown; asDigitise: string[] }
        | undefined;
      if (rawData) {
        try {
          await saveRawExtraction({
            id: `raw-${Date.now()}`,
            savedAt: new Date().toISOString(),
            document: { questionFileName: qpName, answerSheetFileName: asName },
            raw: rawData,
          });
          refreshSavedResponses();
        } catch { /* best-effort */ }
      }
    } catch (error) {
      setExtraction((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "Extraction failed",
      }));
    }
  }, [bothReady, slots, provider, getOriginalFile, refreshSavedResponses, applyExtractionResult]);

  const handleUseSaved = useCallback(
    async (id: string) => {
      const record = await getRawExtraction(id);
      if (!record) return;

      setUsingSaved(id);
      setExtraction({ status: "loading", stage: "Rebuilding from saved response...", questions: [], answers: [] });
      setGrading({ status: "idle" });
      setGradedItems([]);
      prodAutoGradedRef.current = false;
      setActiveQuestionId(null);

      try {
        const response = await fetch("/api/extract/offline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw: record.raw }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `Offline extraction failed (${response.status})`);
        }

        const result = await response.json();
        await applyExtractionResult(result, "offline");
      } catch (error) {
        setExtraction((prev) => ({
          ...prev,
          status: "error",
          error: error instanceof Error ? error.message : "Offline extraction failed",
        }));
      } finally {
        setUsingSaved(null);
      }
    },
    [applyExtractionResult],
  );

  const handleDownloadSaved = useCallback(async (id: string) => {
    const record = await getRawExtraction(id);
    if (!record) return;
    const blob = new Blob([JSON.stringify(record.raw, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sarvam-raw-${id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDeleteSaved = useCallback(
    async (id: string) => {
      await deleteRawExtraction(id);
      refreshSavedResponses();
    },
    [refreshSavedResponses],
  );

  const handleGrade = useCallback(async () => {
    if (!hasExtraction || extraction.questions.length === 0 || mapped.length === 0) return;

    setGrading({ status: "loading" });

    try {
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
      setGrading({ status: "done", summary: result.summary });
      setGradedItems(result.gradedItems ?? []);

      saveLog("grade", {
        provider: extraction.provider ?? provider,
        gradedCount: result.gradedItems?.filter((i: MappedItem) => i.grade).length ?? 0,
        summary: result.summary,
        grades: (result.gradedItems ?? []).map((i: MappedItem) => ({
          questionId: i.question.id,
          questionNumber: i.question.number,
          status: i.status,
          marks: i.grade?.marks,
          maxMarks: i.grade?.maxMarks,
          verdict: i.grade?.verdict,
          feedback: i.grade?.feedback,
        })),
      })
        .then(refreshLogs)
        .catch(() => undefined);
    } catch (error) {
      setGrading((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "Grading failed",
      }));
    }
  }, [hasExtraction, extraction, mapped, provider, refreshLogs]);

  const handleReset = useCallback(() => {
    deleteExtraction("answer-sheet").catch(() => undefined);
    clearLogs().then(refreshLogs).catch(() => undefined);
    setExtraction({ status: "idle", questions: [], answers: [] });
    setGrading({ status: "idle" });
    setGradedItems([]);
    prodAutoGradedRef.current = false;
    setActiveQuestionId(null);
    mappingLoggedFor.current = "";
  }, [refreshLogs]);

  const handleQuestionSelect = useCallback((id: string) => {
    setActiveQuestionId((prev) => (prev === id ? null : id));
  }, []);

  // In production, skip the review step and grade automatically once the
  // extraction lands, so the user immediately sees the final grade result.
  useEffect(() => {
    if (!isProd) return;
    if (!hasExtraction || grading.status !== "idle") return;
    if (prodAutoGradedRef.current) return;
    prodAutoGradedRef.current = true;
    void handleGrade();
  }, [hasExtraction, grading.status, handleGrade]);

  return (
    <div className="mt-8">
      {(extraction.status === "loading" || grading.status === "loading") && (
        <FullScreenLoading
          title={grading.status === "loading" ? "Grading..." : "Extracting..."}
        />
      )}

      {!hasExtraction && (
        <>
          <div className="mb-5 flex items-center justify-between">
            <PipelineStepper
              current={currentStage}
              extracting={extraction.status === "loading"}
            />
            {extraction.status === "loading" && (
              <span className="text-xs text-muted-foreground">{extraction.stage}</span>
            )}
          </div>

          <div className="flex flex-col items-center gap-8">
            <header className="flex flex-col items-center gap-2 text-center">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  Upload
                </h1>
                <div className="inline-flex items-center gap-2.5 rounded-lg bg-secondary px-2 py-1 text-sm font-semibold text-secondary-foreground">
                  Question Paper &amp; Answer Sheets
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Upload both files to get started
              </p>
            </header>

            <div className="flex h-[205px] w-full max-w-[789px] items-center justify-center gap-4 rounded-[24px] bg-neutral-100 p-4">
              {DOCUMENT_IDS.map((id) => (
                <UploadSlot
                  key={id}
                  id={id}
                  title={SLOT_META[id].title}
                  state={slots[id]}
                  onSelect={(files) => void handleSelect(id, files)}
                  onRemove={() => handleRemove(id)}
                />
              ))}
            </div>

            <footer className="flex flex-col items-center gap-3">
              {bothReady && !isProd && (
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as ProviderName)}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <option value="sarvam">Sarvam DocAI</option>
                  <option value="gemini">Gemini Flash Lite</option>
                </select>
              )}
              <button
                type="button"
                disabled={!bothReady || extraction.status === "loading"}
                onClick={handleExtract}
                className="inline-flex items-center gap-2 rounded-full bg-primary py-3 pl-6 pr-5 text-sm font-medium text-primary-foreground transition-all hover:opacity-90 disabled:pointer-events-none disabled:opacity-25"
              >
                Start Mapping
                <ArrowRight className="size-5" />
              </button>
              <p className="text-center text-sm text-muted-foreground">
                Once both files are uploaded, you&apos;ll be able to map answers
                with questions
              </p>
            </footer>
          </div>

          {extraction.status === "error" && (
            <div className="mt-5">
              <ExtractionProgress stage="" error={extraction.error} onRetry={handleExtract} />
            </div>
          )}
        </>
      )}

      {hasExtraction && (
        <div className="flex h-[calc(100vh-2rem)] flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {extraction.questions.length} {extraction.questions.length === 1 ? "question" : "questions"} ·{" "}
              {extraction.answers.length} {extraction.answers.length === 1 ? "answer" : "answers"}
            </p>
            <div className="flex items-center gap-2">
              {!isProd && (
                <>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <RotateCcw className="size-3.5" />
                    Reset
                  </button>
                  <button
                    type="button"
                    disabled={grading.status === "loading" || mapped.length === 0}
                    onClick={handleGrade}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Sparkles className="size-3.5" />
                    Grade answers
                  </button>
                </>
              )}
            </div>
          </div>

          {grading.status === "error" && (
            <div className="mt-3">
              <ExtractionProgress stage="" error={grading.error} onRetry={handleGrade} />
            </div>
          )}

          {extractedEmpty && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <h3 className="text-sm font-medium">Extraction completed, but no questions were detected</h3>
              <p className="mt-1 text-xs opacity-80">
                The API responded successfully, but the question paper text could not be parsed into
                individual questions. This can happen with image-heavy or scanned papers.
              </p>
              {extraction.rawQuestionText?.trim() && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium">Show raw extracted text</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-[11px] leading-5 text-muted-foreground">
                    {extraction.rawQuestionText.slice(0, 6000)}
                  </pre>
                </details>
              )}
              <button
                type="button"
                onClick={handleExtract}
                className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Retry extraction
              </button>
            </div>
          )}

          {isProd ? (
            hasGrading && grading.summary ? (
              <>
                <div className="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
                  <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-neutral-100 p-4">

                    <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto ">
                      {extraction.questions.length === 0 ? (
                        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                          No questions parsed. Try re-running mapping.
                        </p>
                      ) : (
                        <QuestionList
                          questions={extraction.questions}
                          statuses={statuses}
                          grades={grades}
                          answersById={answersById}
                          activeId={activeQuestionId}
                          onSelect={handleQuestionSelect}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
                    <AnswerSheetPanel
                      pages={slots["answer-sheet"].status === "ready" ? slots["answer-sheet"].pages : []}
                      overlays={overlays}
                      activeIds={activeQuestionId ? activeAnswerIds : null}
                      activePage={activePage}
                    />
                  </div>
                </div>
                <div className="thin-scrollbar mt-4 flex-none overflow-y-auto rounded-xl border bg-card">
                  <GradeSummary summary={grading.summary} onReset={handleReset} />
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {extraction.questions.length === 0
                    ? "No questions detected."
                    : "Preparing grades…"}
                </p>
              </div>
            )
          ) : (
            <>
              <div className="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
                <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
                  <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                    <h3 className="text-sm font-medium">{extraction.questions.length} Questions</h3>
                    <span className="text-[11px] text-muted-foreground">Click to locate on sheet</span>
                  </div>
                  <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                    {extraction.questions.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                        No questions parsed. Try re-running mapping.
                      </p>
                    ) : (
                      <QuestionList
                        questions={extraction.questions}
                        statuses={statuses}
                        grades={grades}
                        answersById={answersById}
                        activeId={activeQuestionId}
                        onSelect={handleQuestionSelect}
                      />
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
                  {showDebugPanels && degenerateRegions && (
                    <div className="mx-4 mt-3 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-4 text-amber-600">
                      Warning: the extract API returned near-identical coordinates for all {degenerateRegions.count} answer
                      regions (e.g. x={degenerateRegions.x}, y={degenerateRegions.y}, w={degenerateRegions.w}, h={degenerateRegions.h}).
                      The boxes are drawn from these values, so they likely overlap. Check the extract log for raw bbox values.
                    </div>
                  )}
                  <AnswerSheetPanel
                    pages={slots["answer-sheet"].status === "ready" ? slots["answer-sheet"].pages : []}
                    overlays={overlays}
                    activeIds={activeQuestionId ? activeAnswerIds : null}
                    activePage={activePage}
                  />
                </div>
              </div>

              {hasGrading && grading.summary && (
                <div className="thin-scrollbar mt-4 flex-none overflow-y-auto rounded-xl border bg-card">
                  <GradeSummary summary={grading.summary} onReset={handleReset} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showDebugPanels && (
        <>
          {hasExtraction && (() => {
            const unmatched = mapped.filter((i) => i.status === "unmatched" && i.answer);
            if (unmatched.length === 0) return null;
            return (
              <div className="mt-5 rounded-xl border bg-card p-4">
                <h3 className="text-sm font-medium">
                  {unmatched.length} unmatched {unmatched.length === 1 ? "answer" : "answers"}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  These answer regions could not be matched to any question.
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

          <div className="mt-5 rounded-xl border bg-card">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setSavedOpen((v) => !v)}
                className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-accent/50"
              >
                <Database className="size-4 shrink-0 text-muted-foreground" />
                Saved API responses (IndexedDB)
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {savedResponses.length}
                </span>
              </button>
              {savedResponses.length > 0 && (
                <button
                  type="button"
                  onClick={refreshSavedResponses}
                  className="mr-3 shrink-0 rounded border px-2 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-accent"
                >
                  Refresh
                </button>
              )}
            </div>
            {savedOpen && (
              <div className="space-y-3 border-t px-4 py-3">
                {savedResponses.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No saved responses yet. Run Start Mapping once to store the raw
                    Sarvam response here, then reuse it without calling the API again.
                  </p>
                )}
                {savedResponses.map((record) => (
                  <div key={record.id} className="rounded-md border bg-secondary/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {new Date(record.savedAt).toLocaleString()} · {(record.rawBytes / 1024).toFixed(1)} KB
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          disabled={usingSaved !== null}
                          onClick={() => void handleUseSaved(record.id)}
                          className="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-background disabled:pointer-events-none disabled:opacity-40"
                        >
                          {usingSaved === record.id ? (
                            <LoaderCircle className="size-3 animate-spin" />
                          ) : (
                            <Sparkles className="size-3" />
                          )}
                          Use saved
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDownloadSaved(record.id)}
                          className="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-background"
                        >
                          <Download className="size-3" />
                          Export
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSaved(record.id)}
                          className="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-background hover:text-destructive"
                        >
                          <Trash2 className="size-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Question: {record.document.questionFileName ?? "—"} · Answer sheet:{" "}
                      {record.document.answerSheetFileName ?? "—"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 rounded-xl border bg-card">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-accent/50"
              >
                <ScrollText className="size-4 shrink-0 text-muted-foreground" />
                API & mapping logs (IndexedDB)
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {logs.length}
                </span>
              </button>
              {logs.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearLogs}
                  className="mr-3 shrink-0 rounded border px-2 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-accent"
                >
                  Clear
                </button>
              )}
            </div>
            {logsOpen && (
              <div className="space-y-3 border-t px-4 py-3">
                {logs.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No logs yet. Extract or grade to record API responses here.
                  </p>
                )}
                {[...logs].reverse().map((log, idx) => (
                  <div key={`${log.savedAt}-${idx}`} className="rounded-md border bg-secondary/40 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {log.kind}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(log.savedAt).toLocaleString()}
                      </span>
                    </div>
                    <details>
                      <summary className="mt-1 cursor-pointer text-[11px] text-muted-foreground">
                        View payload
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[10px] leading-4 text-muted-foreground">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
