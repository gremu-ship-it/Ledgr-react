import type { ConstructionProcurementSite } from '@/dal/repositories/ConstructionProcurementRepository';
import { repos } from '@/lib/repositories';
import { loadAllProjects } from './qualityPageData';

export { loadAllProjects };

export async function loadProjectSites(businessId: string, projectId: string): Promise<ConstructionProcurementSite[]> {
  return repos.construction.findSitesForProject(businessId, projectId);
}
