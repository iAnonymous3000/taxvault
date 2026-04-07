function renderReviewPacketList(items, escapeHtml) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="empty-state">None.</p>';
  }

  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderReviewPacketTable(headers, rows, escapeHtml) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<p class="empty-state">None.</p>';
  }

  const thead = `<thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("")}</tbody>`;

  return `<table>${thead}${tbody}</table>`;
}

export function buildReviewPacketHtml(envelope, helpers) {
  const {
    escapeHtml,
    formatDependentRelationshipLabel,
    formatDraftPerson,
    formatFilingStatusLabel,
    formatIncomeRecipientLabel,
    formatLineValue,
    formatReviewPacketTimestamp,
    formatTaxTableStatus,
    isPlainObject,
    sortedLineKeys,
    summarizeEstimateHeadline,
    supportReviewBadgeLabel,
  } = helpers;

  if (!isPlainObject(envelope)) {
    return "";
  }

  const draft = envelope.draftEnvelope?.draft || {};
  const supportReview = envelope.supportReview || null;
  const estimate = envelope.estimate || {};
  const summary = estimate.summary || {};
  const meta = estimate.meta || {};
  const form = estimate.form || {};
  const lines = form.lines || {};
  const breakdownRows = Array.isArray(estimate.breakdown) ? estimate.breakdown : [];
  const headline = summarizeEstimateHeadline(summary);
  const primaryName = formatDraftPerson(draft.primaryFiler);
  const spouseName = formatDraftPerson(draft.spouse);

  const summaryCards = [
    ["Tax Year", String(envelope.taxYear || "Unavailable")],
    ["Filing Status", formatFilingStatusLabel(summary.filing_status || draft.filingStatus)],
    ["Primary Filer", primaryName],
    ["Spouse", spouseName],
    ["Generated", formatReviewPacketTimestamp(envelope.exportedAt)],
    [
      "Rule Pack",
      meta.rule_pack_version ? `Federal rules ${meta.rule_pack_version}` : "Unavailable",
    ],
  ];

  const inputRows = [
    ["W-2 forms", String(Array.isArray(draft.w2s) ? draft.w2s.length : 0)],
    [
      "SSA-1099 forms",
      String(Array.isArray(draft.socialSecurityIncome) ? draft.socialSecurityIncome.length : 0),
    ],
    ["1099-INT forms", String(Array.isArray(draft.interestIncome) ? draft.interestIncome.length : 0)],
    ["1099-DIV forms", String(Array.isArray(draft.dividendIncome) ? draft.dividendIncome.length : 0)],
    ["Dependents", String(Array.isArray(draft.dependents) ? draft.dependents.length : 0)],
    [
      "Adjustments/payments entered",
      [
        draft.adjustments?.traditionalIraDeduction,
        draft.adjustments?.hsaDeduction,
        draft.adjustments?.studentLoanInterestPaid,
        draft.estimatedTaxPayments,
      ]
        .filter((value) => String(value || "").trim() !== "")
        .length > 0
        ? "Yes"
        : "No",
    ],
  ];

  const adjustmentRows = [
    ["Traditional IRA Deduction", draft.adjustments?.traditionalIraDeduction || "0"],
    ["HSA Deduction", draft.adjustments?.hsaDeduction || "0"],
    ["Student Loan Interest Paid", draft.adjustments?.studentLoanInterestPaid || "0"],
    ["Estimated Tax Payments", draft.estimatedTaxPayments || "0"],
  ];

  const dependentRows = Array.isArray(draft.dependents)
    ? draft.dependents.map((dependent) => [
        [dependent.firstName, dependent.lastName].filter(Boolean).join(" ").trim() || "Not entered",
        dependent.dob || "Not entered",
        formatDependentRelationshipLabel(dependent.relationship),
        dependent.monthsLivedInHome || "0",
      ])
    : [];

  const w2Rows = Array.isArray(draft.w2s)
    ? draft.w2s.map((w2) => [
        w2.employerName || "Employer not entered",
        formatIncomeRecipientLabel(w2.recipient),
        w2.wages || "0",
        w2.federalTaxWithheld || "0",
      ])
    : [];

  const interestRows = Array.isArray(draft.interestIncome)
    ? draft.interestIncome.map((item) => [
        item.payerName || "Institution not entered",
        formatIncomeRecipientLabel(item.recipient),
        item.taxableInterest || "0",
        item.taxExemptInterest || "0",
      ])
    : [];

  const dividendRows = Array.isArray(draft.dividendIncome)
    ? draft.dividendIncome.map((item) => [
        item.payerName || "Institution not entered",
        formatIncomeRecipientLabel(item.recipient),
        item.ordinaryDividends || "0",
        item.qualifiedDividends || "0",
      ])
    : [];

  const socialSecurityRows = Array.isArray(draft.socialSecurityIncome)
    ? draft.socialSecurityIncome.map((item) => [
        formatIncomeRecipientLabel(item.recipient),
        item.totalBenefits || "0",
        item.voluntaryWithholding || "0",
      ])
    : [];

  const breakdownTableRows = breakdownRows
    .filter((row) => row && !row.section)
    .map((row) => [row.label || "Unlabeled row", row.formattedValue || "0.00"]);

  const lineRows = sortedLineKeys(lines).map((line) => [
    `Line ${line}`,
    formatLineValue(lines[line]),
  ]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TaxVault Review Packet</title>
<style>
  :root {
    color-scheme: light;
    --ink: #0f172a;
    --muted: #475569;
    --line: #cbd5e1;
    --panel: #ffffff;
    --soft: #f8fafc;
    --accent: #0f766e;
    --warning: #b45309;
    --danger: #b91c1c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem;
    font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
    color: var(--ink);
    background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  }
  main {
    max-width: 960px;
    margin: 0 auto;
  }
  .hero, section {
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 18px;
    padding: 1.4rem 1.5rem;
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
    margin-bottom: 1rem;
  }
  .eyebrow {
    font: 700 0.78rem/1.2 "IBM Plex Sans", "Avenir Next", Helvetica, sans-serif;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
  }
  h1, h2, h3 {
    margin: 0;
    line-height: 1.1;
  }
  h1 { font-size: 2.2rem; margin-top: 0.35rem; }
  h2 { font-size: 1.15rem; margin-bottom: 0.9rem; }
  p, li, td, th, div { font-size: 0.98rem; }
  .hero-note, .muted, .empty-state { color: var(--muted); }
  .amount {
    margin: 0.6rem 0 0.35rem;
    font-size: 2.1rem;
    font-weight: 700;
    color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.8rem;
  }
  .card {
    background: var(--soft);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 0.9rem 1rem;
  }
  .label {
    font: 700 0.75rem/1.2 "IBM Plex Sans", "Avenir Next", Helvetica, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.35rem;
  }
  ul {
    margin: 0.45rem 0 0;
    padding-left: 1.15rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.94rem;
  }
  th, td {
    text-align: left;
    padding: 0.55rem 0.45rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  th {
    font: 700 0.78rem/1.2 "IBM Plex Sans", "Avenir Next", Helvetica, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .section-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }
  .status-pill {
    display: inline-block;
    padding: 0.28rem 0.6rem;
    border-radius: 999px;
    background: #ecfeff;
    border: 1px solid #99f6e4;
    color: #115e59;
    font: 700 0.8rem/1 "IBM Plex Sans", "Avenir Next", Helvetica, sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  pre {
    margin: 0;
    padding: 1rem;
    background: #0f172a;
    color: #e2e8f0;
    border-radius: 14px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font: 0.84rem/1.45 "SFMono-Regular", Menlo, Consolas, monospace;
  }
  @media print {
    body {
      background: #fff;
      padding: 0;
    }
    .hero, section {
      box-shadow: none;
      break-inside: avoid;
    }
  }
</style>
</head>
<body>
<main>
  <section class="hero">
    <div class="eyebrow">TaxVault Review Packet</div>
    <h1>${escapeHtml(headline.label)}</h1>
    <div class="amount">${escapeHtml(headline.amount)}</div>
    <p class="hero-note">${escapeHtml(headline.note)}</p>
    <p class="muted">Generated locally on ${escapeHtml(formatReviewPacketTimestamp(envelope.exportedAt))}. This packet is for review only and is not a filing-ready return.</p>
  </section>

  <section>
    <h2>Estimate Summary</h2>
    <div class="grid">
      ${summaryCards
        .map(
          ([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div>${escapeHtml(value)}</div></div>`
        )
        .join("")}
    </div>
  </section>

  <section>
    <h2>Estimate Readiness</h2>
    <div class="section-grid">
      <div class="card">
        <div class="label">Status</div>
        <div class="status-pill">${escapeHtml(
          supportReview ? supportReviewBadgeLabel(supportReview.status) : "Unavailable"
        )}</div>
        <p>${escapeHtml(supportReview?.summary || "TaxVault did not capture a support review summary for this export.")}</p>
      </div>
      <div class="card">
        <div class="label">Blocking Issues</div>
        ${renderReviewPacketList(supportReview?.blockingIssues, escapeHtml)}
      </div>
      <div class="card">
        <div class="label">Cautions</div>
        ${renderReviewPacketList(supportReview?.cautions, escapeHtml)}
      </div>
    </div>
  </section>

  <section>
    <h2>Scope and Metadata</h2>
    ${renderReviewPacketTable(
      ["Field", "Value"],
      [
        ["Estimate Scope", meta.estimate_scope || "Unavailable"],
        ["Tax Table Status", meta ? formatTaxTableStatus(meta) : "Unavailable"],
        ["Rule Pack", meta.rule_pack_version ? `Federal rules version ${meta.rule_pack_version}` : "Unavailable"],
        ["Privacy", meta.privacy || "Unavailable"],
      ],
      escapeHtml
    )}
    <div class="card" style="margin-top: 0.9rem;">
      <div class="label">Scope Limits</div>
      ${renderReviewPacketList(meta.scope_limits, escapeHtml)}
    </div>
  </section>

  <section>
    <h2>Entered Inputs</h2>
    <div class="section-grid">
      <div class="card">
        <div class="label">Input Counts</div>
        ${renderReviewPacketTable(["Field", "Value"], inputRows, escapeHtml)}
      </div>
      <div class="card">
        <div class="label">Adjustments &amp; Payments</div>
        ${renderReviewPacketTable(["Entry", "Entered Amount"], adjustmentRows, escapeHtml)}
      </div>
    </div>
    <div class="section-grid" style="margin-top: 1rem;">
      <div class="card">
        <div class="label">Dependents</div>
        ${renderReviewPacketTable(["Name", "DOB", "Relationship", "Months in Home"], dependentRows, escapeHtml)}
      </div>
      <div class="card">
        <div class="label">W-2 Forms</div>
        ${renderReviewPacketTable(["Employer", "Recipient", "Wages", "Federal Withholding"], w2Rows, escapeHtml)}
      </div>
    </div>
    <div class="section-grid" style="margin-top: 1rem;">
      <div class="card">
        <div class="label">1099-INT Forms</div>
        ${renderReviewPacketTable(["Institution", "Recipient", "Taxable Interest", "Tax-Exempt Interest"], interestRows, escapeHtml)}
      </div>
      <div class="card">
        <div class="label">1099-DIV Forms</div>
        ${renderReviewPacketTable(["Institution", "Recipient", "Ordinary Dividends", "Qualified Dividends"], dividendRows, escapeHtml)}
      </div>
    </div>
    <div class="card" style="margin-top: 1rem;">
      <div class="label">SSA-1099 Forms</div>
      ${renderReviewPacketTable(["Recipient", "Total Benefits", "Voluntary Withholding"], socialSecurityRows, escapeHtml)}
    </div>
  </section>

  <section>
    <h2>Tax Breakdown</h2>
    ${renderReviewPacketTable(["Line Item", "Amount"], breakdownTableRows, escapeHtml)}
  </section>

  <section>
    <h2>Draft Form 1040 Lines</h2>
    ${renderReviewPacketTable(["Form Line", "Value"], lineRows, escapeHtml)}
  </section>

  <section>
    <h2>Calculation Trace</h2>
    <pre>${escapeHtml(estimate.trace || "Trace unavailable.")}</pre>
  </section>
</main>
</body>
</html>`;
}
