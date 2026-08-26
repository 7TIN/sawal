import type { RenderedPage } from "./types";

const RENDER_SCALE = 2;
const MAX_DIMENSION = 2400;
const JPEG_QUALITY = 0.85;

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
