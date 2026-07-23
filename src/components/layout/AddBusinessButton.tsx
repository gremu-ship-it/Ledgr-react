import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * A compact button to add another business.
 * Drop this inside your BusinessSwitcher dropdown, below the business list.
 *
 * Usage:
 *   import { AddBusinessButton } from '@/components/layout/AddBusinessButton';
 *   <AddBusinessButton />
 */
export function AddBusinessButton({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();

  function handleClick() {
    onClose?.();
    navigate('/create-business');
  }

  return (
    <button
      onClick={handleClick}
      className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-left text-sm font-medium text-muted transition-colors hover:border-brand-300 hover:bg-brand-500/10 hover:text-brand-600 dark:text-brand-300"
    >
      <Plus className="h-4 w-4" />
      Add business
    </button>
  );
}
