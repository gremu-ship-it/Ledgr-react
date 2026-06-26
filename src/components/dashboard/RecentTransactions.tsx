interface RecentTransactionsProps {
  entries?: unknown[];
  isLoading?: boolean;
  isError?: boolean;
}

export function RecentTransactions({
  entries,
}: RecentTransactionsProps) {
  return (
    <div>
      {entries?.length ?? 0} transactions
    </div>
  );
}