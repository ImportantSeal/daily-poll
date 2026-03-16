import type {
  Question,
  ResultsResponse,
  VoteRequest,
  VoteResponse,
} from "@paivankysymys/shared";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

function buildUrl(path: string): string {
  if (!API_BASE_URL) {
    throw new ApiError("VITE_API_BASE_URL is missing", 500);
  }

  return `${API_BASE_URL.replace(/\/$/, "")}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), init);
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const fallbackMessage = `Request failed with status ${response.status}`;
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : fallbackMessage;

    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export async function getTodayQuestion(): Promise<Question> {
  return requestJson<Question>("/api/question/today");
}

export async function vote(body: VoteRequest): Promise<VoteResponse> {
  return requestJson<VoteResponse>("/api/vote", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function getResults(questionId: string): Promise<ResultsResponse> {
  return requestJson<ResultsResponse>(
    `/api/results?questionId=${encodeURIComponent(questionId)}`,
  );
}
