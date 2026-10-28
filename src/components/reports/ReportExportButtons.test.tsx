// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReportExportButtons } from './ReportExportButtons';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe('ReportExportButtons', () => {
  it('calls the selected export action', () => {
    const onExportCSV = vi.fn();
    const onExportPDF = vi.fn();
    render(<ReportExportButtons onExportCSV={onExportCSV} onExportPDF={onExportPDF} />);

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportCSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportPDF' }));
    expect(onExportCSV).toHaveBeenCalledOnce();
    expect(onExportPDF).toHaveBeenCalledOnce();
  });

  it('disables both exports when the report is unavailable', () => {
    render(<ReportExportButtons onExportCSV={vi.fn()} onExportPDF={vi.fn()} disabled />);
    expect((screen.getByRole('button', { name: 'reports.shared.exportCSV' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'reports.shared.exportPDF' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
