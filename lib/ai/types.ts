export type ExtractedQuestion = {
  id: string;
  number: string;
  text: string;
  page: number;
  isSub?: boolean;
  parentNumber?: string;
};

export type ExtractedAnswer = {
  id: string;
  label: string;
  text: string;
  regions: { page: number; bbox: BBox }[];
};

export type BBox = { x: number; y: number; w: number; h: number };

export type AnswerSheetLine = { text: string; bbox: BBox };

export type AnswerSheetLayout = { page: number; lines: AnswerSheetLine[] };

export type ExtractionResult = {
  questions: ExtractedQuestion[];
  answersByPage: Record<number, ExtractedAnswer[]>;
  provider: string;
  rawQuestionText?: string;
  rawAnswerText?: string;
  answerLayout?: AnswerSheetLayout[];
  rawData?: { qpDigitise: string[]; asExtract: unknown; asDigitise: string[] };
};
