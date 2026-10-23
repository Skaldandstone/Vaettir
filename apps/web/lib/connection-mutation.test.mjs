import {test} from "node:test";
import assert from "node:assert/strict";
import {isConnectionMutation} from "./connection-mutation.ts";

test("connection dialogs only wait for connection/intake writes, not unrelated case or AI actions", () => {
  for (const route of ["repositoryConnections", "linearConnections", "jiraConnections", "driveConnections", "populationDocuments", "importJobs", "signalRouting"])
    assert.equal(isConnectionMutation([[route,"save"],{type:"mutation"}]),true);
  for (const key of [undefined, [], [null], [["testCases","assessRisk"]], [["agent","scanRepo"]], [["requirements","create"]], ["repositoryConnections"], [["repositoryConnectionsElse","save"]]])
    assert.equal(isConnectionMutation(key),false);
});
