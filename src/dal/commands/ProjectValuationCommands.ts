import type {
  ProjectRepository,
  ProjectRetentionReleaseResult,
  ProjectValuationDocument,
  ProjectValuationInput,
} from '@/dal/repositories/ProjectRepository';

/**
 * User-intent commands for construction progress billing. The repository runs a
 * caller-bound capability preflight, and each SECURITY DEFINER RPC repeats the
 * authorization and server-side calculation before making changes.
 */
export class CreateValuationCommand {
  private readonly projects: Pick<ProjectRepository, 'createValuation'>;

  constructor(projects: Pick<ProjectRepository, 'createValuation'>) {
    this.projects = projects;
  }

  execute(projectId: string, input: ProjectValuationInput): Promise<ProjectValuationDocument> {
    return this.projects.createValuation(projectId, input);
  }
}

export class UpdateValuationCommand {
  private readonly projects: Pick<ProjectRepository, 'updateValuation'>;

  constructor(projects: Pick<ProjectRepository, 'updateValuation'>) {
    this.projects = projects;
  }

  execute(valuationId: string, input: ProjectValuationInput): Promise<ProjectValuationDocument> {
    return this.projects.updateValuation(valuationId, input);
  }
}

export class SubmitValuationCommand {
  private readonly projects: Pick<ProjectRepository, 'submitValuation'>;

  constructor(projects: Pick<ProjectRepository, 'submitValuation'>) {
    this.projects = projects;
  }

  execute(valuationId: string): Promise<ProjectValuationDocument> {
    return this.projects.submitValuation(valuationId);
  }
}

export class GenerateInvoiceCommand {
  private readonly projects: Pick<ProjectRepository, 'generateInvoice'>;

  constructor(projects: Pick<ProjectRepository, 'generateInvoice'>) {
    this.projects = projects;
  }

  execute(valuationId: string): Promise<ProjectValuationDocument> {
    return this.projects.generateInvoice(valuationId);
  }
}

export class ReleaseRetentionCommand {
  private readonly projects: Pick<ProjectRepository, 'releaseRetention'>;

  constructor(projects: Pick<ProjectRepository, 'releaseRetention'>) {
    this.projects = projects;
  }

  execute(projectId: string, amount: number, description: string): Promise<ProjectRetentionReleaseResult> {
    return this.projects.releaseRetention(projectId, amount, description);
  }
}
