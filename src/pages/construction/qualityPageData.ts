import type {
  ConstructionItpCheckpointRow,
  ConstructionItpRow,
} from '@/dal/repositories/ConstructionQualityRepository';
import { repos } from '@/lib/repositories';
import { loadAllProjects } from './rfiPageData';
import { loadChangeOrderProjectReferences } from './changeOrderPageData';

export { loadAllProjects, loadChangeOrderProjectReferences };

export interface ItpCheckpointOption {
  itp: ConstructionItpRow;
  checkpoint: ConstructionItpCheckpointRow;
}

export async function loadProjectCheckpointOptions(
  businessId: string,
  projectId: string,
): Promise<ItpCheckpointOption[]> {
  const itps = await repos.quality.listItps(businessId, { projectId });
  const checkpoints = await Promise.all(itps.map(async (itp) =>
    (await repos.quality.listCheckpointsByItp(businessId, itp.id)).map((checkpoint) => ({ itp, checkpoint })),
  ));
  return checkpoints.flat();
}
