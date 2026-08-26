import type { DocumentId, StoredDocument } from "./types";

const DATABASE_NAME = "veda-ai-storage";
const DOCUMENT_STORE = "documents";
const EXTRACTION_STORE = "extractions";
const DATABASE_VERSION = 1;

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
