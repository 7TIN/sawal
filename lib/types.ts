export const DOCUMENT_IDS = ["question-paper", "answer-sheet"] as const;

export type DocumentId = (typeof DOCUMENT_IDS)[number];

export type BBox = { x: number; y: number; w: number; h: number };

export type StoredDocument = {
  id: DocumentId;
  fileName: string;
  mimeType: string;
  pages: Blob[];
  originalFile?: Blob;
  createdAt: string;
};

export type PageImage = {
  index: number;
  url: string;
  width: number;
  height: number;
};

export type RenderedPage = {
  blob: Blob;
  width: number;
  height: number;
};

export type SlotState =
  | { status: "empty" }
  | { status: "parsing"; fileName: string; done: number; total: number }
  | { status: "ready"; document: StoredDocument; pages: PageImage[] }
  | { status: "error"; fileName: string; message: string };

export type Question = {
  id: string;
  number: string;
  text: string;
  page: number;
  subQuestions?: Question[];
  isSub?: boolean;
  parentNumber?: string;
  options?: string[];
  maxMarks?: number;
};

export type AnswerRegion = { page: number; bbox: BBox };

export type Answer = {
  id: string;
  label: string;
  text: string;
  regions: AnswerRegion[];
  matchedQuestionNumber?: string;
};

export type MatchStatus = "matched" | "unanswered" | "unmatched";

export type GradeVerdict = "correct" | "partial" | "incorrect";

export type Grade = {
  marks: number;
  maxMarks: number;
  verdict: GradeVerdict;
  feedback: string;
};

export type MappedItem = {
  question: Question;
  answer: Answer | null;
  status: MatchStatus;
  grade?: Grade;
};

export type GradingSummary = {
  totalScore: number;
  maxScore: number;
  counts: Record<GradeVerdict, number>;
  overallFeedback: string;
};
