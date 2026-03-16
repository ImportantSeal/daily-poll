export type Choice = "A" | "B";
export type DeviceType = "mobile" | "desktop";

export interface Question {
  id: string;
  date: string;
  question: string;
  optionA: string;
  optionB: string;
  tags: string[];
}

export interface VoteRequest {
  questionId: string;
  choice: Choice;
}

export interface VoteResponse {
  ok: boolean;
  alreadyVoted?: boolean;
  message?: string;
}

export interface SegmentResult {
  segment: string;
  a: number;
  b: number;
  total: number;
  percentA: number;
  percentB: number;
}

export interface ResultsResponse {
  questionId: string;
  totalA: number;
  totalB: number;
  total: number;
  percentA: number;
  percentB: number;
  segments: SegmentResult[];
}

export interface ApiErrorResponse {
  error: string;
}
