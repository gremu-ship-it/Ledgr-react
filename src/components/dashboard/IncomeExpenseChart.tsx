interface IncomeExpenseChartProps {
  data?: unknown[];
  isLoading?: boolean;
  isError?: boolean;
}

export function IncomeExpenseChart({
  data,
}: IncomeExpenseChartProps) {
  return (
    <div className="h-64 flex items-center justify-center">
      Chart placeholder ({data?.length ?? 0} points)
    </div>
  );
}