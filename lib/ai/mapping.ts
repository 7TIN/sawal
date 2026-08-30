import type { Question, Answer, MappedItem } from "@/lib/types";
import {
  normalizeQuestionNumber,
  extractAnswerQuestionRef,
  extractMaxMarks,
} from "./parser";

function romanToNumber(s: string): number | null {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let total = 0;
  let prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const val = map[s[i]];
    if (!val) return null;
    total += val < prev ? -val : val;
    prev = val;
  }
  return total;
}

function numberKey(qNumber: string): string[] {
  const raw = normalizeQuestionNumber(qNumber);
  if (!raw) return [];

  const keys = new Set<string>([raw]);

  const mainMatch = raw.match(/^(\d+)([a-z]+)$/);
  if (mainMatch) {
    keys.add(mainMatch[1]);
    keys.add(mainMatch[2]);
  }

  const letterSubMatch = raw.match(/^(\d+)([a-z])$/);
  if (letterSubMatch) {
    keys.add(letterSubMatch[1]);
  }

  if (/^[ivx]+$/.test(raw)) {
    const num = romanToNumber(raw);
    if (num) keys.add(String(num));
  }

  return Array.from(keys);
}

function flattenQuestions(question: Question): Question[] {
  const result: Question[] = [question];
  for (const sub of question.subQuestions ?? []) {
    result.push(sub);
  }
  return result;
}

// Best-effort: if a question is missing its total marks, recover it from the
// question text so grading always uses the paper's own marks instead of a
// generic fallback.
function withMaxMarks(question: Question): Question {
  if (question.maxMarks != null && question.maxMarks > 0) return question;
  const parsed = extractMaxMarks(question.text);
  if (!parsed) return question;
  return { ...question, maxMarks: parsed };
}

export function mapQuestionsToAnswers(questions: Question[], answers: Answer[]): MappedItem[] {
  const flatQuestions = questions.flatMap(flattenQuestions);
  const answerUsed = new Set<string>();
  const items: MappedItem[] = [];

  for (const flat of flatQuestions) {
    const question = withMaxMarks(flat);
    let bestAnswer: Answer | null = null;
    let bestScore = 0;
    const qKeys = numberKey(question.number);

    for (const answer of answers) {
      if (answerUsed.has(answer.id)) continue;

      const score = scoreAnswer(answer, question, qKeys);

      if (score > bestScore) {
        bestScore = score;
        bestAnswer = answer;
      }
    }

    if (bestAnswer && bestScore > 0) {
      answerUsed.add(bestAnswer.id);
      bestAnswer.matchedQuestionNumber = question.number;
      items.push({ question, answer: bestAnswer, status: "matched" });
    } else {
      items.push({ question, answer: null, status: "unanswered" });
    }

  }

  for (const answer of answers) {
    if (answerUsed.has(answer.id)) continue;
    const dummyQuestion: Question = {
      id: `unmatched-${answer.id}`,
      number: answer.label.slice(0, 20) || "?",
      text: answer.text,
      page: answer.regions[0]?.page ?? 0,
    };
    items.push({ question: dummyQuestion, answer, status: "unmatched" });
  }

  return items;
}

function scoreAnswer(answer: Answer, question: Question, qKeys: string[]): number {
  const qKeyLower = qKeys.map((k) => k.toLowerCase());
  if (qKeyLower.length === 0) return 0;

  const labelKeys = numberKey(answer.label);
  if (labelKeys.some((key) => qKeyLower.includes(key.toLowerCase()))) return 100;

  const ref = extractAnswerQuestionRef(answer.label) ?? extractAnswerQuestionRef(answer.text);
  if (ref && qKeyLower.includes(normalizeQuestionNumber(ref).toLowerCase())) {
    return 90;
  }

  // Only use answer/question text when the answer repeats almost all of the
  // question. A loose word overlap can attach an answer for Q30 to Q3, etc.
  return ratioOfMatchingWords(question.text, answer.text) >= 0.85 ? 10 : 0;
}

function ratioOfMatchingWords(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const words2 = new Set(text2.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (words1.size === 0 || words2.size === 0) return 0;
  let count = 0;
  for (const w of words1) if (words2.has(w)) count++;
  return count / Math.max(words1.size, 1);
}
