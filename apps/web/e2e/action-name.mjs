// Browser selectors retain the complete action description after caption cleanup.
// Only a one- or two-word visible-label prefix may precede that description.
export function actionName(value, exact = true) {
  const prefix = "(?:[^:\\s]+(?:\\s+[^:\\s]+)?: )?";
  if (value instanceof RegExp) {
    return value.source.startsWith("^")
      ? new RegExp("^" + prefix + value.source.slice(1), value.flags)
      : value;
  }
  const escaped = value.trim().replace(/\s+/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return exact ? new RegExp("^" + prefix + escaped + "$") : new RegExp(escaped, "i");
}
