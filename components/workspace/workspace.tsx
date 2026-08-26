"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { parseFiles } from "@/lib/pdf";
import { deleteDocument, getDocument, saveDocument } from "@/lib/storage";
import {
  DOCUMENT_IDS,
  type DocumentId,
  type PageImage,
  type SlotState,
  type StoredDocument,
} from "@/lib/types";
import { UploadSlot } from "./upload-slot";

type State = Record<DocumentId, SlotState>;

type Action =
  | { type: "hydrate"; id: DocumentId; slot: SlotState }
  | { type: "progress"; id: DocumentId; fileName: string; done: number; total: number }
  | { type: "ready"; id: DocumentId; document: StoredDocument; pages: PageImage[] }
  | { type: "error"; id: DocumentId; fileName: string; message: string }
  | { type: "reset"; id: DocumentId };

const initialState: State = {
  "question-paper": { status: "empty" },
  "answer-sheet": { status: "empty" },
};

const SLOT_META: Record<
  DocumentId,
  { title: string; description: string }
> = {
  "question-paper": {
    title: "Question paper",
    description:
      "The printed exam paper. Questions are extracted in original order, including labelled sub-parts.",
  },
  "answer-sheet": {
    title: "Student answer sheet",
    description:
      "One handwritten submission. Answers are located on the page so you can jump to them from any question.",
  },
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return { ...state, [action.id]: action.slot };
    case "ready":
      return {
        ...state,
        [action.id]: {
          status: "ready",
          document: action.document,
          pages: action.pages,
        },
      };
    case "progress":
      return {
        ...state,
        [action.id]: {
          status: "parsing",
          fileName: action.fileName,
          done: action.done,
          total: action.total,
        },
      };
    case "error":
      return {
        ...state,
        [action.id]: {
          status: "error",
          fileName: action.fileName,
          message: action.message,
        },
      };
    case "reset":
      return { ...state, [action.id]: { status: "empty" } };
  }
}

export function Workspace() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const urlsRef = useRef<Record<DocumentId, string[]>>({
    "question-paper": [],
    "answer-sheet": [],
  });

  const revokeUrls = useCallback((id: DocumentId) => {
    for (const url of urlsRef.current[id]) URL.revokeObjectURL(url);
    urlsRef.current[id] = [];
  }, []);

  const buildPageImages = useCallback(
    async (
      id: DocumentId,
      pages: { blob: Blob; width?: number; height?: number }[],
    ): Promise<PageImage[]> => {
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
          return {
            index,
            url: urlsRef.current[id][index],
            width,
            height,
          };
        }),
      );
    },
    [revokeUrls],
  );

  useEffect(() => {
    let cancelled = false;
    const hydrate = async (id: DocumentId) => {
      try {
        const stored = await getDocument(id);
        if (!stored || cancelled || stored.pages.length === 0) return;
        const pages = await buildPageImages(
          id,
          stored.pages.map((blob) => ({ blob })),
        );
        if (cancelled) return;
        dispatch({
          type: "hydrate",
          id,
          slot: { status: "ready", document: stored, pages },
        });
      } catch {
        // Storage unavailable (e.g. private mode); start empty.
      }
    };
    DOCUMENT_IDS.forEach(hydrate);
    return () => {
      cancelled = true;
    };
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
      const fileName =
        files.length === 1
          ? files[0].name
          : `${files.length} images`;
      dispatch({ type: "progress", id, fileName, done: 0, total: 0 });

      try {
        const pages = await parseFiles(files, (done, total) =>
          dispatch({ type: "progress", id, fileName, done, total }),
        );
        const stored: StoredDocument = {
          id,
          fileName,
          mimeType: files[0].type,
          pages: pages.map((page) => page.blob),
          createdAt: new Date().toISOString(),
        };
        try {
          await saveDocument(stored);
        } catch {
          // Persistence is best-effort; keep the session usable without it.
        }
        const pageImages = await buildPageImages(id, pages);
        dispatch({ type: "ready", id, document: stored, pages: pageImages });
      } catch (error) {
        dispatch({
          type: "error",
          id,
          fileName,
          message:
            error instanceof Error
              ? error.message
              : "Something went wrong while reading the file.",
        });
      }
    },
    [buildPageImages],
  );

  const handleRemove = useCallback(
    (id: DocumentId) => {
      revokeUrls(id);
      deleteDocument(id).catch(() => undefined);
      dispatch({ type: "reset", id });
    },
    [revokeUrls],
  );

  const readyCount = DOCUMENT_IDS.filter(
    (id) => state[id].status === "ready",
  ).length;

  return (
    <div className="mt-8">
      <div className="grid gap-5 lg:grid-cols-2">
        {DOCUMENT_IDS.map((id) => (
          <UploadSlot
            key={id}
            id={id}
            title={SLOT_META[id].title}
            description={SLOT_META[id].description}
            state={state[id]}
            onSelect={(files) => void handleSelect(id, files)}
            onRemove={() => handleRemove(id)}
          />
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4">
        <p className="text-sm text-muted-foreground">
          {readyCount === DOCUMENT_IDS.length
            ? "Both documents are processed locally. Ready to extract."
            : `Upload both documents to continue — ${readyCount}/${DOCUMENT_IDS.length} added.`}
        </p>
        <button
          type="button"
          disabled={readyCount !== DOCUMENT_IDS.length}
          className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
        >
          Extract questions & answers
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
