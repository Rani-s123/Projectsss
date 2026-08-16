// The human review queue.
//
// Only escalated fields appear here. That is the product: a reviewer looking at
// three flagged fields instead of re-keying forty, with the reason for each
// escalation stated so they know what they are actually checking.

const SEVERITY = {
  critical: { color: "var(--critical)", label: "CRITICAL" },
  high: { color: "var(--flag)", label: "HIGH" },
  medium: { color: "var(--signal)", label: "MEDIUM" },
};

export default function ReviewQueue({ escalations, values, confidence, onChange, notes, onNote }) {
  if (!escalations?.length) return null;

  return (
    <div>
      {escalations.map((e) => {
        const sev = SEVERITY[e.severity] || SEVERITY.medium;
        const raw = values?.[e.field];
        const isComplex = Array.isArray(raw) || (raw && typeof raw === "object");
        const conf = confidence?.[e.field];

        return (
          <div key={e.field} style={{ ...s.card, borderLeftColor: sev.color }}>
            <div style={s.head}>
              <span style={s.field}>{e.field}</span>
              <div style={s.headRight}>
                {typeof conf === "number" && (
                  <span style={s.conf}>
                    <span style={{ ...s.confBar, width: `${Math.round(conf * 100)}%`, background: sev.color }} />
                    <span style={s.confText}>{Math.round(conf * 100)}%</span>
                  </span>
                )}
                <span style={{ ...s.sev, color: sev.color, borderColor: sev.color }}>{sev.label}</span>
              </div>
            </div>

            <p style={s.reason}>{e.reason}</p>
            <p style={s.check}>
              <span style={s.checkLabel}>CHECK</span> {e.whatToCheck}
            </p>

            {isComplex ? (
              <textarea
                style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 12 }}
                rows={5}
                value={JSON.stringify(raw, null, 2)}
                onChange={(ev) => {
                  try {
                    onChange(e.field, JSON.parse(ev.target.value));
                  } catch {
                    /* keep the last valid value while the reviewer is mid-edit */
                  }
                }}
              />
            ) : (
              <input
                style={s.input}
                value={raw ?? ""}
                placeholder="empty — enter the correct value"
                onChange={(ev) => onChange(e.field, ev.target.value)}
              />
            )}

            <input
              style={s.noteInput}
              value={notes?.[e.field] || ""}
              placeholder="Reviewer note (recorded in the audit ledger)"
              onChange={(ev) => onNote(e.field, ev.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}

const s = {
  card: {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderLeft: "3px solid", borderRadius: 6, padding: 16, marginBottom: 12,
  },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 },
  field: { fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 },
  headRight: { display: "flex", alignItems: "center", gap: 10 },
  conf: { position: "relative", display: "inline-flex", alignItems: "center", width: 62, height: 16, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" },
  confBar: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.35 },
  confText: { position: "relative", fontFamily: "var(--font-mono)", fontSize: 10, width: "100%", textAlign: "center" },
  sev: { fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: 1, border: "1px solid", borderRadius: 3, padding: "2px 6px" },
  reason: { fontSize: 13, lineHeight: 1.55, color: "var(--text)", margin: "0 0 8px" },
  check: { fontSize: 12, lineHeight: 1.5, color: "var(--muted)", margin: "0 0 12px" },
  checkLabel: { fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: 1, color: "var(--signal)", marginRight: 6 },
  input: {
    width: "100%", padding: "10px 12px", background: "var(--bg)",
    border: "1px solid var(--border-bright)", borderRadius: 4, color: "var(--text)",
    fontSize: 14, fontFamily: "var(--font-sans)", marginBottom: 8, resize: "vertical",
  },
  noteInput: {
    width: "100%", padding: "8px 12px", background: "transparent",
    border: "1px dashed var(--border)", borderRadius: 4, color: "var(--muted)",
    fontSize: 12, fontFamily: "var(--font-sans)",
  },
};
