// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { QuickActions } from '@/components/dashboard/QuickActions';

function CurrentPath() {
  const { pathname } = useLocation();
  return <span data-testid="current-path">{pathname}</span>;
}

describe('dashboard quick actions', () => {
  it('opens the employee list from Payroll', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <QuickActions />
        <CurrentPath />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Payroll' }));

    expect(screen.getByTestId('current-path').textContent).toBe('/payroll/employees');
  });
});
