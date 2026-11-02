import { describe, expect, it } from 'vitest';
import { visibleSectionsFor } from '../navConfig';

function visibleConstructionItems(operatingModels: string[], constructionEnabled = true) {
  return visibleSectionsFor(
    () => true,
    undefined,
    (capability) => capability === 'construction' && constructionEnabled,
    'enterprise',
    operatingModels,
  ).find((section) => section.labelKey === 'navigation.sections.construction')?.items ?? [];
}

describe('construction schedule navigation', () => {
  it('shows the enterprise project-based schedule after Toolbox Talks', () => {
    const items = visibleConstructionItems(['PROJECT_BASED']);
    const toolboxIndex = items.findIndex((item) => item.labelKey === 'navigation.items.toolboxTalks');
    const scheduleIndex = items.findIndex((item) => item.labelKey === 'scheduling.title');

    expect(scheduleIndex).toBeGreaterThan(toolboxIndex);
    expect(items[scheduleIndex]).toMatchObject({
      path: '/construction/schedule',
      minPlan: 'enterprise',
      requiredOperatingModels: ['PROJECT_BASED'],
    });
  });

  it('hides scheduling outside PROJECT_BASED construction businesses', () => {
    expect(visibleConstructionItems(['RETAIL']).some((item) => item.path === '/construction/schedule')).toBe(false);
    expect(visibleConstructionItems(['PROJECT_BASED'], false).some((item) => item.path === '/construction/schedule')).toBe(false);
  });
});
