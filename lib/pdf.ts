import type { RenderedPage } from "./types";

const RENDER_SCALE = 2;
const MAX_DIMENSION = 2400;
const JPEG_QUALITY = 0.85;

const UPLOAD_BUDGET_BYTES = 1.9 * 1024 * 1024;
const UPLOAD_LEVELS: Array<{ maxDimension: number; quality: number }> = [
  { maxDimension: 2400, quality: 0.85 },
  { maxDimension: 1800, quality: 0.82 },
  { maxDimension: 1400, quality: 0.78 },
  { maxDimension: 1100, quality: 0.75 },
];

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Page could not be encoded to an image.")),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });

async function parsePdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<RenderedPage[]> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;
  onProgress?.(0, pdf.numPages);

  const pages: RenderedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        RENDER_SCALE,
        MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height),
      );
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      await page.render({ canvas, viewport }).promise;
      pages.push({
        blob: await canvasToBlob(canvas),
        width: canvas.width,
        height: canvas.height,
      });

      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      onProgress?.(pageNumber, pdf.numPages);
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

type CompactPage = { data: Uint8Array; width: number; height: number };

async function encodeCompactPage(
  blob: Blob,
  level: { maxDimension: number; quality: number },
): Promise<CompactPage> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const scale = Math.min(1, level.maxDimension / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Page could not be prepared for upload.");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const outWidth = canvas.width;
  const outHeight = canvas.height;
  const blobOut = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", level.quality),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blobOut) throw new Error("Page could not be encoded for upload.");
  return { data: new Uint8Array(await blobOut.arrayBuffer()), width: outWidth, height: outHeight };
}

/**
 * Compresses a stored set of page images into a single compact file for upload,
 * keeping the total payload safely under serverless body limits. One page becomes
 * a JPEG; several pages are repackaged into one lightweight PDF.
 */
export async function compressForUpload(
  fileName: string,
  pages: Blob[],
): Promise<File> {
  for (const level of UPLOAD_LEVELS) {
    const encoded: CompactPage[] = [];
    for (const page of pages) {
      encoded.push(await encodeCompactPage(page, level));
    }

    const makeFile = async (): Promise<File> => {
      if (encoded.length === 1) {
        const single = encoded[0];
        return new File([single.data.slice()], fileName.replace(/\.[^.]+$/, "") + ".jpg", {
          type: "image/jpeg",
        });
      }
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      for (const img of encoded) {
        const image = await doc.embedJpg(img.data);
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(image, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const bytes = await doc.save();
      return new File([bytes.slice()], fileName.replace(/\.[^.]+$/, "") + ".pdf", {
        type: "application/pdf",
      });
    };

    const file = await makeFile();
    if (file.size <= UPLOAD_BUDGET_BYTES) return file;
  }

  const encoded: CompactPage[] = [];
  const fallback = UPLOAD_LEVELS[UPLOAD_LEVELS.length - 1];
  for (const page of pages) {
    encoded.push(await encodeCompactPage(page, fallback));
  }
  if (encoded.length === 1) {
    return new File(
      [encoded[0].data.slice()],
      fileName.replace(/\.[^.]+$/, "") + ".jpg",
      { type: "image/jpeg" },
    );
  }
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (const img of encoded) {
    const image = await doc.embedJpg(img.data);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(image, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const bytes = await doc.save();
  return new File([bytes.slice()], fileName.replace(/\.[^.]+$/, "") + ".pdf", {
    type: "application/pdf",
  });
}

export async function parseFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<RenderedPage[]> {
  if (files.length === 0) {
    throw new Error("No file selected.");
  }

  const pdfFiles = files.filter((file) => file.type === "application/pdf");
  if (pdfFiles.length > 1) {
    throw new Error("Upload a single PDF, or a set of images.");
  }
  if (pdfFiles.length === 1) {
    if (files.length > 1) {
      throw new Error("Mixing a PDF with images is not supported.");
    }
    return parsePdf(pdfFiles[0], onProgress);
  }

  if (!files.every(isImageFile)) {
    throw new Error("Unsupported file type. Upload a PDF or images.");
  }

  const pages: RenderedPage[] = [];
  for (const [index, file] of files.entries()) {
    const bitmap = await createImageBitmap(file);
    pages.push({ blob: file, width: bitmap.width, height: bitmap.height });
    bitmap.close();
    onProgress?.(index + 1, files.length);
  }
  return pages;
}
