import {
  createBatch, getBatch, listBatches, addDocument, updateDocument,
  batchStats, reviewQueue, getObservations,
} from "../../lib/batch";
import { calibrationReport, recommendFloor } from "../../lib/calibration";

// Batch operations. Kept as one route with an explicit action rather than five
// near-identical files — the batch is a single resource and this keeps its
// state transitions readable in one place.

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { batchId } = req.query;

      if (batchId) {
        const batch = getBatch(batchId);
        if (!batch) return res.status(404).json({ error: "Batch not found" });
        return res.status(200).json({
          batch,
          stats: batchStats(batch),
          queue: reviewQueue(batchId),
          calibration: calibrationReport(getObservations()),
          floorRecommendation: recommendFloor(getObservations()),
        });
      }

      return res.status(200).json({
        batches: listBatches(),
        calibration: calibrationReport(getObservations()),
        floorRecommendation: recommendFloor(getObservations()),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

    const { action } = req.body;

    if (action === "create") {
      const batch = createBatch(req.body.name);
      return res.status(200).json({ batch });
    }

    if (action === "addDocument") {
      const { batchId, document } = req.body;
      if (!batchId || !document) {
        return res.status(400).json({ error: "batchId and document are required" });
      }
      const doc = addDocument(batchId, document);
      if (!doc) return res.status(404).json({ error: "Batch not found" });
      return res.status(200).json({ document: doc });
    }

    if (action === "updateDocument") {
      const { batchId, docId, patch } = req.body;
      const doc = updateDocument(batchId, docId, patch);
      if (!doc) return res.status(404).json({ error: "Batch or document not found" });
      return res.status(200).json({ document: doc });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
