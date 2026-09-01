const ALLOWED_COMPLEXITY = new Set(["simple", "standard", "complex"]);
const ALLOWED_LEVELS = new Set(["mvp", "production", "scalable"]);
const DELIVERY_LABELS = {
  mvp: "MVP recommended",
  production: "Production-ready recommended",
  scalable: "Scalable recommended",
};
const CONTINGENCY_OPTIONS = new Set([10, 15, 20, 30]);
const DURATION_BOUNDS = {
  mvp: [8.5, 17.5],
  production: [13.5, 30],
  scalable: [20.5, 50],
};

const buckets = globalThis.__deliveryEstimatorRateBuckets || new Map();
globalThis.__deliveryEstimatorRateBuckets = buckets;

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  return response.status(status).json(payload);
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim().slice(0, 220))
    .filter(Boolean)
    .slice(0, 5);
}

function isRateLimited(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "unknown");
  const client = forwarded.split(",")[0].trim();
  const now = Date.now();
  const recent = (buckets.get(client) || []).filter((time) => time > now - 3_600_000);
  if (recent.length >= 10) return true;
  recent.push(now);
  buckets.set(client, recent);
  return false;
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(response, 405, { error: "Only POST requests are allowed." });
  }

  const fetchSite = String(request.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return send(response, 403, { error: "Cross-site requests are not allowed." });
  }

  if (isRateLimited(request)) {
    return send(response, 429, { error: "Hourly AI analysis limit reached. Please try again later." });
  }

  let body;
  try {
    body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
  } catch (error) {
    return send(response, 400, { error: "Invalid JSON request." });
  }
  const projectName = String(body.project_name || "").trim().slice(0, 80);
  const description = String(body.description || "").trim();
  if (projectName.length < 2) {
    return send(response, 422, { error: "Enter a project name." });
  }
  if (description.length < 10 || description.length > 5000) {
    return send(response, 422, { error: "Describe the project using 10 to 5,000 characters." });
  }

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const model = String(process.env.GEMINI_MODEL || "gemini-3.6-flash").trim();
  if (!apiKey) {
    return send(response, 503, { error: "Gemini is not configured on the server." });
  }

  const schema = {
    type: "object",
    properties: {
      complexity: { type: "string", enum: ["simple", "standard", "complex"] },
      delivery_level: { type: "string", enum: ["mvp", "production", "scalable"] },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      duration_low_weeks: { type: "number", minimum: 4, maximum: 60 },
      duration_high_weeks: { type: "number", minimum: 4, maximum: 60 },
      recommended_contingency: { type: "integer", enum: [10, 15, 20, 30] },
      summary: { type: "string" },
      reasons: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      risks: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      missing_specifications: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      suggested_scope: { type: "string" },
    },
    required: ["complexity", "delivery_level", "confidence", "duration_low_weeks", "duration_high_weeks", "recommended_contingency", "summary", "reasons", "risks", "missing_specifications", "suggested_scope"],
  };

  const instructions = `You are a senior software estimator helping a solo developer assess a proposed information system.
Classify complexity as exactly simple, standard, or complex. Recommend exactly one delivery level: mvp, production, or scalable.
Consider workflows, user roles, integrations, data sensitivity, payments, real-time features, mobile or offline needs, reporting, migration, compliance, expected scale, and ambiguity. Identify 2 to 5 missing specifications that could materially change the estimate; do not invent answers for unknowns.
Be conservative and never promise a deadline. Short specifications are allowed, but missing detail should lower confidence and be called out in missing_specifications. Estimate duration_low_weeks and duration_high_weeks for a solo developer before any team-size adjustment. Use these realistic guardrails: MVP is normally 10-14 weeks, production-ready is normally 16-24 weeks (4-6 months), and scalable is normally 24-40 weeks (6-10 months). A simple scope may be lower but never below 8.5, 13.5, or 20.5 weeks respectively; a complex scope may be higher but never above 17.5, 30, or 50 weeks respectively. Choose recommended_contingency as 10 for stable, 15 for normal, 20 for evolving, or 30 for high-uncertainty scope.
Return concise, client-safe language in the requested JSON schema.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        input: `${instructions}\n\nProject: ${projectName}\n\nSpecification:\n${description}`,
        response_format: [{ type: "text", mime_type: "application/json", schema }],
      }),
      signal: controller.signal,
    });

    const geminiPayload = await geminiResponse.json();
    if (!geminiResponse.ok) {
      console.error("Gemini analysis failed", geminiResponse.status, geminiPayload?.error?.message || "Unknown error");
      return send(response, 502, { error: "Gemini could not complete the analysis. Check the API key, model, and account limits." });
    }

    const content = (geminiPayload.steps || [])
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content || [])
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("");
    const analysis = JSON.parse(content);
    const complexity = String(analysis.complexity || "").toLowerCase();
    const deliveryLevel = String(analysis.delivery_level || "").toLowerCase();
    const reasons = cleanList(analysis.reasons);
    const risks = cleanList(analysis.risks);
    const missingSpecifications = cleanList(analysis.missing_specifications);
    const durationBounds = DURATION_BOUNDS[deliveryLevel];
    const rawLowDuration = Number(analysis.duration_low_weeks);
    const rawHighDuration = Number(analysis.duration_high_weeks);
    const recommendedContingency = Number(analysis.recommended_contingency);

    if (!ALLOWED_COMPLEXITY.has(complexity) || !ALLOWED_LEVELS.has(deliveryLevel) || !durationBounds || !Number.isFinite(rawLowDuration) || !Number.isFinite(rawHighDuration) || rawLowDuration > rawHighDuration || !CONTINGENCY_OPTIONS.has(recommendedContingency) || reasons.length < 2 || risks.length < 2 || missingSpecifications.length < 2) {
      return send(response, 502, { error: "Gemini returned an incomplete recommendation. Please try again." });
    }

    const roundHalf = (value) => Math.round(value * 2) / 2;
    const lowDuration = roundHalf(Math.max(durationBounds[0], Math.min(durationBounds[1], rawLowDuration)));
    const highDuration = roundHalf(Math.max(lowDuration, Math.min(durationBounds[1], rawHighDuration)));

    return send(response, 200, {
      complexity,
      delivery_level: deliveryLevel,
      delivery_label: DELIVERY_LABELS[deliveryLevel],
      confidence: Math.max(0, Math.min(100, Number.parseInt(analysis.confidence, 10) || 0)),
      duration_low_weeks: lowDuration,
      duration_high_weeks: highDuration,
      recommended_contingency: recommendedContingency,
      summary: String(analysis.summary || "").trim().slice(0, 600),
      reasons,
      risks,
      missing_specifications: missingSpecifications,
      suggested_scope: String(analysis.suggested_scope || "").trim().slice(0, 800),
    });
  } catch (error) {
    console.error("Gemini analysis request failed", error?.name || "Error");
    return send(response, 502, { error: "Unable to reach Gemini. Please try again." });
  } finally {
    clearTimeout(timeout);
  }
};
