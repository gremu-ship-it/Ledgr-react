import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const workspace = readFileSync('src/pages/construction/ConstructionWorkspacePage.tsx', 'utf8');

describe('construction certificate and retention register routes', () => {
  it('registers the new pages behind Enterprise, PROJECT_BASED, and Construction gates', () => {
    for (const [path, page] of [
      ['/construction/certificates', '<PaymentCertificatesPage />'],
      ['/construction/retention-register', '<RetentionRegisterPage />'],
      ['/construction/rfis', '<RfiListPage />'],
      ['/construction/rfis/new', '<RfiNewPage />'],
      ['/construction/rfis/:id', '<RfiDetailPage />'],
    ]) {
      const route = app.split(`path="${path}"`)[1]?.split('</Route>')[0] ?? '';
      expect(route).toContain('PlanGate minPlan="enterprise"');
      expect(route).toContain("OperatingModelGate requiredOperatingModels={['PROJECT_BASED']}");
      expect(route).toContain('<CapabilityGate capability="construction">');
      expect(route).toContain(page);
    }
  });

  it('preserves the existing retention aging route and its workspace rendering', () => {
    expect(app).toContain('path="/construction/*"');
    expect(workspace).toContain("{ path: '/construction/retention', label: 'construction.reports.retentionAging.tabTitle' }");
    expect(workspace).toContain('<RetentionAgingReport key={businessId} businessId={businessId} capabilities={capabilities} />');
    expect(app).not.toContain('path="/construction/retention"');
  });
});
