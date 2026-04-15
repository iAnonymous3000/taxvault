export function normalizeMoneyValue(rawValue) {
  const trimmed = String(rawValue || "").trim();

  if (trimmed === "") {
    return "";
  }

  const hasParens = trimmed.startsWith("(") && trimmed.endsWith(")");
  let normalized = trimmed.replace(/[$,\s]/g, "");

  if (hasParens) {
    normalized = `-${normalized.slice(1, -1)}`;
  }

  if (!/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) {
    return null;
  }

  if (normalized.startsWith(".")) {
    normalized = `0${normalized}`;
  } else if (normalized.startsWith("-.")) {
    normalized = normalized.replace("-.", "-0.");
  }

  const [wholePart, fractionPart = ""] = normalized.split(".");
  const compactWholePart = wholePart.replace(/^(-?)0+(?=\d)/, "$1") || "0";
  const compactFractionPart = fractionPart.replace(/0+$/, "");

  return compactFractionPart ? `${compactWholePart}.${compactFractionPart}` : compactWholePart;
}
