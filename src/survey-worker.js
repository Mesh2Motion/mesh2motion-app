/***
 * A simple Cloudflare Worker to accept survey responses and store them in a D1 database.
 *
 * POST /submit expected payload format (JSON):
 * {
 *   "survey": [
 *     { "question": "How satisfied are you?", "answer": 5 },
 *     { "question": "Any additional feedback?", "answer": "Great app!" }
 *   ],
 *   "session_id": "optional-session-id"
 * }
 *
 * POST /animation-request expected payload format (JSON):
 * {
 *   "rig_type": "human",
 *   "description": "A sword slash combo and a ledge climb"
 * }
 */
export default {
  /**
   * Routes incoming HTTP requests to the appropriate worker behavior.
   * Keeps top-level control flow simple: preflight, submit, or not found.
   */
  async fetch(request, env) {
    // Parse route data once so we can do simple method/path checks below.
    const url = new URL(request.url);

    // 1) Handle CORS preflight requests early.
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204);
    }

    // 2) Main write endpoint: accept survey payload and store answers.
    if (request.method === "POST" && url.pathname === "/submit") {
      return handleSubmit(request, env);
    }

    // 3) Animation request endpoint: store a single rig type + description.
    if (request.method === "POST" && url.pathname === "/animation-request") {
      return handleAnimationRequest(request, env);
    }

    // 4) Fallback for unknown routes/methods.
    return corsResponse({ error: "Not found" }, 404);
  },
};

const MAX_SURVEY_ITEMS = 20;
const MAX_QUESTION_LENGTH = 200;
const MAX_ANSWER_LENGTH = 2000;
const MAX_RIG_TYPE_LENGTH = 50;
const MAX_ANIMATION_REQUEST_LENGTH = 2000;

/**
 * Handles POST /submit by validating payload shape, preparing DB writes,
 * executing inserts in a batch, and returning a success response.
 */
async function handleSubmit(request, env) {
  let body;
  try {
    // Parse JSON body and fail fast on malformed payloads.
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const { survey, session_id } = body;

  // The API expects: { survey: [{ question, answer }, ...], session_id?: string }
  if (!Array.isArray(survey) || survey.length === 0 || survey.length > MAX_SURVEY_ITEMS) {
    return badRequest("survey must be a non-empty array");
  }

  const normalized_session_id = normalizeSessionId(session_id);
  const statements_or_error = buildSurveyInsertStatements(env.DB, survey, normalized_session_id);

  if (statements_or_error.error) {
    return badRequest(statements_or_error.error);
  }

  // Execute all inserts in one batch for consistency and fewer round trips.
  await env.DB.batch(statements_or_error.statements);

  return corsResponse(
    {
      success: true,
      session_id: normalized_session_id,
      inserted: statements_or_error.statements.length,
    },
    201
  );
}

/**
 * Handles POST /animation-request by validating the rig type and description,
 * then inserting a single row into the animation_requests table.
 */
async function handleAnimationRequest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const rig_type = typeof body?.rig_type === "string" ? body.rig_type.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  if (!rig_type) {
    return badRequest("rig_type is required");
  }

  if (rig_type.length > MAX_RIG_TYPE_LENGTH) {
    return badRequest("rig_type is too long");
  }

  if (!description) {
    return badRequest("description is required");
  }

  if (description.length > MAX_ANIMATION_REQUEST_LENGTH) {
    return badRequest("description is too long");
  }

  // submitted_at defaults to the current timestamp and id auto-increments
  await env.DB.prepare(
    "INSERT INTO animation_requests (rig_type, description) VALUES (?, ?)"
  ).bind(rig_type, description).run();

  return corsResponse({ success: true }, 201);
}

/**
 * Normalizes an optional session id from the client.
 * Generates a UUID when no usable id is provided.
 */
function normalizeSessionId(session_id) {
  // Reuse client session_id when provided; otherwise create one to group this submission.
  return typeof session_id === "string" && session_id.trim().length > 0
    ? session_id.trim()
    : crypto.randomUUID();
}

/**
 * Validates each survey item and converts valid entries into prepared insert
 * statements so all writes remain parameterized and safe.
 */
function buildSurveyInsertStatements(db, survey, normalized_session_id) {
  const statements = [];

  for (const entry of survey) {
    const validation_error = validateSurveyItem(entry);
    if (validation_error) {
      return { error: validation_error };
    }

    const question = entry.question.trim();
    const answer_text = String(entry.answer).trim();

    // submitted at insert automatically uses default to current timestamp
    // the ID auto-increments, so don't specify that.
    statements.push(
      db.prepare(
        "INSERT INTO responses (session_id, question, answer) VALUES (?, ?, ?)"
      ).bind(normalized_session_id, question, answer_text)
    );
  }

  return { statements };
}

/**
 * Applies per-item validation rules and returns a user-facing error message
 * when invalid, otherwise returns null.
 */
function validateSurveyItem(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return "Each survey item must be an object";
  }

  const question = typeof entry.question === "string" ? entry.question.trim() : "";
  const answer = entry.answer;

  if (!question) {
    return "Each survey item must include a question";
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return "Question is too long";
  }

  const answer_type = typeof answer;
  if (answer_type !== "string" && answer_type !== "number" && answer_type !== "boolean") {
    return "Each survey answer must be a string, number, or boolean";
  }

  if (answer_type === "number" && !Number.isFinite(answer)) {
    return "Numeric answers must be finite";
  }

  const answer_text = String(answer).trim();
  if (answer_text === "") {
    return "Each survey item must include an answer";
  }

  if (answer_text.length > MAX_ANSWER_LENGTH) {
    return "Answer is too long";
  }

  return null;
}

/**
 * Convenience helper for consistent JSON 400 responses.
 */
function badRequest(message) {
  return corsResponse({ error: message }, 400);
}

/**
 * Builds a JSON response with CORS headers used by this worker.
 */
function corsResponse(body, status) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",         // restrict to your domain in production
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}