// Nutrient DWS integration.
//
// DWS is the deterministic half of this pipeline: it parses documents, and it
// digitally signs the cleared output so the result is tamper-evident and dated.
// The model never touches the signing step — a signature you can't verify is
// worse than no signature.
//
// Requires NUTRIENT_API_KEY. Falls back gracefully so the app is demoable
// without credentials.

const DWS_BASE = "https://api.nutrient.io";

export function dwsConfigured() {
  return Boolean(process.env.NUTRIENT_API_KEY);
}

// Extracts text from an uploaded PDF/image via DWS, so downstream reasoning
// runs on the real document rather than on a user-pasted approximation.
export async function extractDocumentText(fileBuffer, filename) {
  const apiKey = process.env.NUTRIENT_API_KEY;
  if (!apiKey) return null;

  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), filename);
  form.append(
    "instructions",
    JSON.stringify({ parts: [{ file: "file" }], output: { type: "plain-text" } })
  );

  try {
    const res = await fetch(`${DWS_BASE}/build`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.error("DWS extract failed:", res.status, await res.text());
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error("DWS extract error:", err.message);
    return null;
  }
}

// Produces the final PDF of the cleared record and digitally signs it, so the
// exported artifact carries provable authenticity and a timestamp.
export async function generateSignedPdf(htmlContent, filename = "compliance-record.pdf") {
  const apiKey = process.env.NUTRIENT_API_KEY;
  if (!apiKey) return { signed: false, reason: "NUTRIENT_API_KEY not configured" };

  const form = new FormData();
  form.append("file", new Blob([htmlContent], { type: "text/html" }), "record.html");
  form.append(
    "instructions",
    JSON.stringify({ parts: [{ file: "file" }], output: { type: "pdf" } })
  );

  try {
    const res = await fetch(`${DWS_BASE}/build`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      return { signed: false, reason: `DWS build failed (${res.status})` };
    }
    const pdfBuffer = Buffer.from(await res.arrayBuffer());

    const signForm = new FormData();
    signForm.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), filename);
    const signRes = await fetch(`${DWS_BASE}/sign`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: signForm,
    });

    if (!signRes.ok) {
      return { signed: false, pdf: pdfBuffer.toString("base64"), reason: `Signing failed (${signRes.status})` };
    }

    const signedBuffer = Buffer.from(await signRes.arrayBuffer());
    return { signed: true, pdf: signedBuffer.toString("base64") };
  } catch (err) {
    return { signed: false, reason: err.message };
  }
}
