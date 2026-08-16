// The audit ledger, rendered as a chained tape.
//
// The design thesis of this whole product lives here: each entry visibly links
// to the hash of the one before it, and the actor column is colour-coded so a
// reviewer can see at a glance where a machine decided something and where a
// human did. That distinction is the entire regulatory point.

const ACTOR_STYLE = {
  system: { color: "var(--muted)", label: "SYSTEM" },
  "agent:extractor": { color: "var(--signal)", label: "AGENT" },
  "agent:triage": { color: "var(--signal)", label: "AGENT" },
  human: { color: "var(--flag)", label: "HUMAN" },
};

function actorStyle(actor) {
  if (actor?.startsWith("human:")) return ACTOR_STYLE.human;
  return ACTOR_STYLE[actor] || ACTOR_STYLE.system;
}

const STEP_TONE = {
  RELEASE_BLOCKED: "var(--critical)",
  RELEASED: "var(--verified)",
  HUMAN_CORRECTION: "var(--flag)",
  HUMAN_CONFIRMATION: "var(--flag)",
};

export default function AuditLedger({ ledger = [], verification, fingerprint }) {
  if (!ledger.length) return null;

  const handleExport = async () => {
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ledger }),
      });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit_verification_${fingerprint || "proof"}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to export verification proof: " + err.message);
    }
  };

  return (
    <div>
      <div style={s.head}>
        <span style={s.headTitle}>AUDIT LEDGER</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={s.exportBtn} onClick={handleExport} title="Download offline tamper-proof verification proof">
            EXPORT PROOF (.JSON)
          </button>
          {verification && (
            <span style={{ ...s.chip, color: verification.valid ? "var(--verified)" : "var(--critical)", borderColor: verification.valid ? "var(--verified)" : "var(--critical)" }}>
              {verification.valid
                ? `CHAIN INTACT · ${verification.entries} ENTRIES`
                : `CHAIN BROKEN AT #${verification.brokenAt}`}
            </span>
          )}
        </div>
      </div>

      {fingerprint && (
        <p style={s.fingerprint}>
          RECORD FINGERPRINT <span style={s.fingerprintVal}>{fingerprint}</span>
        </p>
      )}

      <div style={s.tape}>
        {ledger.map((e, i) => {
          const a = actorStyle(e.actor);
          const tone = STEP_TONE[e.step];
          const isLast = i === ledger.length - 1;
          return (
            <div key={e.seq} style={s.entry}>
              <div style={s.rail}>
                <span style={{ ...s.node, borderColor: tone || a.color }} />
                {!isLast && <span style={s.link} />}
              </div>

              <div style={s.body}>
                <div style={s.topRow}>
                  <span style={{ ...s.step, color: tone || "var(--text)" }}>{e.step.replace(/_/g, " ")}</span>
                  <span style={{ ...s.actor, color: a.color, borderColor: a.color }}>
                    {a.label}
                    {e.actor?.startsWith("human:") && `: ${e.actor.slice(6)}`}
                  </span>
                </div>

                <p style={s.detail}>{e.detail}</p>

                <div style={s.hashRow}>
                  <span style={s.seq}>#{String(e.seq).padStart(2, "0")}</span>
                  <span style={s.time}>{new Date(e.timestamp).toISOString().replace("T", " ").slice(0, 19)}</span>
                  <span style={s.hash} title={`hash ${e.hash}\nprev ${e.prevHash}`}>
                    ←{e.prevHash === "GENESIS" ? "GENESIS" : e.prevHash.slice(0, 8)} · {e.hash.slice(0, 8)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s = {
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  headTitle: { fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 1.5, color: "var(--muted)" },
  exportBtn: {
    fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1,
    background: "transparent", border: "1px solid var(--border-bright)",
    borderRadius: 3, padding: "3px 8px", color: "var(--signal)", cursor: "pointer",
  },
  chip: {
    fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1,
    border: "1px solid", borderRadius: 3, padding: "3px 7px",
  },
  fingerprint: { fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 1, margin: "0 0 14px" },
  fingerprintVal: { color: "var(--signal)", marginLeft: 6 },
  tape: { borderLeft: "1px solid var(--border)", paddingLeft: 0 },
  entry: { display: "flex", gap: 12 },
  rail: { display: "flex", flexDirection: "column", alignItems: "center", width: 14, flexShrink: 0, marginLeft: -7 },
  node: { width: 11, height: 11, borderRadius: "50%", border: "2px solid", background: "var(--bg)", marginTop: 4, flexShrink: 0 },
  link: { flex: 1, width: 1, background: "var(--border)", minHeight: 12 },
  body: { flex: 1, paddingBottom: 18 },
  topRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  step: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: 1 },
  actor: { fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: 1, border: "1px solid", borderRadius: 3, padding: "1px 5px" },
  detail: { fontSize: 13, lineHeight: 1.55, color: "var(--text)", margin: "5px 0 6px" },
  hashRow: { display: "flex", gap: 10, flexWrap: "wrap", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)" },
  seq: { color: "var(--border-bright)" },
  time: {},
  hash: { color: "var(--border-bright)", cursor: "help" },
};
