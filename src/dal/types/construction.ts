import type { Row } from './database';

/** Existing procurement statuses remain valid for historical projects. */
export const CONSTRUCTION_PROJECT_STATUSES = [
  'draft',
  'tender',
  'active',
  'on_hold',
  'practical_completion',
  'defect_liability',
  'completed',
  'closed',
] as const;

export type ConstructionProjectStatus = (typeof CONSTRUCTION_PROJECT_STATUSES)[number];
export type ConstructionProject = Omit<Row<'construction_projects'>, 'status'> & {
  status: ConstructionProjectStatus;
};
export type ConstructionSite = Row<'construction_sites'>;

export interface ConstructionProjectInput {
  client_id?: string | null;
  name: string;
  client_name: string;
  contract_sum: number;
  retention_pct: number;
  budget: number;
  start_date: string | null;
  end_date: string | null;
}

export interface ConstructionSiteInput {
  name: string;
  location_id: string | null;
  address: string | null;
}

/**
 * Allowed lifecycle edges. The legacy tender/completion/defect-liability path
 * remains intact while new projects can start as drafts and be put on hold.
 */
export const CONSTRUCTION_PROJECT_STATUS_TRANSITIONS: Record<ConstructionProjectStatus, readonly ConstructionProjectStatus[]> = {
  draft: ['tender', 'active', 'on_hold'],
  tender: ['active', 'on_hold'],
  active: ['on_hold', 'practical_completion', 'completed'],
  on_hold: ['draft', 'tender', 'active', 'completed'],
  practical_completion: ['defect_liability', 'completed'],
  defect_liability: ['closed'],
  completed: [],
  closed: [],
};

export function canTransitionConstructionProjectStatus(
  from: ConstructionProjectStatus,
  to: ConstructionProjectStatus,
): boolean {
  return CONSTRUCTION_PROJECT_STATUS_TRANSITIONS[from].includes(to);
}

export type SubcontractorSafetyRating = 'A' | 'B' | 'C' | 'D' | 'unrated';
export type SubcontractStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'terminated';
export type SubcontractorProfile = Row<'subcontractor_profiles'>;
export type Subcontract = Omit<Row<'subcontracts'>, 'status'> & { status: SubcontractStatus };

export type SubcontractorContact = Pick<
  Row<'contacts'>,
  | 'id'
  | 'name'
  | 'contact_type'
  | 'email'
  | 'phone'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'country'
  | 'tpin'
  | 'vat_number'
>;

export type SubcontractorProfileWithContact = SubcontractorProfile & {
  contact: SubcontractorContact;
};

export type SubcontractSummary = Subcontract & {
  subcontractor_profile: Pick<SubcontractorProfile, 'id' | 'trade' | 'is_active'> & {
    contact: SubcontractorContact;
  };
  project: Pick<ConstructionProject, 'id' | 'name' | 'status'>;
};

export type SubcontractDetail = Subcontract & {
  subcontractor_profile: SubcontractorProfileWithContact;
  project: ConstructionProject;
};

export type CreateSubcontractorProfileInput = Pick<SubcontractorProfile, 'contact_id' | 'trade'> &
  Partial<Pick<
    SubcontractorProfile,
    | 'license_number'
    | 'license_expiry'
    | 'insurance_provider'
    | 'insurance_policy_number'
    | 'insurance_expiry'
    | 'compliance_notes'
    | 'safety_rating'
    | 'preferred'
    | 'is_active'
  >>;

export type UpdateSubcontractorProfileInput = Partial<Omit<
  SubcontractorProfile,
  'id' | 'business_id' | 'contact_id' | 'created_at' | 'updated_at'
>>;

export type CreateSubcontractInput = Pick<
  Subcontract,
  'project_id' | 'subcontractor_profile_id' | 'reference' | 'title' | 'contract_value'
> & Partial<Pick<
  Subcontract,
  | 'description'
  | 'scope_of_work'
  | 'currency'
  | 'retention_percentage'
  | 'status'
  | 'start_date'
  | 'end_date'
  | 'defects_liability_months'
  | 'payment_terms'
  | 'notes'
  | 'created_by'
>>;

export type UpdateSubcontractInput = Partial<Omit<
  Subcontract,
  'id' | 'business_id' | 'project_id' | 'subcontractor_profile_id' | 'created_at' | 'updated_at' | 'created_by' | 'status'
>>;

export const SUBCONTRACT_STATUS_TRANSITIONS: Record<SubcontractStatus, readonly SubcontractStatus[]> = {
  draft: ['active', 'on_hold', 'terminated'],
  active: ['on_hold', 'completed', 'terminated'],
  on_hold: ['active', 'completed', 'terminated'],
  completed: [],
  terminated: [],
};

export function canTransitionSubcontractStatus(from: SubcontractStatus, to: SubcontractStatus): boolean {
  return SUBCONTRACT_STATUS_TRANSITIONS[from].includes(to);
}
