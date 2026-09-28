// Pure estimate logic shared between the browser (index.html) and node tests.
// Browser usage: <script src="lib/estimate.js"> exposes window.Estimate only,
// so its function names cannot collide with page-level const bindings.
// Node usage:    require("./lib/estimate.js").

(function () {
const PRESETS = {
  mvp: { name: "MVP", weeks: 8, soloRange: [10, 14] },
  production: { name: "Production-ready", weeks: 12, soloRange: [16, 24] },
  scalable: { name: "Scalable", weeks: 18, soloRange: [24, 40] },
};

const COMPLEXITY_OPTIONS = {
  simple: { label: "simple", factor: .85 },
  standard: { label: "standard", factor: 1 },
  complex: { label: "complex", factor: 1.25 },
};

const TEAM_OPTIONS = {
  solo: { label: "solo dev", factor: 1 },
  small: { label: "2 devs", factor: .75 },
  dedicated: { label: "3+ devs", factor: .6 },
};

const BUFFER_OPTIONS = [10, 15, 20, 30];

const BUFFER_LABELS = { 10: "Stable", 15: "Recommended", 20: "Evolving", 30: "High uncertainty" };

const ANALYSIS_LIMITS = {
  summary: 600,
  suggested_scope: 800,
  listItems: 5,
  listItem: 220,
};

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim().slice(0, ANALYSIS_LIMITS.listItem))
    .filter(Boolean)
    .slice(0, ANALYSIS_LIMITS.listItems);
}

function normalizeAnalysis(result) {
  if (!result || typeof result !== "object") return null;
  const low = Number(result.duration_low_weeks);
  const high = Number(result.duration_high_weeks);
  const complexity = String(result.complexity || "");
  const deliveryLevel = String(result.delivery_level || "");
  if (!COMPLEXITY_OPTIONS[complexity] || !PRESETS[deliveryLevel]) return null;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high || low < 4 || high > 60) return null;
  const reasons = cleanList(result.reasons);
  const risks = cleanList(result.risks);
  const missing = cleanList(result.missing_specifications);
  if (reasons.length < 1 || risks.length < 1) return null;
  const contingency = Number(result.recommended_contingency);
  return {
    demo: Boolean(result.demo),
    complexity,
    delivery_level: deliveryLevel,
    confidence: Math.max(0, Math.min(100, Number(result.confidence) || 0)),
    duration_low_weeks: low,
    duration_high_weeks: high,
    recommended_contingency: BUFFER_OPTIONS.includes(contingency) ? contingency : 15,
    summary: String(result.summary || "").trim().slice(0, ANALYSIS_LIMITS.summary),
    reasons,
    risks,
    missing_specifications: missing,
    suggested_scope: String(result.suggested_scope || "").trim().slice(0, ANALYSIS_LIMITS.suggested_scope),
  };
}

// ---- Date math ----

function localDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function nextMonday(from = new Date()) {
  const date = new Date(from);
  date.setHours(12, 0, 0, 0);
  const days = (8 - date.getDay()) % 7 || 7;
  return addDays(date, days);
}

// ---- Formatting ----

function formatDate(date, short = false) {
  return new Intl.DateTimeFormat("en", short
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" }
  ).format(date);
}

function formatDuration(weeks) {
  if (weeks < 12) return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  const months = Math.round((weeks / 4) * 10) / 10;
  return `${months} ${months === 1 ? "month" : "months"}`;
}

function formatRange(lowWeeks, highWeeks) {
  if (highWeeks < 16) return `${lowWeeks}–${highWeeks} weeks`;
  const lowMonths = Math.round((lowWeeks / 4) * 10) / 10;
  const highMonths = Math.round((highWeeks / 4) * 10) / 10;
  return `${lowMonths}–${highMonths} months`;
}

function formatRelativeRange(startWeek, endWeek, useMonths) {
  const start = useMonths ? Math.floor(startWeek / 4) + 1 : Math.floor(startWeek) + 1;
  const end = useMonths ? Math.max(start, Math.ceil(endWeek / 4)) : Math.max(start, Math.ceil(endWeek));
  const unit = useMonths ? "Month" : "Week";
  return start === end ? `${unit} ${start}` : `${unit} ${start} – ${unit} ${end}`;
}

// ---- Tier math ----

function adjustedWeeks(baseWeeks, complexity, team) {
  return Math.ceil(baseWeeks * complexity.factor * team.factor * 2) / 2;
}

function adjustedRange(preset, complexity, team) {
  return preset.soloRange.map((weeks) => adjustedWeeks(weeks, complexity, team));
}

// ---- Demo analyzer (client-side heuristic stand-in for Gemini) ----

function demoAnalysis(projectName, description) {
  const text = `${projectName} ${description}`.toLowerCase();
  const hasPayments = /(payment|billing|checkout|subscription)/.test(text);
  const hasIntegrations = /(integration|accounting|erp|sync|third-party)/.test(text);
  const hasRichFeatures = /(realtime|real-time|chat|tracking|notification|mobile|offline|barcode|hardware|report|dashboard|analytics|role|roles|admin|audit|permission)/.test(text);
  const hasHeavyScale = /(thousands|nationwide|enterprise|high traffic|multiple branches|multi-branch)/.test(text);
  const isSimple = /(portfolio|landing|blog|brochure|menu|gallery|resume)/.test(text) && !hasRichFeatures && !hasPayments && !hasIntegrations;

  const complexity = (hasPayments || hasIntegrations) ? "complex" : isSimple ? "simple" : "standard";
  const deliveryLevel = complexity === "complex" && (hasHeavyScale || /(realtime|real-time|tracking|offline|barcode)/.test(text))
    ? "scalable"
    : isSimple ? "mvp" : "production";
  const contingency = complexity === "complex" ? (hasHeavyScale ? 30 : 20) : isSimple ? 10 : 15;
  const base = { mvp: [10, 14], production: [16, 24], scalable: [24, 40] }[deliveryLevel];
  const confidence = description.length < 60 ? 62 : description.length < 200 ? 74 : 85;

  return {
    demo: true,
    complexity,
    delivery_level: deliveryLevel,
    delivery_label: { mvp: "MVP recommended", production: "Production-ready recommended", scalable: "Scalable recommended" }[deliveryLevel],
    confidence,
    duration_low_weeks: base[0],
    duration_high_weeks: base[1],
    recommended_contingency: contingency,
    summary: `Demo analysis: a ${complexity} project with a ${deliveryLevel === "mvp" ? "focused" : deliveryLevel} scope. Connect a Gemini API key for a real analysis.`,
    reasons: [
      complexity === "complex" ? "Payments or external integrations add build and testing time" : isSimple ? "Small, well-understood scope with standard patterns" : "Standard web workflows with familiar patterns",
      description.length < 200 ? "Short specification limits estimate precision" : "Detailed specification supports a tighter range"
    ],
    risks: [
      "Scope growth after approval is the most common schedule risk",
      complexity === "complex" ? "Third-party availability affects integration deadlines" : "Late content or credential handoff can delay QA"
    ],
    missing_specifications: [
      "Expected number of users and peak concurrency",
      "Reporting and export requirements",
      "Who provides design assets and content"
    ],
    suggested_scope: `Demo scope: core workflows, authentication, and reporting for a ${complexity} build. Replace this with a Gemini analysis for a tailored scope.`
  };
}

// ---- URL codec: compact, validated persistence for shareable links ----
// The `ai` param carries the full analysis result (base64url JSON) so a shared
// link restores the recommendation panel, not just the timeline.

function encodeStateToQuery(state) {
  const query = new URLSearchParams();
  query.set("v", "2");
  query.set("project", String(state.project || "New System").slice(0, 80));
  query.set("start", state.start);
  query.set("tier", state.tier);
  query.set("complexity", state.complexity);
  query.set("team", state.team);
  query.set("buffer", String(state.buffer));
  if (state.hasAnalysis && state.analysis) {
    const analysis = normalizeAnalysis(state.analysis);
    if (analysis) {
      query.set("ready", "1");
      if (analysis.demo) query.set("demo", "1");
      if (state.brief) query.set("d", String(state.brief).slice(0, 2000));
      const payload = {
        c: analysis.complexity,
        l: analysis.delivery_level,
        lo: analysis.duration_low_weeks,
        hi: analysis.duration_high_weeks,
        f: analysis.confidence,
        g: analysis.recommended_contingency,
        s: analysis.summary,
        r: analysis.reasons,
        k: analysis.risks,
        m: analysis.missing_specifications,
        p: analysis.suggested_scope,
      };
      const json = JSON.stringify(payload);
      const b64 = typeof Buffer === "function"
        ? Buffer.from(json, "utf8").toString("base64url")
        : btoa(unescape(encodeURIComponent(json)));
      query.set("ai", b64);
    }
  }
  return query.toString();
}

function decodeStateFromQuery(query) {
  const get = (key) => {
    const value = query.get(key);
    return value === null ? "" : value;
  };
  const state = {
    project: get("project").slice(0, 80),
    start: /^\d{4}-\d{2}-\d{2}$/.test(get("start")) ? get("start") : "",
    tier: PRESETS[get("tier")] ? get("tier") : "",
    complexity: COMPLEXITY_OPTIONS[get("complexity")] ? get("complexity") : "",
    team: TEAM_OPTIONS[get("team")] && get("v") === "2" ? get("team") : "",
    buffer: BUFFER_OPTIONS.includes(Number(get("buffer"))) ? Number(get("buffer")) : 0,
    hasAnalysis: get("ready") === "1",
    isDemo: get("ready") === "1" && get("demo") === "1",
    brief: get("d"),
    analysis: null,
  };
  if (state.hasAnalysis && get("ai")) {
    try {
      const json = typeof Buffer === "function"
        ? Buffer.from(get("ai"), "base64url").toString("utf8")
        : decodeURIComponent(escape(atob(get("ai"))));
      const payload = JSON.parse(json);
      state.analysis = normalizeAnalysis({
        demo: state.isDemo,
        complexity: payload.c,
        delivery_level: payload.l,
        duration_low_weeks: payload.lo,
        duration_high_weeks: payload.hi,
        confidence: payload.f,
        recommended_contingency: payload.g,
        summary: payload.s,
        reasons: payload.r,
        risks: payload.k,
        missing_specifications: payload.m,
        suggested_scope: payload.p,
      });
    } catch (error) {
      state.analysis = null;
    }
  }
  return state;
}

const Estimate = {
  PRESETS,
  COMPLEXITY_OPTIONS,
  TEAM_OPTIONS,
  BUFFER_OPTIONS,
  BUFFER_LABELS,
  ANALYSIS_LIMITS,
  localDate,
  isoDate,
  addDays,
  nextMonday,
  formatDate,
  formatDuration,
  formatRange,
  formatRelativeRange,
  adjustedWeeks,
  adjustedRange,
  demoAnalysis,
  normalizeAnalysis,
  encodeStateToQuery,
  decodeStateFromQuery,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Estimate;
} else if (typeof window !== "undefined") {
  window.Estimate = Estimate;
}
})();
