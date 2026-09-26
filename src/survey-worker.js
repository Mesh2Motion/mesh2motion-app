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
 *
 * GET /responses (requires "Authorization: Bearer <ADMIN_TOKEN>") returns the latest
 * survey submissions and animation requests for static/survey/index.html.
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

    // 4) Admin read endpoint: latest survey responses and animation requests.
    if (request.method === "GET" && url.pathname === "/responses") {
      return handleGetResponses(request, env);
    }

    // 5) Fallback for unknown routes/methods.
    return corsResponse({ error: "Not found" }, 404);
  },
};

const MAX_QUESTION_LENGTH = 200;
const MAX_ANSWER_LENGTH = 2000;
const MAX_RIG_TYPE_LENGTH = 50;
const MAX_ANIMATION_REQUEST_LENGTH = 2000;

const MAX_SURVEY_ITEMS = 2000; // // for report viewing. general survey
const RESPONSES_READ_LIMIT = 2000; // for report viewing

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
 * Handles GET /responses for the survey viewer page (static/survey/index.html).
 * Requires "Authorization: Bearer <ADMIN_TOKEN>", where ADMIN_TOKEN is a worker secret.
 * Returns the latest survey submissions (all answers grouped by session) and animation requests.
 */
async function handleGetResponses(request, env) {
  if (!(await isAuthorized(request, env))) {
    return corsResponse({ error: "Unauthorized" }, 401);
  }

  // A single survey submission is stored as multiple rows sharing a session_id,
  // so limit by the latest sessions rather than by rows.
  const survey_query = env.DB.prepare(
    `SELECT session_id, question, answer, submitted_at FROM responses
     WHERE session_id IN (
       SELECT session_id FROM responses GROUP BY session_id ORDER BY MAX(id) DESC LIMIT ?
     )
     ORDER BY id DESC`
  ).bind(RESPONSES_READ_LIMIT);

  const animation_requests_query = env.DB.prepare(
    "SELECT id, rig_type, description, submitted_at FROM animation_requests ORDER BY id DESC LIMIT ?"
  ).bind(RESPONSES_READ_LIMIT);

  const [survey_result, animation_requests_result] = await env.DB.batch([survey_query, animation_requests_query]);

  return corsResponse(
    {
      survey_responses: survey_result.results,
      animation_requests: animation_requests_result.results,
    },
    200
  );
}

/**
 * Compares the bearer token against the ADMIN_TOKEN secret in constant time.
 * Denies everything when the secret has not been configured.
 */
async function isAuthorized(request, env) {
  const admin_token = env.ADMIN_TOKEN;
  if (typeof admin_token !== "string" || admin_token.length === 0) {
    return false;
  }

  const auth_header = request.headers.get("Authorization") || "";
  const provided_token = auth_header.startsWith("Bearer ") ? auth_header.slice(7) : "";

  const encoder = new TextEncoder();
  const provided_bytes = encoder.encode(provided_token);
  const expected_bytes = encoder.encode(admin_token);

  if (provided_bytes.byteLength !== expected_bytes.byteLength) {
    return false;
  }

  return crypto.subtle.timingSafeEqual(provided_bytes, expected_bytes);
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}