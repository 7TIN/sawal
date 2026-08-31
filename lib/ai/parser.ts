type ParsedQuestion = {
  number: string;
  text: string;
  page: number;
  isSub: boolean;
  parentNumber: string | null;
  options?: string[];
  lineIndex?: number;
  maxMarks?: number;
  sectionIndex?: number;
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

// A line that is nothing but a printed mark, e.g. "(5 Marks)", "5 marks",
// "Marks: 5". These are never question text, so they should not be merged into
// a question or turned into a (sub)question of their own. A bare "1." or "(5)"
// is a question number, not a mark, so the mark word/colon form is required.
function isMarksOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const worded =
    /^[\(\[\s]*[\d.]+\s*marks?\b[^\]\)]*[\)\]\s]*$/i.test(t) && /[\d.]/.test(t);
  const colon = /^marks?\s*[:=]\s*[\d.]+\s*$/i.test(t);
  return worded || colon;
}

// True when a captured question "text" is only the mark ("(5 Marks)") with no
// real wording, meaning the following content line is the actual question.
function isMarksOnlyText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const worded =
    /^[\(\[\s]*[\d.]+\s*marks?\b[^\]\)]*[\)\]\s]*$/i.test(t) && /[\d.]/.test(t);
  const colon = /^marks?\s*[:=]\s*[\d.]+\s*$/i.test(t);
  return worded || colon;
}

// Removes printed mark tokens from question text so the list shows the actual
// question, not "(2 Marks)". The value is still captured into maxMarks.
function stripMarksFromText(text: string): string {
  return text
    .replace(/\([\d.]+\s*marks?[^)]*\)/gi, " ")
    .replace(/\[[\d.]+\s*marks?[^\]]*\]/gi, " ")
    .replace(/(?:total\s+)?marks?\s*[:=]\s*[\d.]+/gi, " ")
    .replace(/\s+[\d.]+\s*marks?\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type BuiltQuestion = {
  number: string;
  text: string;
  page: number;
  isSub: boolean;
  parentNumber: string | null;
  lineIndex: number;
  sectionIndex: number;
  maxMarks?: number;
};

function buildQuestion(args: {
  number: string;
  rawText: string;
  page: number;
  isSub: boolean;
  parentNumber: string | null;
  lineIndex: number;
  sectionIndex: number;
}): BuiltQuestion {
  return {
    number: args.number,
    text: stripMarksFromText(args.rawText),
    page: args.page,
    isSub: args.isSub,
    parentNumber: args.parentNumber,
    lineIndex: args.lineIndex,
    sectionIndex: args.sectionIndex,
    maxMarks: extractMaxMarks(args.rawText) ?? undefined,
  };
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
  const state: QuestionParserState = {
    currentMain: null,
    pendingOptions: [],
    currentSection: 0,
    numberedSubsActive: false,
    lastSubNumber: null,
  };
  parseQuestionLines(fullText.split("\n"), pageNumber, questions, state);
  attachPendingOptions(questions, state.pendingOptions);
  return questions;
}

type QuestionParserState = {
  currentMain: ParsedQuestion | null;
  pendingOptions: string[];
  currentSection: number;
  numberedSubsActive: boolean;
  lastSubNumber: number | null;
};

// A section header names its own block ("Part A", "Section I", "Unit 2") so a
// paper that re-uses question numbers in a later part keeps both. The regex is
// deliberately strict: the designator must be a capital letter, roman numeral
// or plain number, so a prose line like "Part of the answer is..." never bumps
// the counter.
function isSectionHeaderLine(line: string): boolean {
  return /^[\(\[]?\s*(?:part|section|unit)\b[^a-z]*\s*(?:[A-Z]|[IVXLCDM]+|\d+)\b/i.test(
    line.trim(),
  );
}

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
    const startIndex = i;

    if (/^\d+\.?$/.test(trimmed) && i + 1 < lines.length) {
      const next = cleanLine(lines[i + 1]);
      if (next && !/^\d+\.?$/.test(next) && !isMarksOnlyLine(next)) {
        trimmed = `${trimmed.replace(/\.$/, "")}. ${next}`;
        i++;
      }
    }

    // Standalone marks line: never a question. Give its value to the most
    // recently pushed question when that question has no marks yet.
    if (isMarksOnlyLine(trimmed)) {
      const marks = parseFloat(trimmed.match(/[\d.]+/)?.[0] ?? "");
      const last = questions[questions.length - 1];
      if (Number.isFinite(marks) && marks > 0 && last && last.maxMarks == null) {
        last.maxMarks = marks;
      }
      continue;
    }

    if (isSectionHeaderLine(trimmed)) {
      state.currentSection++;
      state.currentMain = null;
      state.numberedSubsActive = false;
      state.lastSubNumber = null;
      continue;
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

    // Numbered sub-parts "1.1" / "1.2" under the current main question. Checked
    // before main extraction so the dotted number is not stripped to a bare "1"
    // and then dropped as a duplicate.
    const currentMain = state.currentMain;
    const dottedSub = currentMain
      ? trimmed.match(/^(\d+)\.(\d+)(?![.\d])\b/)
      : null;
    if (dottedSub && currentMain) {
      attachPendingOptions(questions, state.pendingOptions);
      const subNumber = `${currentMain.number}.${dottedSub[2]}`;
      questions.push(
        buildQuestion({
          number: subNumber,
          rawText: getQuestionText(trimmed, null),
          page: pageNumber,
          isSub: true,
          parentNumber: currentMain.number,
          lineIndex: startIndex,
          sectionIndex: state.currentSection,
        }),
      );
      continue;
    }

    const mainNum = extractMainNumber(trimmed);
    if (mainNum) {
      // An explicit "Q1." / "Question 1." always starts a new main question.
      const explicitQ = /^Q(?:uestion)?[\s.:]*[\d]/i.test(trimmed);
      const numVal = parseInt(mainNum, 10);
      const prevMainNum = currentMain
        ? parseInt(currentMain.number, 10)
        : NaN;
      const runContinuation =
        state.numberedSubsActive &&
        state.lastSubNumber != null &&
        Number.isFinite(numVal) &&
        numVal <= state.lastSubNumber + 1;
      const resetAfterMain =
        Number.isFinite(numVal) &&
        Number.isFinite(prevMainNum) &&
        numVal <= prevMainNum;
      const isNumberedSub =
        !explicitQ && currentMain != null && (runContinuation || resetAfterMain);

      if (isNumberedSub) {
        attachPendingOptions(questions, state.pendingOptions);
        const subNumber = `${currentMain.number}.${mainNum}`;
        questions.push(
          buildQuestion({
            number: subNumber,
            rawText: getQuestionText(trimmed, null),
            page: pageNumber,
            isSub: true,
            parentNumber: currentMain.number,
            lineIndex: startIndex,
            sectionIndex: state.currentSection,
          }),
        );
        state.numberedSubsActive = true;
        state.lastSubNumber = numVal;
        continue;
      }

      attachPendingOptions(questions, state.pendingOptions);
      const q: ParsedQuestion = buildQuestion({
        number: mainNum,
        rawText: getQuestionText(trimmed, mainNum),
        page: pageNumber,
        isSub: false,
        parentNumber: null,
        lineIndex: startIndex,
        sectionIndex: state.currentSection,
      });
      questions.push(q);
      state.currentMain = q;
      state.numberedSubsActive = false;
      state.lastSubNumber = null;
      continue;
    }

    const sub = extractSubNumber(trimmed);
    if (sub && state.currentMain) {
      attachPendingOptions(questions, state.pendingOptions);
      const subNumber = `${state.currentMain.number}${sub.kind === "letter" ? sub.number : `.${sub.number}`}`;
      questions.push(
        buildQuestion({
          number: subNumber,
          rawText: getQuestionText(trimmed, null),
          page: pageNumber,
          isSub: true,
          parentNumber: state.currentMain.number,
          lineIndex: startIndex,
          sectionIndex: state.currentSection,
        }),
      );
      continue;
    }

    if (sub && !state.currentMain) {
      attachPendingOptions(questions, state.pendingOptions);
      const subNumber = sub.kind === "letter" ? sub.number : `0.${sub.number}`;
      const q: ParsedQuestion = buildQuestion({
        number: subNumber,
        rawText: getQuestionText(trimmed, null),
        page: pageNumber,
        isSub: false,
        parentNumber: null,
        lineIndex: startIndex,
        sectionIndex: state.currentSection,
      });
      questions.push(q);
      state.currentMain = q;
      continue;
    }

    // A plain content line right after a question whose text is still blank or
    // only the mark ("1. (5 Marks)" / "1." then "(5 Marks)" printed separately)
    // is that question's actual wording — claim it as the question text.
    const last = questions[questions.length - 1];
    if (last && (last.text.trim() === "" || isMarksOnlyText(last.text))) {
      const rawFill = trimmed.trim();
      last.text = stripMarksFromText(rawFill);
      if (last.maxMarks == null) {
        last.maxMarks = extractMaxMarks(rawFill) ?? undefined;
      }
    }
  }
}

export function parseQuestionTextFromPages(
  pages: Array<{ pageNumber: number; content: string }>,
): ParsedQuestion[] {
  const all: ParsedQuestion[] = [];
  const state: QuestionParserState = {
    currentMain: null,
    pendingOptions: [],
    currentSection: 0,
    numberedSubsActive: false,
    lastSubNumber: null,
  };
  const normalizedPages = pages.map((page) => ({ ...page, content: normalizeTableRows(page.content) }));
  for (const page of normalizedPages) {
    parseQuestionLines(page.content.split("\n"), page.pageNumber, all, state);
  }
  attachPendingOptions(all, state.pendingOptions);
  return applySectionMarks(normalizedPages, deduplicateQuestions(all));
}

// Marks can be printed three different ways on a paper:
//   1. Inline next to each question  -> "(5 Marks)", "3 marks", "Marks: 5"
//   2. In a column/table row          -> "| Q.No | Question | Max Marks |" with each row's value
//   3. Once per section header        -> "Part II: Short Answer Questions (2 Marks Each)"
// Order of preference is inline > table > section. This function recasts row-based
// tables into inline "(N marks)" text so the existing question parser and
// extractMaxMarks pick individual marks up without any guessing.
function normalizeTableRows(content: string): string {
  const lines = content.split("\n");
  const output: string[] = [];
  let marksColumnDetected = false;

  for (const line of lines) {
    if (/^\s*\|?(?:[-: ]+\|?){2,}\s*\|?\s*$/.test(line)) continue;

    const header = tableHeaderInfo(line);
    if (header) {
      marksColumnDetected = true;
      output.push(line);
      continue;
    }

    if (marksColumnDetected && !line.includes("|") && line.trim().length > 0) {
      const transformed = transformFlatRow(line);
      if (transformed) {
        output.push(transformed);
        continue;
      }
    }

    if (line.includes("|")) {
      const transformed = transformBarRow(line);
      if (transformed) {
        output.push(transformed);
        continue;
      }
    }

    output.push(line);
  }

  return output.join("\n");
}

function tableHeaderInfo(line: string): "bar" | "flat" | null {
  const lower = line.toLowerCase();
  const hasMarks = /\b(?:max(?:imum)?\.?\s*)?(?:marks?|score)\b/.test(lower);
  const hasNumber = /\b(?:q(?:s|n|\.)?|qs?\.?\s*no\.?|no\.?|number|s\.?\s*no\.?|sno\.?)\b/.test(lower);
  if (!hasMarks || !hasNumber) return null;

  if (line.includes("|")) return "bar";

  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8) return null;
  const numberToken = /\b(?:q(?:s|n|\.)?|qs?\.?\s*no\.?|no\.?|number|s\.?\s*no\.?|sno\.?)\b/;
  const marksToken = /\b(?:max(?:imum)?\.?\s*)?(?:marks?|score)\b/;
  const numberIndex = tokens.findIndex((token) => numberToken.test(token));
  const marksIndex = tokens.findIndex((token) => marksToken.test(token));
  if (numberIndex >= 0 && marksIndex >= 0 && numberIndex <= 1 && marksIndex >= tokens.length - 2) return "flat";
  return null;
}

function transformBarRow(line: string): string | null {
  const cells = line
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (cells.length < 3) return null;
  if (!/^\d+(?:[a-z])?$/.test(cells[0])) return null;
  const last = cells[cells.length - 1];
  if (!/^\d{1,2}(?:\.\d+)?$/.test(last)) return null;
  const marks = parseFloat(last);
  if (!Number.isFinite(marks) || marks <= 0 || marks > 30) return null;
  const text = cells.slice(1, -1).join(" ").replace(/\s+/g, " ").trim();
  if (text.length < 2) return null;
  return `${cells[0]}. ${text} (${marks} marks)`;
}

function transformFlatRow(line: string): string | null {
  const trimmed = line.trim();
  const matched = trimmed.match(/^(\d+[. )a-z]?\s+)([\s\S]*?[^0-9])\s+(\d{1,2}(?:\.\d+)?)\s*$/);
  if (!matched) return null;
  const marks = parseFloat(matched[3]);
  if (!Number.isFinite(marks) || marks <= 0 || marks > 30) return null;
  const text = (matched[1] + matched[2]).trim();
  if (text.length < 3) return null;
  return `${text} (${marks} marks)`;
}

// A section header states one mark for every question in that section. Only
// unambiguous, printed wording is honoured: "X marks each", "each ... carries
// X marks", or "(N x M = total)". A bare "Marks: N" is ignored because it is
// usually the paper's grand total, never a per-question mark.
function sectionMarksFromLine(line: string): number | null {
  let matched = line.match(/[\(\[]?\s*(\d+(?:\.\d+)?)\s*marks?\s*(?:each|per\s*question)\b/i);
  if (!matched) {
    matched = line.match(
      /\beach\s+(?:and\s+)?(?:question|part|item|sub-?question|sub\s*part)\s*(?:carries|is|is\s*of|worth|has)?\s*(\d+(?:\.\d+)?)\s*marks?\b/i,
    );
  }
  if (matched) {
    const value = parseFloat(matched[1]);
    if (Number.isFinite(value) && value > 0 && value <= 100) return value;
  }

  // "(4 x 5 = 20)" or "Section B (3 x 5 = 15)" -> 5 marks per question.
  if (/\b(?:part|section|unit|marks?|questions?|each|attempt)\b/i.test(line)) {
    const multiplied = line.match(/[\(\[]?\s*(\d+)\s*[×x*]\s*(\d+)\s*=\s*\d+\s*[\)\]]?/i);
    if (multiplied) {
      const value = parseFloat(multiplied[2]);
      if (Number.isFinite(value) && value > 0 && value <= 100) return value;
    }
  }

  return null;
}

type MarkEvent = { page: number; lineIndex: number; marks: number; start?: number; end?: number };

function sectionRangeFromLine(line: string): { start?: number; end?: number } {
  // "Q1 - Q10", "Q.No. 11-20", "Questions 1 to 10"
  const prefixed = line.match(
    /\bq(?:uestion)?s?\.?\s*(?:no\.?|number)?\.?\s*(\d+)(?:\s*(?:to|through|[-–—])\s*(\d+))?\b/i,
  );
  if (prefixed) {
    const start = parseInt(prefixed[1], 10);
    if (Number.isFinite(start) && start > 0) {
      const end = prefixed[2] ? parseInt(prefixed[2], 10) : NaN;
      return { start, ...(Number.isFinite(end) && end >= start ? { end } : {}) };
    }
  }
  // "1 - 10" / "1 to 10" when the line also reads like a section descriptor
  const ranged = line.match(/\b(\d+)\s*(?:to|through|[-–—])\s*(\d+)\b/);
  if (ranged && /\b(?:part|section|unit|marks?|questions?)\b/i.test(line)) {
    const start = parseInt(ranged[1], 10);
    const end = parseInt(ranged[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) return { start, end };
  }
  return {};
}

function applySectionMarks(
  pages: Array<{ pageNumber: number; content: string }>,
  questions: ParsedQuestion[],
): ParsedQuestion[] {
  const events: MarkEvent[] = [];
  for (const page of pages) {
    const lines = page.content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const marks = sectionMarksFromLine(lines[index]);
      if (marks == null) continue;
      const range = sectionRangeFromLine(lines[index]);
      events.push({ page: page.pageNumber, lineIndex: index, marks, ...range });
    }
  }
  if (events.length === 0) return questions;

  events.sort((a, b) => a.page - b.page || a.lineIndex - b.lineIndex);

  return questions.map((question) => {
    if (question.maxMarks && question.maxMarks > 0) return question;
    const lineIndex = question.lineIndex ?? 0;
    const mainNumber = parseInt(normalizeQuestionNumber(question.number), 10);
    const hasNumber = Number.isFinite(mainNumber) && mainNumber > 0;

    // Prefer an explicit question-number range from a section header, then fall
    // back to reading order so interleaved "header then its questions" papers work.
    let best: number | null = null;
    if (hasNumber) {
      const numericSlot = events
        .filter(
          (event) =>
            event.start != null &&
            mainNumber >= (event.start as number) &&
            (event.end == null || mainNumber <= (event.end as number)),
        )
        .sort((a, b) => b.page - a.page || b.lineIndex - a.lineIndex)[0];
      if (numericSlot) best = numericSlot.marks;
    }

    if (best == null) {
      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.page < question.page || (event.page === question.page && event.lineIndex <= lineIndex)) {
          best = event.marks;
          break;
        }
      }
    }

    if (best == null) return question;
    return { ...question, maxMarks: best };
  });
}

function deduplicateQuestions(questions: ParsedQuestion[]): ParsedQuestion[] {
  const seen = new Map<string, ParsedQuestion>();
  const result: ParsedQuestion[] = [];

  for (const q of questions) {
    // Key by section + role + number. Same-numbered questions in different
    // sections stay distinct, and a numbered sub-part ("1.1") is kept separate
    // from a real main question numbered 11.
    const role = q.isSub
      ? `sub:${q.parentNumber ?? ""}:${normalizeQuestionNumber(q.number)}`
      : `main:${normalizeQuestionNumber(q.number)}`;
    const key = `${q.sectionIndex ?? 0}|${role}`;
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

  const patterns: Array<{ re: RegExp; group: number }> = [
    // "(1 Mark)", "(2 Marks)", "(10 marks each)", "(5 each)"
    { re: /\(([\d.]+)\s*marks?\b[^)\n]*\)/i, group: 1 },
    // "[1 Mark]" / "[2 Marks]"
    { re: /\[([\d.]+)\s*marks?\b[^\]\n]*\]/i, group: 1 },
    // "Marks: 5" / "Total Marks: 5" / "Marks = 5"
    { re: /\b(?:total\s+)?marks?\s*[:=]\s*([\d.]+)/i, group: 1 },
    // "carries 5 marks", "for 2 marks", "3 marks"
    { re: /\b([\d.]+)\s*(?:marks?|m\.?)\b/i, group: 1 },
    // "(N)" at the very end of the question text
    { re: /\(([\d.]+)\)\s*$/, group: 1 },
    // "[N]" at the very end of the question text
    { re: /\[([\d.]+)\]\s*$/, group: 1 },
    // "5 x 2 = 10" / "5 × 2 = 10" -> the total (last number)
    { re: /\b[\d.]+\s*(?:x|×)\s*[\d.]+\s*=\s*([\d.]+)\b/i, group: 1 },
  ];

  for (const { re, group } of patterns) {
    const match = text.match(re);
    if (match && match[group]) {
      const value = parseFloat(match[group]);
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
