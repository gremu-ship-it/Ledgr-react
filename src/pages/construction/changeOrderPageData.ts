import type { Project, BoqSectionWithItems } from '@/dal/repositories/ProjectRepository';
import type { ConstructionProcurementSite } from '@/dal/repositories/ConstructionProcurementRepository';
import type { SubcontractSummary } from '@/dal/types/subcontracts';
import type { Row } from '@/dal/types/database';
import { subcontractRepository } from '@/dal/repositories/SubcontractRepository';
import { repos } from '@/lib/repositories';
import { loadAllProjects } from './rfiPageData';

export { loadAllProjects };
export type ChangeOrderBoqSection = Row<'boq_sections'>;

export interface ChangeOrderProjectReferences {
  sites: ConstructionProcurementSite[];
  boqSections: ChangeOrderBoqSection[];
  subcontracts: SubcontractSummary[];
}

function flattenSections(sections: BoqSectionWithItems[]): ChangeOrderBoqSection[] {
  return sections.flatMap((section) => [
    section,
    ...flattenSections(section.children),
  ]);
}

export async function loadChangeOrderProjectReferences(
  businessId: string,
  projectId: string,
  includeHistoricalBoqSections = false,
): Promise<ChangeOrderProjectReferences> {
  const [sites, subcontracts, versions] = await Promise.all([
    repos.construction.findSitesForProject(businessId, projectId),
    subcontractRepository.listSubcontracts(businessId, projectId),
    repos.projects.listBoqVersions(businessId, projectId),
  ]);
  const activeVersion = versions.find((version) => version.status === 'active') ?? versions[0];
  const versionsToLoad = includeHistoricalBoqSections ? versions : activeVersion ? [activeVersion] : [];
  const boqTrees = await Promise.all(versionsToLoad.map((version) => repos.projects.getBoqVersion(businessId, version.id)));

  return {
    sites,
    boqSections: boqTrees.flatMap((boq) => flattenSections(boq.sections)),
    subcontracts,
  };
}

export type ChangeOrderProject = Project;
