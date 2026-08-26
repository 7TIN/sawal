import { NextResponse } from "next/server";
import type { MappedItem, GradingSummary } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { items, provider } = (await request.json()) as {
      items: MappedItem[];
      provider: string;
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
          overallFeedback: "No answers were matched to grade.",
        },
      });
    }

    if (provider === "gemini") {
      const result = await gradeWithGemini(matched);
      return NextResponse.json(result);
    }

    const result = await gradeWithSarvam(matched, items);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[grade]", error);
    const message = error instanceof Error ? error.message : "Grading failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function gradeWithGemini(
  matched: MappedItem[],
): Promise<{ gradedItems: MappedItem[]; summary: GradingSummary }> {
  const { GoogleGenAI } = await import("@google/genai");
  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const pairs = matched.map((m) => ({
    questionNumber: m.question.number,
    questionText: m.question.text,
    studentAnswer: m.answer?.text ?? "",
  }));

  const response = await genai.models.generateContent({
    model: "gemini-2.0-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are an expert exam grader. Grade each question-answer pair.

INPUT:
${JSON.stringify(pairs, null, 2)}

For each pair, return:
- marks: number of marks earned (0 to maxMarks)
- maxMarks: maximum marks for this question (use 10 as default if unknown)
- verdict: "correct" | "partial" | "incorrect"
- feedback: brief constructive feedback

Return ONLY a valid JSON array with one object per pair, in the same order:
[
  { "marks": 8, "maxMarks": 10, "verdict": "correct", "feedback": "..." },
  ...
]

Do NOT include markdown or any text outside the JSON array.`,
          },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  });

  const text = response.text ?? "[]";
  const grades: Array<{ marks: number; maxMarks: number; verdict: string; feedback: string }> =
    JSON.parse(text);

  const gradedItems = matched.map((item, i) => ({
    ...item,
    grade: grades[i]
      ? {
          marks: grades[i].marks,
          maxMarks: grades[i].maxMarks,
          verdict: grades[i].verdict as "correct" | "partial" | "incorrect",
          feedback: grades[i].feedback,
        }
      : undefined,
  }));

  const allItems = gradedItems;
  const summary = buildSummary(allItems);

  return { gradedItems: allItems, summary };
}

async function gradeWithSarvam(
  matched: MappedItem[],
  allItems: MappedItem[],
): Promise<{ gradedItems: MappedItem[]; summary: GradingSummary }> {
  // Sarvam doesn't have a direct grading endpoint, so use Gemini as fallback
  // for the actual grading even when Sarvam was used for extraction
  try {
    const result = await gradeWithGemini(matched);
    // Merge graded matched items back into all items
    const gradedMap = new Map(result.gradedItems.map((i) => [i.question.id, i]));
    const merged = allItems.map((item) => {
      if (item.status === "matched" && gradedMap.has(item.question.id)) {
        return gradedMap.get(item.question.id)!;
      }
      return item;
    });
    return { gradedItems: merged, summary: result.summary };
  } catch {
    // If Gemini grading fails, return basic graded items
    const gradedItems = matched.map((m) => ({
      ...m,
      grade: {
        marks: 0,
        maxMarks: 10,
        verdict: "incorrect" as const,
        feedback: "Unable to grade automatically.",
      },
    }));
    return {
      gradedItems,
      summary: {
        totalScore: 0,
        maxScore: matched.length * 10,
        counts: { correct: 0, partial: 0, incorrect: matched.length },
        overallFeedback: "Automatic grading unavailable.",
      },
    };
  }
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
  if (ratio >= 0.8) overallFeedback = "Strong performance overall.";
  else if (ratio >= 0.5) overallFeedback = "Moderate understanding shown.";
  else overallFeedback = "Significant improvement needed.";

  return { totalScore, maxScore, counts, overallFeedback };
}
