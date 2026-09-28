"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Estimate = require("../lib/estimate.js");

const { localDate, isoDate, addDays, nextMonday, formatDate, formatDuration, formatRange, formatRelativeRange, adjustedWeeks, adjustedRange, demoAnalysis, normalizeAnalysis, encodeStateToQuery, decodeStateFromQuery, PRESETS, COMPLEXITY_OPTIONS, TEAM_OPTIONS } = Estimate;

// ---- Date math ----

test("isoDate formats a date as YYYY-MM-DD", () => {
  assert.equal(isoDate(new Date(2026, 9, 5)), "2026-10-05");
  assert.equal(isoDate(new Date(2026, 0, 9)), "2026-01-09");
});

test("localDate parses at local noon, avoiding DST edges", () => {
  const date = localDate("2026-10-05");
  assert.equal(isoDate(date), "2026-10-05");
  assert.equal(date.getHours(), 12);
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(isoDate(addDays(localDate("2026-01-30"), 3)), "2026-02-02");
  assert.equal(isoDate(addDays(localDate("2026-12-30"), 5)), "2027-01-04");
});

test("nextMonday returns the coming Monday, including from a Monday", () => {
  // 2026-09-23 is a Wednesday; the next Monday is 2026-09-28.
  assert.equal(isoDate(nextMonday(new Date(2026, 8, 23))), "2026-09-28");
  // From a Monday itself, the default jumps a full week forward.
  assert.equal(isoDate(nextMonday(new Date(2026, 8, 28))), "2026-10-05");
});

// ---- Formatting ----

test("formatDuration uses weeks under 12 and months at or above", () => {
  assert.equal(formatDuration(1), "1 week");
  assert.equal(formatDuration(8), "8 weeks");
  assert.equal(formatDuration(12), "3 months");
  assert.equal(formatDuration(20), "5 months");
});

test("formatRange switches to months for longer horizons", () => {
  assert.equal(formatRange(10, 14), "10–14 weeks");
  assert.equal(formatRange(16, 24), "4–6 months");
  assert.equal(formatRange(24, 40), "6–10 months");
});

test("formatRelativeRange labels week and month spans", () => {
  assert.equal(formatRelativeRange(0, 1, false), "Week 1");
  assert.equal(formatRelativeRange(2.5, 5.5, false), "Week 3 – Week 6");
  assert.equal(formatRelativeRange(0, 2, true), "Month 1");
  assert.equal(formatRelativeRange(8, 13, true), "Month 3 – Month 4");
});

test("formatDate renders short and long variants", () => {
  const date = localDate("2026-10-05");
  assert.equal(formatDate(date, true), "Oct 5");
  assert.equal(formatDate(date), "Oct 5, 2026");
});

// ---- Tier math ----

test("adjustedWeeks applies complexity and team factors, rounded to half weeks", () => {
  assert.equal(adjustedWeeks(16, COMPLEXITY_OPTIONS.standard, TEAM_OPTIONS.solo), 16);
  assert.equal(adjustedWeeks(16, COMPLEXITY_OPTIONS.complex, TEAM_OPTIONS.small), 15);
  assert.equal(adjustedWeeks(24, COMPLEXITY_OPTIONS.simple, TEAM_OPTIONS.dedicated), 12.5);
});

test("adjustedRange scales both ends of a tier range", () => {
  assert.deepEqual(adjustedRange(PRESETS.production, COMPLEXITY_OPTIONS.complex, TEAM_OPTIONS.solo), [20, 30]);
  assert.deepEqual(adjustedRange(PRESETS.mvp, COMPLEXITY_OPTIONS.standard, TEAM_OPTIONS.small), [7.5, 10.5]);
});

// ---- Demo analyzer ----

test("demoAnalysis classifies archetypes sensibly", () => {
  const inventory = demoAnalysis("Branch Inventory System", "A web-based inventory and sales system for three branches, with user roles, purchase orders, barcode scanning, reports, email notifications, and accounting integration.");
  assert.equal(inventory.complexity, "complex");
  assert.equal(inventory.delivery_level, "scalable");
  assert.equal(inventory.recommended_contingency, 20);

  const portfolio = demoAnalysis("My Portfolio", "A simple personal portfolio site with a gallery and contact form.");
  assert.equal(portfolio.complexity, "simple");
  assert.equal(portfolio.delivery_level, "mvp");
  assert.equal(portfolio.recommended_contingency, 10);

  const chat = demoAnalysis("Chat App", "A real-time chat application with notifications.");
  assert.equal(chat.complexity, "standard");
  assert.equal(chat.delivery_level, "production");

  const billing = demoAnalysis("Billing Portal", "A subscription billing and checkout portal for enterprise customers with high traffic.");
  assert.equal(billing.complexity, "complex");
  assert.equal(billing.delivery_level, "scalable");
  assert.equal(billing.recommended_contingency, 30);
});

test("demoAnalysis confidence tracks description length and output stays in bounds", () => {
  assert.equal(demoAnalysis("X", "short description").confidence, 62);
  assert.equal(demoAnalysis("X", "d".repeat(100)).confidence, 74);
  assert.equal(demoAnalysis("X", "d".repeat(300)).confidence, 85);
  for (const level of ["mvp", "production", "scalable"]) {
    const result = demoAnalysis("Anything", `Build a ${level} style system.`);
    assert.ok(result.duration_low_weeks <= result.duration_high_weeks);
    assert.ok(Estimate.BUFFER_OPTIONS.includes(result.recommended_contingency));
    assert.equal(result.demo, true);
  }
});

// ---- normalizeAnalysis ----

test("normalizeAnalysis accepts a valid Gemini-shaped result", () => {
  const normalized = normalizeAnalysis({
    complexity: "standard",
    delivery_level: "production",
    confidence: 80,
    duration_low_weeks: 16,
    duration_high_weeks: 24,
    recommended_contingency: 15,
    summary: "Looks standard.",
    reasons: ["a", "b"],
    risks: ["x", "y"],
    missing_specifications: ["m"],
    suggested_scope: "Scope.",
  });
  assert.ok(normalized);
  assert.equal(normalized.duration_low_weeks, 16);
  assert.deepEqual(normalized.reasons, ["a", "b"]);
});

test("normalizeAnalysis rejects invalid complexity, levels, and durations", () => {
  assert.equal(normalizeAnalysis({ complexity: "bogus", delivery_level: "production", duration_low_weeks: 16, duration_high_weeks: 24, reasons: ["a"], risks: ["b"] }), null);
  assert.equal(normalizeAnalysis({ complexity: "standard", delivery_level: "galactic", duration_low_weeks: 16, duration_high_weeks: 24, reasons: ["a"], risks: ["b"] }), null);
  assert.equal(normalizeAnalysis({ complexity: "standard", delivery_level: "production", duration_low_weeks: 30, duration_high_weeks: 10, reasons: ["a"], risks: ["b"] }), null);
  assert.equal(normalizeAnalysis({ complexity: "standard", delivery_level: "production", duration_low_weeks: 1, duration_high_weeks: 5, reasons: ["a"], risks: ["b"] }), null);
  assert.equal(normalizeAnalysis(null), null);
});

test("normalizeAnalysis clamps confidence and defaults contingency", () => {
  const normalized = normalizeAnalysis({
    complexity: "standard", delivery_level: "production", confidence: 500,
    duration_low_weeks: 16, duration_high_weeks: 24, recommended_contingency: 12,
    reasons: ["a"], risks: ["b"],
  });
  assert.equal(normalized.confidence, 100);
  assert.equal(normalized.recommended_contingency, 15);
});

// ---- URL codec ----

function sampleAnalysis() {
  return {
    demo: true,
    complexity: "complex",
    delivery_level: "scalable",
    confidence: 74,
    duration_low_weeks: 24,
    duration_high_weeks: 40,
    recommended_contingency: 20,
    summary: "Demo summary text.",
    reasons: ["Payments add time", "Short spec"],
    risks: ["Scope growth", "Third-party availability"],
    missing_specifications: ["User counts"],
    suggested_scope: "Demo scope text.",
  };
}

test("encode/decode round-trips a full shared state", () => {
  const state = {
    project: "Branch Inventory System",
    start: "2026-10-05",
    tier: "scalable",
    complexity: "complex",
    team: "solo",
    buffer: 20,
    hasAnalysis: true,
    isDemo: true,
    brief: "Inventory and sales for three branches with barcode scanning.",
    analysis: sampleAnalysis(),
  };
  const query = new URLSearchParams(encodeStateToQuery(state));
  const decoded = decodeStateFromQuery(query);
  assert.equal(decoded.project, state.project);
  assert.equal(decoded.start, state.start);
  assert.equal(decoded.tier, state.tier);
  assert.equal(decoded.complexity, state.complexity);
  assert.equal(decoded.team, state.team);
  assert.equal(decoded.buffer, 20);
  assert.equal(decoded.hasAnalysis, true);
  assert.equal(decoded.isDemo, true);
  assert.equal(decoded.brief, state.brief);
  assert.deepEqual(decoded.analysis, sampleAnalysis());
});

test("encode omits analysis params when there is no analysis", () => {
  const query = new URLSearchParams(encodeStateToQuery({
    project: "New System", start: "2026-10-05", tier: "production",
    complexity: "standard", team: "solo", buffer: 15,
    hasAnalysis: false, isDemo: false, brief: "", analysis: null,
  }));
  assert.equal(query.get("ready"), null);
  assert.equal(query.get("ai"), null);
  assert.equal(query.get("demo"), null);
  const decoded = decodeStateFromQuery(query);
  assert.equal(decoded.hasAnalysis, false);
  assert.equal(decoded.analysis, null);
});

test("decode drops a tampered or corrupt ai payload without throwing", () => {
  const query = new URLSearchParams("v=2&project=X&ready=1&ai=!!!not-base64!!!");
  const decoded = decodeStateFromQuery(query);
  assert.equal(decoded.hasAnalysis, true);
  assert.equal(decoded.analysis, null);
});

test("decode rejects tampered analysis fields via validation", () => {
  const forged = Buffer.from(JSON.stringify({
    c: "huge", l: "mvp", lo: 10, hi: 14, f: 90, g: 15, s: "s", r: ["a"], k: ["b"], m: [], p: "p",
  })).toString("base64url");
  const decoded = decodeStateFromQuery(new URLSearchParams(`v=2&ready=1&ai=${forged}`));
  assert.equal(decoded.analysis, null);
});

test("decode clamps out-of-range durations inside the payload", () => {
  const forged = Buffer.from(JSON.stringify({
    c: "standard", l: "mvp", lo: 1, hi: 999, f: 90, g: 15, s: "s", r: ["a"], k: ["b"], m: [], p: "p",
  })).toString("base64url");
  const decoded = decodeStateFromQuery(new URLSearchParams(`v=2&ready=1&ai=${forged}`));
  assert.equal(decoded.analysis, null);
});

test("decode ignores invalid enum params instead of throwing", () => {
  const decoded = decodeStateFromQuery(new URLSearchParams("v=2&tier=galactic&complexity=bogus&team=army&buffer=99&start=nope"));
  assert.equal(decoded.tier, "");
  assert.equal(decoded.complexity, "");
  assert.equal(decoded.team, "");
  assert.equal(decoded.buffer, 0);
  assert.equal(decoded.start, "");
});

test("encoded URLs stay reasonably short for sharing", () => {
  const state = {
    project: "Branch Inventory System",
    start: "2026-10-05",
    tier: "scalable",
    complexity: "complex",
    team: "solo",
    buffer: 20,
    hasAnalysis: true,
    isDemo: true,
    brief: "Inventory and sales for three branches with barcode scanning, reports, and accounting integration.",
    analysis: sampleAnalysis(),
  };
  const queryString = encodeStateToQuery(state);
  assert.ok(queryString.length < 1800, `query length ${queryString.length}`);
});
