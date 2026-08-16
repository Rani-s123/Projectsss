import crypto from "crypto";
import { prisma } from "./db";

// Tamper-evident audit ledger.
//
// Regulators don't ask "did the AI get it right?" — they ask "can you prove
// what happened, in what order, and that nobody edited the record afterwards?"
//
// Every step in the pipeline appends an entry whose hash includes the hash of
// the previous entry. Change any earlier entry and every subsequent hash breaks,
// so tampering is detectable rather than merely discouraged.

export function hashEntry(entry, prevHash) {
  const payload = JSON.stringify({
    step: entry.step,
    actor: entry.actor,
    detail: entry.detail,
    data: entry.data ?? null,
    timestamp: entry.timestamp,
    prevHash,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function appendEntry(ledger, { step, actor, detail, data }) {
  const prevHash = ledger.length ? ledger[ledger.length - 1].hash : "GENESIS";
  const entry = {
    seq: ledger.length + 1,
    step,
    // "actor" is deliberately explicit: a regulator needs to distinguish a
    // machine decision from a human one. This is the field that does it.
    actor, // "agent:extractor" | "agent:validator" | "human:reviewer" | "system"
    detail,
    data: data ?? null,
    timestamp: new Date().toISOString(),
    prevHash,
  };
  entry.hash = hashEntry(entry, prevHash);

  // Sync to memory global as fallback
  global._memoryLedger = [...(global._memoryLedger || []), entry];

  // Try DB async save in background without blocking sync flow
  try {
    prisma.ledgerEntry.create({
      data: {
        seq: entry.seq,
        timestamp: entry.timestamp,
        actor: entry.actor,
        event: entry.step,
        detail: entry.detail,
        previousHash: entry.prevHash,
        hash: entry.hash,
        payloadJson: JSON.stringify(entry.data ?? null),
      },
    }).catch(() => {});
  } catch (err) {
    // DB fallback ignore
  }

  return [...ledger, entry];
}

// Async loader from DB with memory fallback
export async function loadLedger() {
  try {
    const entries = await prisma.ledgerEntry.findMany({
      orderBy: { seq: "asc" },
    });
    if (entries.length > 0) {
      return entries.map((e) => ({
        seq: e.seq,
        step: e.event,
        actor: e.actor,
        detail: e.detail || `${e.event}`,
        data: e.payloadJson ? JSON.parse(e.payloadJson) : null,
        timestamp: e.timestamp,
        prevHash: e.previousHash,
        hash: e.hash,
      }));
    }
  } catch (err) {
    // fallback
  }
  return global._memoryLedger || [];
}

// Walks the chain and reports the first break, if any.
export function verifyLedger(ledger) {
  let prevHash = "GENESIS";
  for (const entry of ledger) {
    if (entry.prevHash !== prevHash) {
      return { valid: false, brokenAt: entry.seq, reason: "Previous-hash mismatch" };
    }
    const recomputed = hashEntry(entry, prevHash);
    if (recomputed !== entry.hash) {
      return { valid: false, brokenAt: entry.seq, reason: "Entry content was modified" };
    }
    prevHash = entry.hash;
  }
  return { valid: true, entries: ledger.length, headHash: prevHash };
}

// A short, human-quotable fingerprint of the whole record — the thing you put
// on the exported PDF so the document and its audit trail are provably linked.
export function ledgerFingerprint(ledger) {
  if (!ledger.length) return null;
  return ledger[ledger.length - 1].hash.slice(0, 16).toUpperCase();
}

