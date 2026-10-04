/** Phase arrays remain independent procedure evidence, never prerequisite cases
 * or setup conditions. Keep the original arrays and their exact stored order. */
export function manualProcedurePhases(value: {
  given: readonly string[];
  when: readonly string[];
  then: readonly string[];
}) {
  return [
    { label: "Given", steps: value.given },
    { label: "When", steps: value.when },
    { label: "Then", steps: value.then },
  ];
}
