type ProcedureStep = {
  action: string;
  expectedActionOrData?: string | null;
  expectedResult?: string | null;
  expectedResponse?: string | null;
  mediaAttachmentIds?: readonly string[];
};
/** Read-only ordered procedure preview. Never merges preconditions into steps
 * or omits expected data/result/response from an inherited shared procedure. */
export function CaseProcedureColumns({
  steps,
  labels,
}: {
  steps: readonly ProcedureStep[];
  labels?: Partial<
    Record<
      "action" | "expectedActionOrData" | "expectedResult" | "expectedResponse",
      string
    >
  >;
}) {
  const hasMedia = steps.some((step) => step.mediaAttachmentIds?.length);
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="Ordered procedure action and expected columns"
      tabIndex={0}
      style={{ maxWidth: "100%", overflowX: "auto" }}
    >
      <table
        className="workspace-table"
        style={{ minWidth: 640, width: "100%", tableLayout: "fixed" }}
      >
        <caption>
          Steps in stored order. Empty expected fields are shown as not
          supplied.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ width: 48 }}>
              #
            </th>
            <th scope="col">{labels?.action ?? "Action"}</th>
            <th scope="col">
              {labels?.expectedActionOrData ?? "Expected data"}
            </th>
            <th scope="col">{labels?.expectedResult ?? "Expected result"}</th>
            <th scope="col">
              {labels?.expectedResponse ?? "Expected response"}
            </th>
            {hasMedia && <th scope="col">Media references</th>}
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => (
            <tr key={index}>
              <th scope="row">{index + 1}</th>
              {(
                [
                  "action",
                  "expectedActionOrData",
                  "expectedResult",
                  "expectedResponse",
                ] as const
              ).map((field) => (
                <td
                  key={field}
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    verticalAlign: "top",
                  }}
                >
                  {step[field] == null || step[field] === ""
                    ? "Not supplied"
                    : step[field]}
                </td>
              ))}
              {hasMedia && (
                <td>
                  {step.mediaAttachmentIds?.length ?? 0} linked references; this
                  preview does not fetch or verify media.
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
