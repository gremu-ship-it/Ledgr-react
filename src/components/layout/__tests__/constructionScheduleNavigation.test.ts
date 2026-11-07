import { describe, expect, it } from 'vitest';
import { visibleSectionsFor } from '../navConfig';

function visibleConstructionItems(operatingModels: string[], constructionEnabled = true) {
  return visibleSectionsFor(
    () => true,
    undefined,
    (capability) => capability === 'construction' && constructionEnabled,
    'enterprise',
    operatingModels,
  ).find((section) => section.labelKey === 'nav.construction.title')?.items ?? [];
}

describe('construction schedule navigation', () => {
  it('shows the enterprise construction schedule after Toolbox Talks', () => {
    const items = visibleConstructionItems(['PROJECT_BASED']);
    const toolboxIndex = items.findIndex((item) => item.labelKey === 'nav.construction.toolboxTalks');
    const scheduleIndex = items.findIndex((item) => item.labelKey === 'nav.construction.schedule');

    expect(scheduleIndex).toBeGreaterThan(toolboxIndex);
    expect(items[scheduleIndex]).toMatchObject({
      path: '/construction/schedule',
      minPlan: 'enterprise',
      requiredOperatingModels: ['CONSTRUCTION', 'PROJECT_BASED'],
    });
  });

  it('shows scheduling for CONSTRUCTION and PROJECT_BASED businesses but hides it without capability', () => {
    expect(visibleConstructionItems(['CONSTRUCTION']).some((item) => item.path === '/construction/schedule')).toBe(true);
    expect(visibleConstructionItems(['RETAIL']).some((item) => item.path === '/construction/schedule')).toBe(false);
    expect(visibleConstructionItems(['PROJECT_BASED'], false).some((item) => item.path === '/construction/schedule')).toBe(false);
  });
});
