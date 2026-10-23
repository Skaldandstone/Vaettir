export const populationSteps = ["scope", "context", "sources", "review"] as const;

export function nextPopulationStep(current: number, requested: number, sections: readonly string[]) {
  if (!Number.isInteger(requested) || requested < 0 || requested >= populationSteps.length) throw new Error("Invalid wizard step");
  let index = requested;
  const direction = requested > current ? 1 : -1;
  while ((index === 1 && !sections.includes("context")) || (index === 2 && !sections.includes("sources"))) index += direction;
  return populationSteps[index]!;
}
