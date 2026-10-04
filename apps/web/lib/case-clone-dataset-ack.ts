import {
  verifiedFolderDatasetAck,
  type FolderDatasetSource,
} from "./folder-dataset-copy-ack";
type Request = {
  projectId: string;
  caseId: string;
  requestId: string;
  expectedScope?: { organizationId: string; clerkActorId: string };
  copyParameterDataset?: true;
  expectedDatasetHash?: string;
  expectedDataset?: FolderDatasetSource;
};
type Result = {
  caseId: string;
  displayId: string;
  requestId?: string;
  projectId?: string;
  organizationId?: string;
  clerkActorId?: string;
  copyParameterDataset?: true;
  datasetReviewHash?: string;
  copiedDataset?: FolderDatasetSource & {
    caseId: string;
    displayId: string;
    datasetId: string;
  };
};
export async function verifiedIndependentCloneAck(
  input: Request,
  result: Result,
) {
  if (
    result.copyParameterDataset !== undefined &&
    result.copyParameterDataset !== true
  )
    return false;
  if (
    typeof result.caseId !== "string" ||
    !result.caseId ||
    result.caseId.length > 200 ||
    result.caseId === input.caseId ||
    typeof result.displayId !== "string" ||
    !result.displayId ||
    result.displayId.length > 200
  )
    return false;
  if (
    input.expectedScope &&
    (result.requestId !== input.requestId ||
      result.projectId !== input.projectId ||
      result.organizationId !== input.expectedScope.organizationId ||
      result.clerkActorId !== input.expectedScope.clerkActorId)
  )
    return false;
  return verifiedFolderDatasetAck(
    {
      projectId: input.projectId,
      ...(input.copyParameterDataset
        ? {
            copyParameterDatasets: true as const,
            expectedDatasetHash: input.expectedDatasetHash,
            expectedDatasets: input.expectedDataset
              ? [input.expectedDataset]
              : undefined,
          }
        : {}),
    },
    {
      copies: [
        {
          sourceId: input.caseId,
          caseId: result.caseId,
          displayId: result.displayId,
        },
      ],
      copyParameterDatasets: result.copyParameterDataset === true,
      datasetReviewHash: result.datasetReviewHash,
      copiedDatasets: result.copiedDataset ? [result.copiedDataset] : [],
    },
  );
}
