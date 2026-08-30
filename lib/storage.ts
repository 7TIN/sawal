import type {
  DocumentId,
  GradingSummary,
  MappedItem,
  StoredDocument,
} from "./types";

const DATABASE_NAME = "veda-ai-storage";
const DOCUMENT_STORE = "documents";
const EXTRACTION_STORE = "extractions";
const LOG_STORE = "logs";
const RAW_STORE = "rawExtractions";
const GRADING_STORE = "gradingResults";
const PIPELINE_STORE = "pipelineProgress";
const PROJECT_STORE = "projects";
const DATABASE_VERSION = 5;

const scopedKey = (projectId: string, key: string) => `${projectId}::${key}`;

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(EXTRACTION_STORE)) {
        db.createObjectStore(EXTRACTION_STORE, { keyPath: "docId" });
      }
      if (!db.objectStoreNames.contains(LOG_STORE)) {
        db.createObjectStore(LOG_STORE, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(RAW_STORE)) {
        db.createObjectStore(RAW_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(GRADING_STORE)) {
        db.createObjectStore(GRADING_STORE, { keyPath: "cacheKey" });
      }
      if (!db.objectStoreNames.contains(PIPELINE_STORE)) {
        db.createObjectStore(PIPELINE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB could not be opened."));
  });

const requestAsPromise = <T>(request: IDBRequest<T>, errorMessage: string) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(errorMessage));
  });

const runWrite = async (
  storeName: string,
  mode: IDBTransactionMode,
  operate: (store: IDBObjectStore) => void,
  errorMessage: string,
) => {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    operate(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(errorMessage));
  });
  database.close();
};

export type Project = {
  id: string;
  createdAt: string;
  updatedAt: string;
  label?: string;
};

export function createProjectId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveProject(project: Project) {
  await runWrite(
    PROJECT_STORE,
    "readwrite",
    (store) => store.put(project),
    "Project could not be saved.",
  );
}

// Keep the project's "updatedAt" in sync (creating the record if missing) whenever
// its documents, extraction or grading change, so the hub shows a truthful timeline.
export async function touchProject(projectId: string) {
  const database = await openDatabase();
  const existing = (await requestAsPromise(
    database.transaction(PROJECT_STORE, "readonly")
      .objectStore(PROJECT_STORE)
      .get(projectId),
    "Project could not be read.",
  )) as Project | undefined;
  database.close();
  const now = new Date().toISOString();
  await saveProject({
    id: projectId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.label ? { label: existing.label } : {}),
  });
}

export async function getProjects(): Promise<Project[]> {
  const database = await openDatabase();
  const projects = await requestAsPromise(
    database.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).getAll(),
    "Projects could not be read.",
  );
  database.close();
  return ((projects as Project[]) ?? []).sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1,
  );
}

export async function getLatestProject(): Promise<Project | undefined> {
  const projects = await getProjects();
  return projects[0];
}

export async function deleteProject(projectId: string) {
  const keys = {
    documents: ["question-paper", "answer-sheet"].map((id) =>
      scopedKey(projectId, id),
    ),
    extractions: ["question-paper", "answer-sheet"].map((id) =>
      scopedKey(projectId, id),
    ),
  };
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [DOCUMENT_STORE, EXTRACTION_STORE, GRADING_STORE, PIPELINE_STORE, PROJECT_STORE],
      "readwrite",
    );
    const docStore = transaction.objectStore(DOCUMENT_STORE);
    keys.documents.forEach((key) => docStore.delete(key));
    const extractionStore = transaction.objectStore(EXTRACTION_STORE);
    keys.extractions.forEach((key) => extractionStore.delete(key));
    transaction.objectStore(GRADING_STORE).delete(projectId);
    transaction.objectStore(PIPELINE_STORE).delete(projectId);
    transaction.objectStore(PROJECT_STORE).delete(projectId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Project could not be deleted."));
  });
  database.close();
}

export async function saveDocument(projectId: string, document: StoredDocument) {
  await runWrite(
    DOCUMENT_STORE,
    "readwrite",
    (store) => store.put({ ...document, id: scopedKey(projectId, document.id) }),
    "Document could not be saved.",
  );
}

export async function getDocument(
  projectId: string,
  id: DocumentId,
): Promise<StoredDocument | undefined> {
  const database = await openDatabase();
  const document = await requestAsPromise(
    database.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE).get(scopedKey(projectId, id)),
    "Document could not be read.",
  );
  database.close();
  const stored = document as (StoredDocument & { id: string }) | undefined;
  if (!stored) return undefined;
  return { ...stored, id };
}

export async function deleteDocument(projectId: string, id: DocumentId) {
  await runWrite(
    DOCUMENT_STORE,
    "readwrite",
    (store) => store.delete(scopedKey(projectId, id)),
    "Document could not be deleted.",
  );
  await runWrite(
    EXTRACTION_STORE,
    "readwrite",
    (store) => store.delete(scopedKey(projectId, id)),
    "Extraction data could not be deleted.",
  );
}

// Lightweight metadata only — no page blobs — for listing projects on the hub.
export async function getDocumentInfo(
  projectId: string,
  id: DocumentId,
): Promise<{ fileName: string; createdAt: string } | undefined> {
  const stored = await getDocument(projectId, id);
  if (!stored) return undefined;
  return { fileName: stored.fileName, createdAt: stored.createdAt };
}

export async function saveExtraction(
  projectId: string,
  docId: DocumentId,
  payload: unknown,
) {
  await runWrite(
    EXTRACTION_STORE,
    "readwrite",
    (store) =>
      store.put({
        docId: scopedKey(projectId, docId),
        payload,
        savedAt: new Date().toISOString(),
      }),
    "Extraction data could not be saved.",
  );
}

export async function deleteExtraction(projectId: string, docId: DocumentId) {
  await runWrite(
    EXTRACTION_STORE,
    "readwrite",
    (store) => store.delete(scopedKey(projectId, docId)),
    "Extraction data could not be deleted.",
  );
}

export async function getExtraction<T>(
  projectId: string,
  docId: DocumentId,
): Promise<T | undefined> {
  const database = await openDatabase();
  const record = await requestAsPromise(
    database.transaction(EXTRACTION_STORE, "readonly").objectStore(EXTRACTION_STORE).get(scopedKey(projectId, docId)),
    "Extraction data could not be read.",
  );
  database.close();
  return record?.payload as T | undefined;
}

export type ApiLog = {
  kind: "extract" | "grade" | "mapping";
  savedAt: string;
  payload: unknown;
};

export async function saveLog(kind: ApiLog["kind"], payload: unknown) {
  await runWrite(
    LOG_STORE,
    "readwrite",
    (store) => store.put({ kind, payload, savedAt: new Date().toISOString() }),
    "Log could not be saved.",
  );
}

export async function clearLogs() {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(LOG_STORE, "readwrite");
    transaction.objectStore(LOG_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Logs could not be cleared."));
  });
  database.close();
}

export async function getAllLogs(): Promise<ApiLog[]> {
  const database = await openDatabase();
  const logs = await requestAsPromise(
    database.transaction(LOG_STORE, "readonly").objectStore(LOG_STORE).getAll(),
    "Logs could not be read.",
  );
  database.close();
  return (logs as ApiLog[]) ?? [];
}

export type RawExtractionRaw = {
  qpDigitise: string[];
  asExtract: unknown;
  asDigitise: string[];
};

export type RawExtractionRecord = {
  id: string;
  savedAt: string;
  document: { questionFileName?: string; answerSheetFileName?: string };
  raw: RawExtractionRaw;
};

export type RawExtractionSummary = Pick<RawExtractionRecord, "id" | "savedAt" | "document"> & {
  rawBytes: number;
};

const rawBytesOf = (raw: RawExtractionRaw) => {
  const approx = JSON.stringify(raw);
  return approx ? approx.length : 0;
};

export async function getRawExtractionSummaries(): Promise<RawExtractionSummary[]> {
  const database = await openDatabase();
  const records = await requestAsPromise(
    database.transaction(RAW_STORE, "readonly").objectStore(RAW_STORE).getAll(),
    "Saved responses could not be read.",
  );
  database.close();
  return ((records as RawExtractionRecord[]) ?? [])
    .map((r) => ({
      id: r.id,
      savedAt: r.savedAt,
      document: r.document,
      rawBytes: rawBytesOf(r.raw),
    }))
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export async function saveRawExtraction(record: RawExtractionRecord) {
  await runWrite(
    RAW_STORE,
    "readwrite",
    (store) => store.put(record),
    "Saved response could not be saved.",
  );
}

export async function getRawExtraction(id: string): Promise<RawExtractionRecord | undefined> {
  const database = await openDatabase();
  const record = await requestAsPromise(
    database.transaction(RAW_STORE, "readonly").objectStore(RAW_STORE).get(id),
    "Saved response could not be read.",
  );
  database.close();
  return record as RawExtractionRecord | undefined;
}

export async function deleteRawExtraction(id: string) {
  await runWrite(
    RAW_STORE,
    "readwrite",
    (store) => store.delete(id),
    "Saved response could not be deleted.",
  );
}

export type CachedGradingResult = {
  summary: GradingSummary;
  gradedItems: MappedItem[];
};

type CachedGradingRecord = CachedGradingResult & { savedAt: string };

export async function getCachedGrading(
  projectId: string,
): Promise<CachedGradingResult | undefined> {
  const database = await openDatabase();
  const record = await requestAsPromise(
    database.transaction(GRADING_STORE, "readonly").objectStore(GRADING_STORE).get(projectId),
    "Grading result could not be read.",
  );
  database.close();
  const result = record as CachedGradingRecord | undefined;
  if (!result) return undefined;
  return { summary: result.summary, gradedItems: result.gradedItems };
}

export async function saveCachedGrading(
  projectId: string,
  result: CachedGradingResult,
) {
  await runWrite(
    GRADING_STORE,
    "readwrite",
    (store) =>
      store.put({
        cacheKey: projectId,
        ...result,
        savedAt: new Date().toISOString(),
      }),
    "Grading result could not be saved.",
  );
}

export async function deleteCachedGrading(projectId: string) {
  await runWrite(
    GRADING_STORE,
    "readwrite",
    (store) => store.delete(projectId),
    "Grading result could not be deleted.",
  );
}

export type PipelineProgress = {
  version: number;
  extraction: "pending" | "working" | "done" | "failed";
  grading: "pending" | "working" | "done" | "failed";
  updatedAt: string;
  resultsSavedAt?: string;
};

export async function getPipelineProgress(
  projectId: string,
): Promise<PipelineProgress | undefined> {
  const database = await openDatabase();
  const record = await requestAsPromise(
    database.transaction(PIPELINE_STORE, "readonly").objectStore(PIPELINE_STORE).get(projectId),
    "Pipeline progress could not be read.",
  );
  database.close();
  return record as PipelineProgress | undefined;
}

export async function savePipelineProgress(
  projectId: string,
  progress: PipelineProgress,
) {
  await runWrite(
    PIPELINE_STORE,
    "readwrite",
    (store) => store.put({ id: projectId, ...progress }),
    "Pipeline progress could not be saved.",
  );
}

export async function clearPipelineProgress(projectId: string) {
  await runWrite(
    PIPELINE_STORE,
    "readwrite",
    (store) => store.delete(projectId),
    "Pipeline progress could not be cleared.",
  );
}