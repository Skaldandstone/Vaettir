import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_PERMISSIONS, validateIdentityRole, validateIdentityMapping,
  localGroupGrants, planDirectoryReconciliation, resolveIdentityPermissions,
  satisfiesEnterpriseSignIn,
} from '../packages/core/src/identityPolicy.ts';

function fixture() {
  return {
    now: 1_000,
    catalog: { organizationId: 'workspace-a', projectIds: ['project-a', 'project-b'], roles: [
      { id: 'case-editor', organizationId: 'workspace-a', name: 'Case author', permissions: ['project.read', 'cases.read', 'cases.write'] },
      { id: 'plan-reader', organizationId: 'workspace-a', name: 'Plan reader', permissions: ['plans.read'] },
    ] },
    connection: { id: 'directory-a', organizationId: 'workspace-a', enabled: true, providerConnectionId: 'enterprise-a' },
    binding: { organizationId: 'workspace-a', connectionId: 'directory-a', externalSubjectId: 'immutable-subject', userId: 'local-user', generation: 4 },
    snapshot: { organizationId: 'workspace-a', connectionId: 'directory-a', externalSubjectId: 'immutable-subject', userId: 'local-user',
      active: true, complete: true, externalGroupIds: ['immutable-group'], generation: 5, observedAt: 900, expiresAt: 2_000 },
    mappings: [{ id: 'map-a', organizationId: 'workspace-a', connectionId: 'directory-a', externalGroupId: 'immutable-group', roleId: 'case-editor',
      scope: { kind: 'projects', projectIds: ['project-a'] } }],
  };
}
function evaluate(f, grants, overrides = {}) {
  return resolveIdentityPermissions({ catalog: f.catalog, directoryGrants: grants, groups: [], userId: 'local-user', projectId: 'project-a',
    now: f.now, suspended: false, connections: [f.connection], mappings: f.mappings, ...overrides });
}

test('a complete authenticated directory snapshot plans project-specific grants with provenance', () => {
  const f = fixture(); const plan = planDirectoryReconciliation(f);
  assert.equal(plan.expectedGeneration, 4); assert.equal(plan.generation, 5); assert.equal(plan.reason, 'mapped');
  assert.deepEqual(plan.replace, { organizationId: 'workspace-a', userId: 'local-user', connectionId: 'directory-a', externalSubjectId: 'immutable-subject' });
  assert.equal(plan.grants[0].source.externalGroupId, 'immutable-group');
  assert.deepEqual(evaluate(f, plan.grants), ['project.read', 'cases.read', 'cases.write']);
  assert.deepEqual(evaluate(f, plan.grants, { projectId: 'project-b' }), []);
});
for (const [name, mutate, reason] of [
  ['removal from last mapped group', f => { f.snapshot.externalGroupIds = []; }, 'unmapped'],
  ['subject deprovisioning', f => { f.snapshot.active = false; }, 'deprovisioned'],
  ['connection disabled', f => { f.connection.enabled = false; }, 'connection-disabled'],
  ['mapping deleted', f => { f.mappings = []; }, 'unmapped'],
]) test(`${name} revokes source grants without a Viewer fallback`, () => {
  const f = fixture(); mutate(f); const plan = planDirectoryReconciliation(f);
  assert.equal(plan.reason, reason); assert.deepEqual(plan.grants, []);
  assert.equal(plan.replace.connectionId, 'directory-a');
});

for (const [name, mutate, message] of [
  ['partial snapshot', f => { f.snapshot.complete = false; }, /incomplete/],
  ['duplicate generation', f => { f.snapshot.generation = 4; }, /Stale/],
  ['out of order generation', f => { f.snapshot.generation = 3; }, /Stale/],
  ['fractional generation', f => { f.snapshot.generation = 4.1; }, /Stale/],
  ['unsafe generation', f => { f.snapshot.generation = Number.MAX_SAFE_INTEGER + 1; }, /Stale/],
  ['expired snapshot', f => { f.snapshot.expiresAt = 1_000; }, /stale/],
  ['future snapshot', f => { f.snapshot.observedAt = 1_001; }, /stale/],
  ['nonfinite snapshot time', f => { f.snapshot.expiresAt = Infinity; }, /stale/],
  ['cross-workspace snapshot', f => { f.snapshot.organizationId = 'workspace-b'; }, /workspace/],
  ['cross-workspace binding', f => { f.binding.organizationId = 'workspace-b'; }, /workspace/],
  ['cross-workspace connection', f => { f.connection.organizationId = 'workspace-b'; }, /workspace/],
  ['wrong directory', f => { f.snapshot.connectionId = 'directory-b'; }, /mismatch/],
  ['changed subject', f => { f.snapshot.externalSubjectId = 'email-recycled-person'; }, /binding/],
  ['changed local identity', f => { f.snapshot.userId = 'other-user'; }, /binding/],
  ['cross-workspace role', f => { f.catalog.roles[0].organizationId = 'workspace-b'; }, /workspace/],
  ['foreign project mapping', f => { f.mappings[0].scope.projectIds = ['foreign-project']; }, /workspace/],
  ['unknown mapped role', f => { f.mappings[0].roleId = 'owner'; }, /Unknown/],
  ['duplicate groups', f => { f.snapshot.externalGroupIds.push('immutable-group'); }, /Duplicate/],
  ['duplicate mappings', f => { f.mappings.push(f.mappings[0]); }, /Duplicate/],
  ['malformed active state', f => { f.snapshot.active = 'true'; }, /state/],
]) test(`rejects ${name} before a replacement plan exists`, () => {
  const f = fixture(); mutate(f); assert.throws(() => planDirectoryReconciliation(f), message);
});

test('group display-name guesses do not match stable external group IDs', () => {
  const f = fixture(); f.snapshot.externalGroupIds = ['QA Leads'];
  assert.equal(planDirectoryReconciliation(f).reason, 'unmapped');
});
test('roles union only explicitly configured permissions, not the broad legacy Editor role', () => {
  const f = fixture(); f.mappings.push({ ...f.mappings[0], id: 'map-b', roleId: 'plan-reader' });
  const permissions = evaluate(f, planDirectoryReconciliation(f).grants);
  assert.deepEqual(permissions, ['project.read', 'cases.read', 'cases.write', 'plans.read']);
  assert.ok(!permissions.includes('plans.write')); assert.ok(!permissions.includes('integrations.manage'));
});
test('permission edits and role deletion affect authorization without a new directory login', () => {
  const f = fixture(); const grants = planDirectoryReconciliation(f).grants;
  f.catalog.roles[0].permissions = ['cases.read'];
  assert.deepEqual(evaluate(f, grants), ['cases.read']);
  f.catalog.roles = []; assert.deepEqual(evaluate(f, grants), []);
});
test('expired grants and disabled connections cannot authorize stale sessions', () => {
  const f = fixture(); const grants = planDirectoryReconciliation(f).grants;
  assert.deepEqual(evaluate(f, grants, { now: 2_000 }), []);
  assert.deepEqual(evaluate(f, grants, { connections: [] }), []);
  assert.deepEqual(evaluate(f, grants, { suspended: true }), []);
});
test('foreign subjects, workspaces and nonexistent projects receive no permissions', () => {
  const f = fixture(); const grants = planDirectoryReconciliation(f).grants;
  assert.deepEqual(evaluate(f, grants, { userId: 'other-user' }), []);
  assert.deepEqual(evaluate(f, grants, { projectId: 'foreign-project' }), []);
  grants[0].organizationId = 'workspace-b'; assert.deepEqual(evaluate(f, grants), []);
});
test('local groups are immediately recalculated and remain independent of directory grants', () => {
  const f = fixture(); const groups = [{ id: 'local-qa', organizationId: 'workspace-a', name: 'QA', userIds: ['local-user'],
    roleIds: ['plan-reader'], scope: { kind: 'workspace' } }];
  const local = localGroupGrants(f.catalog, groups, 'local-user');
  f.snapshot.active = false;
  assert.equal(local[0].source.kind, 'local-group');
  assert.deepEqual(evaluate(f, planDirectoryReconciliation(f).grants, { groups }), ['plans.read']);
  groups[0].userIds = []; assert.deepEqual(localGroupGrants(f.catalog, groups, 'local-user'), []);
});
test('deleting or changing a mapping immediately denies old cached grants', () => {
  const f = fixture(); const grants = planDirectoryReconciliation(f).grants;
  assert.deepEqual(evaluate(f, grants, { mappings: [] }), []);
  f.mappings[0].roleId = 'plan-reader'; assert.deepEqual(evaluate(f, grants), []);
  f.mappings[0].roleId = 'case-editor'; f.mappings[0].scope.projectIds = ['project-b'];
  assert.deepEqual(evaluate(f, grants), []);
  assert.deepEqual(evaluate(f, grants, { projectId: 'project-b' }), []);
});
test('cached local-group grants are not accepted as directory evidence', () => {
  const f = fixture(); const group = { id: 'g', organizationId: 'workspace-a', name: 'QA', userIds: ['local-user'],
    roleIds: ['plan-reader'], scope: { kind: 'workspace' } };
  assert.deepEqual(evaluate(f, localGroupGrants(f.catalog, [group], 'local-user')), []);
});
test('local groups cannot select foreign workspace roles or projects', () => {
  const f = fixture(); const group = { id: 'g', organizationId: 'workspace-b', name: 'QA', userIds: ['local-user'],
    roleIds: ['plan-reader'], scope: { kind: 'workspace' } };
  assert.throws(() => localGroupGrants(f.catalog, [group], 'local-user'), /workspace/);
  group.organizationId = 'workspace-a'; group.roleIds = ['foreign-role'];
  assert.throws(() => localGroupGrants(f.catalog, [group], 'local-user'), /Unknown/);
});
test('no wildcard, ownership, identity administration or arbitrary provider permissions', () => {
  const f = fixture();
  for (const permission of ['*', 'OWNER', 'identity.manage', 'org:sys_memberships:manage', 'billing.manage']) {
    assert.throws(() => validateIdentityRole({ ...f.catalog.roles[0], permissions: [permission] }, 'workspace-a'), /reserved/);
  }
  assert.throws(() => validateIdentityRole({ ...f.catalog.roles[0], permissions: [] }, 'workspace-a'), /permission/);
  assert.equal(new Set(IDENTITY_PERMISSIONS).size, IDENTITY_PERMISSIONS.length);
});
test('scope validation rejects empty projects and cross-connection mappings', () => {
  const f = fixture(); f.mappings[0].scope.projectIds = [];
  assert.throws(() => validateIdentityMapping(f.mappings[0], f.connection, f.catalog), /project/);
  f.mappings[0].scope = { kind: 'workspace' }; f.mappings[0].connectionId = 'other';
  assert.throws(() => validateIdentityMapping(f.mappings[0], f.connection, f.catalog), /connection/);
});
test('planning does not mutate catalog, input scopes, binding, or source snapshots', () => {
  const f = fixture(); const original = structuredClone(f); const plan = planDirectoryReconciliation(f);
  plan.grants[0].scope.projectIds.push('project-b'); assert.deepEqual(f, original);
});

function signInFixture() {
  const f = fixture();
  return { userId: 'local-user', organizationId: 'workspace-a', required: true, suspended: false, connections: [f.connection], now: 1_000,
    session: { userId: 'local-user', organizationId: 'workspace-a', providerConnectionId: 'enterprise-a', authenticatedAt: 900, expiresAt: 2_000 } };
}
test('enterprise enforcement accepts only current-session evidence for the selected workspace connection', () => {
  assert.equal(satisfiesEnterpriseSignIn(signInFixture()), true);
});
for (const [name, mutate] of [
  ['no session proof', f => { f.session = null; }],
  ['wrong subject', f => { f.session.userId = 'other'; }],
  ['wrong workspace', f => { f.session.organizationId = 'other'; }],
  ['wrong enterprise connection', f => { f.session.providerConnectionId = 'other'; }],
  ['disabled enterprise connection', f => { f.connections[0].enabled = false; }],
  ['expired session', f => { f.session.expiresAt = 1_000; }],
  ['future authentication', f => { f.session.authenticatedAt = 1_001; }],
  ['suspended workspace', f => { f.suspended = true; }],
]) test(`SSO enforcement denies ${name}`, () => {
  const f = signInFixture(); mutate(f); assert.equal(satisfiesEnterpriseSignIn(f), false);
});
test('SSO opt-in does not change legacy authentication, but suspension still wins', () => {
  const f = signInFixture(); f.required = false; f.session = null;
  assert.equal(satisfiesEnterpriseSignIn(f), true);
  f.suspended = true; assert.equal(satisfiesEnterpriseSignIn(f), false);
});
