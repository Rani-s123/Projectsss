import { callClaude, extractJson } from "../../lib/claude";
import { DOCUMENT_TYPES } from "../../lib/rules";
import { appendEntry } from "../../lib/audit";

// AGENT 2: The Triage Officer
//
// Decides what a human actually has to look at.
//
// The naive version of this product auto-approves everything above some
// confidence threshold. That's wrong, because confidence and *consequence*
// are different axes: a 0.85-confidence typo in a description line is fine,
// while a 0.85-confidence VAT ID on a €400k invoice is not. This agent reasons
// about materiality, not just certainty — and every escalation carries a
// stated reason, because "the AI wasn't sure" is not an audit trail.

const DEFAULT_AUTO_CLEAR_FLOOR = 0.9;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { docType, extraction, validation, ledger = [], configuredFloor } = req.body;
    const AUTO_CLEAR_FLOOR = typeof configuredFloor === "number" ? configuredFloor : DEFAULT_AUTO_CLEAR_FLOOR;
    if (!docType || !extraction) {
      return res.status(400).json({ error: "docType and extraction are required" });
    }

    const spec = DOCUMENT_TYPES[docType];
    const confidence = extraction.confidence || {};
    const fields = extraction.fields || {};

    const fieldSummary = Object.keys(fields)
      .map((k) => {
        const c = confidence[k];
        const note = extraction.notes?.[k];
        const val = Array.isArray(fields[k])
          ? `[${fields[k].length} item(s)]`
          : String(fields[k] ?? "null");
        return `• ${k}: ${val.slice(0, 120)} (confidence ${c ?? "n/a"})${note ? ` — ${note}` : ""}`;
      })
      .join("\n");

    const failedRules = (validation?.failed || [])
      .map((f) => `• [${f.id}] ${f.describe} — FAILED: ${f.message}`)
      .join("\n") || "None — all deterministic rules passed.";

    const system = `You are a compliance triage officer deciding which parts of an automatically-extracted document record require human review before it can be released.

Document type: ${spec.label}
Regulatory context: ${spec.regulation}

EXTRACTED FIELDS AND MODEL CONFIDENCE:
${fieldSummary}

DETERMINISTIC RULE FAILURES (these are facts, computed in code — treat them as ground truth, they are not opinions):
${failedRules}

MISSING REQUIRED FIELDS: ${validation?.missingFields?.length ? validation.missingFields.join(", ") : "none"}

Decide the disposition of this record. Reason about BOTH:
1. **Certainty** — how confident is the extraction?
2. **Materiality** — what is the consequence if this specific field is wrong? A wrong total, tax ID, party name, expiry date, or date that determines a legal deadline is high-consequence. A wrong line-item description is low-consequence.

A field can be low-confidence and still not need review if it is immaterial. A field can be high-confidence and STILL need review if it is high-consequence and a rule failed on it. Say so explicitly.

Any field with confidence below ${AUTO_CLEAR_FLOOR} must be escalated regardless of your reasoning — but explain *why it matters* rather than just citing the number.

Overall disposition:
- "auto_clear": every field is high-confidence, all rules passed, nothing material is uncertain
- "review_required": one or more fields need a human decision before release
- "reject": the document is unusable — too degraded, wrong document type, or missing so much that review is pointless

Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "disposition": "auto_clear|review_required|reject",
  "rationale": "2-3 sentences a compliance officer would accept as justification for this routing decision",
  "escalations": [
    {
      "field": "fieldName",
      "severity": "critical|high|medium",
      "reason": "why a human must decide this — reference the confidence AND the consequence",
      "whatToCheck": "the specific thing the reviewer should verify against the source document"
    }
  ],
  "autoClearedFields": ["fields safe to accept without review"],
  "riskIfReleased": "one sentence on what could go wrong if this record were released without review"
}`;

    const text = await callClaude({
      system,
      messages: [{ role: "user", content: "Triage this record." }],
      maxTokens: 1800,
    });

    const triage = extractJson(text);

    // Guardrail: the model's judgement never overrides the hard floor, and a
    // failed deterministic rule always forces review. We enforce this in code
    // because "the model decided it was fine" is not a defence to a regulator.
    const belowFloor = Object.entries(confidence)
      .filter(([, c]) => typeof c === "number" && c < AUTO_CLEAR_FLOOR)
      .map(([k]) => k);

    const forcedReasons = [];
    if (belowFloor.length) {
      forcedReasons.push(`${belowFloor.length} field(s) below the ${AUTO_CLEAR_FLOOR} confidence floor`);
    }
    if (validation?.failed?.length) {
      forcedReasons.push(`${validation.failed.length} deterministic rule failure(s)`);
    }
    if (validation?.missingFields?.length) {
      forcedReasons.push(`${validation.missingFields.length} required field(s) missing`);
    }

    if (forcedReasons.length && triage.disposition === "auto_clear") {
      triage.disposition = "review_required";
      triage.overriddenByPolicy = true;
      triage.policyNote = `Auto-clear blocked by policy: ${forcedReasons.join("; ")}.`;

      // Make sure every below-floor field actually appears in the queue.
      const escalated = new Set((triage.escalations || []).map((e) => e.field));
      for (const f of belowFloor) {
        if (!escalated.has(f)) {
          triage.escalations = triage.escalations || [];
          triage.escalations.push({
            field: f,
            severity: "high",
            reason: `Confidence ${confidence[f]} is below the ${AUTO_CLEAR_FLOOR} auto-clear floor.`,
            whatToCheck: "Verify this value against the source document.",
          });
        }
      }
    }

    const updatedLedger = appendEntry(ledger, {
      step: "TRIAGE",
      actor: "agent:triage",
      detail: `Disposition: ${triage.disposition.toUpperCase()}. ${triage.escalations?.length || 0} field(s) escalated for human review.${triage.overriddenByPolicy ? " " + triage.policyNote : ""}`,
      data: {
        disposition: triage.disposition,
        escalatedFields: (triage.escalations || []).map((e) => e.field),
        policyOverride: Boolean(triage.overriddenByPolicy),
      },
    });

    res.status(200).json({ triage, ledger: updatedLedger });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
