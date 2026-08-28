import { NextResponse } from "next/server";
import type { MappedItem, GradingSummary } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { items } = (await request.json()) as {
      items: MappedItem[];
    };

    if (!items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: "items array is required." },
        { status: 400 },
      );
    }

    const matched = items.filter((i) => i.status === "matched" && i.answer);

    if (matched.length === 0) {
      return NextResponse.json({
        gradedItems: items,
        summary: {
          totalScore: 0,
          maxScore: 0,
          counts: { correct: 0, partial: 0, incorrect: 0 },
          overallFeedback: "No answers were matched to grade. Check the extraction results.",
        },
      });
    }

    const result = await gradeWithGemini(matched, items);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[grade]", error);
    const message = error instanceof Error ? error.message : "Grading failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function gradeWithGemini(
  matched: MappedItem[],
  allItems: MappedItem[],
): Promise<{ gradedItems: MappedItem[]; summary: GradingSummary }> {
  const { GoogleGenAI } = await import("@google/genai");
  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const pairs = matched.map((m) => ({
    questionNumber: m.question.number,
    questionText: m.question.text,
    studentAnswer: m.answer?.text ?? "",
  }));

  const prompt = `You are a subject-matter expert exam grader. Grade each question-answer pair below with precision and fairness.

## Task
For each question, evaluate the student's answer and assign marks based on:
1. CORRECTNESS - Does the answer correctly address what was asked?
2. COMPLETENESS - Does it cover all required parts (proofs, formulas, examples, points)?
3. CLARITY - Is the reasoning clear and well-structured?
4. EVIDENCE - Does the student show working/steps to arrive at the answer?

## Marking rules
- Award FULL marks only if the answer is essentially correct and complete.
- Partial marks for correct ideas with missing details, minor errors, or incomplete working.
- Zero marks for wrong, irrelevant, or blank answers.
- Be generous but honest: a genuine attempt with mostly correct reasoning earns partial marks.
- Never award full marks to an incomplete or partially wrong answer.

## Question-answer pairs
${JSON.stringify(pairs, null, 2)}

## Output format
Return ONLY a valid JSON array (no markdown, no comments) with one object per pair, in the SAME ORDER as the input:
[
  {
    "marks": 0,
    "maxMarks": 10,
    "verdict": "correct" | "partial" | "incorrect",
    "feedback": "One short constructive paragraph. Start with what the student got right, then what was missed or wrong, then how to improve. Be specific and reference the actual content."
  }
]

Rules:
- verdict must be: "correct" (full marks), "partial" (some marks), or "incorrect" (zero).
- maxMarks: if the question paper implies a mark value use it, otherwise use 10 as a default.
- marks must be between 0 and maxMarks.
- feedback must reference the specific question and the student's actual written content — never generic text.`;

  const response = await genai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0.3,
    },
  });

  const text = response.text ?? "[]";
  let grades: Array<{ marks: number; maxMarks: number; verdict: string; feedback: string }> = [];

  try {
    grades = JSON.parse(text);
  } catch {
    // Fallback: assign zero grades
    grades = matched.map(() => ({
      marks: 0,
      maxMarks: 10,
      verdict: "incorrect",
      feedback: "Grading failed to parse. Please review manually.",
    }));
  }

  const gradedById = new Map<string, MappedItem>();
  matched.forEach((item, i) => {
    const g = grades[i];
    if (!g) return;
    gradedById.set(item.question.id, {
      ...item,
      grade: {
        marks: Math.max(0, Math.min(g.marks, g.maxMarks)),
        maxMarks: g.maxMarks,
        verdict: g.verdict === "correct" || g.verdict === "partial" || g.verdict === "incorrect"
          ? (g.verdict as "correct" | "partial" | "incorrect")
          : "incorrect",
        feedback: g.feedback || "No feedback provided.",
      },
    });
  });

  const merged = allItems.map((item) => gradedById.get(item.question.id) ?? item);
  const summary = buildSummary(merged);

  return { gradedItems: merged, summary };
}

function buildSummary(items: MappedItem[]): GradingSummary {
  let totalScore = 0;
  let maxScore = 0;
  const counts = { correct: 0, partial: 0, incorrect: 0 };

  for (const item of items) {
    if (!item.grade) continue;
    totalScore += item.grade.marks;
    maxScore += item.grade.maxMarks;
    counts[item.grade.verdict]++;
  }

  const ratio = maxScore > 0 ? totalScore / maxScore : 0;
  let overallFeedback: string;
  if (ratio >= 0.85) {
    overallFeedback = "Outstanding performance. The student demonstrated strong understanding across all questions.";
  } else if (ratio >= 0.7) {
    overallFeedback = "Good performance. Solid understanding with a few areas to refine.";
  } else if (ratio >= 0.5) {
    overallFeedback = "Average performance. Core concepts are understood but answers need more depth and completeness.";
  } else {
    overallFeedback = "Needs significant improvement. Many answers are incomplete or incorrect; review the core material.";
  }

  return { totalScore, maxScore, counts, overallFeedback };
}