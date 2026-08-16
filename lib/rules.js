// Deterministic compliance rules.
//
// The model extracts and reasons. It does NOT decide whether a VAT number is
// structurally valid or whether an invoice's line items sum to its total —
// those are arithmetic and regex, and a model that "usually" gets arithmetic
// right is worthless in a regulated context. Anything checkable is checked here.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EU_VAT = /^[A-Z]{2}[0-9A-Z]{8,12}$/;
const US_EIN = /^\d{2}-\d{7}$|^\d{9}$/;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export const JURISDICTIONS = {
  EU: "EU (EN 16931 / VAT Directive)",
  US: "US (IRS Tax ID / US Dollar standard)",
};

export const DOCUMENT_TYPES = {
  invoice: {
    label: "Invoice → Compliance Check",
    regulation: "e-Invoicing Mandate",
    requiredFields: [
      "invoiceNumber", "issueDate", "supplierName", "supplierVatId",
      "buyerName", "currency", "lineItems", "netTotal", "taxTotal", "grossTotal",
    ],
    rules: [
      {
        id: "date-format",
        describe: "Issue date must be ISO 8601 (YYYY-MM-DD)",
        check: (d) => (d.issueDate && ISO_DATE.test(d.issueDate)
          ? { pass: true }
          : { pass: false, message: `Issue date "${d.issueDate ?? "missing"}" is not ISO 8601` }),
      },
      {
        id: "tax-id-format",
        describe: "Tax/VAT ID structural validation",
        check: (d, jurisdiction = "EU") => {
          const v = (d.supplierVatId || "").replace(/[\s-]/g, "").toUpperCase();
          if (jurisdiction === "US") {
            return US_EIN.test(v)
              ? { pass: true }
              : { pass: false, message: `US Tax ID / EIN "${d.supplierVatId ?? "missing"}" fails structural validation (XX-XXXXXXX)` };
          }
          return EU_VAT.test(v)
            ? { pass: true }
            : { pass: false, message: `Supplier VAT ID "${d.supplierVatId ?? "missing"}" fails EU structural validation` };
        },
      },
      {
        id: "totals-arithmetic",
        describe: "Net + tax must equal gross (±0.02 rounding tolerance)",
        check: (d) => {
          const net = num(d.netTotal), tax = num(d.taxTotal), gross = num(d.grossTotal);
          if (net === null || tax === null || gross === null) {
            return { pass: false, message: "One or more totals could not be read as a number" };
          }
          const diff = Math.abs(net + tax - gross);
          return diff <= 0.02
            ? { pass: true }
            : { pass: false, message: `Net ${net} + tax ${tax} = ${(net + tax).toFixed(2)}, but gross reads ${gross} (off by ${diff.toFixed(2)})` };
        },
      },
      {
        id: "line-items-sum",
        describe: "Line item amounts must sum to the net total",
        check: (d) => {
          if (!Array.isArray(d.lineItems) || !d.lineItems.length) {
            return { pass: false, message: "No line items were extracted" };
          }
          const sum = d.lineItems.reduce((s, li) => s + (num(li.amount) ?? 0), 0);
          const net = num(d.netTotal);
          if (net === null) return { pass: false, message: "Net total unreadable" };
          const diff = Math.abs(sum - net);
          return diff <= 0.02
            ? { pass: true }
            : { pass: false, message: `Line items sum to ${sum.toFixed(2)} but net total reads ${net}` };
        },
      },
      {
        id: "currency-code",
        describe: "Currency must be a 3-letter ISO 4217 code",
        check: (d) => (/^[A-Z]{3}$/.test((d.currency || "").toUpperCase())
          ? { pass: true }
          : { pass: false, message: `Currency "${d.currency ?? "missing"}" is not a valid ISO 4217 code` }),
      },
    ],
  },

  identity: {
    label: "ID document → KYC record",
    regulation: "EU digital identity / AML onboarding",
    requiredFields: [
      "documentType", "documentNumber", "fullName", "dateOfBirth",
      "issuingCountry", "issueDate", "expiryDate",
    ],
    rules: [
      {
        id: "not-expired",
        describe: "Document must not be expired",
        check: (d) => {
          if (!ISO_DATE.test(d.expiryDate || "")) {
            return { pass: false, message: `Expiry date "${d.expiryDate ?? "missing"}" unreadable` };
          }
          const expired = new Date(d.expiryDate) < new Date();
          return expired
            ? { pass: false, message: `Document expired on ${d.expiryDate}` }
            : { pass: true };
        },
      },
      {
        id: "dob-plausible",
        describe: "Date of birth must be a plausible adult date",
        check: (d) => {
          if (!ISO_DATE.test(d.dateOfBirth || "")) {
            return { pass: false, message: `Date of birth "${d.dateOfBirth ?? "missing"}" unreadable` };
          }
          const age = (Date.now() - new Date(d.dateOfBirth)) / (365.25 * 24 * 3600 * 1000);
          if (age < 18) return { pass: false, message: `Subject is ${Math.floor(age)} — under 18` };
          if (age > 120) return { pass: false, message: `Implied age ${Math.floor(age)} is implausible` };
          return { pass: true };
        },
      },
      {
        id: "issue-before-expiry",
        describe: "Issue date must precede expiry date",
        check: (d) => {
          if (!ISO_DATE.test(d.issueDate || "") || !ISO_DATE.test(d.expiryDate || "")) {
            return { pass: false, message: "Issue or expiry date unreadable" };
          }
          return new Date(d.issueDate) < new Date(d.expiryDate)
            ? { pass: true }
            : { pass: false, message: "Issue date is not before expiry date" };
        },
      },
      {
        id: "country-code",
        describe: "Issuing country must be a 2-letter ISO 3166 code",
        check: (d) => (/^[A-Z]{2}$/.test((d.issuingCountry || "").toUpperCase())
          ? { pass: true }
          : { pass: false, message: `Issuing country "${d.issuingCountry ?? "missing"}" is not ISO 3166 alpha-2` }),
      },
    ],
  },

  contract: {
    label: "Contract → reviewable agreement record",
    regulation: "Contract lifecycle / e-signature readiness",
    requiredFields: [
      "contractTitle", "parties", "effectiveDate", "termLength",
      "governingLaw", "totalValue", "terminationNotice",
    ],
    rules: [
      {
        id: "two-parties",
        describe: "At least two named parties must be identified",
        check: (d) => (Array.isArray(d.parties) && d.parties.length >= 2
          ? { pass: true }
          : { pass: false, message: `Only ${d.parties?.length ?? 0} party/parties identified` }),
      },
      {
        id: "effective-date",
        describe: "Effective date must be ISO 8601",
        check: (d) => (ISO_DATE.test(d.effectiveDate || "")
          ? { pass: true }
          : { pass: false, message: `Effective date "${d.effectiveDate ?? "missing"}" is not ISO 8601` }),
      },
      {
        id: "governing-law",
        describe: "Governing law clause must be present",
        check: (d) => (d.governingLaw && String(d.governingLaw).trim().length > 2
          ? { pass: true }
          : { pass: false, message: "No governing law clause was found" }),
      },
      {
        id: "termination-notice",
        describe: "Termination notice period must be stated",
        check: (d) => (d.terminationNotice && String(d.terminationNotice).trim().length > 1
          ? { pass: true }
          : { pass: false, message: "No termination notice period was found" }),
      },
    ],
  },
};

// Runs every rule for a document type. Returns structured results, never throws
// on a bad field — a malformed document is a finding, not a crash.
export function runRules(docType, data, jurisdiction = "EU") {
  const spec = DOCUMENT_TYPES[docType];
  if (!spec) return { error: `Unknown document type: ${docType}` };

  const results = spec.rules.map((rule) => {
    let outcome;
    try {
      outcome = rule.check(data || {}, jurisdiction);
    } catch (err) {
      outcome = { pass: false, message: `Rule could not be evaluated: ${err.message}` };
    }
    return { id: rule.id, describe: rule.describe, ...outcome };
  });

  const missingFields = spec.requiredFields.filter((f) => {
    const v = data?.[f];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
  });

  return {
    docType,
    label: spec.label,
    regulation: spec.regulation,
    results,
    failed: results.filter((r) => !r.pass),
    passed: results.filter((r) => r.pass),
    missingFields,
  };
}
