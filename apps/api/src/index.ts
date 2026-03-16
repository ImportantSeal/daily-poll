import type {
  Choice,
  DeviceType,
  Question,
  ResultsResponse,
  SegmentResult,
  VoteRequest,
  VoteResponse,
} from "@paivankysymys/shared";

interface Env {
  DB: D1Database;
  SECRET_SALT: string;
  ALLOWED_ORIGIN: string;
}

interface QuestionRow {
  id: string;
  date: string;
  question: string;
  option_a: string;
  option_b: string;
  tags: string | null;
}

interface AggregateRow {
  segment: string;
  count_a: number;
  count_b: number;
}

const HELSINKI_TIMEZONE = "Europe/Helsinki";
const MOBILE_USER_AGENT_RE =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const corsHeaders = getCorsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      if (!corsHeaders) {
        return new Response(null, { status: 403 });
      }

      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (origin && !corsHeaders) {
      return jsonResponse({ error: "Origin not allowed" }, { status: 403 });
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/question/today") {
        return await handleGetTodayQuestion(env, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/vote") {
        return await handleVote(request, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/results") {
        return await handleGetResults(url, env, corsHeaders);
      }

      return jsonResponse({ error: "Not found" }, { status: 404, corsHeaders });
    } catch (error) {
      console.error("Unhandled API error", error);
      return jsonResponse(
        { error: "Internal server error" },
        { status: 500, corsHeaders },
      );
    }
  },
} satisfies ExportedHandler<Env>;

async function handleGetTodayQuestion(
  env: Env,
  corsHeaders?: Headers,
): Promise<Response> {
  const today = getHelsinkiDate();
  const todayQuestion = await env.DB.prepare(
    `SELECT id, date, question, option_a, option_b, tags
     FROM questions
     WHERE date = ? AND status = 'published'
     LIMIT 1`,
  )
    .bind(today)
    .first<QuestionRow>();

  const fallbackQuestion =
    todayQuestion ??
    (await env.DB.prepare(
      `SELECT id, date, question, option_a, option_b, tags
       FROM questions
       WHERE status = 'published'
       ORDER BY date DESC
       LIMIT 1`,
    ).first<QuestionRow>());

  if (!fallbackQuestion) {
    return jsonResponse(
      { error: "No published questions found" },
      { status: 404, corsHeaders },
    );
  }

  const responseBody: Question = mapQuestionRow(fallbackQuestion);
  return jsonResponse(responseBody, { corsHeaders });
}

async function handleVote(
  request: Request,
  env: Env,
  corsHeaders?: Headers,
): Promise<Response> {
  if (!env.SECRET_SALT) {
    return jsonResponse(
      { error: "Server is missing SECRET_SALT configuration" },
      { status: 500, corsHeaders },
    );
  }

  const parsedRequest = await parseVoteRequest(request);
  if (!parsedRequest.ok) {
    return jsonResponse({ error: parsedRequest.error }, { status: 400, corsHeaders });
  }

  const { questionId, choice } = parsedRequest.value;
  const question = await env.DB.prepare(
    "SELECT id FROM questions WHERE id = ? AND status = 'published' LIMIT 1",
  )
    .bind(questionId)
    .first<{ id: string }>();

  if (!question) {
    return jsonResponse({ error: "Question not found" }, { status: 404, corsHeaders });
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const userAgent = request.headers.get("User-Agent") ?? "";
  const country = extractCountry(request);
  const deviceType = detectDeviceType(userAgent);
  const now = new Date().toISOString();

  const dailySalt = `${getHelsinkiDate()}::${env.SECRET_SALT}`;
  const dedupeKey = await sha256Hex(`${ip}|${userAgent}|${questionId}|${dailySalt}`);

  const incrementA = choice === "A" ? 1 : 0;
  const incrementB = choice === "B" ? 1 : 0;

  const segments = ["all", `device:${deviceType}`];
  if (country) {
    segments.push(`country:${country}`);
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO dedupe_votes (question_id, dedupe_key, created_at, country, device_type)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(questionId, dedupeKey, now, country ?? null, deviceType),
    ...segments.map((segment) =>
      env.DB.prepare(
        `INSERT INTO aggregates (question_id, segment, count_a, count_b, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(question_id, segment) DO UPDATE SET
           count_a = count_a + excluded.count_a,
           count_b = count_b + excluded.count_b,
           updated_at = excluded.updated_at`,
      ).bind(questionId, segment, incrementA, incrementB, now),
    ),
  ];

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const alreadyVotedBody: VoteResponse = {
        ok: false,
        alreadyVoted: true,
        message: "Already voted today",
      };
      return jsonResponse(alreadyVotedBody, { status: 409, corsHeaders });
    }

    throw error;
  }

  const responseBody: VoteResponse = { ok: true };
  return jsonResponse(responseBody, { corsHeaders });
}

async function handleGetResults(
  url: URL,
  env: Env,
  corsHeaders?: Headers,
): Promise<Response> {
  const questionId = url.searchParams.get("questionId");
  if (!questionId) {
    return jsonResponse({ error: "Missing query parameter: questionId" }, { status: 400, corsHeaders });
  }

  const question = await env.DB.prepare(
    "SELECT id FROM questions WHERE id = ? AND status = 'published' LIMIT 1",
  )
    .bind(questionId)
    .first<{ id: string }>();

  if (!question) {
    return jsonResponse({ error: "Question not found" }, { status: 404, corsHeaders });
  }

  const aggregateResult = await env.DB.prepare(
    `SELECT segment, count_a, count_b
     FROM aggregates
     WHERE question_id = ?`,
  )
    .bind(questionId)
    .all<AggregateRow>();

  const rows = aggregateResult.results ?? [];
  const allRow = rows.find((row) => row.segment === "all");

  const totalA = allRow?.count_a ?? 0;
  const totalB = allRow?.count_b ?? 0;
  const total = totalA + totalB;

  const deviceSegments = rows
    .filter((row) => row.segment.startsWith("device:"))
    .sort((left, right) => segmentTotal(right) - segmentTotal(left));

  const countrySegments = rows
    .filter((row) => row.segment.startsWith("country:"))
    .sort((left, right) => segmentTotal(right) - segmentTotal(left))
    .slice(0, 5);

  const responseBody: ResultsResponse = {
    questionId,
    totalA,
    totalB,
    total,
    percentA: toPercent(totalA, total),
    percentB: toPercent(totalB, total),
    segments: [...deviceSegments, ...countrySegments].map((row) =>
      buildSegmentResult(row.segment, row.count_a, row.count_b),
    ),
  };

  return jsonResponse(responseBody, {
    corsHeaders,
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
}

function getCorsHeaders(origin: string | null, allowedOriginRaw: string): Headers | undefined {
  if (!origin) {
    return undefined;
  }

  const allowedOrigin = normalizeOrigin(allowedOriginRaw);
  if (normalizeOrigin(origin) !== allowedOrigin) {
    return undefined;
  }

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return headers;
}

function normalizeOrigin(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

function mapQuestionRow(row: QuestionRow): Question {
  return {
    id: row.id,
    date: row.date,
    question: row.question,
    optionA: row.option_a,
    optionB: row.option_b,
    tags: parseTags(row.tags),
  };
}

function parseTags(rawTags: string | null): string[] {
  if (!rawTags) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawTags);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    return rawTags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

async function parseVoteRequest(
  request: Request,
): Promise<{ ok: true; value: VoteRequest } | { ok: false; error: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }

  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object" };
  }

  const { questionId, choice } = body as Partial<VoteRequest>;
  if (typeof questionId !== "string" || questionId.length === 0) {
    return { ok: false, error: "questionId must be a non-empty string" };
  }

  if (choice !== "A" && choice !== "B") {
    return { ok: false, error: 'choice must be "A" or "B"' };
  }

  return {
    ok: true,
    value: {
      questionId,
      choice,
    },
  };
}

function extractCountry(request: Request): string | undefined {
  const country = (request.cf as { country?: unknown } | undefined)?.country;
  if (typeof country !== "string") {
    return undefined;
  }

  const normalized = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function detectDeviceType(userAgent: string): DeviceType {
  return MOBILE_USER_AGENT_RE.test(userAgent) ? "mobile" : "desktop";
}

function buildSegmentResult(segment: string, a: number, b: number): SegmentResult {
  const total = a + b;
  return {
    segment,
    a,
    b,
    total,
    percentA: toPercent(a, total),
    percentB: toPercent(b, total),
  };
}

function segmentTotal(row: AggregateRow): number {
  return row.count_a + row.count_b;
}

function toPercent(value: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Number(((value / total) * 100).toFixed(1));
}

function getHelsinkiDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HELSINKI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to format Helsinki date");
  }

  return `${year}-${month}-${day}`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("UNIQUE constraint failed");
}

function jsonResponse(
  payload: unknown,
  options?: {
    status?: number;
    corsHeaders?: Headers;
    headers?: HeadersInit;
  },
): Response {
  const responseHeaders = new Headers(options?.headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");

  if (options?.corsHeaders) {
    for (const [header, value] of options.corsHeaders.entries()) {
      responseHeaders.set(header, value);
    }
  }

  return new Response(JSON.stringify(payload), {
    status: options?.status ?? 200,
    headers: responseHeaders,
  });
}
