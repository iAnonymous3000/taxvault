export function dedupeMessages(messages) {
  return [...new Set(Array.isArray(messages) ? messages : [])];
}

export function coalesceStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item));
}

export function normalizeSupportReviewSnapshot(review) {
  const status = ["ready", "attention", "unsupported", "pending"].includes(review?.status)
    ? review.status
    : "attention";
  const blockingIssues = dedupeMessages(
    coalesceStringList(review?.blockingIssues ?? review?.blocking_issues)
  );
  const cautions = dedupeMessages(coalesceStringList(review?.cautions));

  return {
    status,
    readyForEstimate:
      (Boolean(review?.readyForEstimate) || Boolean(review?.ready_for_estimate)) &&
      status === "ready",
    summary:
      review?.summary || "TaxVault reviewed this draft, but the status message was unavailable.",
    blockingIssues,
    cautions,
  };
}

export function supportReviewBadgeLabel(status) {
  switch (status) {
    case "ready":
      return "Ready";
    case "pending":
      return "In Progress";
    case "unsupported":
      return "Unsupported";
    default:
      return "Needs Attention";
  }
}

export function buildSupportReviewSnapshot({
  payload,
  errors,
  reviewInput,
  safeMessage,
  defaultSummary,
}) {
  const blockingIssues = dedupeMessages(errors);

  if (blockingIssues.length > 0) {
    if (
      blockingIssues.length === 1 &&
      blockingIssues[0] === "Add at least one W-2, SSA-1099, 1099-INT, or 1099-DIV before calculating."
    ) {
      return normalizeSupportReviewSnapshot({
        status: "pending",
        readyForEstimate: false,
        summary: defaultSummary,
        blockingIssues: [],
        cautions: [],
      });
    }

    return normalizeSupportReviewSnapshot({
      status: "attention",
      readyForEstimate: false,
      summary: "Finish the items below before calculating.",
      blockingIssues,
      cautions: [],
    });
  }

  try {
    const review = JSON.parse(reviewInput(JSON.stringify(payload)));
    if (!review || typeof review !== "object" || Array.isArray(review)) {
      throw new Error("Support review returned an unexpected payload shape.");
    }

    return normalizeSupportReviewSnapshot(review);
  } catch (error) {
    return normalizeSupportReviewSnapshot({
      status: "attention",
      readyForEstimate: false,
      summary: "TaxVault could not review this draft right now.",
      blockingIssues: [`Support review error: ${safeMessage(error)}`],
      cautions: [],
    });
  }
}
