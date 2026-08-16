import { runRules, DOCUMENT_TYPES } from "../../lib/rules";
import { appendEntry, verifyLedger, ledgerFingerprint } from "../../lib/audit";
import { generateSignedPdf, dwsConfigured } from "../../lib/nutrient";
import { generateComplianceDocument, doctavianConfigured, deriveTemplateContext } from "../../lib/doctavian";
import { recordObservations } from "../../lib/calibration";
import { addObservations, updateDocument } from "../../lib/batch";

// FINALISE
//
// Records each human decision individually, re-runs the deterministic rules
// against the corrected data, feeds the outcome back into calibration, and only
// then generates and signs the released record.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const {
      docType, originalFields, correctedFields, confidence,
      decisions = [], reviewer, ledger = [], batchId, docId,
    } = req.body;

    if (!docType || !correctedFields) {
      return res.status(400).json({ error: "docType and correctedFields are required" });
    }

    let updated = [...ledger];

    // One ledger entry per human decision — a single "human approved" entry
    // would not tell a regulator which values a person actually examined.
    for (const d of decisions) {
      const before = originalFields?.[d.field];
      const after = correctedFields?.[d.field];
      const changed = JSON.stringify(before) !== JSON.stringify(after);

      updated = appendEntry(updated, {
        step: changed ? "HUMAN_CORRECTION" : "HUMAN_CONFIRMATION",
        actor: `human:${reviewer || "unidentified-reviewer"}`,
        detail: changed
          ? `Corrected "${d.field}" from "${fmt(before)}" to "${fmt(after)}"${d.note ? ` — ${d.note}` : ""}`
          : `Confirmed "${d.field}" as "${fmt(after)}" without change${d.note ? ` — ${d.note}` : ""}`,
        data: { field: d.field, before: before ?? null, after: after ?? null, note: d.note || null },
      });
    }

    // Close the calibration loop: every reviewed field is a labelled sample of
    // whether the model's confidence was actually earned.
    const reviewedFields = decisions.map((d) => d.field);
    const observations = recordObservations({
      docType, extractedFields: originalFields, confidence,
      correctedFields, reviewedFields,
    });
    if (observations.length) {
      addObservations(observations);
      const corrected = observations.filter((o) => !o.wasCorrect).length;
      updated = appendEntry(updated, {
        step: "CALIBRATION",
        actor: "system",
        detail: `${observations.length} reviewed field(s) recorded as calibration samples; ${corrected} required correction.`,
        data: { observations },
      });
    }

    const revalidation = runRules(docType, correctedFields);

    updated = appendEntry(updated, {
      step: "REVALIDATION",
      actor: "system",
      detail: `Post-review validation: ${revalidation.passed.length}/${revalidation.results.length} rules passed, ${revalidation.missingFields.length} required field(s) still missing.`,
      data: {
        failed: revalidation.failed.map((f) => ({ id: f.id, message: f.message })),
        missingFields: revalidation.missingFields,
      },
    });

    const clean = !revalidation.failed.length && !revalidation.missingFields.length;

    if (!clean) {
      updated = appendEntry(updated, {
        step: "RELEASE_BLOCKED",
        actor: "system",
        detail: `Release blocked: the record still fails ${revalidation.failed.length} rule(s) and is missing ${revalidation.missingFields.length} required field(s) after human review.`,
      });

      if (batchId && docId) {
        updateDocument(batchId, docId, { status: "blocked", ledger: updated, correctedFields });
      }

      return res.status(200).json({
        released: false, revalidation, ledger: updated,
        verification: verifyLedger(updated),
        fingerprint: ledgerFingerprint(updated),
        message: "The record cannot be released while deterministic rules still fail.",
      });
    }

    const fingerprint = ledgerFingerprint(updated);

    // Doctavian generates the correctly-shaped compliant document from the
    // cleared data — branching on tax treatment, expiry obligations, or
    // jurisdiction rather than swapping fields into a fixed form.
    const templateContext = deriveTemplateContext(docType, correctedFields);
    const doctavian = await generateComplianceDocument({
      docType, fields: correctedFields, ledgerFingerprint: fingerprint, reviewer, sign: true,
    });

    if (doctavian.generated) {
      updated = appendEntry(updated, {
        step: "DOCUMENT_GENERATED",
        actor: "system",
        detail: `Compliant ${docType} generated via Doctavian (treatment: ${templateContext.taxTreatment || "standard"})${templateContext.mandatoryStatements?.length ? `, carrying ${templateContext.mandatoryStatements.length} mandatory statement(s)` : ""}.${doctavian.signed ? " Document digitally signed." : ""}`,
        data: { documentId: doctavian.documentId, signed: doctavian.signed, mandatoryStatements: templateContext.mandatoryStatements },
      });
    }

    // Nutrient DWS signs the human-readable audit record itself.
    const html = buildRecordHtml(docType, correctedFields, updated, reviewer, templateContext);
    const signing = await generateSignedPdf(html, `${docType}-record.pdf`);

    updated = appendEntry(updated, {
      step: "RELEASED",
      actor: "system",
      detail: signing.signed
        ? "Audit record sealed and digitally signed via Nutrient DWS. Output is tamper-evident and timestamped."
        : `Record cleared. DWS signing unavailable (${signing.reason}) — the hash chain remains the integrity guarantee.`,
      data: { dwsSigned: Boolean(signing.signed), dwsConfigured: dwsConfigured(), doctavianConfigured: doctavianConfigured() },
    });

    if (batchId && docId) {
      updateDocument(batchId, docId, { status: "cleared", ledger: updated, correctedFields });
    }

    res.status(200).json({
      released: true, revalidation, ledger: updated,
      verification: verifyLedger(updated),
      fingerprint: ledgerFingerprint(updated),
      templateContext,
      doctavian: { generated: doctavian.generated, signed: doctavian.signed, url: doctavian.url || null, reason: doctavian.reason || null },
      signing: { signed: Boolean(signing.signed), reason: signing.reason || null, pdf: signing.pdf || null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

function fmt(v) {
  if (v === null || v === undefined) return "empty";
  if (Array.isArray(v)) return `[${v.length} item(s)]`;
  return String(v).slice(0, 80);
}

function buildRecordHtml(docType, fields, ledger, reviewer, ctx) {
  const spec = DOCUMENT_TYPES[docType];
  const rows = Object.entries(fields)
    .map(([k, v]) => {
      const val = Array.isArray(v)
        ? v.map((i) => (typeof i === "object" ? JSON.stringify(i) : i)).join("<br>")
        : String(v ?? "");
      return `<tr><td class="k">${k}</td><td>${val}</td></tr>`;
    })
    .join("");

  const statements = (ctx?.mandatoryStatements || [])
    .map((s) => `<li>${s}</li>`).join("");

  const trail = ledger
    .map((e) => `<tr><td>${e.seq}</td><td>${e.timestamp}</td><td>${e.actor}</td><td>${e.step}</td><td>${e.detail}</td><td class="hash">${e.hash.slice(0, 12)}</td></tr>`)
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:-apple-system,Segoe UI,sans-serif;font-size:11px;color:#111;padding:32px}
  h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:1px;color:#555}
  .meta{color:#666;font-size:10px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:5px 7px;text-align:left;vertical-align:top}
  .k{font-weight:600;width:170px;background:#fafafa}.hash{font-family:monospace;font-size:9px;color:#777}
  th{background:#f2f2f2;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
  .stmt{background:#fff8e6;border-left:3px solid #d99b00;padding:8px 12px;margin:8px 0}
  </style></head><body>
  <h1>Compliance Record — ${spec.label}</h1>
  <div class="meta">Regulatory context: ${spec.regulation} &nbsp;|&nbsp; Reviewer: ${reviewer || "unidentified"} &nbsp;|&nbsp; Generated: ${new Date().toISOString()} &nbsp;|&nbsp; Ledger fingerprint: ${ledgerFingerprint(ledger)}</div>
  ${statements ? `<div class="stmt"><strong>Mandatory statements</strong><ul>${statements}</ul></div>` : ""}
  <h2>Cleared data</h2><table>${rows}</table>
  <h2>Audit trail</h2>
  <table><tr><th>#</th><th>Timestamp</th><th>Actor</th><th>Step</th><th>Detail</th><th>Hash</th></tr>${trail}</table>
  </body></html>`;
}
