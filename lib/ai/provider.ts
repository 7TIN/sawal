import type { ExtractionResult, ExtractedAnswer } from "./types";
import type { AnswerSheetLine, AnswerSheetLayout, BBox } from "./types";
import { extractMaxMarks, parseQuestionTextFromPages } from "./parser";

export type ProviderName = "sarvam" | "gemini";

export type ExtractAdapter = (
  questionPaper: Blob,
  answerSheet: Blob,
  questionFileName: string,
  answerFileName: string,
  onProgress?: (stage: string) => void,
) => Promise<ExtractionResult>;

export async function extractWithProvider(
  provider: ProviderName,
  questionPaper: Blob,
  answerSheet: Blob,
  questionFileName: string,
  answerFileName: string,
  onProgress?: (stage: string) => void,
): Promise<ExtractionResult> {
  const adapters: Record<ProviderName, ExtractAdapter> = {
    sarvam: sarvamExtract,
    gemini: geminiExtract,
  };
  return adapters[provider](questionPaper, answerSheet, questionFileName, answerFileName, onProgress);
}

async function sarvamExtract(
  questionPaper: Blob,
  answerSheet: Blob,
  questionFileName: string,
  answerFileName: string,
  onProgress?: (stage: string) => void,
): Promise<ExtractionResult> {
  const { SarvamAIClient } = await import("sarvamai");
  const client = new SarvamAIClient({
    apiSubscriptionKey: process.env.SARVAM_API_KEY,
  });

  const qpFile = new File([questionPaper], questionFileName || "question-paper.pdf", {
    type: questionPaper.type || "application/pdf",
  });
  const asFile = new File([answerSheet], answerFileName || "answer-sheet.pdf", {
    type: answerSheet.type || "application/pdf",
  });

  onProgress?.("Digitising question paper...");
  const qpDigitiseResult = await client.docAi.digitise({
    file: [qpFile],
    language: "en-IN",
    output_format: "md",
  });

  onProgress?.("Extracting answer regions...");
  const answerSchema = JSON.stringify({
    type: "object",
    description: "Answer regions extracted from handwritten answer sheet",
    properties: {
      answers: {
        type: "array",
        description: "All answer regions found on the sheet",
        items: {
          type: "object",
          description: "A single answer block with its region",
          properties: {
            label: { type: "string", description: "Which question this answers, e.g. 1, 2a, Q3" },
            text: { type: "string", description: "The handwritten answer text transcribed" },
            page: { type: "number", description: "Page number where the answer is found, 0-indexed" },
            bbox_x: { type: "number", description: "Left edge of answer region normalized 0 to 1" },
            bbox_y: { type: "number", description: "Top edge of answer region normalized 0 to 1" },
            bbox_w: { type: "number", description: "Width of answer region normalized 0 to 1" },
            bbox_h: { type: "number", description: "Height of answer region normalized 0 to 1" },
          },
        },
      },
    },
  });

  const asExtractResult = await client.docAi.extract({
    file: [asFile],
    language: "en-IN",
    output_format: "json",
    schema: answerSchema,
  });

  onProgress?.("Digitising answer sheet for region coordinates...");
  const asDigitiseResult = await client.docAi.digitise({
    file: [asFile],
    language: "en-IN",
    output_format: "md",
  });

  onProgress?.("Waiting for jobs to complete...");
  await Promise.all([
    pollUntilDone(client, qpDigitiseResult.job_id),
    pollUntilDone(client, asExtractResult.job_id),
    pollUntilDone(client, asDigitiseResult.job_id),
  ]);

  onProgress?.("Fetching question paper text...");
  const qpContent = await fetchDigitiseContent(client, qpDigitiseResult.job_id);

  onProgress?.("Fetching answer sheet regions...");
  const asData = await fetchExtractResults(client, asExtractResult.job_id);
  const asDigitiseContent = await fetchDigitiseContent(client, asDigitiseResult.job_id);

  const result = await combineExtractionFromRaw({
    qpDigitise: qpContent,
    asExtract: asData,
    asDigitise: asDigitiseContent,
  });

  console.log(
    `[extract] digitised ${qpContent.length} question-paper page(s)` +
      (qpContent[0] ? ` (first page: "${qpContent[0].slice(0, 160).replace(/\n/g, " ")}")` : ""),
  );
  console.log(
    `[extract] parsed ${result.questions.length} question(s), ` +
      `${Object.keys(result.answersByPage).length} page(s) with answers, ` +
      `${result.rawData ? result.rawData.asDigitise.length : 0} answer-sheet page(s) with coordinate blocks`,
  );

  return result;
}

export async function combineExtractionFromRaw(raw: {
  qpDigitise: string[];
  asExtract: unknown;
  asDigitise: string[];
}): Promise<ExtractionResult> {
  const { questions, qpTexts } = buildQuestionsFromDigitise(raw.qpDigitise);
  const answers = answersFromRaw(raw.asExtract, raw.asDigitise);

  console.log(
    `[extract] offline combine: parsed ${questions.length} question(s), ` +
      `${Object.keys(answers.answersByPage).length} page(s) with answers`,
  );

  return {
    questions,
    answersByPage: answers.answersByPage,
    provider: "sarvam",
    rawQuestionText: qpTexts.join("\n\n"),
    ...(answers.answerLayout.length > 0 ? { answerLayout: answers.answerLayout } : {}),
    rawData: raw,
  };
}

function buildQuestionsFromDigitise(qpDigitise: string[]) {
  const qpTexts = (qpDigitise ?? []).map(reconstructDigitisePage);
  const pages = qpTexts.map((content, i) => ({ pageNumber: i, content }));
  const parsed = parseQuestionTextFromPages(pages);
  const questions = parsed.map((q, i) => {
    const maxMarks = q.maxMarks ?? extractMaxMarks(q.text);
    return {
      id: `q${i + 1}`,
      number: q.number,
      text: q.text,
      page: q.page,
      isSub: q.isSub,
      ...(q.parentNumber ? { parentNumber: q.parentNumber } : {}),
      ...(q.options && q.options.length > 0 ? { options: q.options } : {}),
      ...(maxMarks ? { maxMarks } : {}),
    };
  });
  return { questions, qpTexts };
}

function answersFromRaw(asExtract: unknown, asDigitise: string[]) {
  const answersByPage = parseAnswerResults(asExtract, asDigitise.length);

  const answerBlocksByPage: Record<number, DigitisePage> = {};
  const parsedDigitisePages: Array<{ pageIndex: number; page: DigitisePage }> = [];
  (asDigitise ?? []).forEach((content, pageIndex) => {
    const parsed = parseDigitiseBlocks(content);
    if (parsed) parsedDigitisePages.push({ pageIndex, page: parsed });
  });
  const digitiseIndexes = parsedDigitisePages.map(({ pageIndex }) => pageIndex);
  const digitisePageOffset = digitiseIndexes.length > 0 &&
    !digitiseIndexes.includes(0) && Math.min(...digitiseIndexes) === 1
    ? -1
    : 0;
  for (const { pageIndex, page } of parsedDigitisePages) {
    answerBlocksByPage[pageIndex + digitisePageOffset] = page;
  }
  if (digitisePageOffset !== 0) {
    console.log(`[extract] normalized digitise page indexes by ${digitisePageOffset}`);
  }
  let answerLayout: AnswerSheetLayout[] = [];
  if (Object.keys(answerBlocksByPage).length > 0) {
    const assigned = assignAnswerRegionsFromBlocks(answersByPage, answerBlocksByPage);
    answerLayout = assigned.layout;
    logAnswerSheetLayout(answerLayout);
  }

  return { answersByPage, answerLayout };
}

async function geminiExtract(
  questionPaper: Blob,
  answerSheet: Blob,
  questionFileName: string,
  answerFileName: string,
  onProgress?: (stage: string) => void,
): Promise<ExtractionResult> {
  const { GoogleGenAI } = await import("@google/genai");
  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const [qpBase64, asBase64] = await Promise.all([
    blobToBase64(questionPaper),
    blobToBase64(answerSheet),
  ]);

  onProgress?.("Sending to Gemini for analysis...");
  const prompt = `You are an expert educational document analyst. I am sending you two images:

IMAGE 1: A QUESTION PAPER (printed text)
IMAGE 2: A STUDENT ANSWER SHEET (handwritten responses)

Your task:
1. From the QUESTION PAPER, extract EVERY question. Preserve the original numbering exactly as printed.
2. From the ANSWER SHEET, find every answer region. For each answer, provide its bounding box.

IMPORTANT RULES FOR QUESTION DETECTION:
- Questions can be numbered as: 1. 2. 3. OR Q1 Q2 Q3 OR Question 1 OR (1) OR a) b) c)
- Sub-questions exist: after main question 1. you might see a. b. c. or (i) (ii) (iii) or 1(a) 1(b) 1(c)
- If questions are lettered (a. b. c.) then sub-questions might be a(1) a(2) a(3)
- Include ALL questions, even if they seem simple or have no answer on the sheet
- A question that spans multiple lines: combine all lines into the text field
- Preserve the question number EXACTLY as printed (e.g., "1(a)" not "1a", "Q2" not "2")

IMPORTANT RULES FOR ANSWER DETECTION:
- Find every handwritten answer on the answer sheet
- Match each answer to its corresponding question number
- The bbox coordinates MUST be normalized 0-1 relative to page dimensions
- bbox_x = left edge, bbox_y = top edge, bbox_w = width, bbox_h = height
- If an answer spans a large region, use the bounding box that covers all of it
- An answer might start with the question number (e.g., "1. The answer is...") - extract the full answer text
- If you cannot determine which question an answer belongs to, use label "unknown"

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "questions": [
    {
      "number": "1",
      "text": "Full question text here",
      "page": 0,
      "maxMarks": 2
    },
    {
      "number": "1(a)",
      "text": "Sub-question text",
      "page": 0,
      "maxMarks": 1
    }
  ],
  "answersByPage": {
    "0": [
      {
        "id": "a1",
        "label": "1",
        "text": "Student answer text",
        "regions": [
          { "page": 0, "bbox": {"x": 0.05, "y": 0.1, "w": 0.9, "h": 0.15} }
        ]
      }
    ]
  }
}

HOW TO FILL IN "maxMarks" (read marks EXACTLY as printed — never guess, estimate, or invent):
- If the marks are printed next to the question itself — "(2 Marks)", "1 Mark", "[5]", "Marks: 5" — use that exact number.
- If questions are grouped into sections with one mark printed once in the section header — e.g. "Part I: Multiple Choice Questions (1 Mark Each)", "Section B (3 Marks Each)", "(4 x 5 = 20)" — then EVERY question in that section gets that same printed number.
- If the marks appear in a column or table — e.g. "| Q.No | Question | Max Marks |" with a value in each row — use the value from that row's column.
- If a question's mark is genuinely not printed anywhere, OMIT "maxMarks" for it. Do not infer a mark from the answer length, the section's question count, or a neighbouring question.`;

  const response = await genai.models.generateContent({
    model: "gemini-3.5-flash-lite",
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
    (q: { id?: string; number: string; text?: string; page?: number; maxMarks?: number }) => {
      const readMarks = Number(q.maxMarks);
      const marks = Number.isFinite(readMarks) && readMarks > 0
        ? readMarks
        : extractMaxMarks(q.text ?? "");
      return {
        id: q.id || `q${q.number}`,
        number: String(q.number),
        text: q.text || "",
        page: q.page ?? 0,
        isSub: /\([a-z0-9]+\)|^[a-z]\)?\.|^[a-z]\(/.test(String(q.number)),
        parentNumber: extractParentNumber(String(q.number)),
        ...(marks ? { maxMarks: marks } : {}),
      };
    },
  );

  const answersByPage: Record<number, ExtractedAnswer[]> = {};
  for (const [pageStr, answers] of Object.entries(parsed.answersByPage ?? {})) {
    answersByPage[Number(pageStr)] = (answers as Array<{
      id: string;
      label: string;
      text: string;
      regions: Array<{ page: number; bbox: { x: number; y: number; w: number; h: number } }>;
    }> ?? []).map((a, i) => ({
      id: a.id || `a${i}`,
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

function extractParentNumber(number: string): string | null {
  const m = number.match(/^(\d+)/);
  return m ? m[1] : null;
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
async function fetchDigitiseContent(client: any, jobId: string): Promise<string[]> {
  try {
    const results = await client.docAi.getResults(jobId);
    const content = extractPagesContent(results as Record<string, unknown>);
    if (content.length > 0) return content;
  } catch {
    // Fall through
  }

  try {
    const download = await client.docAi.getDownloadUrl(jobId);
    const response = await fetch(download.url, { headers: download.headers ?? {} });
    const zipBuffer = new Uint8Array(await response.arrayBuffer());
    const { unzipSync } = await import("fflate");
    const unzipped = unzipSync(zipBuffer);
    const pages: Array<{ index: number; text: string }> = [];
    for (const [path, data] of Object.entries(unzipped)) {
      if (!/\.(?:md|html|txt|json)$/i.test(path)) continue;
      const match = path.match(/(\d+)/);
      if (!match) continue;
      const content = new TextDecoder().decode(data);
      if (content.trim().length === 0) continue;
      pages.push({ index: parseInt(match[1], 10), text: content });
    }
    pages.sort((a, b) => a.index - b.index);
    return pages.map((p) => p.text);
  } catch {
    return [];
  }
}

function extractPagesContent(results: Record<string, unknown>): string[] {
  if (!results || typeof results !== "object") return [];

  const docs = (results.documents ??
    (results.result as Record<string, unknown> | undefined)?.documents ??
    results.result ??
    results.pages) as unknown;

  const pages = Array.isArray(docs)
    ? docs
    : (docs as Record<string, unknown> | undefined)?.pages;

  if (!Array.isArray(pages)) return [];

  return pages
    .flatMap((p) => {
      const content = (p as Record<string, unknown> | undefined)?.content;
      return typeof content === "string" && content.trim() ? content : [];
    })
    .filter(Boolean);
}

type PageBlock = { text: string; x: number; y: number };

function reconstructDigitisePage(content: string): string {
  const trimmed = content.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return content;

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return content;
  }

  const blocks: PageBlock[] = [];
  collectPageBlocks(data, blocks);
  if (blocks.length === 0) return content;

  blocks.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return blocks.map((b) => b.text).filter(Boolean).join("\n");
}

function collectPageBlocks(data: unknown, out: PageBlock[]): void {
  if (data === null || typeof data !== "object") return;

  if (Array.isArray(data)) {
    for (const item of data) collectPageBlocks(item, out);
    return;
  }

  const obj = data as Record<string, unknown>;

  for (const key of ["blocks", "pages", "elements", "layouts", "lines", "regions", "children", "words", "tokens"]) {
    if (Array.isArray(obj[key])) {
      for (const item of obj[key] as unknown[]) collectPageBlocks(item, out);
      return;
    }
  }

  if (Array.isArray(obj.content)) {
    for (const item of obj.content as unknown[]) collectPageBlocks(item, out);
    return;
  }

  const rawText = obj.text ?? obj.content ?? obj.line_text;
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (text.length > 0) {
    const coords = (obj.coordinates ?? obj.bbox ?? {}) as Record<string, unknown>;
    out.push({
      text,
      x: toNum(coords.x1 ?? coords.x ?? coords.left),
      y: toNum(coords.y1 ?? coords.y ?? coords.top),
    });
    return;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") collectPageBlocks(value, out);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchExtractResults(client: any, jobId: string): Promise<unknown> {
  try {
    const results = await client.docAi.getResults(jobId);
    if (results && typeof results === "object") {
      return results;
    }
  } catch {
    // Fall through
  }

  const download = await client.docAi.getDownloadUrl(jobId);
  const response = await fetch(download.url, { headers: download.headers ?? {} });
  const zipBuffer = new Uint8Array(await response.arrayBuffer());
  const { unzipSync } = await import("fflate");
  const unzipped = unzipSync(zipBuffer);
  const pages: Record<number, unknown> = {};
  for (const [path, data] of Object.entries(unzipped)) {
    const match = path.match(/page_(\d+)\.json$/);
    if (match) {
      pages[parseInt(match[1], 10)] = JSON.parse(new TextDecoder().decode(data));
    }
  }
  return { _zipPages: pages };
}

function parseAnswerResults(data: unknown, pageCount = 0): Record<number, ExtractedAnswer[]> {
  const answersByPage: Record<number, ExtractedAnswer[]> = {};
  if (!data || typeof data !== "object") return answersByPage;
  const obj = data as Record<string, unknown>;
  const inner = (obj.result && typeof obj.result === "object" ? (obj.result as Record<string, unknown>) : obj) as Record<string, unknown>;

  if (Array.isArray(inner.answers)) {
    const pageW = toNum(inner.image_width) || null;
    const pageH = toNum(inner.image_height) || null;
    const rawPages = inner.answers
      .map((answer) => {
        if (!answer || typeof answer !== "object") return null;
        const rawPage = (answer as Record<string, unknown>).page;
        return rawPage == null ? null : toNum(rawPage);
      })
      .filter((page): page is number => page != null);
    const oneBasedPages = pageCount > 0 && rawPages.length > 0 &&
      !rawPages.includes(0) && rawPages.every((page) => page >= 1 && page <= pageCount);
    if (inner.answers.length > 0) {
      console.log(
        `[extract] raw first answer bbox: ${JSON.stringify(inner.answers[0] as Record<string, unknown>)}` +
          (pageW || pageH ? ` | page ${pageW}x${pageH}px` : " | no page dims"),
      );
    }
    for (let i = 0; i < inner.answers.length; i++) {
      const a = inner.answers[i] as Record<string, unknown>;
      if (!a) continue;
      const label = String(a.label ?? `Answer ${i + 1}`);
      const text = String(a.text ?? "");
      const rawPage = toNum(a.page);
      const page = oneBasedPages ? Math.max(rawPage - 1, 0) : rawPage;
      const bbox = normalizeBboxWithPage(a, pageW, pageH);
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

  const pages = (inner._zipPages ?? inner) as Record<string, unknown>;
  for (const [pageStr, pageData] of Object.entries(pages)) {
    const rawPageNum = parseInt(pageStr, 10) || parseInt(pageStr.replace("page_", ""), 10) || 0;
    const pageNum = pageCount > 0 && rawPageNum >= 1 && rawPageNum <= pageCount
      ? rawPageNum - 1
      : rawPageNum;
    const blocks = extractBlocks(pageData);
    const answers: ExtractedAnswer[] = blocks
      .filter((b) => b.text.length > 5)
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

function normalizeBboxWithPage(
  b: Record<string, unknown>,
  pageW: number | null,
  pageH: number | null,
): { x: number; y: number; w: number; h: number } {
  const x1 = toNum(b.x ?? b.x1 ?? b.left ?? b.minX ?? b.bbox_x);
  const y1 = toNum(b.y ?? b.y1 ?? b.top ?? b.minY ?? b.bbox_y);
  const rawW = toNum(b.w ?? b.width ?? b.bbox_w);
  const rawH = toNum(b.h ?? b.height ?? b.bbox_h);
  const x2 = toNum(b.x2 ?? b.right ?? b.maxX ?? b.bbox_x2);
  const y2 = toNum(b.y2 ?? b.bottom ?? b.maxY ?? b.bbox_y2);

  const w = rawW || Math.max(x2 - x1, 0);
  const h = rawH || Math.max(y2 - y1, 0);

  if (pageW && pageH) {
    return { x: clamp(x1 / pageW), y: clamp(y1 / pageH), w: clamp(w / pageW), h: clamp(h / pageH) };
  }

  const maxVal = Math.max(x1, y1, w, h, x2, y2);
  if (maxVal === 0) return { x: 0, y: 0, w: 0, h: 0 };
  if (maxVal <= 1.01) return { x: clamp(x1), y: clamp(y1), w: clamp(w), h: clamp(h) };
  if (maxVal <= 100) {
    return { x: clamp(x1 / 100), y: clamp(y1 / 100), w: clamp(w / 100), h: clamp(h / 100) };
  }
  return { x: clamp(x1 / 2550), y: clamp(y1 / 3300), w: clamp(w / 2550), h: clamp(h / 3300) };
}

type DigitiseBlock = { text: string; x1: number; y1: number; x2: number; y2: number };

type DigitisePage = { pageW: number; pageH: number; normalized: boolean; blocks: DigitiseBlock[] };

function parseDigitiseBlocks(content: string): DigitisePage | null {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!trimmed || !/^[\[{]/.test(trimmed)) return null;

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const blocks: DigitiseBlock[] = [];
  const pageDims = { w: 0, h: 0 };
  walkDigitise(data, blocks, pageDims);
  if (blocks.length === 0) return null;

  // Some DocAI responses omit page dimensions. Derive a common basis once for the
  // page; using each block's own bottom/right edge makes every block fill the page.
  if (pageDims.w <= 0) pageDims.w = Math.max(...blocks.map((block) => block.x2), 1);
  if (pageDims.h <= 0) pageDims.h = Math.max(...blocks.map((block) => block.y2), 1);
  const maxCoordinate = Math.max(
    ...blocks.flatMap((block) => [Math.abs(block.x1), Math.abs(block.y1), Math.abs(block.x2), Math.abs(block.y2)]),
  );
  return { pageW: pageDims.w, pageH: pageDims.h, normalized: maxCoordinate <= 1.01, blocks };
}

function walkDigitise(data: unknown, out: DigitiseBlock[], pageDims: { w: number; h: number }): void {
  if (data === null || typeof data !== "object") return;

  if (Array.isArray(data)) {
    for (const item of data) walkDigitise(item, out, pageDims);
    return;
  }

  const obj = data as Record<string, unknown>;

  const imageWidth = firstNumber(obj.image_width, obj.imageWidth, obj.page_width, obj.pageWidth);
  const imageHeight = firstNumber(obj.image_height, obj.imageHeight, obj.page_height, obj.pageHeight);
  if (imageWidth != null && imageHeight != null) {
    pageDims.w = imageWidth;
    pageDims.h = imageHeight;
  }

  const text = readDigitiseText(obj);
  const rect = readDigitiseRect(obj);
  if (text && rect) {
    const splitBlocks = splitStructuredDigitiseBlock(text, rect);
    if (splitBlocks) out.push(...splitBlocks);
    else out.push({ text, ...rect });
    // Layout containers can carry aggregate text/bbox values as well as child
    // blocks. Keep walking so the child answer boxes remain available.
    const hasNestedBlocks = ["blocks", "layouts", "lines", "regions", "elements", "children", "words", "tokens"]
      .some((key) => Array.isArray(obj[key]));
    if (!hasNestedBlocks) return;
  }

  for (const value of Object.values(obj)) walkDigitise(value, out, pageDims);
}

function splitStructuredDigitiseBlock(
  text: string,
  rect: { x1: number; y1: number; x2: number; y2: number },
): DigitiseBlock[] | null {
  const htmlRows = Array.from(text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((match, slot) => ({ text: decodeDigitiseMarkup(match[1]), slot }))
    .filter((row) => row.text.length > 0);
  if (htmlRows.length > 1) {
    const firstMarker = htmlRows.findIndex((row) => isQuestionNumberText(row.text));
    const markerCount = htmlRows.filter((row) => isQuestionNumberText(row.text)).length;
    const rows = firstMarker > 0 && markerCount > 1 ? htmlRows.slice(firstMarker) : htmlRows;
    // Sarvam's page-level HTML table bbox includes a leading blank table row on
    // the answer sheet. Reserve that slot when the first row is already Q1;
    // otherwise every generated box is exactly one answer above its handwriting.
    const leadingSlot = firstMarker === 0 ? 1 : 0;
    const shiftedRows = leadingSlot > 0
      ? rows.map((row) => ({ ...row, slot: row.slot + leadingSlot }))
      : rows;
    return splitTextIntoRows(shiftedRows, rect, htmlRows.length + leadingSlot);
  }

  const markdownRows = text
    .split(/\r?\n/)
    .map((row, slot) => ({ text: row.trim(), slot }))
    .filter((row) => row.text.startsWith("|") && row.text.endsWith("|"))
    .filter((row) => !/^\|?\s*:?-{2,}/.test(row.text.replace(/\|/g, "")))
    .map((row) => ({ ...row, text: decodeDigitiseMarkup(row.text) }))
    .filter((row) => row.text.length > 0);
  if (markdownRows.length > 1) return splitTextIntoRows(markdownRows, rect, text.split(/\r?\n/).length);

  const lines = text.split(/\r?\n/).map((line) => decodeDigitiseMarkup(line)).filter(Boolean);
  const markerIndexes = lines
    .map((line, index) => (isQuestionNumberText(line) ? index : -1))
    .filter((index) => index >= 0);
  if (markerIndexes.length > 1) {
    const rows = markerIndexes.map((start, index) => ({
      text: lines.slice(start, markerIndexes[index + 1] ?? lines.length).join(" "),
      slot: index,
    }));
    return splitTextIntoRows(rows, rect, rows.length);
  }
  return null;
}

function splitTextIntoRows(
  rows: Array<{ text: string; slot: number }>,
  rect: { x1: number; y1: number; x2: number; y2: number },
  slotCount: number,
): DigitiseBlock[] {
  const rowHeight = (rect.y2 - rect.y1) / Math.max(slotCount, 1);
  return rows.map((row) => ({
    text: row.text,
    x1: rect.x1,
    y1: rect.y1 + rowHeight * row.slot,
    x2: rect.x2,
    y2: row.slot >= slotCount - 1 ? rect.y2 : rect.y1 + rowHeight * (row.slot + 1),
  }));
}

function decodeDigitiseMarkup(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readDigitiseText(obj: Record<string, unknown>): string {
  for (const key of ["text", "line_text", "content", "value", "transcription"]) {
    if (typeof obj[key] === "string" && obj[key].trim()) return obj[key].trim();
  }
  for (const key of ["text", "content", "value", "transcription"]) {
    if (obj[key] && typeof obj[key] === "object") {
      const nestedText = readDigitiseText(obj[key] as Record<string, unknown>);
      if (nestedText) return nestedText;
    }
  }
  return "";
}

function readDigitiseRect(obj: Record<string, unknown>):
  | { x1: number; y1: number; x2: number; y2: number }
  | null {
  const candidates: unknown[] = [
    obj,
    obj.coordinates,
    obj.bbox,
    obj.bounding_box,
    obj.boundingBox,
    obj.box,
    obj.rect,
    obj.geometry,
    obj.coordinate,
    obj.boundingRect,
    obj.layout,
  ];

  for (const candidate of candidates) {
    const rect = rectFromCoordinateValue(candidate);
    if (rect) return rect;
  }
  return null;
}

function rectFromCoordinateValue(value: unknown):
  | { x1: number; y1: number; x2: number; y2: number }
  | null {
  if (Array.isArray(value)) {
    const numbers = value.flatMap((item) => {
      const number = firstNumber(item);
      return number == null ? [] : [number];
    });
    if (numbers.length >= 4) {
      // A four-number array is treated as x1,y1,x2,y2. Longer arrays are commonly
      // polygon points, so calculate their enclosing rectangle below when possible.
      if (numbers.length === 4) {
        return { x1: numbers[0], y1: numbers[1], x2: numbers[2], y2: numbers[3] };
      }

      if (numbers.length % 2 === 0) {
        const points = [];
        for (let i = 0; i < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
        return {
          x1: Math.min(...points.map((point) => point.x)),
          y1: Math.min(...points.map((point) => point.y)),
          x2: Math.max(...points.map((point) => point.x)),
          y2: Math.max(...points.map((point) => point.y)),
        };
      }
    }

    const points = value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const point = item as Record<string, unknown>;
      const x = firstNumber(point.x, point.left, Array.isArray(item) ? item[0] : undefined);
      const y = firstNumber(point.y, point.top, Array.isArray(item) ? item[1] : undefined);
      return x != null && y != null ? [{ x, y }] : [];
    });
    if (points.length > 1) {
      return {
        x1: Math.min(...points.map((point) => point.x)),
        y1: Math.min(...points.map((point) => point.y)),
        x2: Math.max(...points.map((point) => point.x)),
        y2: Math.max(...points.map((point) => point.y)),
      };
    }
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const nested = obj.points ?? obj.polygon ?? obj.vertices;
  if (nested) {
    const polygonRect = rectFromCoordinateValue(nested);
    if (polygonRect) return polygonRect;
  }

  const x1 = firstNumber(obj.x1, obj.x, obj.left, obj.minX);
  const y1 = firstNumber(obj.y1, obj.y, obj.top, obj.minY);
  const x2 = firstNumber(obj.x2, obj.right, obj.maxX);
  const y2 = firstNumber(obj.y2, obj.bottom, obj.maxY);
  const width = firstNumber(obj.w, obj.width);
  const height = firstNumber(obj.h, obj.height);

  if (x1 == null || y1 == null || (x2 == null && width == null) || (y2 == null && height == null)) {
    return null;
  }

  return {
    x1,
    y1,
    x2: x2 ?? x1 + (width ?? 0),
    y2: y2 ?? y1 + (height ?? 0),
  };
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function normalizeDigitiseBlock(
  block: DigitiseBlock,
  pageW: number,
  pageH: number,
  normalized: boolean,
): { x: number; y: number; w: number; h: number } {
  const isNormalized = normalized || (pageW <= 1.01 && pageH <= 1.01);
  const basisW = isNormalized ? 1 : Math.max(pageW, 1);
  const basisH = isNormalized ? 1 : Math.max(pageH, 1);

  let x = clamp(block.x1 / basisW);
  let y = clamp(block.y1 / basisH);
  let x2 = clamp(block.x2 / basisW);
  let y2 = clamp(block.y2 / basisH);

  if (x2 < x) [x, x2] = [x2, x];
  if (y2 < y) [y, y2] = [y2, y];
  return { x, y, w: x2 - x, h: y2 - y };
}

function unionNormalizedRects(
  rects: Array<{ x: number; y: number; w: number; h: number }>,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = 0.012;
  minX = Math.max(minX - pad, 0);
  minY = Math.max(minY - pad, 0);
  maxX = Math.min(maxX + pad, 1);
  maxY = Math.min(maxY + pad, 1);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Merge digitise blocks into PAGE LINES in reading order. Blocks that vertically overlap are
// part of the same line (e.g. printed question number + answer text + handwritten mark).
function buildPageLines(meta: DigitisePage): AnswerSheetLine[] {
  const spans = meta.blocks
    .map((block) => ({
      block,
      rect: normalizeDigitiseBlock(block, meta.pageW, meta.pageH, meta.normalized),
    }))
    .sort((a, b) => a.block.y1 - b.block.y1 || a.block.x1 - b.block.x1);

  const lines: AnswerSheetLine[] = [];
  for (const { block, rect } of spans) {
    const last = lines[lines.length - 1];
    const verticalGap = rect.y - (last?.bbox.y ?? 0) - (last?.bbox.h ?? 0);
    const overlapsVertically = last != null &&
      rect.y < last.bbox.y + last.bbox.h && rect.y + rect.h > last.bbox.y;
    const closeSameLine = last != null && verticalGap > 0 && verticalGap <= 0.006 &&
      last.bbox.h <= 0.08 && rect.h <= 0.08;
    if (last && (overlapsVertically || closeSameLine)) {
      const minX = Math.min(last.bbox.x, rect.x);
      const minY = Math.min(last.bbox.y, rect.y);
      const maxX = Math.max(last.bbox.x + last.bbox.w, rect.x + rect.w);
      const maxY = Math.max(last.bbox.y + last.bbox.h, rect.y + rect.h);
      last.bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      last.text = `${last.text} ${block.text}`.trim();
    } else {
      lines.push({ text: block.text, bbox: { ...rect } });
    }
  }
  return lines;
}

const HEADER_LINE = /^(name|roll|class|branch|exam|examination|subject|date|duration|marks|section|part|semester|instruction|page|answer)\b/i;
const PAGE_COUNTER_LINE = /^(?:page\s*)?\d{1,3}\s*(?:\/|\\|\bof\b)\s*\d{1,3}$/i;

function extractQuestionMarker(text: string): string | null {
  const normalized = text.trim().replace(/[ＱＱ]/g, "Q");
  const match = normalized.match(
    /^(?:(?:question|ques|answer|q)\s*(?:(?:no|number)\s*)?\.?\s*)?(?:\(\s*(\d{1,3})\s*\)|(\d{1,3}))(?:\s*(?:\(\s*([a-z])\s*\)|([a-z])(?:\s*[.)])?))?/i,
  );
  if (!match || PAGE_COUNTER_LINE.test(normalized)) return null;
  return `${match[1] ?? match[2]}${(match[3] ?? match[4] ?? "").toLowerCase()}`;
}

function isQuestionNumberText(text: string): boolean {
  return extractQuestionMarker(text) != null;
}

// A page line that starts a new answer region: a question-number line near the page's
// left text margin. Real sheets often use Q1, (1), 1(a), or place the number farther
// right than 16% of the page, so the margin is relative to the detected page content.
function isQuestionStartLine(line: AnswerSheetLine, leftMargin = 0): boolean {
  const text = line.text.trim();
  if (!isQuestionNumberText(text)) return false;
  return line.bbox.x <= Math.max(0.3, leftMargin + 0.18);
}

function isPageFurnitureLine(line: AnswerSheetLine): boolean {
  const text = line.text.trim();
  return PAGE_COUNTER_LINE.test(text) || (/^\d{1,3}$/.test(text) && line.bbox.y > 0.9);
}

function answerTextTokens(text: string): string[] {
  return Array.from(new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2)));
}

function scoreAnswerText(answerText: string, candidateText: string): number {
  const expected = answerTextTokens(answerText);
  if (expected.length === 0) return 0;
  const normalizedCandidate = candidateText.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedExpected = answerText.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalizedExpected && normalizedCandidate.includes(normalizedExpected)) return 1;

  const candidate = new Set(answerTextTokens(candidateText));
  const overlap = expected.filter((token) =>
    Array.from(candidate).some((candidateToken) => similarOcrToken(token, candidateToken)),
  ).length;
  return overlap / expected.length;
}

function similarOcrToken(expected: string, candidate: string): boolean {
  if (expected === candidate) return true;
  if (expected.length < 4 || candidate.length < 4) return false;
  const maxDistance = Math.max(1, Math.floor(Math.min(expected.length, candidate.length) * 0.2));
  if (Math.abs(expected.length - candidate.length) > maxDistance) return false;

  let previous = Array.from({ length: candidate.length + 1 }, (_, i) => i);
  for (let i = 0; i < expected.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < candidate.length; j++) {
      current.push(
        expected[i] === candidate[j]
          ? previous[j]
          : 1 + Math.min(previous[j], previous[j + 1], current[j]),
      );
    }
    previous = current;
  }
  return previous[candidate.length] <= maxDistance;
}

function markerMatchesAnswer(lineText: string, answerKey: string): boolean {
  const lineKey = extractQuestionMarker(lineText);
  if (!lineKey) return false;
  if (lineKey === answerKey) return true;
  // OCR often merges an answer option into the marker (for example, "1D)").
  // Only allow the numeric fallback for a main question, never for a sub-question.
  return /^\d+$/.test(answerKey) && lineKey.match(/^\d+/)?.[0] === answerKey;
}

function regionFromAnchor(
  lines: AnswerSheetLine[],
  anchorIndex: number,
  leftMargin: number,
  maxHeight = 0.3,
): BBox {
  const anchor = lines[anchorIndex];
  const selected = [anchor];
  const maxGap = 0.07;
  for (let i = anchorIndex + 1; i < lines.length; i++) {
    const previous = lines[i - 1];
    const line = lines[i];
    if (isQuestionStartLine(line, leftMargin)) break;

    const gap = line.bbox.y - (previous.bbox.y + previous.bbox.h);
    const height = line.bbox.y + line.bbox.h - anchor.bbox.y;
    if (gap > maxGap || height > maxHeight) break;
    selected.push(line);
  }

  return unionNormalizedRects(selected.map((line) => line.bbox));
}

function usableAnswerRegion(bbox: BBox, allowLarge = false): boolean {
  return (
    Number.isFinite(bbox.x) &&
    Number.isFinite(bbox.y) &&
    Number.isFinite(bbox.w) &&
    Number.isFinite(bbox.h) &&
    bbox.w > 0 &&
    bbox.h > 0 &&
    (allowLarge ? bbox.h <= 0.5 && bbox.w * bbox.h <= 0.5 : bbox.h <= 0.55 && bbox.w * bbox.h <= 0.5) &&
    !(bbox.w >= 0.96 && bbox.h >= 0.48) &&
    bbox.w < 0.98 &&
    bbox.h < 0.98
  );
}

function isLongAnswer(answer: ExtractedAnswer): boolean {
  return answerTextTokens(answer.text).length >= 10;
}

function capLongAnswerRegion(bbox: BBox): BBox {
  if (bbox.h <= 0.5) return bbox;
  return { ...bbox, h: Math.min(0.5, 1 - bbox.y) };
}

function availableLongAnswerRegion(
  bbox: BBox,
  usedRegions: Array<{ page: number; bbox: BBox }>,
  page: number,
): BBox | null {
  let candidates = [bbox];
  for (const used of usedRegions) {
    if (used.page !== page || !regionsOverlap(used.bbox, bbox)) continue;
    const next: BBox[] = [];
    for (const candidate of candidates) {
      if (!regionsOverlap(used.bbox, candidate)) {
        next.push(candidate);
        continue;
      }
      const candidateBottom = candidate.y + candidate.h;
      const usedBottom = used.bbox.y + used.bbox.h;
      if (used.bbox.y > candidate.y + 0.02) {
        next.push({ ...candidate, h: used.bbox.y - candidate.y });
      }
      if (usedBottom < candidateBottom - 0.02) {
        next.push({
          ...candidate,
          y: usedBottom,
          h: candidateBottom - usedBottom,
        });
      }
    }
    candidates = next;
  }

  const best = candidates.sort((first, second) => second.h - first.h)[0];
  if (!best || best.h < 0.08) return null;
  return capLongAnswerRegion(best);
}

function regionsOverlap(first: BBox, second: BBox): boolean {
  const overlapWidth = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
  const overlapHeight = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(first.w * first.h, second.w * second.h);
  return smallerArea > 0 && overlapArea / smallerArea >= 0.65;
}

function candidateLineRegion(
  answer: ExtractedAnswer,
  lines: AnswerSheetLine[],
  startIndex: number,
  leftMargin: number,
): { pageIndex: number; bbox: BBox; rawBbox: BBox; score: number } | null {
  const selected: AnswerSheetLine[] = [];
  const maxHeight = isLongAnswer(answer) ? 0.95 : 0.3;
  const maxGap = 0.07;

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (index > startIndex) {
      const previous = lines[index - 1];
      if (isQuestionStartLine(line, leftMargin)) break;
      const gap = line.bbox.y - (previous.bbox.y + previous.bbox.h);
      const height = line.bbox.y + line.bbox.h - lines[startIndex].bbox.y;
      if (gap > maxGap || height > maxHeight) break;
    }
    selected.push(line);
  }

  if (selected.length === 0) return null;
  const rawBbox = unionNormalizedRects(selected.map((line) => line.bbox));
  const score = scoreAnswerText(answer.text, selected.map((line) => line.text).join(" "));
  const bbox = isLongAnswer(answer) ? capLongAnswerRegion(rawBbox) : rawBbox;
  if (!usableAnswerRegion(bbox, isLongAnswer(answer) && score >= 0.5)) return null;
  return { pageIndex: startIndex, bbox, rawBbox, score };
}

function normalizedDigitiseBlockBBox(block: DigitiseBlock, meta: DigitisePage): BBox {
  return normalizeDigitiseBlock(block, meta.pageW, meta.pageH, meta.normalized);
}

// The schema extract API returns bbox_* = null (no coordinates at all), while digitise returns
// precise per-block coordinates. Match those two APIs by question marker/text first; never
// assign a region merely because it happens to have the same array position as an answer.
function assignAnswerRegionsFromBlocks(
  answersByPage: Record<number, ExtractedAnswer[]>,
  blocksByPage: Record<number, DigitisePage>,
): { layout: AnswerSheetLayout[] } {
  const allAnswers = Object.values(answersByPage).flat();
  const layout: AnswerSheetLayout[] = [];
  const pages: Array<{ page: number; lines: AnswerSheetLine[]; leftMargin: number; meta: DigitisePage }> = [];

  const pagesSorted = Object.entries(blocksByPage)
    .filter(([, meta]) => meta.blocks.length > 0)
    .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));

  for (const [pageStr, meta] of pagesSorted) {
    const page = parseInt(pageStr, 10) || 0;
    const rawLines = buildPageLines(meta);
    const lines = rawLines.filter(
      (line) =>
        line.text.trim().length > 0 &&
        line.bbox.w > 0 &&
        line.bbox.h > 0 &&
        !isPageFurnitureLine(line) &&
        (!HEADER_LINE.test(line.text) || isQuestionNumberText(line.text)),
    );
    if (lines.length === 0) {
      if (rawLines.length > 0) layout.push({ page, lines: rawLines });
      continue;
    }

    layout.push({ page, lines });
    pages.push({ page, lines, leftMargin: Math.min(...lines.map((line) => line.bbox.x)), meta });
  }

  const assigned = new Map<string, { page: number; bbox: BBox }>();
  const usedAnchors = new Set<string>();
  const usedRegions: Array<{ page: number; bbox: BBox }> = [];
  let markerMatches = 0;
  let blockTextMatches = 0;
  let lineTextMatches = 0;

  // First use the extracted answer label (1, Q1, 1(a), ...) to find the same marker
  // in the digitised answer sheet. This prevents page headers and footer counters from
  // being assigned to a question merely because they occur at the same array index.
  for (const answer of allAnswers) {
    const answerKey = extractQuestionMarker(answer.label) ?? extractQuestionMarker(answer.text);
    const allowLarge = isLongAnswer(answer);
    if (!answerKey) continue;

    for (const page of pages) {
      const anchorIndex = page.lines.findIndex((line, index) => {
        if (
          usedAnchors.has(`${page.page}:${index}`) ||
          !isQuestionStartLine(line, page.leftMargin) ||
          !markerMatchesAnswer(line.text, answerKey)
        ) return false;
        const rawBbox = regionFromAnchor(page.lines, index, page.leftMargin, allowLarge ? 0.5 : 0.3);
        const bbox = allowLarge ? capLongAnswerRegion(rawBbox) : rawBbox;
        return usableAnswerRegion(bbox, allowLarge);
      });
      if (anchorIndex < 0) continue;

      const rawBbox = regionFromAnchor(page.lines, anchorIndex, page.leftMargin, allowLarge ? 0.5 : 0.3);
      const bbox = allowLarge ? capLongAnswerRegion(rawBbox) : rawBbox;
      if (!usableAnswerRegion(bbox, allowLarge)) continue;
      if (usedRegions.some((region) => region.page === page.page && regionsOverlap(region.bbox, bbox))) continue;
      usedAnchors.add(`${page.page}:${anchorIndex}`);
      assigned.set(answer.id, { page: page.page, bbox });
      usedRegions.push({ page: page.page, bbox });
      markerMatches++;
      break;
    }
  }

  // Multiple-choice answers are often emitted as individual digitise blocks without
  // a question-number block. Match the extracted answer text directly to that block
  // before attempting any spatial clustering.
  for (const answer of allAnswers) {
    if (assigned.has(answer.id)) continue;
    let best: { page: number; blockKey: string; score: number; bbox: BBox } | null = null;
    for (const page of pages) {
      for (let index = 0; index < page.meta.blocks.length; index++) {
        const block = page.meta.blocks[index];
        const blockKey = `${page.page}:block:${index}`;
        const longAnswer = isLongAnswer(answer);
        if (usedAnchors.has(blockKey) && !longAnswer) continue;
        const score = scoreAnswerText(answer.text, block.text);
        const allowLarge = longAnswer && score >= 0.5;
        const rawBbox = normalizedDigitiseBlockBBox(block, page.meta);
        let bbox = allowLarge ? capLongAnswerRegion(rawBbox) : rawBbox;
        if (allowLarge && usedRegions.some((region) => region.page === page.page && regionsOverlap(region.bbox, rawBbox))) {
          const available = availableLongAnswerRegion(rawBbox, usedRegions, page.page);
          if (!available) continue;
          bbox = available;
        }
        if (!usableAnswerRegion(bbox, allowLarge)) continue;
        if (!allowLarge && usedRegions.some((region) => region.page === page.page && regionsOverlap(region.bbox, bbox))) continue;
        const area = bbox.w * bbox.h;
        const bestArea = best ? best.bbox.w * best.bbox.h : Number.POSITIVE_INFINITY;
        if (!best || score > best.score || (score === best.score && area < bestArea)) {
          best = { page: page.page, blockKey, score, bbox };
        }
      }
    }
    const minimumScore = isLongAnswer(answer) ? 0.5 : 0.6;
    if (best && best.score >= minimumScore && usableAnswerRegion(best.bbox, isLongAnswer(answer))) {
      usedAnchors.add(best.blockKey);
      assigned.set(answer.id, { page: best.page, bbox: best.bbox });
      usedRegions.push({ page: best.page, bbox: best.bbox });
      blockTextMatches++;
    }
  }

  // If the question marker was missed, match the answer transcription against the
  // digitise OCR. This handles sheets where the number is written in a separate block.
  for (const answer of allAnswers) {
    if (assigned.has(answer.id)) continue;
    let best: { page: number; index: number; score: number; bbox: BBox } | null = null;
    for (const page of pages) {
      for (let index = 0; index < page.lines.length; index++) {
        if (usedAnchors.has(`${page.page}:${index}`)) continue;
        const candidate = candidateLineRegion(answer, page.lines, index, page.leftMargin);
        if (!candidate) continue;
        let candidateBbox = candidate.bbox;
        if (isLongAnswer(answer)) {
          const available = availableLongAnswerRegion(candidate.rawBbox, usedRegions, page.page);
          if (!available) continue;
          candidateBbox = available;
        } else if (usedRegions.some((region) => region.page === page.page && regionsOverlap(region.bbox, candidateBbox))) {
          continue;
        }
        const bestArea = best ? best.bbox.w * best.bbox.h : Number.POSITIVE_INFINITY;
        const candidateArea = candidateBbox.w * candidateBbox.h;
        if (!best || candidate.score > best.score || (candidate.score === best.score && candidateArea < bestArea)) {
          best = {
            page: page.page,
            index: candidate.pageIndex,
            score: candidate.score,
            bbox: candidateBbox,
          };
        }
      }
    }
    if (best && best.score >= (isLongAnswer(answer) ? 0.5 : 0.45) &&
      usableAnswerRegion(best.bbox, isLongAnswer(answer))) {
      usedAnchors.add(`${best.page}:${best.index}`);
      assigned.set(answer.id, { page: best.page, bbox: best.bbox });
      usedRegions.push({ page: best.page, bbox: best.bbox });
      lineTextMatches++;
    }
  }

  for (const answer of allAnswers) {
    const region = assigned.get(answer.id);
    if (region) answer.regions = [region];
  }

  const unmatched = allAnswers.filter((answer) => !assigned.has(answer.id));

  const regrouped: Record<number, ExtractedAnswer[]> = {};
  for (const answer of allAnswers) {
    const page = answer.regions[0]?.page ?? 0;
    (regrouped[page] ??= []).push(answer);
  }
  for (const key of Object.keys(answersByPage)) delete answersByPage[Number(key)];
  Object.assign(answersByPage, regrouped);

  console.log(
    `[extract] located ${assigned.size}/${allAnswers.length} answers using digitise coordinates ` +
      `(markers: ${markerMatches}, blocks: ${blockTextMatches}, lines: ${lineTextMatches}, ${pagesSorted.length} pages)` +
      (unmatched.length > 0 ? ` | unmatched: ${unmatched.map((a) => a.label).join(", ")}` : ""),
  );

  return { layout };
}

function logAnswerSheetLayout(layout: AnswerSheetLayout[]): void {
  for (const page of layout) {
    const leftMargin = Math.min(...page.lines.map((line) => line.bbox.x));
    const rows = page.lines
      .map(
        (line, i) =>
          `[${i}]${isQuestionStartLine(line, leftMargin) ? ">" : " "} x${line.bbox.x.toFixed(2)} y${line.bbox.y.toFixed(2)} w${line.bbox.w.toFixed(2)} h${line.bbox.h.toFixed(2)} "${line.text.slice(0, 60)}"`,
      )
      .join("\n      ");
    console.log(
      `[extract] answer-sheet page ${page.page} (${page.lines.length} lines, ">" marks question starts):\n      ${rows}`,
    );
  }
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

function normalizeBbox(bbox: unknown): { x: number; y: number; w: number; h: number } {
  if (!bbox || typeof bbox !== "object") return { x: 0, y: 0, w: 0, h: 0 };
  const b = bbox as Record<string, unknown>;
  const hasCoordinates = ["x", "y", "w", "h", "left", "top", "right", "bottom", "x1", "y1", "x2", "y2"]
    .some((key) => b[key] != null);
  if (!hasCoordinates) return { x: 0, y: 0, w: 0, h: 0 };
  const x1 = toNum(b.x ?? b.left ?? b.x1 ?? b.minX ?? 0);
  const y1 = toNum(b.y ?? b.top ?? b.y1 ?? b.minY ?? 0);
  const x2 = toNum(b.x2 ?? b.right ?? b.maxX ?? x1);
  const y2 = toNum(b.y2 ?? b.bottom ?? b.maxY ?? y1);
  const w = toNum(b.w ?? b.width ?? x2 - x1);
  const h = toNum(b.h ?? b.height ?? y2 - y1);
  const maxVal = Math.max(x1, y1, w, h, x2, y2);
  if (maxVal > 1.01) {
    if (maxVal <= 100) {
      return { x: clamp(x1 / 100), y: clamp(y1 / 100), w: clamp(w / 100), h: clamp(h / 100) };
    }
    return { x: clamp(x1 / 2480), y: clamp(y1 / 3508), w: clamp(w / 2480), h: clamp(h / 3508) };
  }
  return { x: clamp(x1), y: clamp(y1), w: clamp(w || Math.max(x2 - x1, 0)), h: clamp(h || Math.max(y2 - y1, 0)) };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
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
