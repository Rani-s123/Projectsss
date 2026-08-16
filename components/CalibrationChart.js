// Reliability diagram.
//
// The diagonal is perfect calibration: a field the model called 90% confident
// should be right 90% of the time. Bars above the line mean the model earned
// more than it claimed; bars below mean it was overconfident — which is the
// dangerous direction, because that is how a bad record gets auto-cleared.

export default function CalibrationChart({ calibration, floorRecommendation }) {
  if (!calibration?.hasData) {
    return (
      <div style={s.empty}>
        <p style={s.emptyText}>
          No calibration data yet. Every field a reviewer confirms or corrects becomes a
          labelled sample here — the auto-clear floor is then set from observed accuracy
          rather than intuition.
        </p>
      </div>
    );
  }

  const populated = calibration.buckets.filter((b) => b.count > 0);
  const w = 300, h = 150, pad = 28;
  const plotW = w - pad * 2, plotH = h - pad;

  const biasColor =
    calibration.bias === "overconfident" ? "var(--critical)"
    : calibration.bias === "underconfident" ? "var(--signal)"
    : "var(--verified)";

  return (
    <div>
      <div style={s.summary}>
        <div style={s.stat}>
          <span style={s.statVal}>{calibration.totalObservations}</span>
          <span style={s.statLabel}>reviewed samples</span>
        </div>
        <div style={s.stat}>
          <span style={{ ...s.statVal, color: biasColor }}>
            {(calibration.expectedCalibrationError * 100).toFixed(1)}%
          </span>
          <span style={s.statLabel}>calibration error</span>
        </div>
        <div style={s.stat}>
          <span style={{ ...s.statVal, color: biasColor, fontSize: 13 }}>
            {calibration.bias.toUpperCase()}
          </span>
          <span style={s.statLabel}>bias direction</span>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: 340 }} role="img" aria-label="Confidence calibration reliability diagram">
        {/* perfect-calibration diagonal */}
        <line
          x1={pad} y1={h - pad} x2={w - pad} y2={pad - 14}
          stroke="var(--border-bright)" strokeWidth="1" strokeDasharray="3 3"
        />
        <text x={w - pad} y={pad - 18} textAnchor="end" fontSize="7" fill="var(--muted)" fontFamily="var(--font-mono)">
          perfect
        </text>

        {populated.map((b, i) => {
          const bw = plotW / populated.length;
          const x = pad + i * bw;
          const barH = (b.actualAccuracy ?? 0) * (plotH - 14);
          const y = h - pad - barH;
          const claimedY = h - pad - (b.claimedConfidence ?? 0) * (plotH - 14);
          const over = b.gap > 0.03;

          return (
            <g key={b.label}>
              <rect
                x={x + 3} y={y} width={bw - 6} height={Math.max(1, barH)}
                fill={over ? "var(--critical)" : "var(--verified)"} opacity="0.35"
              />
              {/* claimed confidence marker */}
              <line
                x1={x + 3} y1={claimedY} x2={x + bw - 3} y2={claimedY}
                stroke="var(--flag)" strokeWidth="1.5"
              />
              <text
                x={x + bw / 2} y={h - pad + 9} textAnchor="middle"
                fontSize="6.5" fill="var(--muted)" fontFamily="var(--font-mono)"
              >
                {b.label}
              </text>
              <text
                x={x + bw / 2} y={h - pad + 17} textAnchor="middle"
                fontSize="6" fill="var(--border-bright)" fontFamily="var(--font-mono)"
              >
                n={b.count}
              </text>
            </g>
          );
        })}

        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--border)" strokeWidth="1" />
      </svg>

      <div style={s.legend}>
        <span><span style={{ ...s.swatch, background: "var(--verified)", opacity: 0.5 }} /> observed accuracy</span>
        <span><span style={{ ...s.swatch, background: "var(--flag)", height: 2 }} /> claimed confidence</span>
      </div>

      {floorRecommendation && (
        <div style={s.rec}>
          <span style={s.recLabel}>FLOOR RECOMMENDATION</span>
          <p style={s.recText}>
            {floorRecommendation.recommended !== null && (
              <strong style={{ color: "var(--signal)" }}>
                {Math.round(floorRecommendation.recommended * 100)}% —{" "}
              </strong>
            )}
            {floorRecommendation.reason}
          </p>
        </div>
      )}
    </div>
  );
}

const s = {
  empty: { background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 5, padding: 16 },
  emptyText: { fontSize: 13, lineHeight: 1.6, color: "var(--muted)", margin: 0 },
  summary: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 },
  stat: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "12px" },
  statVal: { display: "block", fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, lineHeight: 1.1 },
  statLabel: { display: "block", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)", letterSpacing: 1, marginTop: 3 },
  legend: { display: "flex", gap: 16, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)", marginTop: 6 },
  swatch: { display: "inline-block", width: 10, height: 8, marginRight: 5, verticalAlign: "middle", borderRadius: 1 },
  rec: { marginTop: 16, background: "var(--surface)", borderLeft: "3px solid var(--signal)", border: "1px solid var(--border)", borderRadius: 5, padding: 14 },
  recLabel: { fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: 1.5, color: "var(--muted)" },
  recText: { fontSize: 13, lineHeight: 1.6, margin: "6px 0 0" },
};
