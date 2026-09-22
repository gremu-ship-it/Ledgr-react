import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { evidenceSuite, Blocked } from './evidence';
import { loadEdge, mockClient } from './edge-loader.mjs';
import { identities, key } from './fixtures';
import { normalizePhone, phoneLoginEmail } from '../../src/lib/phone';

// R02 containment stage, single-owner phone model (product clarification: one
// registered phone number = one Ledgr account; shared-phone scenarios are OUT
// OF MODEL and were removed — possession, not uniqueness, is what remains to be
// proven). invite-team-member carries INTERIM SECURITY CONTAINMENT: credential
// rotation of an existing account is refused (RECOVERY_UNAVAILABLE) and a reset
// request for a number with no account is refused (ACCOUNT_NOT_FOUND) until a
// phone-possession proof such as SMS/OTP is authorized. This is NOT the
// permanent recovery implementation — OTP/provider-token scenarios stay BLOCKED
// and the accept-invite-link display-phone fallback stays FAIL pending
// permanent work. Actual repository handler; synthetic Auth/DB adapters,
// NEVER real resets.
const test = evidenceSuite('r02-recovery');
const source = 'supabase/functions/invite-team-member/index.ts';
const meta = (id: string, expected: string) => ({ id: `R02.${id}`, expected, source,
  remediation: 'R02', layer: 'actual Edge handler; stateful synthetic Auth/DB adapters, NOT provider token verification' });
const phones = { A: '+265990000001', B: '+265990000002' };
type Party = 'A' | 'B';
interface Scenario {
  caller?: Party; target?: Party; mapped?: Party; profile?: Party;
  mappingError?: boolean; profileError?: boolean; scan?: Party;
  rawPhone?: string; unauthenticated?: boolean; foreignOrg?: boolean;
  neverSignedIn?: boolean; reset?: boolean; unregistered?: boolean; suppliedId?: Party;
}
function setup(s: Scenario) {
  const caller = s.caller ?? 'A'; const target = s.target ?? 'B';
  // State contains revisions, not passwords, tokens, OTPs or password hashes.
  const state = { A: { credentialRevision: 0, accountRevision: 0 }, B: { credentialRevision: 0, accountRevision: 0 },
    creations: 0, databaseWrites: 0 };
  const mutations: { identity: string; fields: string[] }[] = [];
  const user = (party: Party) => ({ id: identities[`${party}_viewer`].id,
    email: phoneLoginEmail(phones[party]), phone: phones[party],
    last_sign_in_at: s.neverSignedIn ? null : '2026-01-01T00:00:00Z', user_metadata: {} });
  const client = mockClient({ user: s.unauthenticated ? null : { id: identities[`${caller}_owner`].id },
    resolveQuery: c => {
      if (c.operation !== 'select') { state.databaseWrites++; return { data: null, error: null }; }
      if (c.table === 'business_users') {
        const isCaller = c.filters.some(f => f[1] === 'user_id' && f[2] === identities[`${caller}_owner`].id);
        return { data: isCaller && !s.foreignOrg ? { role: 'owner', is_active: true } : null, error: null };
      }
      if (c.table === 'phone_accounts') return {
        data: s.unregistered || s.mappingError ? null : { user_id: user(s.mapped ?? target).id },
        error: s.mappingError ? { code: '42501', message: 'Synthetic lookup unavailable' } : null,
      };
      if (c.table === 'user_profiles') return {
        data: s.profile && !s.profileError ? { id: user(s.profile).id } : null,
        error: s.profileError ? { code: 'PGRST116', message: 'Synthetic ambiguous lookup' } : null,
      };
      return { data: null, error: null };
    },
  });
  Object.assign(client.auth.admin, {
    getUserById: async (id: string) => ({ data: { user: id === user('A').id ? user('A') : id === user('B').id ? user('B') : null }, error: null }),
    listUsers: async () => ({ data: { users: s.scan ? [user(s.scan)] : [] }, error: null }),
    updateUserById: async (id: string, attrs: Record<string, unknown>) => {
      const party = id === user('A').id ? 'A' : id === user('B').id ? 'B' : null;
      mutations.push({ identity: party ?? 'new synthetic identity', fields: Object.keys(attrs).sort() });
      if (party) {
        state[party].accountRevision++;
        if (Object.hasOwn(attrs, 'password')) state[party].credentialRevision++;
      }
      return { data: { user: party ? user(party) : { id } }, error: null };
    },
    createUser: async () => {
      state.creations++;
      return { data: { user: { id: key(88002), email: phoneLoginEmail(phones[target]), user_metadata: {} } }, error: null };
    },
  });
  const edge = loadEdge('invite-team-member', { client });
  const request = () => new Request('https://r13.invalid/recovery', {
    method: 'POST', headers: { Authorization: 'Bearer r02-synthetic-session' },
    body: JSON.stringify({ business_id: key(s.foreignOrg ? 202 : caller === 'A' ? 201 : 202),
      phone: s.rawPhone ?? phones[target], role: 'viewer', reset_password: s.reset !== false,
      ...(s.suppliedId ? { user_id: user(s.suppliedId).id } : {}),
    }),
  });
  return { state, mutations, edge, request };
}
const cases: [string, Scenario][] = [
  ['ISOLATION.A-TO-B', { caller: 'A', target: 'B' }],
  ['ISOLATION.B-TO-A', { caller: 'B', target: 'A' }],
  ['ISOLATION.MAPPED-IDENTITY-SUBSTITUTION', { target: 'A', mapped: 'B' }],
  ['ISOLATION.CALLER-SUPPLIED-ID-MISMATCH', { target: 'A', suppliedId: 'B' }],
  ['PHONE.MAP-LOOKUP-ERROR', { target: 'B', mappingError: true, profile: 'B' }],
  ['RECOVERY.IMPLICIT-NEVER-SIGNED-IN', { target: 'B', neverSignedIn: true, reset: false }],
  ['RECOVERY.NO-OWNERSHIP-PROOF', { target: 'A' }],
  ['DENIAL.INVALID-PHONE', { rawPhone: '123' }],
  ['DENIAL.UNAUTHENTICATED', { unauthenticated: true }],
  ['DENIAL.FOREIGN-ORGANISATION', { foreignOrg: true }],
];
for (const [id, scenario] of cases) {
  const observations: Record<string, unknown> = {};
  const record = { ...meta(id, 'Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged'), observations };
  test(record, async () => {
    const p = setup(scenario); const before = structuredClone(p.state);
    const response = await p.edge.invoke(p.request());
    // Only safe labels, field names, counts and booleans are evidence. Never
    // serialize the response (it may contain a generated temporary password).
    Object.assign(observations, { status: response.status, mutations: p.mutations,
      before, after: structuredClone(p.state), unchanged: JSON.stringify(before) === JSON.stringify(p.state) });
    // Check mutation state FIRST: a late error is not a security denial.
    expect(p.state).toEqual(before); expect(p.mutations).toHaveLength(0);
    expect(response.status).toBeGreaterThanOrEqual(400); expect(response.status).toBeLessThan(500);
    expect(p.edge.effects).toEqual({ network: 0, mail: 0 });
  });
}
test(meta('RECOVERY.REPEATED-UNPROVEN-REQUEST', 'Repeated requests without identity-bound recovery proof cannot repeatedly rotate any account credential'), async () => {
  const p = setup({ target: 'B' }); const before = structuredClone(p.state);
  await p.edge.invoke(p.request()); await p.edge.invoke(p.request());
  expect(p.state).toEqual(before); expect(p.mutations).toHaveLength(0);
});
const unregisteredObs: Record<string, unknown> = {};
const unregisteredRecord = { ...meta('PHONE.UNREGISTERED-RESET', 'A reset request for a number with no account is denied as an unknown recovery target; it must NOT silently provision a replacement/new account'),
  observations: unregisteredObs };
test(unregisteredRecord, async () => {
  const p = setup({ target: 'B', unregistered: true }); const before = structuredClone(p.state);
  const response = await p.edge.invoke(p.request());
  Object.assign(unregisteredObs, { status: response.status, unchanged: JSON.stringify(before) === JSON.stringify(p.state) });
  // State FIRST: denial must happen before any account creation or write.
  expect(p.state).toEqual(before); expect(p.mutations).toHaveLength(0);
  expect(response.status).toBe(404);
});
const onboardingObs: Record<string, unknown> = {};
const onboardingRecord = { ...meta('PHONE.UNREGISTERED-ONBOARDING', 'Legitimate new-account onboarding: a plain invite (no reset flag) for a genuinely new number provisions exactly one new account and never touches an existing identity'),
  observations: onboardingObs };
test(onboardingRecord, async () => {
  const p = setup({ target: 'B', unregistered: true, reset: false }); const before = structuredClone(p.state);
  const response = await p.edge.invoke(p.request());
  // Never record the response body: it carries the one-time generated password.
  Object.assign(onboardingObs, { status: response.status, authMutations: p.mutations,
    existingIdentitiesUnchanged: JSON.stringify({ A: before.A, B: before.B }) === JSON.stringify({ A: p.state.A, B: p.state.B }),
    creations: p.state.creations });
  expect(response.status).toBe(200);
  expect(p.state.A).toEqual(before.A); expect(p.state.B).toEqual(before.B);
  expect(p.state.creations).toBe(before.creations + 1); expect(p.state.databaseWrites).toBeGreaterThan(0);
  expect(p.mutations).toEqual([{ identity: 'new synthetic identity', fields: ['phone', 'phone_confirm'] }]);
});
const containmentObs: Record<string, unknown> = {};
const containmentRecord = { ...meta('CONTAINMENT.RESPONSE-LABELLED', 'Refusal is a controlled 4xx RECOVERY_UNAVAILABLE response before any Auth/database write, and its body carries no credential material'),
  observations: containmentObs };
test(containmentRecord, async () => {
  const p = setup({ target: 'B' }); const before = structuredClone(p.state);
  const response = await p.edge.invoke(p.request());
  // State is checked FIRST: a late error is not a security denial.
  expect(p.state).toEqual(before); expect(p.mutations).toHaveLength(0);
  expect(response.status).toBe(403);
  const body = await response.json() as Record<string, unknown>;
  const allKeys = (v: unknown): string[] => (v && typeof v === 'object')
    ? Object.entries(v as Record<string, unknown>).flatMap(([k, val]) => [k, ...allKeys(val)]) : [];
  // Only keys and the fixed public code are evidence; values never carry secrets.
  Object.assign(containmentObs, { status: response.status, code: body.code, topLevelKeys: Object.keys(body).sort() });
  expect(body.code).toBe('RECOVERY_UNAVAILABLE');
  expect(String(body.message).toLowerCase()).toContain('recovery');
  expect(allKeys(body).filter(k => /password|temporary|token|secret|otp/i.test(k))).toEqual([]);
});
for (const value of ['0990000001', '+265 990 000 001', '00265990000001', '265990000001']) {
  test({ ...meta(`NORMALIZATION.${value.replace(/\D/g, '')}.${value.startsWith('+') ? 'plus' : 'plain'}`, 'Existing Malawi local/international phone semantics resolve the same synthetic login, not ownership proof'),
    source: 'src/lib/phone.ts', layer: 'client phone helper; Edge/client parity tested separately by root suite' }, () => {
    expect(normalizePhone(value)).toBe(phones.A);
    expect(phoneLoginEmail(value)).toBe(phoneLoginEmail(phones.A));
  });
}
for (const [source, fragment] of [
  ['src/pages/SettingsPage.tsx', 'auth.updateUser'],
]) {
  test({ ...meta('PRESERVED.SESSION-OWNED-PASSWORD-CHANGE', 'The existing authenticated self-service password change (session-owned, no target ID) is untouched by recovery containment'),
    source, layer: 'source-preservation check; behavior owned by provider session, not by R02' }, () => {
    const src = readFileSync(source, 'utf8');
    expect(src).toContain(fragment);
    expect(src).toMatch(/updateUser\(\{\s*password/);
  });
}
test({ ...meta('PRESERVED.EMAIL-RECOVERY-ROUTES', 'The existing provider email recovery routes are untouched and still delegate issuance/session to Supabase Auth'),
  source: 'src/pages/auth/ForgotPasswordPage.tsx', layer: 'source-preservation check; provider lifecycle verification remains BLOCKED below' }, () => {
  const forgot = readFileSync('src/pages/auth/ForgotPasswordPage.tsx', 'utf8');
  const reset = readFileSync('src/pages/auth/ResetPasswordPage.tsx', 'utf8');
  expect(forgot).toContain('resetPasswordForEmail');
  expect(reset).toContain('PASSWORD_RECOVERY');
  expect(reset).toMatch(/updateUser\(\{\s*password/);
  // Session-owned only: no target selection and no privileged Auth calls anywhere
  // in the recovery UI, so app-layer identity substitution is structurally absent.
  expect(reset).not.toContain('updateUserById'); expect(reset).not.toContain('auth.admin');
  expect(forgot).not.toContain('updateUserById'); expect(forgot).not.toContain('auth.admin');
});
for (const scenario of ['valid-own-identity', 'missing', 'malformed', 'invalid', 'expired', 'consumed', 'replay', 'substituted', 'identity-changed-after-issuance']) {
  test({ ...meta(`PROVIDER-TOKEN.${scenario}`, 'Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity'),
    source: 'src/pages/auth/ResetPasswordPage.tsx', layer: 'isolated Supabase Auth recovery service unavailable' }, () => {
    throw new Blocked('No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used.');
  });
}
for (const [id, expected] of [
  ['OTP.WRONG-DENIED', 'A wrong or non-matching OTP is denied, consumes an attempt within the approved limit and changes no state'],
  ['OTP.SUBSTITUTED-TARGET-DENIED', 'An OTP issued to the phone of User A cannot authorize a credential change for User B; the recovery transaction is bound to the phone-resolved user and the caller cannot replace that user ID'],
  ['OTP.FUTURE-VALID-ALLOWS-RECOVERY', 'With an authorized OTP capability, verified possession of the registered phone authorizes recovery of exactly its one account (one phone = one user; no account-selection logic needed)'],
] as [string, string][]) {
  test({ ...meta(`RECOVERY.${id}`, expected), layer: 'single-owner OTP capability not authorized or implemented' }, () => {
    throw new Blocked('Ledgr has no SMS/OTP phone-possession mechanism and none was built at this stage. Future model per product clarification: unique registered phone -> OTP delivered to that phone -> OTP verified -> recovery authorized for the server-resolved user only. Requires separate authorization of SMS provider, delivery cost, OTP generation/expiry, retry and rate limits, replay protection, normalization, enrollment/change-of-phone process, loss-of-phone process, audit logging and provider failure behavior.');
  });
}
test(meta('DEC-02.LEGITIMATE-PHONE-RECOVERY', 'A verified phone owner can recover their own unique phone account while tenant administrators never gain global credential authority'), () => {
  throw new Blocked('DEC-02 single-owner model (per clarification): the phone number identifies the unique account, but possession must be proven before it authorizes credential recovery. Ledgr currently has no phone-possession challenge, so phone-only self-service recovery remains RECOVERY_UNAVAILABLE by design pending the authorized OTP/possession design. No shared-phone selection logic will be built.');
});

// Contained-finding stage (final R02 investigation): the phone-restriction
// screen is exercised BOTH ways. The handler's only Auth call is a READ
// (getUserById); it can never create, rotate or reset a credential — the
// mutation list below proves that structurally, not by HTTP status.
const phoneMismatchObs: Record<string, unknown> = {};
const phoneMismatchRecord = { ...meta('INVITATION.PHONE-MISMATCH', 'A phone-restricted invitation is denied with zero mutations when the caller holds a different phone number'),
  source: 'supabase/functions/accept-invite-link/index.ts', observations: phoneMismatchObs };
test(phoneMismatchRecord, async () => {
  const state = { membershipMutations: 0, profileMutations: 0 };
  const client = mockClient({ user: { id: identities.B_viewer.id, email: identities.B_viewer.email, phone: phones.B },
    resolveQuery: c => {
      if (c.operation !== 'select') { state.profileMutations++; return { data: null, error: null }; }
      if (c.table === 'business_invitations') return { data: { id: key(89001), business_id: key(201), role: 'viewer',
        phone: phones.A, email: null, token: 'r02-synthetic-invite', invited_by: identities.A_owner.id,
        role_assignment_authorized: true, accepted_at: null, expires_at: '2099-01-01' }, error: null };
      if (c.table === 'user_profiles') return { data: { phone: phones.A }, error: null };
      return { data: c.table === 'businesses' ? { name: 'R02 synthetic A' } : null, error: null };
    },
    resolveRpc: name => {
      if (name === 'accept_invitation_membership') state.membershipMutations++;
      return { data: { success: true, business_id: key(201), role: 'viewer' }, error: null };
    },
  });
  const edge = loadEdge('accept-invite-link', { client });
  const response = await edge.invoke(new Request('https://r13.invalid/accept', { method: 'POST',
    headers: { Authorization: 'Bearer r02-synthetic-session' }, body: JSON.stringify({ token: 'r02-synthetic-invite' }) }));
  Object.assign(phoneMismatchObs, { status: response.status, after: { ...state } });
  expect(state).toEqual({ membershipMutations: 0, profileMutations: 0 }); expect(response.status).toBe(403);
  expect(edge.effects).toEqual({ network: 0, mail: 0 });
});
const profileNotProofObs: Record<string, unknown> = {};
const profileNotProofRecord = { ...meta('INVITATION.PROFILE-NOT-PROOF', 'Display-profile phone can satisfy the invitation phone-restriction screen (documented membership-layer finding), while the flow provably performs zero Auth identity mutations — no credential creation/rotation/reset or takeover is possible through it; contained finding deferred to invitation hardening'),
  source: 'supabase/functions/accept-invite-link/index.ts', observations: profileNotProofObs };
test(profileNotProofRecord, async () => {
  // User B's own Auth session; B's DISPLAY profile row carries A's number
  // (manipulated/historical display data). Invitation is restricted to A's phone.
  const state = { membershipMutations: 0, profileMutations: 0 };
  const authMutations: { method: string; identity: string; fields: string[] }[] = [];
  const labelOf = (id: string) => [identities.A_viewer.id, identities.A_owner.id].includes(id) ? 'A' : 'B';
  const client = mockClient({ user: { id: identities.B_viewer.id, email: identities.B_viewer.email, phone: '' },
    resolveQuery: c => {
      if (c.operation !== 'select') { state.profileMutations++; return { data: null, error: null }; }
      if (c.table === 'business_invitations') return { data: { id: key(89001), business_id: key(201), role: 'viewer',
        phone: phones.A, email: null, token: 'r02-synthetic-invite', invited_by: identities.A_owner.id,
        role_assignment_authorized: true, accepted_at: null, expires_at: '2099-01-01' }, error: null };
      if (c.table === 'user_profiles') return { data: { phone: phones.A }, error: null };
      return { data: c.table === 'businesses' ? { name: 'R02 synthetic A' } : null, error: null };
    },
    resolveRpc: name => {
      if (name === 'accept_invitation_membership') state.membershipMutations++;
      return { data: { success: true, business_id: key(201), role: 'viewer' }, error: null };
    },
  });
  // Track every Auth-admin mutation class explicitly. The exploit succeeds at
  // the membership screen ONLY if it also produces zero of these.
  Object.assign(client.auth.admin, {
    updateUserById: async (id: string, attrs: Record<string, unknown>) => {
      authMutations.push({ method: 'updateUserById', identity: labelOf(id), fields: Object.keys(attrs).sort() });
      return { data: { user: { id } }, error: null };
    },
    createUser: async (attrs: Record<string, unknown>) => {
      authMutations.push({ method: 'createUser', identity: 'new synthetic identity', fields: Object.keys(attrs).sort() });
      return { data: { user: { id: key(88999) } }, error: null };
    },
    deleteUser: async (id: string) => { authMutations.push({ method: 'deleteUser', identity: labelOf(id), fields: [] }); return { error: null }; },
  });
  const edge = loadEdge('accept-invite-link', { client });
  const response = await edge.invoke(new Request('https://r13.invalid/accept', { method: 'POST',
    headers: { Authorization: 'Bearer r02-synthetic-session' }, body: JSON.stringify({ token: 'r02-synthetic-invite' }) }));
  Object.assign(profileNotProofObs, { status: response.status, membershipScreen: 'passed-via-display-data',
    membershipInvocations: state.membershipMutations, callerProfileWrites: state.profileMutations, authMutationCalls: authMutations });
  // Documented finding: the screen can be satisfied by display data.
  expect(state.membershipMutations).toBe(1); expect(response.status).toBe(200);
  // Containment guarantee: credential/account layer unreachable and untouched.
  expect(authMutations).toHaveLength(0);
  // Application-layer effects stay confined to the caller's own profile row.
  expect(state.profileMutations).toBe(2);
  expect(edge.effects).toEqual({ network: 0, mail: 0 });
});
