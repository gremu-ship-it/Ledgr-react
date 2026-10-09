import { isFeatureEnabled } from '@/lib/featureFlags';

/**
 * Inputs are resolved by existing contexts/loaders; this module performs no
 * I/O. `partner` is true when no partner restriction applies, and `role` is
 * the existing role/path authorization result. Neither axis is bypassed by the
 * organisation-layer kill switch.
 */
export interface CapabilityLayers {
  subscription: boolean;
  partner: boolean;
  organisation?: boolean | null;
  role: boolean;
}

export interface CapabilityResolveOptions {
  /** Test seam; production reads VITE_FEATURE_CAPABILITY_ORG_LAYER. */
  organisationLayerEnabled?: boolean;
}

/**
 * Resolve one effective capability. Normally all four frozen layers compose:
 * subscription ∧ partner ∧ organisation ∧ role. Turning off the organisation
 * layer restores the pre-multibusiness result (subscription ∧ partner ∧ role)
 * without weakening tenant isolation, RLS, or server-side role checks.
 *
 * Compatibility rule from the frozen spec: when the organisation layer is on,
 * an absent `pos` value is fail-open (`true`) so a partial/missing pin cannot
 * lock existing businesses out of their current POS. Every other explicit
 * `false` still narrows access; a missing non-POS decision stays closed until
 * its code-derived default has been resolved.
 *
 * The resolver is intentionally synchronous and O(1): callers must pass
 * already-loaded values. Do not add a database request or per-row lookup here;
 * the future provider should resolve/cache capabilities once per active
 * business/session, not once per component render.
 */
export function resolveCapability(
  capability: string,
  layers: CapabilityLayers,
  options: CapabilityResolveOptions = {},
): boolean {
  const organisationLayerEnabled = options.organisationLayerEnabled
    ?? isFeatureEnabled('capability_org_layer');

  const organisationAllows = !organisationLayerEnabled
    || (capability === 'pos' && layers.organisation == null)
    || layers.organisation === true;

  return layers.subscription && layers.partner && layers.role && organisationAllows;
}
