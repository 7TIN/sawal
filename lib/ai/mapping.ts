import type { Question, Answer, MappedItem, MatchStatus } from "@/lib/types";

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[().]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractNumberTokens = (number: string) => {
  const tokens = normalize(number)
    .split(" ")
    .filter(Boolean);
  return tokens;
};

const questionKey = (q: Question) => {
  const tokens = extractNumberTokens(q.number);
  return tokens.join(" ");
};

const answerKey = (label: string) => {
  const tokens = extractNumberTokens(label);
  return tokens.join(" ");
};

function findMatchingQuestion(
  answerLabel: string,
  questions: Question[],
): Question | null {
  const ansTokens = answerKey(answerLabel);
  if (ansTokens.length === 0) return null;

  let bestMatch: Question | null = null;
  let bestScore = 0;

  for (const q of questions) {
    const qTokens = questionKey(q);
    if (qTokens === ansTokens) return q;

    const qParts = qTokens.split(" ");
    const aParts = ansTokens.split(" ");
    const overlap = qParts.filter((p) => aParts.includes(p)).length;
    const score = overlap / Math.max(qParts.length, aParts.length);

    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = q;
    }
  }

  return bestMatch;
}

export function mapQuestionsToAnswers(
  questions: Question[],
  answers: Answer[],
): MappedItem[] {
  const answerUsed = new Set<string>();
  const items: MappedItem[] = [];

  for (const question of questions) {
    const matchingAnswer = answers.find(
      (a) => findMatchingQuestion(a.label, [question])?.id === question.id,
    );

    if (matchingAnswer) {
      answerUsed.add(matchingAnswer.id);
      items.push({
        question,
        answer: matchingAnswer,
        status: "matched" as MatchStatus,
      });
    } else {
      items.push({ question, answer: null, status: "unanswered" as MatchStatus });
    }
  }

  for (const answer of answers) {
    if (!answerUsed.has(answer.id)) {
      const dummyQuestion: Question = {
        id: `unmatched-${answer.id}`,
        number: answer.label.slice(0, 20),
        text: answer.text,
        page: answer.regions[0]?.page ?? 0,
      };
      items.push({
        question: dummyQuestion,
        answer,
        status: "unmatched" as MatchStatus,
      });
    }
  }

  return items;
}
