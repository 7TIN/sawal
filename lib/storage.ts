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
const DATABASE_VERSION = 4;

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

export async function saveDocument(document: StoredDocument) {
  await runWrite(
    DOCUMENT_STORE,
    "readwrite",
    (store) => store.put(document),
    "Document could not be saved.",
  );
}

export async function getDocument(
  id: DocumentId,
): Promise<StoredDocument | undefined> {
  const database = await openDatabase();
  const document = await requestAsPromise(
    database
      .transaction(DOCUMENT_STORE, "readonly")
      .objectStore(DOCUMENT_STORE)
      .get(id),
    "Document could not be read.",
  );
  database.close();
  return document as StoredDocument | undefined;
}

export async function deleteDocument(id: DocumentId) {
  await runWrite(
    DOCUMENT_STORE,
    "readwrite",
    (store) => store.delete(id),
    "Document could not be deleted.",
  );
  await runWrite(
    EXTRACTION_STORE,
    "readwrite",
    (store) => store.delete(id),
    "Extraction data could not be deleted.",
  );
}

export async function saveExtraction(docId: DocumentId, payload: unknown) {
  await runWrite(
    EXTRACTION_STORE,
    "readwrite",
    (store) => store.put({ docId, payload, savedAt: new Date().toISOString() }),
    "Extraction data could not be saved.",
  );
}

export async function deleteExtraction(docId: DocumentId) {
  await runWrite(
    EXTRACTION_STORE,
    "readwrite",
    (store) => store.delete(docId),
    "Extraction data could not be deleted.",
  );
}

export async function getExtraction<T>(
  docId: DocumentId,
): Promise<T | undefined> {
  const database = await openDatabase();
  const record = await requestAsPromise(
    database
      .transaction(EXTRACTION_STORE, "readonly")
      .objectStore(EXTRACTION_STORE)
      .get(docId),
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
    database
      .transaction(RAW_STORE, "readonly")
      .objectStore(RAW_STORE)
      .get(id),
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
  cacheKey: string,
): Promise<CachedGradingResult | undefined> {
  const database = await openDatabase();
  const record = await requestAsPromise(
    database
      .transaction(GRADING_STORE, "readonly")
      .objectStore(GRADING_STORE)
      .get(cacheKey),
    "Grading result could not be read.",
  );
  database.close();
  const result = record as CachedGradingRecord | undefined;
  if (!result) return undefined;
  return { summary: result.summary, gradedItems: result.gradedItems };
}

export async function saveCachedGrading(
  cacheKey: string,
  result: CachedGradingResult,
) {
  await runWrite(
    GRADING_STORE,
    "readwrite",
    (store) =>
      store.put({ cacheKey, ...result, savedAt: new Date().toISOString() }),
    "Grading result could not be saved.",
  );
}

export async function deleteCachedGrading(cacheKey: string) {
  await runWrite(
    GRADING_STORE,
    "readwrite",
    (store) => store.delete(cacheKey),
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

const PIPELINE_PROGRESS_ID = "current";

export async function getPipelineProgress(): Promise<PipelineProgress | undefined> {
  const database = await openDatabase();
  const record = await requestAsPromise(
    database
      .transaction(PIPELINE_STORE, "readonly")
      .objectStore(PIPELINE_STORE)
      .get(PIPELINE_PROGRESS_ID),
    "Pipeline progress could not be read.",
  );
  database.close();
  return record as PipelineProgress | undefined;
}

export async function savePipelineProgress(progress: PipelineProgress) {
  await runWrite(
    PIPELINE_STORE,
    "readwrite",
    (store) => store.put({ id: PIPELINE_PROGRESS_ID, ...progress }),
    "Pipeline progress could not be saved.",
  );
}

export async function clearPipelineProgress() {
  await runWrite(
    PIPELINE_STORE,
    "readwrite",
    (store) => store.delete(PIPELINE_PROGRESS_ID),
    "Pipeline progress could not be cleared.",
  );
}
