"use client";
import { useId, useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { useStepExecutionResources } from "@/lib/use-step-execution-resources";
import {
  retainedStepEvidence,
  type StepResourceTransport,
} from "@/lib/step-execution-resource-reader";
import type { StepReviewOrigin } from "@/lib/step-execution-review-draft";
import type { StepResourceEvidence } from "@vaettir/api/src/services/manualStepExecutionResourcesSchema";

export type RecordedStepEvidenceIntent = Readonly<{
  origin: StepReviewOrigin;
  revisionId: string;
  attachmentId: string;
  procedureHash: string;
  populationHash: string;
}>;
export type StepObservationResourcesProps = {
  origin: StepReviewOrigin | null;
  expectedProcedureHash: string | null;
  active: boolean;
  selectedEvidenceIds: readonly string[];
  selectedEvidenceNames: Readonly<Record<string, string>>;
  editingEnabled: boolean;
  onEvidenceToggle: (id: string, selected: boolean) => boolean;
  onOpenRecordedEvidence?: (intent: RecordedStepEvidenceIntent) => boolean;
};
const text = {
  whiteSpace: "pre-wrap" as const,
  overflowWrap: "anywhere" as const,
};
/** Revocation only. Read authorization comes from the resource reader, and
 * draft write authority is independently checked by the parent controller. */
class ResourceCallbackFrame {
  private key = "";
  private epoch = 0;
  private active = false;
  private editing = false;
  private toggle: StepObservationResourcesProps["onEvidenceToggle"] | null =
    null;
  private open: StepObservationResourcesProps["onOpenRecordedEvidence"];
  observe(props: StepObservationResourcesProps) {
    const key = JSON.stringify([
      props.active,
      props.editingEnabled,
      props.origin,
      props.expectedProcedureHash,
      props.selectedEvidenceIds,
    ]);
    if (
      key !== this.key ||
      this.toggle !== props.onEvidenceToggle ||
      this.open !== props.onOpenRecordedEvidence
    ) {
      this.key = key;
      this.epoch++;
    }
    this.active = props.active;
    this.editing = props.editingEnabled;
    this.toggle = props.onEvidenceToggle;
    this.open = props.onOpenRecordedEvidence;
    return this.epoch;
  }
  allows(epoch: number, edit: boolean) {
    return (
      epoch === this.epoch && this.active && (edit ? this.editing : !!this.open)
    );
  }
}
function StoredValue({
  value,
  present = true,
}: {
  value: unknown;
  present?: boolean;
}) {
  return (
    <span style={text}>
      {!present ? (
        <em>Absent (retained)</em>
      ) : value === null ? (
        <em>NULL (retained)</em>
      ) : value === "" ? (
        <em>Empty text (retained)</em>
      ) : typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ? (
        String(value)
      ) : (
        <em>Unsupported retained type; see exact metadata</em>
      )}
    </span>
  );
}
function RawDisclosure({ value, label }: { value: unknown; label: string }) {
  return (
    <details>
      <summary>{label}</summary>
      <pre style={{ ...text, maxHeight: 360, overflow: "auto", padding: 10 }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
function FrozenStep({ value }: { value: unknown }) {
  const step =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!step)
    return (
      <p>
        Friendly frozen procedure is unavailable; exact stored metadata remains
        retained.
      </p>
    );
  return (
    <section aria-label="Recorded run frozen step">
      <h4>
        Frozen step{" "}
        {typeof step.order === "number"
          ? step.order + 1
          : "(unsupported order)"}
      </h4>
      <div
        role="region"
        aria-label="Frozen step columns"
        tabIndex={0}
        style={{ overflowX: "auto" }}
      >
        <table
          className="workspace-table"
          style={{ minWidth: 600, width: "100%", tableLayout: "fixed" }}
        >
          <thead>
            <tr>
              {[
                "Action",
                "Expected action or data",
                "Expected result",
                "Expected response",
              ].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {[
                "action",
                "expectedActionOrData",
                "expectedResult",
                "expectedResponse",
              ].map((key) => (
                <td key={key} style={{ verticalAlign: "top", ...text }}>
                  <StoredValue
                    value={step[key]}
                    present={Object.hasOwn(step, key)}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-muted">
        Stored run procedure, not the current editable case. Media references
        below are metadata only.
      </p>
      <RawDisclosure
        value={value}
        label="Exact frozen step metadata and media references"
      />
    </section>
  );
}
function ObservationMetadata({ value }: { value: unknown }) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const readings = record?.measurements,
    friendly =
      Array.isArray(readings) &&
      readings.length <= 100 &&
      readings.every(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      );
  return (
    <section>
      <h5>Stored context</h5>
      {record ? (
        <dl>
          {[
            ["specimen", "Specimen"],
            ["hardwareRevision", "Hardware revision"],
            ["firmwareVersion", "Firmware version"],
            ["environment", "Environment"],
          ].map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                <StoredValue
                  value={record[key!]}
                  present={Object.hasOwn(record, key!)}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>Friendly context is unavailable for this retained representation.</p>
      )}
      <h5>Stored measurements</h5>
      {friendly ? (
        <div
          role="region"
          aria-label="Stored measurement values"
          tabIndex={0}
          style={{ overflowX: "auto" }}
        >
          <table
            className="workspace-table"
            style={{ minWidth: 600, width: "100%" }}
          >
            <thead>
              <tr>
                {[
                  "Measurement",
                  "Value",
                  "Unit",
                  "Lower limit",
                  "Upper limit",
                  "Instrument",
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {readings.map((reading, index) => (
                <tr key={index}>
                  {[
                    "name",
                    "value",
                    "unit",
                    "lowerLimit",
                    "upperLimit",
                    "instrument",
                  ].map((key) => (
                    <td key={key}>
                      <StoredValue
                        value={reading[key]}
                        present={Object.hasOwn(reading, key)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {readings.length === 0 && <p>No stored measurement rows.</p>}
        </div>
      ) : (
        <p>
          Friendly measurement rows are unavailable. No raw values were
          converted or discarded.
        </p>
      )}
      <RawDisclosure
        value={value}
        label="Exact stored observation metadata, including unknown fields"
      />
    </section>
  );
}
function ResourcePager({
  prefix,
  limit,
  busy,
  canRequest,
  hasNext,
  onLimit,
  onRefresh,
  onNext,
}: {
  prefix: string;
  limit: number;
  busy: boolean;
  canRequest: boolean;
  hasNext: boolean;
  onLimit: (limit: number) => void;
  onRefresh: () => void;
  onNext: () => void;
}) {
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8 }}
    >
      <label htmlFor={`${prefix}-limit`}>
        Rows per page
        <select
          id={`${prefix}-limit`}
          value={limit}
          disabled={!canRequest || busy}
          onChange={(event) => onLimit(Number(event.target.value))}
          style={{ display: "block" }}
        >
          {[1, 5, 10, 25].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button
        className="btn-secondary"
        disabled={!canRequest || busy}
        onClick={onRefresh}
      >
        Refresh / first page
      </button>
      <button
        className="btn-secondary"
        disabled={!canRequest || busy || !hasNext}
        onClick={onNext}
      >
        Next page
      </button>
    </div>
  );
}
function FileVersion({
  file,
}: {
  file: StepResourceEvidence["attachments"][number];
}) {
  return (
    <p className="text-muted">
      {file.versionProvenance === "VERSION_ID_RECORDED_NOT_FETCHED" ? (
        <>
          Version ID recorded: <StoredValue value={file.versionId} />. File
          bytes were not fetched or verified here.
        </>
      ) : file.versionProvenance === "UNVERSIONED_NOT_IMMUTABLE" ? (
        "Unversioned stored object. This is not immutable evidence proof."
      ) : (
        "Unsupported verification metadata is retained read-only; this file cannot be newly selected here."
      )}
    </p>
  );
}

/** Metadata-only component. The parent separately owns and reauthorizes every
 * draft delta; no storage URL, signing, upload, file byte fetch or provider work. */
export function StepObservationResources({
  origin,
  expectedProcedureHash,
  active,
  selectedEvidenceIds,
  selectedEvidenceNames,
  editingEnabled,
  onEvidenceToggle,
  onOpenRecordedEvidence,
}: StepObservationResourcesProps) {
  const utils = trpcReact.useUtils(),
    prefix = useId();
  const [historyOpen, setHistoryOpen] = useState(false),
    [pickerOpen, setPickerOpen] = useState(false),
    [notice, setNotice] = useState(""),
    [searchDraft, setSearchDraft] = useState("");
  const [callbackFrame] = useState(() => new ResourceCallbackFrame());
  const callbackEpoch = callbackFrame.observe({
    origin,
    expectedProcedureHash,
    active,
    selectedEvidenceIds,
    selectedEvidenceNames,
    editingEnabled,
    onEvidenceToggle,
    onOpenRecordedEvidence,
  });
  const transport: StepResourceTransport = (input) =>
    "search" in input
      ? utils.manualStepExecutionResources.evidence.fetch(input)
      : utils.manualStepExecutionResources.history.fetch(input);
  // Always mounted: hiding this component never resets the readers, parent
  // raw buffers or selected IDs. Reopening still requires another native read.
  const history = useStepExecutionResources(
    "HISTORY",
    origin,
    active && historyOpen,
    expectedProcedureHash,
    transport,
  );
  const picker = useStepExecutionResources(
    "EVIDENCE",
    origin,
    active && pickerOpen,
    expectedProcedureHash,
    transport,
  );
  const historyData =
    history.view.data && "revisions" in history.view.data
      ? history.view.data
      : null;
  const pickerData =
    picker.view.data && "attachments" in picker.view.data
      ? picker.view.data
      : null;
  function toggle(id: string, selected: boolean) {
    const accepted =
      callbackFrame.allows(callbackEpoch, true) &&
      picker.currentData((data) => {
        if (!("attachments" in data)) return false;
        const file = data.attachments.find((item) => item.id === id);
        if (
          (selected &&
            (!file?.selectable ||
              (selectedEvidenceIds.length >= 20 &&
                !selectedEvidenceIds.includes(id)))) ||
          (!selected && !selectedEvidenceIds.includes(id))
        )
          return false;
        return onEvidenceToggle(id, selected);
      });
    if (!accepted)
      setNotice(
        "The evidence action was refused. Retained selections are unchanged; restore current edit access and review.",
      );
  }
  function openIntent(revisionId: string, attachmentId: string) {
    if (
      !callbackFrame.allows(callbackEpoch, false) ||
      !origin ||
      !onOpenRecordedEvidence
    )
      return;
    const accepted = history.currentData((data) => {
      if (
        !("revisions" in data) ||
        !data.revisions
          .find((revision) => revision.id === revisionId)
          ?.evidenceAttachmentIds.includes(attachmentId)
      )
        return false;
      return onOpenRecordedEvidence(
        Object.freeze({
          origin: Object.freeze({ ...origin }),
          revisionId,
          attachmentId,
          procedureHash: data.procedureHash,
          populationHash: data.populationHash,
        }),
      );
    });
    if (!accepted)
      setNotice(
        "The recorded-file intent was refused. No file was opened by this component.",
      );
  }
  if (!active) return null;
  let selected: ReturnType<typeof retainedStepEvidence> | null = null;
  try {
    if (pickerData)
      selected = retainedStepEvidence(selectedEvidenceIds, pickerData);
  } catch {
    /* Whole selection remains with the parent, never repaired here. */
  }
  return (
    <section
      aria-label="Step history and stored evidence"
      style={{ margin: "16px 0", minWidth: 0 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          className="btn-secondary"
          aria-expanded={historyOpen}
          disabled={!origin}
          onClick={() => setHistoryOpen((value) => !value)}
        >
          {historyOpen ? "Hide step history" : "View step history"}
        </button>
        <button
          className="btn-secondary"
          aria-expanded={pickerOpen}
          disabled={!origin}
          onClick={() => setPickerOpen((value) => !value)}
        >
          {pickerOpen ? "Hide confirmed files" : "Link confirmed stored files"}
        </button>
      </div>
      {notice && (historyData || pickerData) && <p role="status">{notice}</p>}
      {historyOpen && (
        <section aria-label="Stored step revision history">
          <h3>Step revision history</h3>
          <p className="text-muted">
            Up to 25 rows per page and 100 revisions per step within native byte
            bounds. Current reader authorization is not proof of historical
            original tenancy or a fix.
          </p>
          <ResourcePager
            prefix={`${prefix}-history`}
            limit={history.view.intent?.limit ?? 10}
            busy={history.view.busy}
            canRequest={history.view.canRequest}
            hasNext={!!historyData?.nextCursor}
            onLimit={(limit) => void history.setLimit(limit)}
            onRefresh={() => void history.refresh()}
            onNext={() => void history.next()}
          />
          {history.view.error && <p role="alert">{history.view.error}</p>}
          {!history.view.canRequest && (
            <p role="status">
              Restore the current original reader before requesting private
              history.
            </p>
          )}
          {history.view.busy && (
            <p role="status">Reading exact scoped history…</p>
          )}
          {historyData && (
            <>
              <FrozenStep value={historyData.frozenStep} />
              <p>
                {historyData.revisions.length} shown of{" "}
                {historyData.totalRevisions} stored revisions in this scoped
                population.
              </p>
              {historyData.revisions.length === 0 && (
                <p>No recorded revisions in this admitted step scope.</p>
              )}
              <ol style={{ paddingLeft: 22 }}>
                {historyData.revisions.map((revision) => (
                  <li
                    key={revision.id}
                    style={{
                      margin: "16px 0",
                      padding: 12,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      minWidth: 0,
                    }}
                  >
                    <h4>
                      <span
                        className={
                          revision.status === "PASS"
                            ? "run-status-passed"
                            : revision.status === "FAIL"
                              ? "run-status-failed"
                              : "text-muted"
                        }
                      >
                        {revision.status}
                      </span>{" "}
                      · revision {revision.revisionNumber}
                    </h4>
                    <p style={text}>
                      {revision.actorName} · {revision.recordedAt}
                    </p>
                    <p>
                      Actual outcome: <StoredValue value={revision.note} />
                    </p>
                    <p>
                      Correction reason:{" "}
                      <StoredValue value={revision.correctionReason} />
                    </p>
                    <ObservationMetadata value={revision.observations} />
                    <RawDisclosure
                      value={revision.evidenceAttachments}
                      label="Exact stored evidence labels and version metadata"
                    />
                    {revision.evidenceAttachmentIds.map((id, index) => (
                      <div key={`${index}:${id}`} style={text}>
                        <span>Stored reference: {id}</span>
                        {onOpenRecordedEvidence && (
                          <button
                            className="btn-secondary"
                            onClick={() => openIntent(revision.id, id)}
                          >
                            Request recorded file
                          </button>
                        )}
                      </div>
                    ))}
                    <p className="text-muted">
                      Stored revision metadata only. No media bytes or
                      immutable-storage proof were obtained here.
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
      {pickerOpen && (
        <section aria-label="Confirmed project evidence picker">
          <h3>Confirmed stored files</h3>
          <p className="text-muted">
            Same-project confirmed uploads only. Literal search; up to 25 rows
            per page and 10,000 candidates within native byte bounds. Selected
            references stay retained when unavailable.
          </p>
          <label htmlFor={`${prefix}-search`}>
            Find confirmed files
            <input
              id={`${prefix}-search`}
              value={picker.view.canRequest ? searchDraft : ""}
              maxLength={200}
              disabled={!picker.view.canRequest}
              onChange={(event) => setSearchDraft(event.target.value)}
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </label>
          <button
            className="btn-secondary"
            disabled={!picker.view.canRequest || picker.view.busy}
            onClick={() => void picker.setSearch(searchDraft)}
          >
            Apply literal search
          </button>
          <ResourcePager
            prefix={`${prefix}-picker`}
            limit={picker.view.intent?.limit ?? 25}
            busy={picker.view.busy}
            canRequest={picker.view.canRequest}
            hasNext={!!pickerData?.nextCursor}
            onLimit={(limit) => void picker.setLimit(limit)}
            onRefresh={() => void picker.refresh()}
            onNext={() => void picker.next()}
          />
          {picker.view.error && <p role="alert">{picker.view.error}</p>}
          {!picker.view.canRequest && (
            <p role="status">
              Restore the current original reader before requesting private file
              metadata.
            </p>
          )}
          {picker.view.busy && (
            <p role="status">Reading exact confirmed-file metadata…</p>
          )}
          {pickerData && (
            <>
              <p>
                Applied search: <StoredValue value={pickerData.search} />
              </p>
              <p>
                {pickerData.attachments.length} shown of{" "}
                {pickerData.totalCandidates} candidates for this exact search.
              </p>
              {!editingEnabled && (
                <p role="status">
                  Evidence references are read-only. Restoring access does not
                  discard retained selections.
                </p>
              )}
              <h4>
                Retained selected references ({selectedEvidenceIds.length})
              </h4>
              {selected ? (
                <ul>
                  {selected.map((entry, index) => (
                    <li key={`${index}:${entry.id}`} style={text}>
                      <StoredValue
                        value={
                          Object.hasOwn(selectedEvidenceNames, entry.id)
                            ? selectedEvidenceNames[entry.id]
                            : entry.label
                        }
                      />
                      <span>
                        {" "}
                        · {entry.id} ·{" "}
                        {entry.availableInPage
                          ? "present in current page"
                          : "unavailable in current page; reference retained"}
                      </span>
                      <button
                        className="btn-secondary"
                        disabled={!editingEnabled || picker.view.busy}
                        onClick={() => toggle(entry.id, false)}
                      >
                        Remove reference
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  Retained selection representation is unsupported. No IDs were
                  removed or normalized.
                </p>
              )}
              {pickerData.attachments.length === 0 && (
                <p>No confirmed files match this admitted search.</p>
              )}
              <ul style={{ paddingLeft: 22 }}>
                {pickerData.attachments.map((file) => (
                  <li key={file.id} style={{ margin: "12px 0", ...text }}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedEvidenceIds.includes(file.id)}
                        disabled={
                          !editingEnabled ||
                          picker.view.busy ||
                          (!file.selectable &&
                            !selectedEvidenceIds.includes(file.id)) ||
                          (selectedEvidenceIds.length >= 20 &&
                            !selectedEvidenceIds.includes(file.id))
                        }
                        onChange={(event) =>
                          toggle(file.id, event.target.checked)
                        }
                      />
                      <StoredValue value={file.fileName} />
                    </label>
                    <span>
                      {" "}
                      · {file.contentType} · {file.sizeBytes} bytes
                    </span>
                    <FileVersion file={file} />
                    <RawDisclosure
                      value={file.uploadVerification}
                      label="Exact stored upload verification metadata"
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </section>
  );
}
