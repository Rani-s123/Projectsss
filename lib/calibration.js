// Confidence calibration.
//
// Every AI document tool reports confidence. Almost none of them check whether
// that confidence was *earned*. This module closes the loop: when a reviewer
// corrects a field, we learn that the model's confidence on that field was
// wrong, and by how much.
//
// This matters commercially, not just academically. The auto-clear floor is the
// single number that determines how much human labour this system saves. Set it
// too high and you review everything; too low and you release bad records. The
// only honest way to set it is from observed data — which requires measuring.

// Standard reliability-diagram buckets.
const BUCKETS = [
  { min: 0.0, max: 0.5, label: "0-50%" },
  { min: 0.5, max: 0.7, label: "50-70%" },
  { min: 0.7, max: 0.8, label: "70-80%" },
  { min: 0.8, max: 0.9, label: "80-90%" },
  { min: 0.9, max: 0.95, label: "90-95%" },
  { min: 0.95, max: 1.01, label: "95-100%" },
];

// One observation per field that a human actually looked at. Fields nobody
// reviewed are deliberately excluded — we have no ground truth for those, and
// counting them as "correct" would flatter the model with unverified wins.
export function recordObservations({ docType, extractedFields, confidence, correctedFields, reviewedFields }) {
  const observations = [];

  for (const field of reviewedFields) {
    const conf = confidence?.[field];
    if (typeof conf !== "number") continue;

    const before = extractedFields?.[field];
    const after = correctedFields?.[field];
    const wasCorrect = JSON.stringify(before) === JSON.stringify(after);

    observations.push({
      docType,
      field,
      confidence: conf,
      wasCorrect,
      timestamp: new Date().toISOString(),
    });
  }

  return observations;
}

// Builds a reliability report: for each confidence band, what fraction of
// predictions in that band actually turned out correct.
export function calibrationReport(observations) {
  if (!observations?.length) {
    return { hasData: false, totalObservations: 0, buckets: [] };
  }

  const buckets = BUCKETS.map((b) => {
    const inBucket = observations.filter((o) => o.confidence >= b.min && o.confidence < b.max);
    if (!inBucket.length) {
      return { ...b, count: 0, actualAccuracy: null, claimedConfidence: null, gap: null };
    }
    const correct = inBucket.filter((o) => o.wasCorrect).length;
    const actualAccuracy = correct / inBucket.length;
    const claimedConfidence = inBucket.reduce((s, o) => s + o.confidence, 0) / inBucket.length;

    return {
      ...b,
      count: inBucket.length,
      actualAccuracy: Number(actualAccuracy.toFixed(3)),
      claimedConfidence: Number(claimedConfidence.toFixed(3)),
      // Positive gap = overconfident (claimed more than delivered).
      gap: Number((claimedConfidence - actualAccuracy).toFixed(3)),
    };
  });

  const populated = buckets.filter((b) => b.count > 0);

  // Expected Calibration Error — the standard single-number summary, weighted
  // by how many observations fall in each band.
  const total = observations.length;
  const ece = populated.reduce(
    (sum, b) => sum + (b.count / total) * Math.abs(b.gap),
    0
  );

  // Direction of bias tells you which way to move the floor.
  const weightedGap = populated.reduce((sum, b) => sum + (b.count / total) * b.gap, 0);

  return {
    hasData: true,
    totalObservations: total,
    buckets,
    populatedBuckets: populated.length,
    expectedCalibrationError: Number(ece.toFixed(3)),
    bias: weightedGap > 0.05 ? "overconfident" : weightedGap < -0.05 ? "underconfident" : "well-calibrated",
    weightedGap: Number(weightedGap.toFixed(3)),
  };
}

// Recommends an auto-clear floor from observed data rather than intuition:
// the lowest confidence band whose *observed* accuracy meets the target, with
// enough samples behind it to be worth acting on.
export function recommendFloor(observations, targetAccuracy = 0.98, minSamples = 8) {
  const report = calibrationReport(observations);
  if (!report.hasData) {
    return { recommended: null, reason: "No reviewed fields yet — floor stays at the configured default." };
  }

  const eligible = report.buckets
    .filter((b) => b.count >= minSamples && b.actualAccuracy !== null && b.actualAccuracy >= targetAccuracy)
    .sort((a, b) => a.min - b.min);

  if (!eligible.length) {
    const best = report.buckets
      .filter((b) => b.count > 0)
      .sort((a, b) => (b.actualAccuracy ?? 0) - (a.actualAccuracy ?? 0))[0];

    return {
      recommended: null,
      reason: best
        ? `No confidence band yet meets ${Math.round(targetAccuracy * 100)}% observed accuracy with ${minSamples}+ samples. Best so far: ${best.label} at ${Math.round((best.actualAccuracy ?? 0) * 100)}% over ${best.count} sample(s).`
        : "Insufficient data to recommend a floor.",
      report,
    };
  }

  const floor = eligible[0];
  return {
    recommended: floor.min,
    reason: `Fields at ${floor.label} confidence were correct ${Math.round(floor.actualAccuracy * 100)}% of the time across ${floor.count} reviewed sample(s), meeting the ${Math.round(targetAccuracy * 100)}% target.`,
    report,
  };
}
