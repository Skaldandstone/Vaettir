"use client";
import type { CaseQueryRule } from "@vaettir/api/src/services/caseQuerySchema";
type Rule = Extract<CaseQueryRule, { field: "custom" }>;
export function CaseCustomQueryCondition({
  rule,
  onChange,
  label,
}: {
  rule: Rule;
  onChange: (rule: Rule) => void;
  label: string;
}) {
  const operations = [
    ...(rule.type === "TEXT"
      ? ["equals", "contains", "empty"]
      : rule.type === "NUMBER"
        ? ["equals", "atLeast", "atMost"]
        : rule.type === "DATE"
          ? ["equals", "before", "after"]
          : ["equals"]),
    "missing",
    "null",
  ];
  const labels: Record<string, string> = {
    equals: "Equals (exact)",
    contains: "Contains literal text",
    empty: 'Empty text (set to "")',
    missing: "Key absent (never set)",
    null: "Explicitly not set (null)",
    atLeast: "At least",
    atMost: "At most",
    before: "Before date",
    after: "After date",
  };
  const valueFree = ["missing", "null", "empty"].includes(rule.operator);
  const defaultValue =
    rule.type === "NUMBER"
      ? 0
      : rule.type === "BOOLEAN"
        ? false
        : rule.type === "CHOICE"
          ? (rule.options[0] ?? "")
          : "";
  return (
    <>
      <label>
        Condition {label}
        <select
          value={rule.operator}
          onChange={(event) => {
            const operator = event.target.value as Rule["operator"];
            const { value: old, ...withoutValue } = rule;
            onChange(
              ["missing", "null", "empty"].includes(operator)
                ? { ...withoutValue, operator }
                : { ...rule, operator, value: old ?? defaultValue },
            );
          }}
        >
          {operations.map((operation) => (
            <option key={operation} value={operation}>
              {labels[operation]}
            </option>
          ))}
        </select>
      </label>
      {!valueFree && (
        <label style={{ minWidth: 0, flex: "1 1 180px" }}>
          Value {label}
          {rule.type === "BOOLEAN" || rule.type === "CHOICE" ? (
            <select
              value={String(rule.value ?? defaultValue)}
              onChange={(event) =>
                onChange({
                  ...rule,
                  value:
                    rule.type === "BOOLEAN"
                      ? event.target.value === "true"
                      : event.target.value,
                })
              }
            >
              {rule.type === "BOOLEAN" ? (
                <>
                  <option value="false">No (false)</option>
                  <option value="true">Yes (true)</option>
                </>
              ) : (
                rule.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))
              )}
            </select>
          ) : (
            <input
              type={
                rule.type === "NUMBER"
                  ? "number"
                  : rule.type === "DATE"
                    ? "date"
                    : "text"
              }
              step={rule.type === "NUMBER" ? "any" : undefined}
              maxLength={2000}
              value={String(rule.value ?? "")}
              onChange={(event) =>
                onChange({
                  ...rule,
                  value:
                    rule.type === "NUMBER"
                      ? event.target.value === ""
                        ? undefined
                        : Number(event.target.value)
                      : event.target.value,
                })
              }
            />
          )}
        </label>
      )}
    </>
  );
}
