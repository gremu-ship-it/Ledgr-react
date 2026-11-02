import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { ChangeOrderForm, type ChangeOrderFormValues } from './ChangeOrderForm';

export function ChangeOrderNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);

  const createMutation = useMutation({
    mutationFn: (values: ChangeOrderFormValues) => repos.changeOrder.create(businessId as string, values),
    onSuccess: (changeOrder) => navigate(`/construction/change-orders/${changeOrder.id}`),
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <Link to="/construction/change-orders" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('changeOrders.backToList')}
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t('changeOrders.newTitle')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('changeOrders.newDescription')}</p>
      </header>
      <ChangeOrderForm
        submitLabel={t('changeOrders.create')}
        isSubmitting={createMutation.isPending}
        errorMessage={createMutation.isError ? t('changeOrders.errors.create') : undefined}
        onSubmit={(values) => createMutation.mutate(values)}
      />
    </main>
  );
}
