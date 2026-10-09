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

  it('allows an absent POS organisation key as the frozen rollback-compatibility rule', () => {
    const enabled = { organisationLayerEnabled: true };
    expect(resolveCapability('pos', { ...allowed, organisation: undefined }, enabled)).toBe(true);
    expect(resolveCapability('pos', { ...allowed, organisation: null }, enabled)).toBe(true);
    expect(resolveCapability('pos', { ...allowed, organisation: false }, enabled)).toBe(false);
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
