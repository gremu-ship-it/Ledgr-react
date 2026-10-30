import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');

describe('Manufacturing MRP route', () => {
  it('registers the new route behind both Enterprise and manufacturing capability gates', () => {
    const route = app.split('path="/manufacturing/mrp"')[1]?.split('</Route>')[0] ?? '';
    expect(route).toContain('PlanGate minPlan="enterprise"');
    expect(route).toContain('<CapabilityGate capability="manufacturing">');
    expect(route).toContain('<MrpWorkbenchPage />');
  });

  it('preserves the existing manufacturing route URLs', () => {
    for (const path of [
      '/manufacturing', '/manufacturing/bom', '/manufacturing/bom/new',
      '/manufacturing/bom/:id', '/manufacturing/production',
      '/manufacturing/production/new', '/manufacturing/production/:id',
      '/manufacturing/runs', '/manufacturing/routings', '/manufacturing/work-centres',
    ]) {
      expect(app).toContain(`path="${path}"`);
    }
  });
});
