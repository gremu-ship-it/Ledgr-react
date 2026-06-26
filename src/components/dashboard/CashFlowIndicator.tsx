interface CashFlowIndicatorProps {
  income?: number;
  expenses?: number;
  isLoading?: boolean;
  isError?: boolean;
}

export function CashFlowIndicator({
  income,
  expenses,
}: CashFlowIndicatorProps) {
  const profitable = (income ?? 0) > (expenses ?? 0);

  return (
    <div className="rounded-xl border p-4">
      {profitable ? 'Profitable' : 'Loss Making'}
    </div>
  );
}