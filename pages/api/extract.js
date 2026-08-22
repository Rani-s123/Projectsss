import { callClaude, extractJson } from "../../lib/claude";
import { DOCUMENT_TYPES, runRules } from "../../lib/rules";
import { appendEntry } from "../../lib/audit";

// AGENT 1: The Extractor. Real Claude is preferred; the labelled demo
// extractor keeps the hackathon walkthrough usable when the provider has no
// credits. It never claims that a live model ran.

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

function demoExtract(docType, documentText) {
 if (docType === "invoice") {
  const fields = {
   invoiceNumber: (documentText.match(/Invoice No:\s*([^\n]+)/i)?.[1] || "TNV-2026-04471").trim(),
   issueDate: null,
   supplierName: "TECHNOVA SOLUTIONS B.V.",
   supplierVatId: "NL8••234•7B01",
   buyerName: "Meridian Logistics GmbH",
   currency: "EUR",
   lineItems: [
    { description: "Cloud infrastructure, Q1", quantity: 3, unitPrice: 4200, amount: 12600 },
    { description: "Migration engineering", quantity: 1, unitPrice: 8750, amount: 8750 },
    { description: "Support retainer (Mar)", quantity: 1, unitPrice: 2400, amount: 2400 },
    { description: "Onboarding workshop", quantity: 2, unitPrice: 1150, amount: 2300 }
   ],
   netTotal: 24900, taxTotal: 5229, grossTotal: 30129
  };
  return { fields, confidence: { invoiceNumber: 0.98, issueDate: 0.42, supplierName: 0.98, supplierVatId: 0.45, buyerName: 0.97, currency: 0.99, lineItems: 0.96, netTotal: 0.99, taxTotal: 0.99, grossTotal: 0.99 }, notes: { issueDate: "Source uses ambiguous 03/04/2026 format; human confirmation is required.", supplierVatId: "VAT ID contains illegible scan characters." }, documentQuality: "degraded", qualityNote: "Demo extraction preserves planted date and VAT defects for policy review.", mode: "demo-fallback" };
 }
 if (docType === "identity") return { fields: { documentType: "P", documentNumber: "PA4471••2", fullName: "SIOBHAN MARY O'CONNELL", dateOfBirth: "1991-06-14", issuingCountry: "IE", issueDate: "2014-09-22", expiryDate: "2024-09-21" }, confidence: { documentType: 0.98, documentNumber: 0.5, fullName: 0.98, dateOfBirth: 0.97, issuingCountry: 0.96, issueDate: 0.96, expiryDate: 0.96 }, notes: { documentNumber: "Passport number has degraded characters in the source." }, documentQuality: "degraded", qualityNote: "Demo extraction preserves the degraded passport number and expired date.", mode: "demo-fallback" };
 return { fields: { contractTitle: "MASTER SERVICES AGREEMENT", parties: ["Halcyon Data Systems Ltd", "Brightwater Retail Group Inc."], effectiveDate: null, termLength: "36 months", governingLaw: "England and Wales; Delaware for North American services", totalValue: 485000, terminationNotice: null }, confidence: { contractTitle: 0.99, parties: 0.97, effectiveDate: 0.35, termLength: 0.92, governingLaw: 0.55, totalValue: 0.98, terminationNotice: 0.1 }, notes: { effectiveDate: "Commencement is described in prose rather than an ISO date.", governingLaw: "Two jurisdictions are referenced.", terminationNotice: "No termination notice period was found." }, documentQuality: "clean", qualityNote: "Demo extraction preserves planted missing/ambiguous contract clauses.", mode: "demo-fallback" };
}

export default async function handler(req, res) {
 if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
 try {
  const { docType, documentText, filename } = req.body;
  if (!docType || !DOCUMENT_TYPES[docType]) return res.status(400).json({ error: "Valid docType is required" });
  if (!documentText?.trim()) return res.status(400).json({ error: "documentText is required" });
  const spec = DOCUMENT_TYPES[docType];
  let ledger = appendEntry([], { step: "INTAKE", actor: "system", detail: `Document received: ${filename || "pasted text"} (${documentText.length} chars), classified as ${spec.label}`, data: { docType, filename: filename || null, charCount: documentText.length } });
  const system = `You are a document data extraction engine for regulated compliance workflows.\nDocument type: ${spec.label}\nRegulatory context: ${spec.regulation}\nFields to extract: ${spec.requiredFields.join(", ")}\nExtract only stated values, never infer missing values. Dates must be ISO 8601. Return confidence per field from 0.0 to 1.0 and explain uncertainty.\nDOCUMENT:\n---\n${documentText.slice(0, 12000)}\n---\nRespond with ONLY JSON: {"fields":{},"confidence":{},"notes":{},"documentQuality":"clean|degraded|poor","qualityNote":"one line"}`;
  let extraction;
  try {
   const text = await callClaude({ system, messages: [{ role: "user", content: "Extract the fields." }], maxTokens: 2500 });
   extraction = extractJson(text);
   extraction.mode = "anthropic";
  } catch (providerError) {
   console.warn("Live Claude unavailable; using deterministic demo extraction.", providerError?.message || "provider error");
   extraction = demoExtract(docType, documentText);
  }
  ledger = appendEntry(ledger, { step: "EXTRACTION", actor: extraction.mode === "anthropic" ? "agent:extractor" : "agent:extractor-demo", detail: `Extracted ${Object.keys(extraction.fields || {}).length} fields. Source quality assessed as ${extraction.documentQuality}.`, data: { fields: extraction.fields, confidence: extraction.confidence, mode: extraction.mode } });
  const jurisdiction = req.body.jurisdiction || "EU";
  const validation = runRules(docType, extraction.fields, jurisdiction);
  ledger = appendEntry(ledger, { step: "RULE_VALIDATION", actor: "system", detail: `${validation.passed.length}/${validation.results.length} deterministic rules passed. ${validation.missingFields.length} required field(s) missing.`, data: { failed: validation.failed.map((f) => ({ id: f.id, message: f.message })), missingFields: validation.missingFields } });
  res.status(200).json({ extraction, validation, ledger });
 } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}

export { demoExtract };
