"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function CreationWizard({
  step,
  steps,
  title,
  description,
  children,
  canContinue = true,
  validationMessage,
  busy = false,
  submitLabel,
  onStepChange,
  onCancel,
  onSubmit,
  onInvalid,
}: {
  step: number;
  steps: string[];
  title: string;
  description?: string;
  children: ReactNode;
  canContinue?: boolean;
  validationMessage?: string;
  busy?: boolean;
  submitLabel: string;
  onStepChange: (step: number) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onInvalid?: () => void;
}) {
  const finalStep = step === steps.length - 1;
  const validationId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);
  const blocked = !canContinue;
  const explainBlocked = blocked && Boolean(validationMessage);
  return (
    <div className="creation-wizard">
      <div className="eyebrow" aria-live="polite">
        Step {step + 1} of {steps.length} · {steps[step]}
      </div>
      <div
        className="creation-wizard-progress"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
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
      <div className="creation-wizard-body" ref={bodyRef}>{children}</div>
      <div className="form-actions creation-wizard-actions">
        {explainBlocked && (
          <p id={validationId} className="creation-wizard-validation" role="status">
            {validationMessage}
          </p>
        )}
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
            onClick={() => blocked ? onInvalid?.() : onSubmit()}
            aria-disabled={blocked && !explainBlocked ? true : undefined}
            aria-describedby={explainBlocked ? validationId : undefined}
            disabled={busy || (blocked && !explainBlocked)}
          >
            {busy ? "Creating…" : submitLabel}
          </button>
        ) : (
          <button
            className="btn-primary"
            type="button"
            onClick={() => blocked ? onInvalid?.() : onStepChange(step + 1)}
            aria-disabled={blocked && !explainBlocked ? true : undefined}
            aria-describedby={explainBlocked ? validationId : undefined}
            disabled={busy || (blocked && !explainBlocked)}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

export function WizardChoices({
  id,
  title,
  options,
  selected,
  onToggle,
  single = false,
}: {
  id?: string;
  title: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  single?: boolean;
}) {
  return (
    <fieldset id={id} className="wizard-choice-group" aria-description={single ? "Choose one." : "Choose any that apply."}>
      <legend>{title}</legend>
      <div>
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              className={`wizard-choice-chip${active ? " selected" : ""}`}
              aria-pressed={active}
              onClick={() => onToggle(option)}
            >
              <span className="wizard-choice-chip-mark" aria-hidden="true">{active ? "✓" : ""}</span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
