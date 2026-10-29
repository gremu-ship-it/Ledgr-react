import type { Row } from './database';

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
  project: Pick<Row<'construction_projects'>, 'id' | 'name' | 'status'>;
};

export type SubcontractDetail = Subcontract & {
  subcontractor_profile: SubcontractorProfileWithContact;
  project: Row<'construction_projects'>;
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
