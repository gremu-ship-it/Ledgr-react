// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

function RecoverableSection({ shouldFail }: { shouldFail: boolean }) {
  if (shouldFail) throw new Error('Temporary payroll query failure');
  return <div>Payroll recovered</div>;
}

function BoundaryHarness() {
  const [shouldFail, setShouldFail] = useState(true);
  return (
    <>
      <button onClick={() => setShouldFail(false)}>Resolve failure</button>
      <SectionErrorBoundary sectionName="Payroll" fallbackHeight="360px">
        <RecoverableSection shouldFail={shouldFail} />
      </SectionErrorBoundary>
    </>
  );
}

describe('SectionErrorBoundary', () => {
  it('shows a retry action and recovers the section when retried', () => {
    render(<BoundaryHarness />);

    expect(screen.getByText('Payroll failed to load')).toBeTruthy();
    expect(screen.getByText('Temporary payroll query failure')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve failure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.getByText('Payroll recovered')).toBeTruthy();
  });
});
