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
 * Capabilities whose visibility is always driven by the business profile,
 * regardless of the `capability_org_layer` kill switch.
 *
 * Construction was introduced after the organisation layer shipped: it has
 * no pre-Phase-1 behaviour to preserve, so the compatibility kill switch —
 * which exists to protect the surfaces a business could already reach —
 * does not apply to it.
 *
 * POS predates the layer, but it is a retail workflow: only a business whose
 * operating models include RETAIL derives `pos: true` (see
 * `deriveOrganisationCapabilityDefaults`), so honouring the profile decision
 * on both switch states is what keeps POS from failing open for
 * construction, service and other non-retail businesses while the switch is
 * off. The legacy pin is unaffected: a pinned `pos: true` override is itself
 * the profile decision, so pinned businesses keep POS on either state.
 *
 * Both resolve from the profile every time, fail closed, and can therefore
 * never appear for a business whose profile does not select their operating
 * model (e.g. Construction, or POS, for an Enterprise retail business whose
 * profile never selected the matching model).
 */
const ALWAYS_PROFILE_GATED: ReadonlySet<string> = new Set(['construction', 'pos']);

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
 * Exception: capabilities listed in ALWAYS_PROFILE_GATED (Construction and
 * POS) ignore the kill switch entirely and fail closed on an absent decision.
 * Construction was introduced after the switch's commitments were frozen, so
 * there is no legacy surface to preserve; resolving it from the profile is
 * what keeps an Enterprise retail business from seeing a Construction
 * workspace that its profile never selected. For POS this supersedes the
 * absent-value fail-open above: existing businesses are protected by the
 * legacy pin, which resolves to an explicit decision, while a business with
 * no POS decision at all has no retail profile to show a till for.
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

  const organisationAllows = ALWAYS_PROFILE_GATED.has(capability)
    ? layers.organisation === true
    : (!organisationLayerEnabled
      || (capability === 'pos' && layers.organisation == null)
      || layers.organisation === true);

  return layers.subscription && layers.partner && layers.role && organisationAllows;
}
