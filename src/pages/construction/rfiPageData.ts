import type { Project, BoqItem } from '@/dal/repositories/ProjectRepository';
import type { ConstructionProcurementSite } from '@/dal/repositories/ConstructionProcurementRepository';
import type { SubcontractSummary } from '@/dal/types/subcontracts';
import { subcontractRepository } from '@/dal/repositories/SubcontractRepository';
import { repos } from '@/lib/repositories';

export interface RfiProjectReferences {
  sites: ConstructionProcurementSite[];
  boqItems: BoqItem[];
  subcontracts: SubcontractSummary[];
}

export async function loadAllProjects(businessId: string): Promise<Project[]> {
  const projects: Project[] = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await repos.projects.list(businessId, { page });
    projects.push(...result.rows);
    if (projects.length >= result.count || result.rows.length === 0) break;
  }
  return projects;
}

function flattenBoq(sections: Awaited<ReturnType<typeof repos.projects.getBoqVersion>>['sections']): BoqItem[] {
  return sections.flatMap((section) => [...section.items, ...flattenBoq(section.children)]);
}

export async function loadProjectReferences(businessId: string, projectId: string): Promise<RfiProjectReferences> {
  const [sites, subcontracts, versions] = await Promise.all([
    repos.construction.findSitesForProject(businessId, projectId),
    subcontractRepository.listSubcontracts(businessId, projectId),
    repos.projects.listBoqVersions(businessId, projectId),
  ]);
  const activeVersion = versions.find((version) => version.status === 'active') ?? versions[0];
  const boq = activeVersion
    ? await repos.projects.getBoqVersion(businessId, activeVersion.id)
    : null;

  return {
    sites,
    boqItems: boq ? flattenBoq(boq.sections) : [],
    subcontracts,
  };
}
