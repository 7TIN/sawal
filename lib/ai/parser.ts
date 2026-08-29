type ParsedQuestion = {
  number: string;
  text: string;
  page: number;
  isSub: boolean;
  parentNumber: string | null;
  options?: string[];
};

const MAIN_PATTERNS: Array<{ regex: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  { regex: /^Q(?:uestion)?[\s.:]*([\d]+(?:[.\s][\d]+)*)\b/i, extract: (m) => m[1].trim() },
  { regex: /^([\d]+(?:\.\d+)*)\s*[.\):\-]\s*/, extract: (m) => m[1].replace(/\.$/, "").trim() },
  { regex: /^\(([\d]+(?:\.\d+)*)\)\s*/, extract: (m) => m[1].trim() },
  { regex: /^([\d]+)\s*\)\s*/, extract: (m) => m[1].trim() },
  { regex: /^([\d]+)\s*[:\-]\s*/, extract: (m) => m[1].trim() },
];

const SUB_LETTER_PATTERNS: Array<{ regex: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  { regex: /^\(?([a-z])\)?[.\):\-]\s*/i, extract: (m) => m[1].toLowerCase() },
  { regex: /^\(?([ivx]+)\)?[.\):\-]\s*/i, extract: (m) => m[1].toLowerCase() },
];

const SUB_NUMBERED_PATTERNS: Array<{ regex: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  { regex: /^\(?(\d+)\)?[.\):\-]\s*/, extract: (m) => m[1] },
];

function isLikelyQuestionStart(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 2) return false;
  if (/^(?:figure|fig|table|image|diagram|note|hint|answer|solution|direction|instruction)/i.test(trimmed)) return false;
  if (/^\d+\s*$/.test(trimmed)) return false;
  if (trimmed.length > 500) return false;
  return true;
}

function extractMainNumber(line: string): string | null {
  for (const p of MAIN_PATTERNS) {
    const m = line.match(p.regex);
    if (m) return p.extract(m);
  }
  return null;
}

function extractSubNumber(line: string): { number: string; kind: "letter" | "roman" | "numbered" } | null {
  for (const p of SUB_LETTER_PATTERNS) {
    const m = line.match(p.regex);
    if (m) {
      const num = p.extract(m);
      const kind = /^[ivx]+$/.test(num) ? "roman" : "letter";
      return { number: num, kind };
    }
  }
  for (const p of SUB_NUMBERED_PATTERNS) {
    const m = line.match(p.regex);
    if (m) return { number: p.extract(m), kind: "numbered" };
  }
  return null;
}

function getQuestionText(line: string, number: string | null): string {
  if (!number) return line.trim();
  let text = line;
  const patterns = [
    new RegExp(`^Q(?:uestion)?[\\s.:]*${escapeRegex(number)}\\s*[.\\):\\-]?\\s*`, "i"),
    new RegExp(`^${escapeRegex(number)}\\s*[.\\):\\-]\\s*`),
    new RegExp(`^\\(${escapeRegex(number)}\\)\\s*`),
    new RegExp(`^${escapeRegex(number)}\\s*\\)\\s*`),
    new RegExp(`^${escapeRegex(number)}\\s*[:\\-]\\s*`),
  ];
  for (const p of patterns) {
    text = text.replace(p, "");
  }
  return text.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\s+/g, "*")
    .replace(/\*/g, "")
    .replace(/^[-•·]\s+/, "")
    .replace(/^`+(.*?)`+$/, "$1")
    .trim();
}

function isMcqOptionLine(line: string, allowLowercase = false): boolean {
  const match = line.match(/^\(?([A-E])\s*[.)]\s*/i);
  if (!match || (match[1] !== match[1].toUpperCase() && !allowLowercase)) return false;
  const rest = line.slice(match[0].length).trim();
  return rest.length > 0 && rest.length <= 200;
}

export function parseQuestionText(
  fullText: string,
  pageNumber: number,
): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const state: QuestionParserState = { currentMain: null, pendingOptions: [] };
  parseQuestionLines(fullText.split("\n"), pageNumber, questions, state);
  attachPendingOptions(questions, state.pendingOptions);
  return questions;
}

type QuestionParserState = {
  currentMain: ParsedQuestion | null;
  pendingOptions: string[];
};

function attachPendingOptions(questions: ParsedQuestion[], pendingOptions: string[]): void {
  if (questions.length > 0 && pendingOptions.length > 0) {
    questions[questions.length - 1].options = [...pendingOptions];
    pendingOptions.length = 0;
  }
}

function parseQuestionLines(
  lines: string[],
  pageNumber: number,
  questions: ParsedQuestion[],
  state: QuestionParserState,
): void {

  for (let i = 0; i < lines.length; i++) {
    let trimmed = cleanLine(lines[i]);
    if (!trimmed) continue;

    if (/^\d+\.?$/.test(trimmed) && i + 1 < lines.length) {
      const next = cleanLine(lines[i + 1]);
      if (next && !/^\d+\.?$/.test(next)) {
        trimmed = `${trimmed.replace(/\.$/, "")}. ${next}`;
        i++;
      }
    }

    if (!isLikelyQuestionStart(trimmed)) continue;

    if (isMcqOptionLine(trimmed, state.pendingOptions.length > 0 || !state.currentMain)) {
      if (state.currentMain && state.pendingOptions.length < 6) state.pendingOptions.push(trimmed);
      continue;
    }

    // "(e.g., ...)" is a continuation of the preceding question, never a
    // sub-question named "e". If it begins a page, ignore it rather than
    // turning it into a fake standalone question.
    if (/^\(?e\.g\./i.test(trimmed)) {
      if (state.currentMain) state.currentMain.text = `${state.currentMain.text} ${trimmed}`.trim();
      continue;
    }

    const mainNum = extractMainNumber(trimmed);
    if (mainNum) {
      attachPendingOptions(questions, state.pendingOptions);
      const text = getQuestionText(trimmed, mainNum);
      const q: ParsedQuestion = {
        number: mainNum,
        text,
        page: pageNumber,
        isSub: false,
        parentNumber: null,
      };
      questions.push(q);
      state.currentMain = q;
      continue;
    }

    const sub = extractSubNumber(trimmed);
    if (sub && state.currentMain) {
      attachPendingOptions(questions, state.pendingOptions);
      const subNumber = `${state.currentMain.number}${sub.kind === "letter" ? sub.number : `.${sub.number}`}`;
      const text = getQuestionText(trimmed, null);
      questions.push({
        number: subNumber,
        text,
        page: pageNumber,
        isSub: true,
        parentNumber: state.currentMain.number,
      });
      continue;
    }

    if (sub && !state.currentMain) {
      attachPendingOptions(questions, state.pendingOptions);
      const subNumber = sub.kind === "letter" ? sub.number : `0.${sub.number}`;
      const text = getQuestionText(trimmed, null);
      const q: ParsedQuestion = {
        number: subNumber,
        text,
        page: pageNumber,
        isSub: false,
        parentNumber: null,
      };
      questions.push(q);
      state.currentMain = q;
    }
  }
}

export function parseQuestionTextFromPages(
  pages: Array<{ pageNumber: number; content: string }>,
): ParsedQuestion[] {
  const all: ParsedQuestion[] = [];
  const state: QuestionParserState = { currentMain: null, pendingOptions: [] };
  for (const page of pages) {
    parseQuestionLines(page.content.split("\n"), page.pageNumber, all, state);
  }
  attachPendingOptions(all, state.pendingOptions);
  return deduplicateQuestions(all);
}

function deduplicateQuestions(questions: ParsedQuestion[]): ParsedQuestion[] {
  const seen = new Map<string, ParsedQuestion>();
  const result: ParsedQuestion[] = [];

  for (const q of questions) {
    const key = normalizeQuestionNumber(q.number);
    if (!seen.has(key)) {
      seen.set(key, q);
      result.push(q);
    }
  }

  return result;
}

export function normalizeQuestionNumber(num: string): string {
  return num
    .toLowerCase()
    .replace(/[.\s\-_:]/g, "")
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .replace(/^q/, "")
    .replace(/^question/, "")
    .trim();
}

export function extractMaxMarks(text: string): number | null {
  if (!text) return null;

  const patterns: Array<RegExp> = [
    /(?:\(|\[)\s*(\d+(?:\.\d+)?)\s*(?:mark|marks|m)\s*(?:\)|\])/i,
    /(\d+(?:\.\d+)?)\s*(?:mark|marks|m)\b/i,
    /(?:\(|\[)\s*(\d+(?:\.\d+)?)\s*(?:\)|\])\s*$/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  return null;
}

export function extractAnswerQuestionRef(text: string): string | null {
  const patterns = [
    /^answer\s+(?:to\s+)?(?:q(?:uestion)?[\s.:]*)([\d]+(?:[.\s][\d]+)*[a-z]?(?:\([a-z0-9]+\))?)\b/i,
    /^ans\.?\s+(?:to\s+)?(?:q[\s.:]*)([\d]+(?:[.\s][\d]+)*[a-z]?)\b/i,
    /^(?:q(?:uestion)?[\s.:]*)([\d]+(?:[.\s][\d]+)*[a-z]?(?:\([a-z0-9]+\))?)\b/i,
    /^([\d]+(?:[.\s][\d]+)*[a-z]?)\s*[.:\-]\s*(?:answer|solution|response)/i,
    /^[\[\(]?\s*(?:q[\s.:]*)?([\d]+[a-z]?(?:\([a-z0-9]+\))?)\s*[\]\)]?\s*[.:\-]/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}
