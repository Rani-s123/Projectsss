// Batch store and reviewer work queue.
//
// One document at a time is a demo. Compliance operations run hundreds a day,
// and the bottleneck is never extraction — it's reviewer attention. So the
// question this module answers is: given forty documents in flight and one
// reviewer, what should they look at *next*?
//
// In-memory for the hackathon; the interface is deliberately storage-shaped so
// it maps onto Postgres or a queue service without touching callers.

import { prisma } from "./db";

const store = global._batchStore || (global._batchStore = new Map()); // batchId -> batch
const observations = global._calibrationObs || (global._calibrationObs = []); // global calibration observations across all batches

export function createBatch(name) {
  const id = `batch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const batch = {
    id,
    name: name || `Batch ${new Date().toLocaleString()}`,
    createdAt: new Date().toISOString(),
    documents: [],
  };
  store.set(id, batch);

  try {
    prisma.batch.create({
      data: {
        id: batch.id,
        name: batch.name,
        status: "active",
        createdAt: batch.createdAt,
        updatedAt: batch.createdAt,
      },
    }).catch(() => {});
  } catch (err) {}

  return batch;
}

export function getBatch(id) {
  return store.get(id) || null;
}

export function listBatches() {
  return [...store.values()]
    .map((b) => ({ ...b, ...batchStats(b) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addDocument(batchId, doc) {
  const batch = store.get(batchId);
  if (!batch) return null;

  const document = {
    id: `doc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    addedAt: new Date().toISOString(),
    status: "pending", // pending | review_required | cleared | blocked | rejected
    ...doc,
  };
  batch.documents.push(document);

  try {
    prisma.documentItem.create({
      data: {
        id: document.id,
        batchId: batchId,
        filename: document.name || document.id,
        docType: document.docType || "unknown",
        text: document.text || "",
        status: document.status,
        priority: document.priority || 0,
        monetaryValue: Number(document.extraction?.fields?.grossTotal || 0),
        scanned: Boolean(document.extraction?.documentQuality === "degraded"),
        escalated: Boolean(document.triage?.escalations?.length),
        escalatedCount: document.triage?.escalations?.length || 0,
        ruleFailures: document.validation?.failed?.length || 0,
        createdAt: document.addedAt,
        extractedJson: document.extraction ? JSON.stringify(document.extraction) : null,
        triageJson: document.triage ? JSON.stringify(document.triage) : null,
      },
    }).catch(() => {});
  } catch (err) {}

  return document;
}

export function updateDocument(batchId, docId, patch) {
  const batch = store.get(batchId);
  if (!batch) return null;
  const idx = batch.documents.findIndex((d) => d.id === docId);
  if (idx === -1) return null;
  batch.documents[idx] = { ...batch.documents[idx], ...patch };

  try {
    const updated = batch.documents[idx];
    prisma.documentItem.update({
      where: { id: docId },
      data: {
        status: updated.status,
        extractedJson: updated.extraction ? JSON.stringify(updated.extraction) : null,
        triageJson: updated.triage ? JSON.stringify(updated.triage) : null,
        finalizedJson: updated.finalized ? JSON.stringify(updated.finalized) : null,
      },
    }).catch(() => {});
  } catch (err) {}

  return batch.documents[idx];
}

export function batchStats(batch) {
  const docs = batch.documents || [];
  const byStatus = docs.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {});

  const needingReview = docs.filter((d) => d.status === "review_required");
  const escalatedFields = needingReview.reduce(
    (sum, d) => sum + (d.triage?.escalations?.length || 0),
    0
  );
  const totalFields = docs.reduce(
    (sum, d) => sum + Object.keys(d.extraction?.fields || {}).length,
    0
  );
  const autoClearedFields = totalFields - escalatedFields;

  return {
    total: docs.length,
    byStatus,
    escalatedFields,
    autoClearedFields,
    // The number that justifies the product: what fraction of fields a human
    // never had to touch.
    automationRate: totalFields ? Number((autoClearedFields / totalFields).toFixed(3)) : null,
  };
}

// Priority score for the reviewer queue.
//
// Deliberately NOT just "lowest confidence first" — that surfaces trivial
// uncertainty ahead of consequential uncertainty. A critical escalation on a
// large-value document outranks three medium ones on a small one, and anything
// failing a deterministic rule outranks a merely uncertain field.
const SEVERITY_WEIGHT = { critical: 100, high: 40, medium: 12 };

export function priorityScore(doc) {
  let score = 0;

  for (const e of doc.triage?.escalations || []) {
    score += SEVERITY_WEIGHT[e.severity] ?? SEVERITY_WEIGHT.medium;
  }

  // Hard rule failures are facts, not guesses — they outrank soft uncertainty.
  score += (doc.validation?.failed?.length || 0) * 60;
  score += (doc.validation?.missingFields?.length || 0) * 25;

  // Monetary exposure: a €400k invoice's ambiguity costs more than a €400 one.
  const value =
    Number(doc.extraction?.fields?.grossTotal) ||
    Number(doc.extraction?.fields?.totalValue) ||
    0;
  if (value > 0) score += Math.min(80, Math.log10(value + 1) * 14);

  // Degraded source documents deserve earlier eyes — they fail late otherwise.
  if (doc.extraction?.documentQuality === "poor") score += 30;
  else if (doc.extraction?.documentQuality === "degraded") score += 15;

  // Age, so nothing starves at the bottom of a busy queue.
  const ageMinutes = (Date.now() - new Date(doc.addedAt).getTime()) / 60000;
  score += Math.min(40, ageMinutes * 0.5);

  return Math.round(score);
}

export function reviewQueue(batchId) {
  const batch = store.get(batchId);
  if (!batch) return [];

  return batch.documents
    .filter((d) => d.status === "review_required")
    .map((d) => ({
      ...d,
      priority: priorityScore(d),
      reasons: queueReasons(d),
    }))
    .sort((a, b) => b.priority - a.priority);
}

function queueReasons(doc) {
  const reasons = [];
  const crit = (doc.triage?.escalations || []).filter((e) => e.severity === "critical").length;
  if (crit) reasons.push(`${crit} critical field${crit > 1 ? "s" : ""}`);
  if (doc.validation?.failed?.length) reasons.push(`${doc.validation.failed.length} rule failure(s)`);
  if (doc.validation?.missingFields?.length) reasons.push(`${doc.validation.missingFields.length} field(s) missing`);

  const value = Number(doc.extraction?.fields?.grossTotal) || Number(doc.extraction?.fields?.totalValue) || 0;
  if (value >= 100000) reasons.push(`high value (${value.toLocaleString()})`);
  if (doc.extraction?.documentQuality === "poor") reasons.push("poor source quality");

  return reasons;
}

// Calibration observations are global — they're about the model, not any one batch.
export function addObservations(obs) {
  observations.push(...obs);
  return observations.length;
}

export function getObservations() {
  return [...observations];
}

export function resetAll() {
  store.clear();
  observations.length = 0;
}
