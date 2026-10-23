"use client";
import { useId, useState } from "react";
import {
  caseDesignGuide,
  caseDesignGuides,
  caseDesignReviewKey,
  caseDesignStages,
  type CaseDesignStage,
} from "@/lib/case-design-guides";

/** Local advisory checklist. Deliberately accepts no case/source/tenant data or
 * write callback; checking a prompt cannot change a test or approve evidence. */
export function CaseDesignGuide() {
  const id = useId();
  const [guideId, setGuideId] = useState("");
  const [stage, setStage] = useState<CaseDesignStage>("design");
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const guide = caseDesignGuide(guideId);
  return (
    <details style={{ minWidth: 0, marginBlock: 12 }}>
      <summary>Help design this test</summary>
      <p className="text-muted">
        Choose a workflow for advisory prompts. Nothing is inferred from your
        project or written into case fields. Checklist marks are local, not
        saved evidence, execution status or approval; they reset when this guide
        unmounts.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))",
          gap: 12,
        }}
      >
        <label htmlFor={`${id}-workflow`}>
          Testing workflow
          <select
            id={`${id}-workflow`}
            style={{ display: "block", width: "100%", minWidth: 0 }}
            value={guideId}
            onChange={(event) => setGuideId(event.target.value)}
          >
            <option value="">Choose a workflow</option>
            {caseDesignGuides.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-stage`}>
          Authoring stage
          <select
            id={`${id}-stage`}
            style={{ display: "block", width: "100%", minWidth: 0 }}
            value={stage}
            disabled={!guide}
            onChange={(event) => {
              const selected = caseDesignStages.find(
                (item) => item.id === event.target.value,
              );
              if (selected) setStage(selected.id);
            }}
          >
            {caseDesignStages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {guide && (
        <fieldset style={{ minWidth: 0, marginBlock: 12 }}>
          <legend>{guide.label}: local authoring checklist</legend>
          {guide.stages[stage].map((prompt, index) => {
            const key = caseDesignReviewKey(guide.id, stage, index)!;
            return (
              <label
                key={key}
                style={{
                  display: "flex",
                  alignItems: "start",
                  gap: 8,
                  marginBlock: 10,
                  overflowWrap: "anywhere",
                }}
              >
                <input
                  type="checkbox"
                  checked={marks[key] === true}
                  onChange={(event) =>
                    setMarks((value) => ({
                      ...value,
                      [key]: event.target.checked,
                    }))
                  }
                />
                <span>{prompt}</span>
              </label>
            );
          })}
          <p className="text-muted">
            Check an item only to mark that you considered its prompt. No
            readiness score or qualifying decision is produced.
          </p>
        </fieldset>
      )}
    </details>
  );
}
