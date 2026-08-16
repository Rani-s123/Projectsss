// Demo documents. Each contains deliberately planted problems so the pipeline
// has something real to catch — a clean document proves nothing about a system
// whose entire job is deciding what a human must look at.

export const SAMPLES = {
  invoice: {
    label: "Invoice — supplier with OCR damage",
    planted: [
      "Ambiguous date format (03/04/2026)",
      "Line items don't sum to the stated net total",
      "VAT ID partially illegible",
    ],
    text: `TECHNOVA SOLUTIONS B.V.
Keizersgracht 241, 1016 EA Amsterdam, Netherlands
VAT: NL8••234•7B01        (partially illegible on scan)
IBAN: NL91ABNA0417164300

INVOICE

Invoice No:  TNV-2026-04471
Date:        03/04/2026
Due:         30 days net

Bill to:
  Meridian Logistics GmbH
  Hafenstrasse 88
  20359 Hamburg, Germany
  VAT: DE811907980

------------------------------------------------------------
DESCRIPTION                    QTY    UNIT      AMOUNT
------------------------------------------------------------
Cloud infrastructure, Q1        3     4,200.00   12,600.00
Migration engineering           1     8,750.00    8,750.00
Support retainer (Mar)          1     2,400.00    2,400.00
Onboarding workshop             2     1,150.00    2,300.00
------------------------------------------------------------
                              Subtotal (net):    24,900.00
                              VAT @ 21%:          5,229.00
                              TOTAL DUE:         30,129.00
------------------------------------------------------------
Currency: EUR

Payment terms: Net 30. Late payment interest applies at the
statutory rate. All amounts exclusive of VAT unless stated.`,
  },

  identity: {
    label: "ID document — expired passport",
    planted: [
      "Document expired in 2024",
      "MRZ line partially unreadable",
      "Issuing authority name smudged",
    ],
    text: `REPUBLIC OF IRELAND
PASSPORT / PASSEPORT

Type: P
Country code: IRL
Passport No: PA4471••2      (last digits degraded)

Surname:      O'CONNELL
Given names:  SIOBHAN MARY
Nationality:  IRISH
Date of birth: 14 JUN 1991
Sex: F
Place of birth: GALWAY

Date of issue:  22 SEP 2014
Date of expiry: 21 SEP 2024
Authority: DEPT OF FOREI•N AFFA•RS

Machine readable zone:
P<IRLOCONNELL<<SIOBHAN<MARY<<<<<<<<<<<<<<<<<
PA4471••2 5IRL9106144F2409214<<<<<<<<<<<<<<<0

Holder's signature: [present]`,
  },

  contract: {
    label: "Contract — missing termination clause",
    planted: [
      "No termination notice period stated",
      "Governing law ambiguous (two jurisdictions referenced)",
      "Effective date written in prose, not a date field",
    ],
    text: `MASTER SERVICES AGREEMENT

This Agreement is entered into between Halcyon Data Systems Ltd,
a company registered in England and Wales (company no. 09441772),
having its registered office at 14 Finsbury Square, London EC2A 1AH
("Provider"), and Brightwater Retail Group Inc., a Delaware
corporation with offices at 200 Congress Ave, Austin TX 78701
("Client").

1. COMMENCEMENT
   This Agreement shall take effect on the first business day of
   May in the year two thousand and twenty-six and shall continue
   for an initial period of thirty-six (36) months.

2. SERVICES
   Provider shall supply data platform engineering, managed hosting,
   and Tier-2 support services as set out in Schedule A.

3. FEES
   Client shall pay Provider an annual fee of USD 485,000, invoiced
   quarterly in advance.

4. CONFIDENTIALITY
   Each party shall keep confidential all information disclosed by
   the other party and marked or reasonably understood as confidential.

5. LIABILITY
   Neither party's aggregate liability shall exceed the fees paid in
   the twelve (12) months preceding the claim.

6. GOVERNING LAW
   This Agreement shall be governed by the laws of England and Wales,
   provided that any dispute arising in connection with services
   delivered in North America shall be subject to the laws of the
   State of Delaware.

7. ENTIRE AGREEMENT
   This Agreement supersedes all prior understandings.

Signed for and on behalf of the parties.`,
  },
};
