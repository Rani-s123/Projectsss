import { callClaude, extractJson } from "../../lib/claude";
import { DOCUMENT_TYPES } from "../../lib/rules";
import { appendEntry } from "../../lib/audit";

// AGENT 2: The Triage Officer
// Real Claude is used when available. If the provider is unavailable (for
// example, a zero-credit hackathon account), the deterministic demo fallback
// keeps the workflow demonstrable without pretending that Claude ran.

const DEFAULT_AUTO_CLEAR_FLOOR = 0.9;

function demoTriage({ fields, confidence, validation, floor }) {
  const belowFloor = Object.entries(confidence)
    .filter(([, c]) => typeof c === "number" && c < floor)
    .map(([field]) => field);
  const failed = validation?.failed || [];
  const missing = validation?.missingFields || [];
  const escalations = belowFloor.map((field) => ({
    field,
    severity: "high",
    reason: `Demo policy: confidence ${confidence[field]} is below the ${floor} auto-clear floor.`,
    whatToCheck: "Verify this value against the source document.",
  }));
  if (failed.length) {
    escalations.push({
      field: "deterministic_rules",
      severity: "critical",
      reason: `${failed.length} deterministic validation rule(s) failed.`,
      whatToCheck: "Review each failed rule and correct the source or extracted value.",
    });
  }
  const disposition = missing.length || failed.length || belowFloor.length ? "review_required" : "auto_clear";
  return {
    disposition,
    rationale: disposition === "auto_clear"
      ? "Demo triage found all extracted fields above the configured confidence floor and no deterministic validation failures. The record is suitable for automatic clearance in this demonstration."
      : "Demo triage routed this record to human review because one or more confidence, required-field, or deterministic validation checks need attention.",
    escalations,
    autoClearedFields: disposition === "auto_clear" ? Object.keys(fields) : Object.keys(fields).filter((field) => !belowFloor.includes(field)),
    riskIfReleased: disposition === "auto_clear"
      ? "A source-document discrepancy could still pass without human review."
      : "Releasing before review could preserve an incorrect or incomplete compliance record.",
    mode: "demo-fallback",
    demoNotice: "Live Claude was unavailable, so deterministic demo triage was used."
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { docType, extraction, validation, ledger = [], configuredFloor } = req.body;
    const AUTO_CLEAR_FLOOR = typeof configuredFloor === "number" ? configuredFloor : DEFAULT_AUTO_CLEAR_FLOOR;
    if (!docType || !extraction) return res.status(400).json({ error: "docType and extraction are required" });

    const spec = DOCUMENT_TYPES[docType];
    const confidence = extraction.confidence || {};
    const fields = extraction.fields || {};
    const fieldSummary = Object.keys(fields).map((k) => {
      const c = confidence[k];
      const note = extraction.notes?.[k];
      const val = Array.isArray(fields[k]) ? `[${fields[k].length} item(s)]` : String(fields[k] ?? "null");
      return `• ${k}: ${val.slice(0, 120)} (confidence ${c ?? "n/a"})${note ? ` — ${note}` : ""}`;
    }).join("\n");
    const failedRules = (validation?.failed || []).map((f) => `• [${f.id}] ${f.describe} — FAILED: ${f.message}`).join("\n") || "None — all deterministic rules passed.";
    const system = `You are a compliance triage officer deciding which parts of an automatically-extracted document record require human review before it can be released.

Document type: ${spec.label}
Regulatory context: ${spec.regulation}

EXTRACTED FIELDS AND MODEL CONFIDENCE:
${fieldSummary}

DETERMINISTIC RULE FAILURES:
${failedRules}

MISSING REQUIRED FIELDS: ${validation?.missingFields?.length ? validation.missingFields.join(", ") : "none"}

Reason about certainty and materiality. Any field with confidence below ${AUTO_CLEAR_FLOOR} must be escalated. A failed deterministic rule or missing required field requires review.

Respond with ONLY this JSON shape:
{"disposition":"auto_clear|review_required|reject","rationale":"2-3 sentences","escalations":[{"field":"fieldName","severity":"critical|high|medium","reason":"why review is needed","whatToCheck":"what to verify"}],"autoClearedFields":["field"],"riskIfReleased":"one sentence"}`;

    let triage;
    try {
      const text = await callClaude({
        system,
        messages: [{ role: "user", content: "Triage this record." }],
        maxTokens: 1800,
      });
      triage = extractJson(text);
      triage.mode = "anthropic";
    } catch (providerError) {
      console.warn("Live Claude unavailable; using deterministic demo triage.", providerError?.message || "provider error");
      triage = demoTriage({ fields, confidence, validation, floor: AUTO_CLEAR_FLOOR });
    }

    const belowFloor = Object.entries(confidence)
      .filter(([, c]) => typeof c === "number" && c < AUTO_CLEAR_FLOOR)
      .map(([k]) => k);
    const forcedReasons = [];
    if (belowFloor.length) forcedReasons.push(`${belowFloor.length} field(s) below the ${AUTO_CLEAR_FLOOR} confidence floor`);
    if (validation?.failed?.length) forcedReasons.push(`${validation.failed.length} deterministic rule failure(s)`);
    if (validation?.missingFields?.length) forcedReasons.push(`${validation.missingFields.length} required field(s) missing`);

    if (forcedReasons.length && triage.disposition === "auto_clear") {
      triage.disposition = "review_required";
      triage.overriddenByPolicy = true;
      triage.policyNote = `Auto-clear blocked by policy: ${forcedReasons.join("; ")}.`;
      const escalated = new Set((triage.escalations || []).map((e) => e.field));
      for (const field of belowFloor) {
        if (!escalated.has(field)) {
          triage.escalations = triage.escalations || [];
          triage.escalations.push({ field, severity: "high", reason: `Confidence ${confidence[field]} is below the ${AUTO_CLEAR_FLOOR} auto-clear floor.`, whatToCheck: "Verify this value against the source document." });
        }
      }
    }

    const updatedLedger = appendEntry(ledger, {
      step: "TRIAGE",
      actor: triage.mode === "anthropic" ? "agent:triage" : "agent:triage-demo",
      detail: `Disposition: ${triage.disposition.toUpperCase()}. ${triage.escalations?.length || 0} field(s) escalated for human review.${triage.mode === "demo-fallback" ? " Demo fallback used because live Claude was unavailable." : ""}${triage.overriddenByPolicy ? " " + triage.policyNote : ""}`,
      data: { disposition: triage.disposition, mode: triage.mode, escalatedFields: (triage.escalations || []).map((e) => e.field), policyOverride: Boolean(triage.overriddenByPolicy) },
    });

    res.status(200).json({ triage, ledger: updatedLedger });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

export { demoTriage };
