import { buildReviewPacketHtml as buildReviewPacketDocumentHtml } from "./review_packet.js";

export function createExportModule({
  constants,
  currentTaxYear,
  normalizeTaxYear,
  buildBreakdownRows,
  normalizeSupportReviewSnapshot,
  sanitizeDraftSnapshotForRestore,
  buildAnonymizedSupportInputSnapshot,
  redactSupportSnapshotEnvelope,
  isPlainObject,
  reviewPacketHelpers,
}) {
  const {
    APP_VERSION,
    AUDIT_TRAIL_FILE_TYPE,
    AUDIT_TRAIL_VERSION,
    SUPPORT_SNAPSHOT_FILE_TYPE,
    SUPPORT_SNAPSHOT_VERSION,
    DOWNLOAD_BLOB_URL_REVOKE_DELAY_MS,
  } = constants;

  function makeExportFilename(prefix, envelope, ext, { stampKey = "exportedAt" } = {}) {
    const stampSource =
      typeof envelope?.[stampKey] === "string" && envelope[stampKey]
        ? envelope[stampKey]
        : new Date().toISOString();
    const safeStamp = stampSource.replace(/[:.]/g, "-");
    return `taxvault-${normalizeTaxYear(envelope?.taxYear)}-${prefix}-${safeStamp}.${ext}`;
  }

  function draftExportFilename(envelope) {
    return makeExportFilename("draft", envelope, "json", { stampKey: "updatedAt" });
  }

  function auditTrailExportFilename(envelope) {
    return makeExportFilename("audit-trail", envelope, "json");
  }

  function supportSnapshotExportFilename(envelope) {
    return makeExportFilename("support-snapshot", envelope, "json");
  }

  function reviewPacketExportFilename(envelope) {
    return makeExportFilename("review-packet", envelope, "html");
  }

  function downloadFile(contents, fileName, mimeType) {
    let blobUrl = "";
    const link = document.createElement("a");

    try {
      const blob = new Blob([contents], { type: mimeType });
      blobUrl = URL.createObjectURL(blob);
      link.href = blobUrl;
      link.download = fileName;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
    } finally {
      link.remove();
      if (blobUrl) {
        window.setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
        }, DOWNLOAD_BLOB_URL_REVOKE_DELAY_MS);
      }
    }
  }

  function downloadJsonFile(contents, fileName) {
    downloadFile(contents, fileName, "application/json");
  }

  function buildEstimateExportSnapshot(result) {
    if (!isPlainObject(result)) {
      return null;
    }

    const summary = isPlainObject(result.summary) ? { ...result.summary } : {};
    const meta = isPlainObject(result.meta) ? { ...result.meta } : {};
    const form = isPlainObject(result.form) ? result.form : {};
    const lines = isPlainObject(form.lines) ? { ...form.lines } : {};
    const taxYear = Number(summary.tax_year || form.tax_year || currentTaxYear());

    return {
      summary,
      meta,
      breakdown: buildBreakdownRows(summary),
      form: {
        formId:
          typeof form.form_id === "string" && form.form_id.trim() ? form.form_id.trim() : "1040",
        taxYear: Number.isInteger(taxYear) ? taxYear : currentTaxYear(),
        lines,
      },
      trace: typeof result.trace === "string" ? result.trace : "",
    };
  }

  function buildAuditTrailEnvelope(result, { draftEnvelope = null, supportReview = null } = {}) {
    const estimate = buildEstimateExportSnapshot(result);
    if (!estimate) {
      return null;
    }

    const normalizedSupportReview = supportReview
      ? normalizeSupportReviewSnapshot(supportReview)
      : null;

    return {
      type: AUDIT_TRAIL_FILE_TYPE,
      version: AUDIT_TRAIL_VERSION,
      appVersion: APP_VERSION,
      taxYear: estimate.form.taxYear,
      exportedAt: new Date().toISOString(),
      draftEnvelope,
      supportReview: normalizedSupportReview,
      estimate,
    };
  }

  function buildSupportSnapshotEnvelope(result, { rawDraftSnapshot = null, supportReview = null } = {}) {
    const estimate = buildEstimateExportSnapshot(result);
    if (!estimate) {
      return null;
    }

    const normalizedSupportReview = supportReview
      ? normalizeSupportReviewSnapshot(supportReview)
      : null;
    const normalizedDraftSnapshot = sanitizeDraftSnapshotForRestore(rawDraftSnapshot);

    return redactSupportSnapshotEnvelope(
      {
        type: SUPPORT_SNAPSHOT_FILE_TYPE,
        version: SUPPORT_SNAPSHOT_VERSION,
        appVersion: APP_VERSION,
        taxYear: estimate.form.taxYear,
        exportedAt: new Date().toISOString(),
        suitableForSharing: true,
        redaction: {
          removed: ["names", "dates_of_birth", "ssns", "eins", "employer_names", "payer_names"],
        },
        inputSnapshot: buildAnonymizedSupportInputSnapshot(
          normalizedDraftSnapshot,
          estimate.form.taxYear
        ),
        supportReview: normalizedSupportReview,
        estimate,
      },
      rawDraftSnapshot
    );
  }

  function buildReviewPacketHtml(envelope) {
    return buildReviewPacketDocumentHtml(envelope, reviewPacketHelpers);
  }

  return {
    auditTrailExportFilename,
    buildAuditTrailEnvelope,
    buildEstimateExportSnapshot,
    buildReviewPacketHtml,
    buildSupportSnapshotEnvelope,
    downloadFile,
    downloadJsonFile,
    draftExportFilename,
    makeExportFilename,
    reviewPacketExportFilename,
    supportSnapshotExportFilename,
  };
}
