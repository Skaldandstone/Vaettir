import { useState } from "react";
export const trpcReact = {
  useUtils: () => ({
    client: {
      liveAppGeneration: {
        explorationAccess: {
          query: async (input) => {
            if (window.explorationFixture.accessDenied)
              throw Error("Synthetic membership revoked");
            return {
              readRequestId: input.readRequestId,
              requestKey: "a".repeat(64),
              scope: {
                projectId: input.projectId,
                organizationId: input.originalOrganizationId,
                nativeActorId: "synthetic-native",
                clerkActorId: input.expectedClerkActorId,
              },
              role: "EDITOR",
              seatType: "FULL",
              authorization: "CURRENT_LOCKED_FULL_EDITOR_READ",
              processingPermissionGranted: false,
              foregroundTargetVerified: false,
              deviceOperationPerformed: false,
            };
          },
        },
      },
    },
  }),
  liveAppGeneration: {
    commitExploration: {
      useMutation() {
        const [isPending, setPending] = useState(false);
        return {
          isPending,
          mutateAsync: async (input) => {
            setPending(true);
            try {
              window.explorationFixture.commits.push(structuredClone(input));
              if (window.explorationFixture.uncertain) {
                window.explorationFixture.uncertain = false;
                throw Error("Synthetic lost reply");
              }
              return {
                projectId: input.projectId,
                organizationId: input.originalOrganizationId,
                actorClerkId: input.expectedClerkActorId,
                requestId: input.requestId,
                requestHash: "f".repeat(64),
                cases: input.journeys.map((j) => ({
                  journeyId: j.id,
                  caseId: "synthetic-case-" + j.id.slice(0, 12),
                })),
              };
            } finally {
              setPending(false);
            }
          },
        };
      },
    },
  },
};
