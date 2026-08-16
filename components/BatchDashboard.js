// Batch dashboard — the operations view.
//
// Two things a compliance manager actually asks: how much did the machine save
// me, and what does my reviewer open next. Everything here answers one of those.

const STATUS_TONE = {
  pending: "var(--muted)",
  review_required: "var(--flag)",
  cleared: "var(--verified)",
  blocked: "var(--critical)",
};

export default function BatchDashboard({ stats, queue, onOpen, activeDocId }) {
  const automation = stats?.automationRate;

  return (
    <div>
      <div style={s.statRow}>
        <Stat value={stats?.total ?? 0} label="documents" />
        <Stat
          value={automation !== null && automation !== undefined ? `${Math.round(automation * 100)}%` : "—"}
          label="fields auto-cleared"
          tone="var(--verified)"
        />
        <Stat
          value={stats?.byStatus?.review_required ?? 0}
          label="awaiting review"
          tone="var(--flag)"
        />
        <Stat
          value={stats?.byStatus?.blocked ?? 0}
          label="blocked"
          tone={stats?.byStatus?.blocked ? "var(--critical)" : "var(--muted)"}
        />
      </div>

      {automation !== null && automation !== undefined && (
        <div style={s.bar}>
          <span style={{ ...s.barFill, width: `${automation * 100}%` }} />
          <span style={s.barLabel}>
            {stats.autoClearedFields} of {stats.autoClearedFields + stats.escalatedFields} fields never needed a human
          </span>
        </div>
      )}

      {queue?.length > 0 && (
        <>
          <p style={s.queueTitle}>REVIEW QUEUE — PRIORITISED</p>
          {queue.map((doc, i) => (
            <button
              key={doc.id}
              onClick={() => onOpen(doc)}
              style={{
                ...s.row,
                ...(activeDocId === doc.id ? s.rowActive : {}),
              }}
            >
              <span style={s.rank}>{String(i + 1).padStart(2, "0")}</span>

              <span style={s.rowMain}>
                <span style={s.rowName}>{doc.filename || doc.docType}</span>
                <span style={s.rowReasons}>
                  {doc.reasons?.length ? doc.reasons.join(" · ") : "uncertain fields"}
                </span>
              </span>

              <span style={s.rowRight}>
                <span style={{ ...s.priority, color: priorityTone(doc.priority) }}>
                  {doc.priority}
                </span>
                <span style={s.priorityLabel}>priority</span>
              </span>
            </button>
          ))}
        </>
      )}

      {queue?.length === 0 && stats?.total > 0 && (
        <p style={s.clear}>Queue is clear — every document has been cleared or blocked.</p>
      )}
    </div>
  );
}

function priorityTone(p) {
  if (p >= 150) return "var(--critical)";
  if (p >= 70) return "var(--flag)";
  return "var(--signal)";
}

function Stat({ value, label, tone }) {
  return (
    <div style={s.stat}>
      <span style={{ ...s.statVal, color: tone || "var(--text)" }}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  );
}

const s = {
  statRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, marginBottom: 12 },
  stat: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "13px 14px" },
  statVal: { display: "block", fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 600, lineHeight: 1 },
  statLabel: { display: "block", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)", letterSpacing: 1, marginTop: 5 },
  bar: {
    position: "relative", height: 30, background: "var(--surface)",
    border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden",
    display: "flex", alignItems: "center", marginBottom: 8,
  },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, background: "var(--verified)", opacity: 0.18 },
  barLabel: { position: "relative", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", paddingLeft: 12, letterSpacing: 0.5 },
  queueTitle: { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1.5, color: "var(--muted)", margin: "26px 0 10px" },
  row: {
    display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5,
    padding: "12px 14px", marginBottom: 6, color: "var(--text)",
  },
  rowActive: { borderColor: "var(--signal)", background: "var(--surface-2)" },
  rank: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--border-bright)", flexShrink: 0 },
  rowMain: { flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
  rowName: { fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowReasons: { fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--flag)" },
  rowRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 },
  priority: { fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600, lineHeight: 1 },
  priorityLabel: { fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--muted)", letterSpacing: 1 },
  clear: { fontSize: 13, color: "var(--verified)", fontFamily: "var(--font-mono)", marginTop: 20 },
};
