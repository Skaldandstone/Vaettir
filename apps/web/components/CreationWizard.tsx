"use client";

import { useId, type ReactNode } from "react";

export function CreationWizard({
  step,
  steps,
  title,
  description,
  children,
  canContinue = true,
  busy = false,
  submitLabel,
  onStepChange,
  onCancel,
  onSubmit,
}: {
  step: number;
  steps: string[];
  title: string;
  description?: string;
  children: ReactNode;
  canContinue?: boolean;
  busy?: boolean;
  submitLabel: string;
  onStepChange: (step: number) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const finalStep = step === steps.length - 1;
  return (
    <div className="creation-wizard">
      <div className="eyebrow">
        Step {step + 1} of {steps.length} · {steps[step]}
      </div>
      <div
        className="creation-wizard-progress"
        style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}
        aria-label={`Step ${step + 1} of ${steps.length}`}
      >
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            aria-label={`Go to ${label}`}
            aria-current={index === step ? "step" : undefined}
            className={index <= step ? "complete" : ""}
            onClick={() => index < step && onStepChange(index)}
            disabled={busy || index > step}
          />
        ))}
      </div>
      <div>
        <h3 style={{ marginBottom: 4 }}>{title}</h3>
        {description && (
          <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>
            {description}
          </p>
        )}
      </div>
      <div className="creation-wizard-body">{children}</div>
      <div className="form-actions creation-wizard-actions">
        <button
          className="btn-secondary"
          type="button"
          onClick={step === 0 ? onCancel : () => onStepChange(step - 1)}
          disabled={busy}
        >
          {step === 0 ? "Cancel" : "Back"}
        </button>
        {finalStep ? (
          <button
            className="btn-primary"
            type="button"
            onClick={onSubmit}
            disabled={!canContinue || busy}
          >
            {busy ? "Creating…" : submitLabel}
          </button>
        ) : (
          <button
            className="btn-primary"
            type="button"
            onClick={() => onStepChange(step + 1)}
            disabled={!canContinue || busy}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

export function WizardChoices({
  title,
  options,
  selected,
  onToggle,
  single = false,
}: {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  single?: boolean;
}) {
  const groupName = useId();
  return (
    <fieldset className="wizard-choice-group">
      <legend>{title}</legend>
      <div>
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <label key={option} className={active ? "selected" : ""}>
              <input
                name={single ? groupName : undefined}
                type={single ? "radio" : "checkbox"}
                checked={active}
                onChange={() => onToggle(option)}
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
