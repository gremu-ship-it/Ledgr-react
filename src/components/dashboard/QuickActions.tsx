import { useNavigate } from 'react-router-dom';
import { Plus, DollarSign, Receipt, Users } from 'lucide-react';

export function QuickActions() {
  const navigate = useNavigate();

  const actions = [
    {
      label: 'New Invoice',
      icon: Plus,
      onClick: () => navigate('/income?action=invoice'),
    },
    {
      label: 'Record Income',
      icon: DollarSign,
      onClick: () => navigate('/income?action=record'),
    },
    {
      label: 'Record Expense',
      icon: Receipt,
      onClick: () => navigate('/expenses?action=record'),
    },
    {
      label: 'Run Payroll',
      icon: Users,
      onClick: () => navigate('/payroll?action=run'),
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            onClick={action.onClick}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:text-brand-700"
          >
            <Icon className="h-4 w-4 text-brand-500" />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
