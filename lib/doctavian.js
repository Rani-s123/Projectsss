// Doctavian integration — compliant document generation.
//
// Nutrient DWS handles the inbound side (parse the messy original, sign the
// output). Doctavian handles the outbound side: taking the cleared structured
// data and generating the correctly shaped compliant document from it.
//
// Demo credentials are supplied through Vercel Environment Variables:
//   DOCTAVIAN_API_KEY
//   DOCTAVIAN_API_BASE_URL (optional; defaults to the hackathon demo API)
//
// Doctavian demo authentication uses the x-api-key header, not Bearer auth.

const BASE = (process.env.DOCTAVIAN_API_BASE_URL || "https://demo.api.doctavian.com").replace(/\/$/, "");

export function doctavianConfigured() {
  return Boolean(process.env.DOCTAVIAN_API_KEY);
}

async function dv(path, body, { raw = false } = {}) {
  const apiKey = process.env.DOCTAVIAN_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Doctavian ${path} failed (${res.status}): ${await res.text()}`);
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : await res.json();
}

export function deriveTemplateContext(docType, fields) {
  const ctx = { docType, ...fields };

  if (docType === "invoice") {
    const supplierCountry = (fields.supplierVatId || "").slice(0, 2).toUpperCase();
    const buyerCountry = (fields.buyerVatId || "").slice(0, 2).toUpperCase();
    const crossBorder = Boolean(
      supplierCountry && buyerCountry && supplierCountry !== buyerCountry
    );
    const tax = Number(fields.taxTotal) || 0;

    ctx.supplierCountry = supplierCountry || null;
    ctx.buyerCountry = buyerCountry || null;
    ctx.reverseCharge = crossBorder && tax === 0;
    ctx.crossBorder = crossBorder;
    ctx.mandatoryStatements = ctx.reverseCharge
      ? ["Reverse charge — VAT to be accounted for by the recipient (Art. 196 VAT Directive)"]
      : [];
    ctx.taxTreatment = ctx.reverseCharge
      ? "reverse_charge"
      : crossBorder
      ? "cross_border_taxed"
      : "domestic";
  }

  if (docType === "identity") {
    const expiry = fields.expiryDate ? new Date(fields.expiryDate) : null;
    const monthsLeft = expiry ? (expiry - new Date()) / (30.44 * 24 * 3600 * 1000) : null;
    ctx.expiringSoon = monthsLeft !== null && monthsLeft > 0 && monthsLeft < 6;
    ctx.expired = monthsLeft !== null && monthsLeft <= 0;
    ctx.mandatoryStatements = ctx.expiringSoon
      ? ["Identity document expires within 6 months — re-verification required before expiry"]
      : [];
  }

  if (docType === "contract") {
    const parties = Array.isArray(fields.parties) ? fields.parties : [];
    ctx.partyCount = parties.length;
    ctx.multiJurisdiction = /(?:\band\b|\/|,).*(?:law|jurisdiction)|(?:law|jurisdiction).*(?:\band\b|\/|,)/i
      .test(String(fields.governingLaw || ""));
    ctx.mandatoryStatements = ctx.multiJurisdiction
      ? ["Multiple governing law references detected — jurisdiction clause requires legal confirmation"]
      : [];
  }

  return ctx;
}

export async function generateComplianceDocument({ docType, fields, ledgerFingerprint, reviewer, sign = false }) {
  if (!doctavianConfigured()) {
    return { generated: false, reason: "DOCTAVIAN_API_KEY not configured" };
  }

  const context = deriveTemplateContext(docType, fields);

  try {
    const generated = await dv("/documents/generate", {
      template: `compliance-${docType}`,
      data: {
        ...context,
        provenance: {
          ledgerFingerprint,
          reviewer: reviewer || "unidentified-reviewer",
          clearedAt: new Date().toISOString(),
        },
      },
      output: { format: "pdf" },
    });

    if (!sign) {
      return {
        generated: true,
        signed: false,
        documentId: generated?.id || null,
        url: generated?.url || null,
        context,
      };
    }

    const signed = await dv("/documents/sign", {
      documentId: generated?.id,
      reason: "Compliance record cleared after human review",
      signer: reviewer || "compliance-copilot",
    });

    return {
      generated: true,
      signed: true,
      documentId: generated?.id || null,
      url: signed?.url || generated?.url || null,
      context,
    };
  } catch (err) {
    return { generated: false, reason: err.message, context };
  }
}
