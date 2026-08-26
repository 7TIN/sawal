import type { ExtractionResult, ExtractedAnswer } from "./types";

export type ProviderName = "sarvam" | "gemini";

export type ExtractAdapter = (
  questionPaper: Blob,
  answerSheet: Blob,
  onProgress?: (stage: string) => void,
) => Promise<ExtractionResult>;

export async function extractWithProvider(
  provider: ProviderName,
  questionPaper: Blob,
  answerSheet: Blob,
  onProgress?: (stage: string) => void,
): Promise<ExtractionResult> {
  const adapters: Record<ProviderName, ExtractAdapter> = {
    sarvam: sarvamExtract,
    gemini: geminiExtract,
  };
  return adapters[provider](questionPaper, answerSheet, onProgress);
}

async function sarvamExtract(
  questionPaper: Blob,
  answerSheet: Blob,
  onProgress?: (stage: string) => void,
): Promise<ExtractionResult> {
  onProgress?.("Submitting to Sarvam DocAI...");
  const { SarvamAIClient } = await import("sarvamai");
  const client = new SarvamAIClient({
    apiSubscriptionKey: process.env.SARVAM_API_KEY,
  });

  const qpFile = new File([questionPaper], "question-paper.pdf", {
    type: questionPaper.type || "application/pdf",
  });
  const asFile = new File([answerSheet], "answer-sheet.pdf", {
    type: answerSheet.type || "application/pdf",
  });

  const questionSchema = JSON.stringify({
    type: "object",
    description: "Extraction schema for question paper",
    properties: {
      questions: {
        type: "array",
        description: "All questions in the paper",
        items: {
          type: "object",
          description: "A single question",
          properties: {
            number: { type: "string", description: "Question number" },
            text: { type: "string", description: "Question text" },
            page: { type: "number", description: "Page number" },
          },
        },
      },
    },
  });

  const answerSchema = JSON.stringify({
    type: "object",
    description: "Extraction schema for answer sheet",
    properties: {
      answers: {
        type: "array",
        description: "All answer regions on the sheet",
        items: {
          type: "object",
          description: "A single answer region",
          properties: {
            label: { type: "string", description: "Which question this answers" },
            text: { type: "string", description: "Answer text" },
            page: { type: "number", description: "Page number" },
            bbox_x: { type: "number", description: "Left edge 0 to 1" },
            bbox_y: { type: "number", description: "Top edge 0 to 1" },
            bbox_w: { type: "number", description: "Width 0 to 1" },
            bbox_h: { type: "number", description: "Height 0 to 1" },
          },
        },
      },
    },
  });

  console.log("[extract] questionSchema:", questionSchema);
  console.log("[extract] answerSchema:", answerSchema);

  const qpExtractReq = {
    file: [qpFile],
    language: "en-IN",
    output_format: "json" as const,
    schema: questionSchema,
  };
  const asExtractReq = {
    file: [asFile],
    language: "en-IN",
    output_format: "json" as const,
    schema: answerSchema,
  };

  console.log("[extract] QP request schema field:", qpExtractReq.schema);
  console.log("[extract] AS request schema field:", asExtractReq.schema);

  const [qpResult, asResult] = await Promise.all([
    client.docAi.extract(qpExtractReq),
    client.docAi.extract(asExtractReq),
  ]);

  const qpJobId = qpResult.job_id;
  const asJobId = asResult.job_id;
  onProgress?.("Waiting for extraction jobs...");

  await Promise.all([
    pollUntilDone(client, qpJobId),
    pollUntilDone(client, asJobId),
  ]);

  onProgress?.("Fetching results...");
  const [qpData, asData] = await Promise.all([
    fetchResults(client, qpJobId),
    fetchResults(client, asJobId),
  ]);

  const questions = parseQuestionsFromResult(qpData);
  const answersByPage = parseAnswersFromResult(asData);

  return { questions, answersByPage, provider: "sarvam" };
}

async function geminiExtract(
  questionPaper: Blob,
  answerSheet: Blob,
  onProgress?: (stage: string) => void,
): Promise<ExtractionResult> {
  onProgress?.("Preparing Gemini request...");
  const { GoogleGenAI } = await import("@google/genai");
  const genai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const [qpBase64, asBase64] = await Promise.all([
    blobToBase64(questionPaper),
    blobToBase64(answerSheet),
  ]);

  onProgress?.("Sending to Gemini Flash Lite...");
  const prompt = `You are an educational document analysis AI. I am sending you two documents:

1. A QUESTION PAPER (image 1)
2. A STUDENT ANSWER SHEET (image 2, handwritten)

For the QUESTION PAPER, extract every question with its number and text.
For the STUDENT ANSWER SHEET, find where each answer is located on the page.

Return ONLY a valid JSON object with this exact structure:
{
  "questions": [
    { "id": "q1", "number": "1", "text": "What is...", "page": 0 }
  ],
  "answersByPage": {
    "0": [
      {
        "id": "a1", "label": "Answer to Q1",
        "text": "student wrote...",
        "regions": [{ "page": 0, "bbox": {"x": 0.1, "y": 0.2, "w": 0.8, "h": 0.15} }]
      }
    ]
  }
}

bbox coordinates must be NORMALIZED 0-1 relative to page dimensions.
Page numbers are 0-indexed.
Match each answer to the corresponding question by number.
If an answer spans multiple pages, include multiple regions.
If you cannot find an answer for a question, omit it from answersByPage.
Do NOT include any markdown, only the raw JSON object.`;

  const response = await genai.models.generateContent({
    model: "gemini-2.0-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: questionPaper.type || "image/jpeg", data: qpBase64 } },
          { inlineData: { mimeType: answerSheet.type || "image/jpeg", data: asBase64 } },
          { text: prompt },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  });

  onProgress?.("Parsing Gemini response...");
  const text = response.text ?? "";
  const parsed = JSON.parse(text);

  const questions = (parsed.questions ?? []).map(
    (q: { id: string; number: string; text: string; page: number }) => ({
      id: q.id,
      number: q.number,
      text: q.text,
      page: q.page ?? 0,
    }),
  );

  const answersByPage: Record<number, ExtractedAnswer[]> = {};
  for (const [pageStr, answers] of Object.entries(parsed.answersByPage ?? {})) {
    answersByPage[Number(pageStr)] = (answers as Array<{
      id: string;
      label: string;
      text: string;
      regions: Array<{ page: number; bbox: { x: number; y: number; w: number; h: number } }>;
    }> ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      text: a.text,
      regions: (a.regions ?? []).map((r) => ({
        page: r.page ?? Number(pageStr),
        bbox: r.bbox,
      })),
    }));
  }

  return { questions, answersByPage, provider: "gemini" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pollUntilDone(client: any, jobId: string, maxAttempts = 60, intervalMs = 2000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await client.docAi.getStatus(jobId);
    if (status.status === "completed" || status.status === "partially_completed") return;
    if (["failed", "rejected"].includes(status.status)) {
      throw new Error(`Extraction job ${jobId} ${status.status}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Extraction job ${jobId} timed out`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchResults(client: any, jobId: string): Promise<unknown> {
  try {
    const results = await client.docAi.getResults(jobId);
    // Schema-based extract returns { result: { questions: [...] } or { answers: [...] } }
    if (results && typeof results === "object") {
      if ("result" in results && results.result && typeof results.result === "object") {
        return results.result;
      }
      // getResults might return the data directly
      return results;
    }
  } catch {
    // Fall through to ZIP download
  }

  const download = await client.docAi.getDownloadUrl(jobId);
  const response = await fetch(download.url, { headers: download.headers ?? {} });
  if (!response.ok) throw new Error(`Failed to download results: ${response.status}`);
  const zipBuffer = new Uint8Array(await response.arrayBuffer());

  const { unzipSync } = await import("fflate");
  const unzipped = unzipSync(zipBuffer);
  const pages: Record<number, unknown> = {};

  for (const [path, data] of Object.entries(unzipped)) {
    const match = path.match(/page_(\d+)\.json$/);
    if (match) {
      const pageNum = parseInt(match[1], 10);
      try {
        pages[pageNum] = JSON.parse(new TextDecoder().decode(data));
      } catch {
        // Skip malformed page JSON
      }
    }
  }

  return { _zipPages: pages };
}

function parseQuestionsFromResult(data: unknown) {
  const questions: Array<{ id: string; number: string; text: string; page: number }> = [];
  const seen = new Set<string>();

  if (!data || typeof data !== "object") return questions;
  const obj = data as Record<string, unknown>;

  // Schema-based response: { questions: [{ number, text }] }
  if (Array.isArray(obj.questions)) {
    for (const q of obj.questions) {
      if (!q || typeof q !== "object") continue;
      const qObj = q as Record<string, unknown>;
      const number = String(qObj.number ?? "").trim();
      const text = String(qObj.text ?? "").trim();
      const page = typeof qObj.page === "number" ? qObj.page : 0;
      if (number && text) {
        const normalized = number.toLowerCase().replace(/[.)\s]+/g, " ").trim();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          questions.push({ id: `q${questions.length + 1}`, number, text, page });
        }
      }
    }
    return questions.sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
  }

  // ZIP page-based fallback: { _zipPages: { 0: pageData, ... } }
  const pages = (obj._zipPages ?? obj) as Record<string, unknown>;
  for (const [pageStr, pageData] of Object.entries(pages)) {
    const pageNum = parseInt(pageStr, 10) || parseInt(pageStr.replace("page_", ""), 10) || 0;
    const blocks = extractBlocks(pageData);
    for (const block of blocks) {
      const qMatch = block.text.match(/^(\d+(?:[.)]\d*)?(?:\([a-zA-Z]\))?)\s*[.:\-]?\s*(.+)/);
      if (qMatch) {
        const number = qMatch[1].replace(/[.)]$/, "").trim();
        const normalized = number.toLowerCase().replace(/[.)\s]+/g, " ").trim();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          questions.push({ id: `q${questions.length + 1}`, number, text: qMatch[2].trim(), page: pageNum });
        }
      }
    }
  }

  return questions.sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
}

function parseAnswersFromResult(data: unknown) {
  const answersByPage: Record<number, ExtractedAnswer[]> = [];

  if (!data || typeof data !== "object") return answersByPage;
  const obj = data as Record<string, unknown>;

  // Schema-based response: { answers: [{ label, text, page, bbox_x, ... }] }
  if (Array.isArray(obj.answers)) {
    for (let i = 0; i < obj.answers.length; i++) {
      const a = obj.answers[i] as Record<string, unknown>;
      if (!a) continue;
      const label = String(a.label ?? `Answer ${i + 1}`);
      const text = String(a.text ?? "");
      const page = typeof a.page === "number" ? a.page : 0;
      const bbox = {
        x: toNum(a.bbox_x),
        y: toNum(a.bbox_y),
        w: toNum(a.bbox_w),
        h: toNum(a.bbox_h),
      };
      if (!answersByPage[page]) answersByPage[page] = [];
      answersByPage[page].push({
        id: `a${page}_${answersByPage[page].length}`,
        label,
        text,
        regions: [{ page, bbox }],
      });
    }
    return answersByPage;
  }

  // ZIP page-based fallback
  const pages = (obj._zipPages ?? obj) as Record<string, unknown>;
  for (const [pageStr, pageData] of Object.entries(pages)) {
    const pageNum = parseInt(pageStr, 10) || parseInt(pageStr.replace("page_", ""), 10) || 0;
    const blocks = extractBlocks(pageData);
    const answers: ExtractedAnswer[] = blocks
      .filter((b) => b.text.length > 10)
      .map((b, i) => ({
        id: `a${pageNum}_${i}`,
        label: b.text.slice(0, 40) + (b.text.length > 40 ? "\u2026" : ""),
        text: b.text,
        regions: [{ page: pageNum, bbox: normalizeBbox(b.bbox) }],
      }));
    if (answers.length > 0) answersByPage[pageNum] = answers;
  }

  return answersByPage;
}

function extractBlocks(pageData: unknown): Array<{
  text: string;
  bbox?: { x: number; y: number; w: number; h: number; [key: string]: unknown };
  tag?: string;
}> {
  if (!pageData || typeof pageData !== "object") return [];
  const obj = pageData as Record<string, unknown>;

  if (Array.isArray(obj.blocks)) return obj.blocks as Array<{ text: string; bbox?: { x: number; y: number; w: number; h: number }; tag?: string }>;
  if (Array.isArray(obj.elements)) return obj.elements as Array<{ text: string; bbox?: { x: number; y: number; w: number; h: number }; tag?: string }>;
  if (Array.isArray(obj.content)) return obj.content as Array<{ text: string; bbox?: { x: number; y: number; w: number; h: number }; tag?: string }>;
  if (Array.isArray(obj)) return obj as Array<{ text: string; bbox?: { x: number; y: number; w: number; h: number }; tag?: string }>;

  return [];
}

export function normalizeBbox(bbox: unknown): { x: number; y: number; w: number; h: number } {
  if (!bbox || typeof bbox !== "object") return { x: 0, y: 0, w: 1, h: 1 };
  const b = bbox as Record<string, unknown>;

  const x1 = toNum(b.x ?? b.left ?? b.x1 ?? b.minX ?? 0);
  const y1 = toNum(b.y ?? b.top ?? b.y1 ?? b.minY ?? 0);
  const x2 = toNum(b.x2 ?? b.right ?? b.maxX ?? x1);
  const y2 = toNum(b.y2 ?? b.bottom ?? b.maxY ?? y1);
  const w = toNum(b.w ?? b.width ?? x2 - x1);
  const h = toNum(b.h ?? b.height ?? y2 - y1);

  const maxVal = Math.max(x1, y1, w, h, x2, y2);
  if (maxVal > 1.01) {
    if (maxVal <= 100) {
      return { x: x1 / 100, y: y1 / 100, w: w / 100, h: h / 100 };
    }
    return {
      x: Math.min(x1 / 2480, 1),
      y: Math.min(y1 / 3508, 1),
      w: Math.min(w / 2480, 1),
      h: Math.min(h / 3508, 1),
    };
  }

  return { x: x1, y: y1, w: w || Math.max(x2 - x1, 0), h: h || Math.max(y2 - y1, 0) };
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return 0;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
