import { callClaude, extractJson } from "../../lib/claude";
import { DOCUMENT_TYPES, runRules } from "../../lib/rules";
import { appendEntry } from "../../lib/audit";

// AGENT 1: The Extractor
//
// Pulls structured fields out of a messy document — and, critically, reports a
// calibrated confidence per field. A single blended "94% accurate" number is
// useless: what a reviewer needs to know is *which three fields* to look at.

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { docType, documentText, filename } = req.body;
    if (!docType || !DOCUMENT_TYPES[docType]) {
      return res.status(400).json({ error: "Valid docType is required" });
    }
    if (!documentText?.trim()) {
      return res.status(400).json({ error: "documentText is required" });
    }

    const spec = DOCUMENT_TYPES[docType];

    let ledger = appendEntry([], {
      step: "INTAKE",
      actor: "system",
      detail: `Document received: ${filename || "pasted text"} (${documentText.length} chars), classified as ${spec.label}`,
      data: { docType, filename: filename || null, charCount: documentText.length },
    });

    const system = `You are a document data extraction engine for regulated compliance workflows.

Document type: ${spec.label}
Regulatory context: ${spec.regulation}
Fields to extract: ${spec.requiredFields.join(", ")}

RULES:
- Extract ONLY what is actually present in the document. Never infer, complete, or invent a plausible-looking value. A missing field must be null, not a guess.
- Dates must be normalised to ISO 8601 (YYYY-MM-DD). If a date is ambiguous (e.g. 03/04/2026 could be March 4 or April 3), extract your best reading but assign LOW confidence and explain the ambiguity.
- Monetary values: extract as plain numbers without currency symbols or thousands separators.
- For "lineItems" (invoices), return an array of {description, quantity, unitPrice, amount}.
- For "parties" (contracts), return an array of party names as strings.

CONFIDENCE — this is the most important part of your output. For each field assign 0.0-1.0:
- 0.95-1.0: the value is stated explicitly and unambiguously
- 0.7-0.94: clearly present but required minor normalisation or interpretation
- 0.4-0.69: ambiguous, partially legible, or inferred from context — a human should check this
- 0.0-0.39: barely supported, or absent
Be honestly calibrated. Overconfidence here causes a bad record to be auto-approved, which is the exact failure mode this system exists to prevent.

DOCUMENT:
---
${documentText.slice(0, 12000)}
---

Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "fields": { "<fieldName>": <value or null>, ... },
  "confidence": { "<fieldName>": <0.0-1.0>, ... },
  "notes": { "<fieldName>": "only for fields below 0.7 — one line explaining what is uncertain and why" },
  "documentQuality": "clean|degraded|poor",
  "qualityNote": "one line on the legibility and completeness of the source document"
}`;

    const text = await callClaude({
      system,
      messages: [{ role: "user", content: "Extract the fields." }],
      maxTokens: 2500,
    });

    const extraction = extractJson(text);

    ledger = appendEntry(ledger, {
      step: "EXTRACTION",
      actor: "agent:extractor",
      detail: `Extracted ${Object.keys(extraction.fields || {}).length} fields. Source quality assessed as ${extraction.documentQuality}.`,
      data: { fields: extraction.fields, confidence: extraction.confidence },
    });

    // Deterministic validation runs immediately — arithmetic and formats are
    // never left to the model.
    const jurisdiction = req.body.jurisdiction || "EU";
    const validation = runRules(docType, extraction.fields, jurisdiction);

    ledger = appendEntry(ledger, {
      step: "RULE_VALIDATION",
      actor: "system",
      detail: `${validation.passed.length}/${validation.results.length} deterministic rules passed. ${validation.missingFields.length} required field(s) missing.`,
      data: {
        failed: validation.failed.map((f) => ({ id: f.id, message: f.message })),
        missingFields: validation.missingFields,
      },
    });

    res.status(200).json({ extraction, validation, ledger });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
