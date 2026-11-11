import type { PartnerClientUsage } from '@/types/partners';

type StatusFilter = 'all' | PartnerClientUsage['status'];

export function filterPartnerClients(
  clients: PartnerClientUsage[],
  search: string,
  status: StatusFilter,
  plan: string,
): PartnerClientUsage[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return clients.filter((client) => {
    const matchesSearch = !normalizedSearch
      || client.business_name.toLocaleLowerCase().includes(normalizedSearch)
      || client.business_id.toLocaleLowerCase().includes(normalizedSearch);
    const matchesStatus = status === 'all' || client.status === status;
    const matchesPlan = plan === 'all' || (client.plan_tier ?? 'free').toLowerCase() === plan;
    return matchesSearch && matchesStatus && matchesPlan;
  });
}
