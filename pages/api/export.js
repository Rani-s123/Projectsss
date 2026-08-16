import { verifyLedger, ledgerFingerprint } from "../../lib/audit";
import { prisma } from "../../lib/db";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let ledger = [];

    // If POSTed with custom ledger data, use that; otherwise fetch from DB or RAM
    if (req.method === "POST" && req.body && Array.isArray(req.body.ledger)) {
      ledger = req.body.ledger;
    } else {
      try {
        const dbEntries = await prisma.ledgerEntry.findMany({
          orderBy: { seq: "asc" },
        });

        ledger = dbEntries.map((e) => ({
          seq: e.seq,
          step: e.event,
          actor: e.actor,
          detail: `${e.event} - ${e.documentId || "global"}`,
          data: e.payloadJson ? JSON.parse(e.payloadJson) : null,
          timestamp: e.timestamp,
          prevHash: e.previousHash,
          hash: e.hash,
        }));
      } catch (dbErr) {
        ledger = global._memoryLedger || [];
      }
    }

    const verificationResult = verifyLedger(ledger);
    const fingerprint = ledgerFingerprint(ledger);

    const exportBundle = {
      title: "Compliance Copilot - Standalone Verification Bundle",
      specVersion: "1.0.0",
      exportedAt: new Date().toISOString(),
      fingerprint,
      verification: verificationResult,
      ledgerLength: ledger.length,
      ledger,
      verificationInstructions:
        "To verify this chain independently: For each entry in seq order, compute SHA256 of JSON stringified {step, actor, detail, data, timestamp, prevHash}. Verify that computed hash matches 'hash' field and 'prevHash' matches previous entry's 'hash'.",
    };

    if (req.query.download === "true") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit_verification_${fingerprint || "empty"}.json"`
      );
      return res.status(200).send(JSON.stringify(exportBundle, null, 2));
    }

    return res.status(200).json(exportBundle);
  } catch (err) {
    return res.status(500).json({ error: "Export failed: " + err.message });
  }
}
