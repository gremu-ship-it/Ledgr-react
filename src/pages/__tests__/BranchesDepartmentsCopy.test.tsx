// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import en from '@/i18n/locales/en.json';

const mocks = vi.hoisted(() => ({
  updateBranch: vi.fn(),
  findByBusiness: vi.fn(),
  findLocations: vi.fn(),
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: { currentBusiness: unknown }) => unknown) =>
    selector({ currentBusiness: { business: { id: 'biz-1' } } }),
}));
vi.mock('@/hooks/useBusinessProfile', () => ({
  useBusinessProfile: () => ({ profile: { operating_models: ['RETAIL'] } }),
}));
vi.mock('@/hooks/useCapability', () => ({
  useOrganisationCapabilityVisibility: () => () => true,
}));
vi.mock('@/lib/repositories', () => ({
  repos: {
    branch: {
      updateBranch: mocks.updateBranch,
      findByBusiness: mocks.findByBusiness,
      findLocations: mocks.findLocations,
    },
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { BranchesPage } from '../BranchesPage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('branch and department copy', () => {
  it('uses neutral translated copy on the Branches page', () => {
    expect(en.pages.branches.description).toMatch(/branches and their linked locations/i);
    expect(en.pages.branches.description).not.toMatch(/selling points/i);
  });

  it('explains that a cost centre is a reporting label, not a ledger account code', () => {
    expect(en.pages.departments.costCentreHelp).toMatch(/reporting label/i);
    expect(en.pages.departments.costCentreHelp).toMatch(/not a general-ledger account code/i);
  });

  it('invalidates both branch and linked-location queries after a successful edit', async () => {
    mocks.findByBusiness.mockResolvedValue([{
      id: 'branch-1',
      business_id: 'biz-1',
      name: 'Old Branch',
      code: 'OLD',
      location: null,
      is_active: true,
    }]);
    mocks.findLocations.mockResolvedValue([]);
    mocks.updateBranch.mockResolvedValue({ id: 'branch-1', name: 'New Branch', code: 'NEW' });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BranchesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Old Branch');
    fireEvent.click(screen.getByRole('button', { name: 'pages.branches.moreActions' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    fireEvent.change(screen.getByPlaceholderText('pages.branches.namePlaceholder'), {
      target: { value: 'New Branch' },
    });
    fireEvent.change(screen.getByPlaceholderText('pages.branches.codePlaceholder'), {
      target: { value: 'NEW' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(mocks.updateBranch).toHaveBeenCalledWith('branch-1', {
      name: 'New Branch',
      code: 'NEW',
      location: null,
    }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['branches', 'biz-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations', 'biz-1'] });
  });
});
