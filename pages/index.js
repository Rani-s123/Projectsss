import { useState, useEffect } from "react";
import AuditLedger from "../components/AuditLedger";
import ReviewQueue from "../components/ReviewQueue";
import BatchDashboard from "../components/BatchDashboard";
import CalibrationChart from "../components/CalibrationChart";
import { SAMPLES } from "../lib/samples";

const DOC_TYPES = [
  { id: "invoice", label: "Invoice", sub: "EU e-invoice (EN 16931)" },
  { id: "identity", label: "ID document", sub: "KYC / AML onboarding" },
  { id: "contract", label: "Contract", sub: "Agreement record" },
];

const VIEW = { INTAKE: "intake", OPS: "ops", REVIEW: "review" };

export default function Home() {
  const [view, setView] = useState(VIEW.INTAKE);
  const [batch, setBatch] = useState(null);
  const [stats, setStats] = useState(null);
  const [queue, setQueue] = useState([]);
  const [calibration, setCalibration] = useState(null);
  const [floorRec, setFloorRec] = useState(null);

  const [docType, setDocType] = useState("invoice");
  const [jurisdiction, setJurisdiction] = useState("EU");
  const [documentText, setDocumentText] = useState("");
  const [filename, setFilename] = useState("");
  const [reviewer, setReviewer] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("reviewer_id");
    if (saved) setReviewer(saved);
  }, []);

  const handleReviewerChange = (val) => {
    setReviewer(val);
    localStorage.setItem("reviewer_id", val);
  };

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const [active, setActive] = useState(null);
  const [corrected, setCorrected] = useState({});
  const [notes, setNotes] = useState({});
  const [result, setResult] = useState(null);

  async function refresh(batchId) {
    const id = batchId || batch?.id;
    if (!id) return;
    const res = await fetch(`/api/batch?batchId=${id}`);
    const data = await res.json();
    if (res.ok) {
      setBatch(data.batch);
      setStats(data.stats);
      setQueue(data.queue);
      setCalibration(data.calibration);
      setFloorRec(data.floorRecommendation);
    }
  }

  async function ensureBatch() {
    if (batch) return batch;
    const res = await fetch("/api/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", name: "Session batch" }),
    });
    const data = await res.json();
    setBatch(data.batch);
    return data.batch;
  }

  function loadSample(type) {
    const t = type || docType;
    setDocType(t);
    setDocumentText(SAMPLES[t].text);
    setFilename(`${t}-sample.txt`);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setDocumentText((await file.text()).slice(0, 40000));
  }

  async function processDoc(overrideType, overrideText, overrideName) {
    const t = overrideType || docType;
    const text = overrideText || documentText;
    const name = overrideName || filename;
    if (!text?.trim()) return;

    setError("");
    setBusy(`Extracting ${name || t}…`);
    try {
      const b = await ensureBatch();

      const exRes = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docType: t, documentText: text, filename: name, jurisdiction }),
      });
      const exData = await exRes.json();
      if (!exRes.ok) throw new Error(exData.error);

      setBusy(`Triaging ${name || t}…`);
      const trRes = await fetch("/api/triage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docType: t, extraction: exData.extraction,
          validation: exData.validation, ledger: exData.ledger,
        }),
      });
      const trData = await trRes.json();
      if (!trRes.ok) throw new Error(trData.error);

      const status =
        trData.triage.disposition === "auto_clear" ? "cleared"
        : trData.triage.disposition === "reject" ? "blocked"
        : "review_required";

      await fetch("/api/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "addDocument",
          batchId: b.id,
          document: {
            docType: t, filename: name, status,
            extraction: exData.extraction,
            validation: exData.validation,
            triage: trData.triage,
            ledger: trData.ledger,
          },
        }),
      });

      await refresh(b.id);
      setDocumentText(""); setFilename("");
      setView(VIEW.OPS);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function loadAllSamples() {
    setError("");
    for (const t of Object.keys(SAMPLES)) {
      await processDoc(t, SAMPLES[t].text, `${t}-sample.txt`);
    }
  }

  function openDoc(doc) {
    setActive(doc);
    setCorrected({ ...doc.extraction.fields });
    setNotes({});
    setResult(null);
    setView(VIEW.REVIEW);
  }

  async function release() {
    setBusy("Re-validating and releasing…");
    setError("");
    try {
      const decisions = (active.triage.escalations || []).map((e) => ({
        field: e.field,
        note: notes[e.field] || null,
      }));

      const res = await fetch("/api/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docType: active.docType,
          originalFields: active.extraction.fields,
          correctedFields: corrected,
          confidence: active.extraction.confidence,
          decisions,
          reviewer: reviewer || "unidentified-reviewer",
          ledger: active.ledger,
          batchId: batch.id,
          docId: active.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setResult(data);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.brand}>
          <span style={s.mark} />
          <span style={s.brandName}>COMPLIANCE COPILOT</span>
        </div>
        <nav style={s.nav}>
          <NavBtn on={view === VIEW.INTAKE} onClick={() => setView(VIEW.INTAKE)}>Intake</NavBtn>
          <NavBtn on={view === VIEW.OPS} onClick={() => { refresh(); setView(VIEW.OPS); }} disabled={!batch}>
            Operations{stats?.byStatus?.review_required ? ` (${stats.byStatus.review_required})` : ""}
          </NavBtn>
        </nav>
      </header>

      <main style={s.main}>
        <div style={s.col}>
          {busy && <div style={s.busy}>{busy}</div>}
          {error && <p style={s.error}>{error}</p>}

          {view === VIEW.INTAKE && (
            <Intake
              {...{ docType, setDocType, jurisdiction, setJurisdiction, documentText, setDocumentText, filename,
                    handleFile, loadSample, loadAllSamples, reviewer, handleReviewerChange,
                    processDoc, busy }}
            />
          )}

          {view === VIEW.OPS && (
            <Ops
              {...{ stats, queue, calibration, floorRec, openDoc,
                    activeDocId: active?.id, onAddMore: () => setView(VIEW.INTAKE) }}
            />
          )}

          {view === VIEW.REVIEW && active && (
            <Review
              {...{ active, corrected, setCorrected, notes, setNotes, reviewer,
                    setReviewer, release, busy, result,
                    onBack: () => { setActive(null); setResult(null); setView(VIEW.OPS); } }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function NavBtn({ children, on, ...rest }) {
  return (
    <button style={{ ...s.navBtn, ...(on ? s.navBtnOn : {}) }} {...rest}>
      {children}
    </button>
  );
}

function Intake({ docType, setDocType, jurisdiction, setJurisdiction, documentText, setDocumentText, filename, handleFile, loadSample, loadAllSamples, reviewer, handleReviewerChange, processDoc, busy }) {
  return (
    <>
      <h1 style={s.h1}>Messy documents in.<br />Provable records out.</h1>
      <p style={s.lede}>
        Agents extract and score every field, deterministic rules check what must never be
        guessed, and only genuinely uncertain fields reach a human — prioritised by
        consequence, not just uncertainty. Every step is written to a hash-chained ledger.
      </p>

      <button style={s.demoBtn} onClick={loadAllSamples} disabled={Boolean(busy)}>
        Run all three samples →
      </button>
      <p style={s.demoNote}>
        Each sample carries deliberately planted defects. A clean document proves nothing
        about a system whose job is deciding what a human must look at.
      </p>

      <Label>Or process one document</Label>
      <div style={s.typeRow}>
        {DOC_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => setDocType(t.id)}
            style={{ ...s.typeBtn, ...(docType === t.id ? s.typeBtnOn : {}) }}
          >
            <span style={s.typeLabel}>{t.label}</span>
            <span style={s.typeSub}>{t.sub}</span>
          </button>
        ))}
      </div>

      <Label>Compliance Jurisdiction</Label>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          onClick={() => setJurisdiction("EU")}
          style={{
            ...s.ghostBtn,
            flex: 1,
            background: jurisdiction === "EU" ? "var(--surface-2)" : "transparent",
            borderColor: jurisdiction === "EU" ? "var(--signal)" : "var(--border)",
            color: jurisdiction === "EU" ? "var(--signal)" : "var(--muted)",
          }}
        >
          🇪🇺 EU Mandates (VAT / EN 16931)
        </button>
        <button
          onClick={() => setJurisdiction("US")}
          style={{
            ...s.ghostBtn,
            flex: 1,
            background: jurisdiction === "US" ? "var(--surface-2)" : "transparent",
            borderColor: jurisdiction === "US" ? "var(--signal)" : "var(--border)",
            color: jurisdiction === "US" ? "var(--signal)" : "var(--muted)",
          }}
        >
          🇺🇸 US Rules (IRS Tax ID / Sales Tax)
        </button>
      </div>

      <div style={s.sourceRow}>
        <label style={s.fileBtn}>
          {filename || "Upload .txt / .md"}
          <input type="file" accept=".txt,.md,text/plain" onChange={handleFile} style={{ display: "none" }} />
        </label>
        <button style={s.ghostBtn} onClick={() => loadSample()}>Load this sample</button>
      </div>

      <textarea
        style={s.doc} rows={10} value={documentText}
        onChange={(e) => setDocumentText(e.target.value)}
        placeholder="Paste document text, upload a file, or load a sample."
      />

      <Label>Reviewer identity</Label>
      <input
        style={s.input} value={reviewer} onChange={(e) => handleReviewerChange(e.target.value)}
        placeholder="e.g. a.sharma@firm.com — recorded against every human decision"
      />

      <button style={s.primary} onClick={() => processDoc()} disabled={!documentText.trim() || Boolean(busy)}>
        Process document →
      </button>
    </>
  );
}

function Ops({ stats, queue, calibration, floorRec, openDoc, activeDocId, onAddMore }) {
  return (
    <>
      <h1 style={s.h2}>Operations</h1>
      <BatchDashboard stats={stats} queue={queue} onOpen={openDoc} activeDocId={activeDocId} />

      <SectionTitle>Confidence calibration</SectionTitle>
      <p style={s.calNote}>
        Every field a reviewer confirms or corrects is a labelled sample of whether the
        model&apos;s confidence was earned. The auto-clear floor — the number that decides how
        much human labour this saves — is set from this, not from intuition.
      </p>
      <CalibrationChart calibration={calibration} floorRecommendation={floorRec} />

      <button style={{ ...s.ghostBtn, width: "100%", marginTop: 28, padding: 13 }} onClick={onAddMore}>
        + Add another document
      </button>
    </>
  );
}

function Review({ active, corrected, setCorrected, notes, setNotes, reviewer, setReviewer, release, busy, result, onBack }) {
  const t = active.triage;
  const v = active.validation;
  const tone = t.disposition === "auto_clear" ? "var(--verified)"
    : t.disposition === "reject" ? "var(--critical)" : "var(--flag)";
  const escalated = new Set((t.escalations || []).map((e) => e.field));
  const cleared = Object.keys(active.extraction.fields || {}).filter((f) => !escalated.has(f));

  if (result) {
    const ok = result.released;
    return (
      <>
        <button style={s.backBtn} onClick={onBack}>← Back to operations</button>
        <div style={{ ...s.dispBar, borderColor: ok ? "var(--verified)" : "var(--critical)" }}>
          <span style={{ ...s.dispLabel, color: ok ? "var(--verified)" : "var(--critical)" }}>
            {ok ? "RECORD RELEASED" : "RELEASE BLOCKED"}
          </span>
          <p style={s.dispRationale}>
            {ok
              ? "The record passed all deterministic rules after review, was generated in its compliant form, and sealed against its audit trail."
              : result.message}
          </p>
        </div>

        {ok && result.templateContext?.mandatoryStatements?.length > 0 && (
          <>
            <SectionTitle>Mandatory statements applied</SectionTitle>
            {result.templateContext.mandatoryStatements.map((m, i) => (
              <p key={i} style={s.statement}>{m}</p>
            ))}
          </>
        )}

        {!ok && result.revalidation?.failed?.length > 0 && (
          <>
            <SectionTitle>Still failing after review</SectionTitle>
            {result.revalidation.failed.map((f) => (
              <div key={f.id} style={s.ruleFail}>
                <p style={s.ruleName}>{f.describe}</p>
                <p style={s.ruleMsg}>{f.message}</p>
              </div>
            ))}
          </>
        )}

        <div style={{ marginTop: 32 }}>
          <AuditLedger ledger={result.ledger} verification={result.verification} fingerprint={result.fingerprint} />
        </div>
      </>
    );
  }

  return (
    <>
      <button style={s.backBtn} onClick={onBack}>← Back to operations</button>

      <div style={{ ...s.dispBar, borderColor: tone }}>
        <span style={{ ...s.dispLabel, color: tone }}>{t.disposition.replace(/_/g, " ").toUpperCase()}</span>
        <p style={s.dispRationale}>{t.rationale}</p>
        {t.overriddenByPolicy && <p style={s.policyNote}>⛔ {t.policyNote}</p>}
      </div>

      <div style={s.statRow}>
        <Stat value={cleared.length} label="auto-cleared" tone="var(--verified)" />
        <Stat value={t.escalations?.length || 0} label="need review" tone="var(--flag)" />
        <Stat value={v?.failed?.length || 0} label="rules failed" tone={v?.failed?.length ? "var(--critical)" : "var(--muted)"} />
      </div>

      {v?.failed?.length > 0 && (
        <>
          <SectionTitle>Deterministic rule failures</SectionTitle>
          {v.failed.map((f) => (
            <div key={f.id} style={s.ruleFail}>
              <p style={s.ruleName}>{f.describe}</p>
              <p style={s.ruleMsg}>{f.message}</p>
            </div>
          ))}
        </>
      )}

      {t.escalations?.length > 0 && (
        <>
          <SectionTitle>Review queue — {t.escalations.length} field(s)</SectionTitle>
          <ReviewQueue
            escalations={t.escalations}
            values={corrected}
            confidence={active.extraction.confidence}
            notes={notes}
            onChange={(f, val) => setCorrected((p) => ({ ...p, [f]: val }))}
            onNote={(f, val) => setNotes((p) => ({ ...p, [f]: val }))}
          />
        </>
      )}

      {cleared.length > 0 && (
        <>
          <SectionTitle>Auto-cleared — no review needed</SectionTitle>
          <div style={s.clearedGrid}>
            {cleared.map((f) => (
              <div key={f} style={s.clearedItem}>
                <span style={s.clearedKey}>{f}</span>
                <span style={s.clearedVal}>
                  {Array.isArray(corrected[f]) ? `${corrected[f].length} item(s)` : String(corrected[f] ?? "—").slice(0, 40)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Risk if released unreviewed</SectionTitle>
      <p style={s.risk}>{t.riskIfReleased}</p>

      {!reviewer && (
        <input
          style={{ ...s.input, marginTop: 16 }} value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          placeholder="Reviewer identity — recorded against every decision"
        />
      )}

      <button style={s.primary} onClick={release} disabled={Boolean(busy)}>
        {busy || "Approve and release record →"}
      </button>

      <div style={{ marginTop: 40 }}>
        <AuditLedger ledger={active.ledger} />
      </div>
    </>
  );
}

function Stat({ value, label, tone }) {
  return (
    <div style={s.stat}>
      <span style={{ ...s.statVal, color: tone }}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  );
}

function Label({ children }) { return <p style={s.label}>{children}</p>; }
function SectionTitle({ children }) { return <p style={s.sectionTitle}>{children}</p>; }

const s = {
  page: { minHeight: "100vh" },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 24px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", gap: 10,
  },
  brand: { display: "flex", alignItems: "center", gap: 9 },
  mark: { width: 9, height: 9, background: "var(--signal)", borderRadius: 1, transform: "rotate(45deg)" },
  brandName: { fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, letterSpacing: 2 },
  nav: { display: "flex", gap: 4 },
  navBtn: {
    background: "transparent", border: "1px solid transparent", borderRadius: 4,
    padding: "6px 12px", color: "var(--muted)", fontSize: 12.5,
    fontFamily: "var(--font-mono)", letterSpacing: 0.5,
  },
  navBtnOn: { color: "var(--signal)", borderColor: "var(--border-bright)", background: "var(--surface)" },
  main: { display: "flex", justifyContent: "center", padding: "36px 20px 100px" },
  col: { width: "100%", maxWidth: 660 },
  busy: {
    fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--signal)",
    background: "var(--surface)", border: "1px solid var(--border-bright)",
    borderRadius: 4, padding: "10px 14px", marginBottom: 18,
  },
  h1: { fontSize: 34, lineHeight: 1.1, fontWeight: 700, letterSpacing: -0.8, margin: "0 0 14px" },
  h2: { fontSize: 24, fontWeight: 700, letterSpacing: -0.4, margin: "0 0 20px" },
  lede: { fontSize: 15, lineHeight: 1.65, color: "var(--muted)", margin: "0 0 28px" },
  demoBtn: {
    width: "100%", padding: 13, background: "transparent", border: "1px solid var(--signal)",
    borderRadius: 4, color: "var(--signal)", fontSize: 14, fontWeight: 600,
  },
  demoNote: { fontSize: 12.5, lineHeight: 1.55, color: "var(--muted)", margin: "10px 0 34px" },
  label: { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1.5, color: "var(--muted)", margin: "0 0 10px" },
  sectionTitle: { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1.5, color: "var(--muted)", margin: "34px 0 12px" },
  calNote: { fontSize: 13, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 16px" },
  typeRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginBottom: 12 },
  typeBtn: {
    display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start",
    padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 5, color: "var(--muted)", textAlign: "left",
  },
  typeBtnOn: { borderColor: "var(--signal)", color: "var(--text)", background: "var(--surface-2)" },
  typeLabel: { fontSize: 14, fontWeight: 600 },
  typeSub: { fontFamily: "var(--font-mono)", fontSize: 10, opacity: 0.75 },
  sourceRow: { display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  fileBtn: {
    flex: 1, minWidth: 170, padding: "10px 14px", background: "var(--surface)",
    border: "1px dashed var(--border-bright)", borderRadius: 4, color: "var(--muted)",
    fontSize: 13, cursor: "pointer", textAlign: "center",
  },
  ghostBtn: {
    padding: "10px 16px", background: "transparent", border: "1px solid var(--border-bright)",
    borderRadius: 4, color: "var(--signal)", fontSize: 13,
  },
  doc: {
    width: "100%", padding: 14, background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 5, color: "var(--text)", fontSize: 12.5, fontFamily: "var(--font-mono)",
    lineHeight: 1.6, resize: "vertical", marginBottom: 24,
  },
  input: {
    width: "100%", padding: "11px 13px", background: "var(--surface)",
    border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)",
    fontSize: 14, marginBottom: 22,
  },
  primary: {
    width: "100%", padding: 14, background: "var(--signal)", color: "#0E1216",
    border: "none", borderRadius: 4, fontSize: 14, fontWeight: 600,
  },
  backBtn: {
    background: "transparent", border: "none", color: "var(--muted)",
    fontSize: 12.5, fontFamily: "var(--font-mono)", padding: 0, marginBottom: 18,
  },
  error: { color: "var(--critical)", fontSize: 13, marginBottom: 14 },
  dispBar: {
    background: "var(--surface)", border: "1px solid", borderLeftWidth: 3,
    borderRadius: 5, padding: "16px 18px", marginBottom: 18,
  },
  dispLabel: { fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, letterSpacing: 1.5 },
  dispRationale: { fontSize: 14, lineHeight: 1.6, margin: "8px 0 0" },
  policyNote: { fontSize: 12.5, lineHeight: 1.5, color: "var(--critical)", margin: "10px 0 0", fontFamily: "var(--font-mono)" },
  statement: {
    fontSize: 13, lineHeight: 1.55, color: "var(--flag)", background: "var(--surface)",
    borderLeft: "3px solid var(--flag)", borderRadius: 3, padding: "10px 14px", margin: "0 0 8px",
  },
  statRow: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 },
  stat: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "13px 14px" },
  statVal: { display: "block", fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 600, lineHeight: 1 },
  statLabel: { display: "block", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)", letterSpacing: 1, marginTop: 5 },
  ruleFail: {
    background: "var(--surface)", borderLeft: "3px solid var(--critical)",
    border: "1px solid var(--border)", borderRadius: 5, padding: 14, marginBottom: 8,
  },
  ruleName: { fontSize: 13, fontWeight: 600, margin: "0 0 4px" },
  ruleMsg: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--critical)", margin: 0, lineHeight: 1.5 },
  clearedGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 6 },
  clearedItem: {
    display: "flex", justifyContent: "space-between", gap: 8, padding: "9px 12px",
    background: "var(--surface)", borderLeft: "2px solid var(--verified)", borderRadius: 3,
  },
  clearedKey: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" },
  clearedVal: { fontSize: 12, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  risk: { fontSize: 14, lineHeight: 1.6, color: "var(--flag)", margin: "0 0 22px" },
};
