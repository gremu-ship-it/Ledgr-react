import React from 'react';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/Button';
import { useNavigate } from 'react-router';

interface OnboardingStep {
  id: number;
  label: string;
  description: string;
  path: string;
  completed: boolean;
}

interface OnboardingChecklistProps {
  className?: string;
  compact?: boolean; // mobile-friendly version
}

export function OnboardingChecklist({ className, compact = false }: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const [skipped, setSkipped] = React.useState(() => localStorage.getItem('onboardingSkipped') === 'true');

  // Simulated completion state — in real app this would come from backend / local flags
  // For now we derive from simple heuristics (you can wire to real data)
  const steps: OnboardingStep[] = React.useMemo(() => [
    {
      id: 1,
      label: "Add business information",
      description: "Tell us about your company",
      path: "/settings",
      completed: !!currentBusiness?.business?.name,
    },
    {
      id: 2,
      label: "Configure financial year",
      description: "Set chart of accounts & FY",
      path: "/settings?tab=periods",
      completed: false, // would check periods or COA
    },
    {
      id: 3,
      label: "Add first contact",
      description: "Create a customer or supplier",
      path: "/contacts",
      completed: false,
    },
    {
      id: 4,
      label: "Record first transaction",
      description: "Log income or expense",
      path: "/income",
      completed: false,
    },
    {
      id: 5,
      label: "Create first invoice",
      description: "Send an invoice to a customer",
      path: "/invoices",
      completed: false,
    },
    {
      id: 6,
      label: "Add products",
      description: "Enable inventory tracking",
      path: "/products",
      completed: false,
    },
  ], [currentBusiness]);

  const completedCount = steps.filter(s => s.completed).length;
  const progress = Math.round((completedCount / steps.length) * 100);

  if (completedCount === steps.length || skipped) {
    return null; // All done or skipped — hide checklist
  }

  return (
    <div className={`card ${className || ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="heading-3">Get started</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {completedCount} of {steps.length} steps completed
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-brand-600 tabular-nums">{progress}%</div>
          <div className="text-[10px] text-gray-400 -mt-1">complete</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-100 rounded-full mb-5 overflow-hidden">
        <div 
          className="h-2 bg-brand-500 transition-all rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="space-y-1">
        {steps.map((step) => (
          <button
            key={step.id}
            onClick={() => navigate(step.path)}
            className={`group w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-gray-50 active:bg-gray-100 ${
              step.completed ? 'opacity-60' : ''
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {step.completed ? (
                <CheckCircle2 className="h-5 w-5 text-brand-600" />
              ) : (
                <Circle className="h-5 w-5 text-gray-300 group-hover:text-brand-400" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm text-gray-900">{step.label}</div>
                  {!compact && (
                    <div className="text-xs text-gray-500 mt-0.5">{step.description}</div>
                  )}
                </div>
                {!step.completed && (
                  <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-brand-600 transition-colors ml-2" />
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 text-center">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => {
            localStorage.setItem('onboardingSkipped', 'true');
            setSkipped(true);
            navigate('/dashboard');
          }}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

// Mobile-friendly compact variant
export function MobileOnboardingChecklist() {
  return <OnboardingChecklist compact className="mx-4 mt-4" />;
}
