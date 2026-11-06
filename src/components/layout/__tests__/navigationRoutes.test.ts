import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS } from '../navConfig';

const sourceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const appSource = readFileSync(path.join(sourceRoot, 'App.tsx'), 'utf8');
const headerSource = readFileSync(path.join(sourceRoot, 'components/layout/Header.tsx'), 'utf8');

function routePatterns(): RegExp[] {
  return [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map(([, route]) => {
    const normalized = route.replace(/\*/g, '.*').replace(/:[^/]+/g, '[^/]+');
    return new RegExp(`^${normalized}/?$`);
  });
}

describe('navigation route contracts', () => {
  it('points every desktop sidebar item at a declared application route', () => {
    const paths = NAV_SECTIONS.flatMap((section) => section.items.map(({ path: itemPath }) => itemPath));
    const routes = routePatterns();
    const unresolved = paths.filter((itemPath) => {
      const pathname = itemPath.split('?')[0];
      return !routes.some((route) => route.test(pathname));
    });
    expect(unresolved).toEqual([]);
  });

  it('redirects legacy /payroll and /chat URLs to their canonical surfaces', () => {
    expect(appSource).toMatch(/<Route path="\/payroll" element=\{\s*<PartnerPlanGate[\s\S]*?<Navigate to="\/payroll\/employees" replace \/>[\s\S]*?<\/PartnerPlanGate>/);
    expect(appSource).toMatch(/<Route path="\/chat" element=\{<Navigate to="\/ai" replace \/>\} \/>/);
  });

  it('keeps the Settings entry in the account menu and out of duplicate sidebar routes', () => {
    const paths = NAV_SECTIONS.flatMap((section) => section.items.map(({ path: itemPath }) => itemPath));
    expect(paths).not.toContain('/settings');
    expect(paths.filter((itemPath) => itemPath === '/settings/exchange-rates')).toHaveLength(1);
    expect(headerSource).toContain("navigate('/settings');");
    expect(headerSource).toContain("navigate('/settings?tab=profile');");
  });
});
