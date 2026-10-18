import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCapability, type CapabilityLayers } from '../resolve';

afterEach(() => vi.unstubAllEnvs());

const allowed: CapabilityLayers = {
  subscription: true,
  partner: true,
  organisation: true,
  role: true,
};

describe('resolveCapability rollback and capability-layer semantics', () => {
  it('defaults to the pre-architecture layers until explicitly enabled', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    expect(resolveCapability('services', { ...allowed, organisation: false })).toBe(true);
  });

  it('enables the organisation layer only when its build-time flag is on', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveCapability('services', { ...allowed, organisation: false })).toBe(false);
    expect(resolveCapability('services', allowed)).toBe(true);
  });

  it('ignores the organisation decision on rollback but still enforces other layers', () => {
    const disabled = { organisationLayerEnabled: false };
    expect(resolveCapability('inventory', { ...allowed, organisation: false }, disabled)).toBe(true);
    expect(resolveCapability('inventory', { ...allowed, subscription: false }, disabled)).toBe(false);
    expect(resolveCapability('inventory', { ...allowed, partner: false }, disabled)).toBe(false);
    expect(resolveCapability('inventory', { ...allowed, role: false }, disabled)).toBe(false);
  });

  it('fails POS closed on an absent organisation key, like the other profile-gated capabilities', () => {
    // POS joined ALWAYS_PROFILE_GATED, so the frozen absent-POS fail-open no
    // longer applies to it. Existing businesses are protected by the legacy
    // pin, which resolves to an explicit decision rather than an absent one.
    for (const options of [{ organisationLayerEnabled: true }, { organisationLayerEnabled: false }]) {
      expect(resolveCapability('pos', { ...allowed, organisation: undefined }, options)).toBe(false);
      expect(resolveCapability('pos', { ...allowed, organisation: null }, options)).toBe(false);
      expect(resolveCapability('pos', { ...allowed, organisation: false }, options)).toBe(false);
    }
  });

  it('profile-gates POS regardless of the kill switch, without touching other capabilities', () => {
    const disabled = { organisationLayerEnabled: false };
    // An explicit POS decision is honoured on rollback…
    expect(resolveCapability('pos', { ...allowed, organisation: false }, disabled)).toBe(false);
    expect(resolveCapability('pos', allowed, disabled)).toBe(true);
    // …while non-gated capabilities keep their legacy rollback behaviour.
    expect(resolveCapability('inventory', { ...allowed, organisation: false }, disabled)).toBe(true);
    // …and the frozen absent-value fail-open no longer rescues POS.
    expect(resolveCapability('pos', { ...allowed, organisation: undefined }, disabled)).toBe(false);
    // The other layers still compose for a profile-gated capability.
    expect(resolveCapability('pos', { ...allowed, subscription: false }, disabled)).toBe(false);
    expect(resolveCapability('pos', { ...allowed, role: false }, disabled)).toBe(false);
  });

  it('does not fail-open a missing non-POS organisation decision', () => {
    expect(resolveCapability('services', { ...allowed, organisation: undefined }, {
      organisationLayerEnabled: true,
    })).toBe(false);
  });

  it('accepts the documented true/1 spellings and treats false as off', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '1');
    expect(resolveCapability('services', { ...allowed, organisation: false })).toBe(false);
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'false');
    expect(resolveCapability('services', { ...allowed, organisation: false })).toBe(true);
  });
});
