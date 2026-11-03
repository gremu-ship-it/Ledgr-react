// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulePage } from '@/pages/construction/SchedulePage';

const { repos, subcontractRepository } = vi.hoisted(() => ({
  repos: {
    projects: {
      list: vi.fn(),
      listBoqVersions: vi.fn(),
      getBoqVersion: vi.fn(),
    },
    construction: { findSitesForProject: vi.fn() },
    schedule: {
      getTaskTree: vi.fn(),
      getProjectScheduleSummary: vi.fn(),
      listDependencies: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateProgress: vi.fn(),
      delete: vi.fn(),
      createDependency: vi.fn(),
      deleteDependency: vi.fn(),
    },
  },
  subcontractRepository: { listSubcontracts: vi.fn() },
}));

vi.mock('@/lib/repositories', () => ({ repos }));
vi.mock('@/dal/repositories/SubcontractRepository', () => ({ subcontractRepository }));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    currentBusiness: { business: { id: 'business-1' } },
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => options
      ? `${key}:${Object.values(options).join(',')}`
      : key,
    i18n: { language: 'en' },
  }),
}));

const project = { id: 'project-1', name: 'Clinic Extension' };
const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1', business_id: 'business-1', project_id: 'project-1', site_id: null,
  parent_task_id: null, wbs_code: '1', task_name: 'Main works', description: null,
  status: 'in_progress', planned_start: '2026-11-01', planned_finish: '2026-12-01',
  actual_start: '2026-11-02', actual_finish: null, progress_percent: 45,
  boq_section_id: null, subcontract_id: null, sort_order: 0, created_by: 'user-1',
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', children: [],
  ...overrides,
});

function renderPage(initialEntry = '/construction/schedule') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/construction/schedule" element={<SchedulePage />} />
          <Route path="/construction/schedule/:projectId" element={<SchedulePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  repos.projects.list.mockResolvedValue({ rows: [project], count: 1 });
  repos.projects.listBoqVersions.mockResolvedValue([]);
  repos.projects.getBoqVersion.mockResolvedValue({ sections: [] });
  repos.construction.findSitesForProject.mockResolvedValue([]);
  subcontractRepository.listSubcontracts.mockResolvedValue([]);
  repos.schedule.getTaskTree.mockResolvedValue([]);
  repos.schedule.getProjectScheduleSummary.mockResolvedValue({
    total_tasks: 0, completed: 0, in_progress: 0, not_started: 0, on_hold: 0,
  });
  repos.schedule.listDependencies.mockResolvedValue([]);
  repos.schedule.create.mockResolvedValue(makeTask());
  repos.schedule.update.mockResolvedValue(makeTask());
  repos.schedule.updateProgress.mockResolvedValue(undefined);
  repos.schedule.createDependency.mockResolvedValue({});
  repos.schedule.delete.mockResolvedValue(true);
  repos.schedule.deleteDependency.mockResolvedValue(true);
});

describe('SchedulePage', () => {
  it('shows the empty prompt when no project is selected', async () => {
    renderPage();

    expect(await screen.findByText('scheduling.noProject')).toBeTruthy();
    expect(screen.getByLabelText('scheduling.selectProject')).toBeTruthy();
    expect(repos.schedule.getTaskTree).not.toHaveBeenCalled();
  });

  it('renders the task table in WBS hierarchy with status and progress', async () => {
    const parent = makeTask({ id: 'task-1', wbs_code: '1', task_name: 'Main works', children: [
      makeTask({ id: 'task-2', parent_task_id: 'task-1', wbs_code: '1.1', task_name: 'Foundations', status: 'completed', progress_percent: 100, children: [] }),
    ] });
    repos.schedule.getTaskTree.mockResolvedValue([parent]);
    repos.schedule.getProjectScheduleSummary.mockResolvedValue({
      total_tasks: 2, completed: 1, in_progress: 1, not_started: 0, on_hold: 0,
    });

    renderPage('/construction/schedule/project-1');

    expect(await screen.findByRole('button', { name: 'Main works' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Foundations' })).toBeTruthy();
    expect(screen.getByText('1.1')).toBeTruthy();
    expect(screen.getByText('scheduling.statusCompleted')).toBeTruthy();
    expect(screen.getByText('scheduling.summaryTotal')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'scheduling.progressForTask:Main works' }).getAttribute('aria-valuenow')).toBe('45');
    expect(screen.getByRole('progressbar', { name: 'scheduling.progressForTask:Foundations' }).getAttribute('aria-valuenow')).toBe('100');
  });

  it('opens the task form from Add Task', async () => {
    renderPage('/construction/schedule/project-1');

    const addTaskButton = await screen.findByRole('button', { name: 'scheduling.addTask' });
    await waitFor(() => expect(addTaskButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(addTaskButton);

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('scheduling.wbsCode')).toBeTruthy();
    expect(screen.getByText('scheduling.taskName')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'scheduling.progress' })).toBeTruthy();
    expect(screen.getByLabelText('scheduling.site')).toBeTruthy();
    expect(screen.getByLabelText('scheduling.boqSection')).toBeTruthy();
    expect(screen.getByLabelText('scheduling.subcontract')).toBeTruthy();
  });

  it('renders dependency management for a selected task', async () => {
    repos.schedule.getTaskTree.mockResolvedValue([
      makeTask({ id: 'task-1', wbs_code: '1', task_name: 'Main works' }),
      makeTask({ id: 'task-2', wbs_code: '2', task_name: 'Finishes', status: 'not_started', progress_percent: 0 }),
    ]);

    renderPage('/construction/schedule/project-1');

    fireEvent.click(await screen.findByRole('button', { name: 'scheduling.viewDependenciesNamed:Main works' }));

    expect(await screen.findByRole('heading', { name: 'scheduling.dependencies' })).toBeTruthy();
    expect(screen.getByLabelText('scheduling.predecessor')).toBeTruthy();
    expect(screen.getByLabelText('scheduling.successor')).toBeTruthy();
    expect(screen.getByLabelText('scheduling.dependencyType')).toBeTruthy();
    expect(screen.getByLabelText('scheduling.lagDays')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'scheduling.addDependency' })).toBeTruthy();
    expect(repos.schedule.listDependencies).toHaveBeenCalledWith('business-1', 'task-1');
  });
});
