export type ExtractedQuestion = {
  id: string;
  number: string;
  text: string;
  page: number;
};

export type ExtractedAnswer = {
  id: string;
  label: string;
  text: string;
  regions: { page: number; bbox: BBox }[];
};

export type BBox = { x: number; y: number; w: number; h: number };

export type ExtractionResult = {
  questions: ExtractedQuestion[];
  answersByPage: Record<number, ExtractedAnswer[]>;
  provider: string;
};
