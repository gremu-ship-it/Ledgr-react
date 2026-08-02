import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { 
  Search, Star, Clock, Lock, ArrowRight, 
  TrendingUp, Users, FileText, Package, Calendar, 
  CreditCard, BarChart3, Settings 
} from 'lucide-react';
import { useUsage } from '@/hooks/useUsage';
import { Button } from '@/components/ui/Button';
import { clsx } from 'clsx';

interface Tool {
  id: string;
  label: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- icon component accepts no props; any is conventional here
  icon: React.ComponentType<any>;
  path: string;
  category: 'daily' | 'accounting' | 'advanced';
  requiresPlan?: 'growth' | 'pro';
  isPinned?: boolean;
  lastUsed?: string;
}

const ALL_TOOLS: Tool[] = [
  // Daily tools
  { id: 'dashboard', label: 'Dashboard', description: 'Overview of your business', icon: BarChart3, path: '/dashboard', category: 'daily' },
  { id: 'income', label: 'Income', description: 'Record sales and revenue', icon: TrendingUp, path: '/income', category: 'daily' },
  { id: 'expenses', label: 'Expenses', description: 'Track business spending', icon: CreditCard, path: '/expenses', category: 'daily' },
  { id: 'invoices', label: 'Invoices', description: 'Create and send invoices', icon: FileText, path: '/invoices', category: 'daily' },
  { id: 'contacts', label: 'Contacts', description: 'Manage customers & suppliers', icon: Users, path: '/contacts', category: 'daily' },

  // Accounting tools
  { id: 'accounts', label: 'Chart of Accounts', description: 'Manage your account structure', icon: Settings, path: '/accounts', category: 'accounting' },
  { id: 'journals', label: 'Journal Entries', description: 'Manual accounting entries', icon: FileText, path: '/journals', category: 'accounting' },
  { id: 'reports', label: 'Reports', description: 'Financial reports & insights', icon: BarChart3, path: '/reports', category: 'accounting' },
  { id: 'periods', label: 'Financial Periods', description: 'Manage accounting periods', icon: Calendar, path: '/periods', category: 'accounting' },

  // Advanced / Growth tools
  { id: 'inventory', label: 'Inventory', description: 'Stock & product management', icon: Package, path: '/inventory', category: 'advanced', requiresPlan: 'growth' },
  { id: 'payroll', label: 'Payroll', description: 'Employee salary management', icon: Users, path: '/payroll', category: 'advanced', requiresPlan: 'growth' },
  { id: 'assets', label: 'Fixed Assets', description: 'Track company assets', icon: Package, path: '/assets', category: 'advanced', requiresPlan: 'growth' },
  { id: 'bank', label: 'Bank Reconciliation', description: 'Reconcile bank statements', icon: CreditCard, path: '/bank-reconcile', category: 'advanced', requiresPlan: 'pro' },
];

export default function ToolsPage() {
  const navigate = useNavigate();
  const { planTier } = useUsage();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'daily' | 'accounting' | 'advanced'>('all');

  const filteredTools = React.useMemo(() => {
    let tools = [...ALL_TOOLS];

    // Filter by plan access
    tools = tools.filter(tool => {
      if (!tool.requiresPlan) return true;
      if (tool.requiresPlan === 'growth' && ['free'].includes(planTier)) return false;
      if (tool.requiresPlan === 'pro' && !['pro'].includes(planTier)) return false;
      return true;
    });

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      tools = tools.filter(t =>
        t.label.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    }

    // Category filter
    if (activeTab !== 'all') {
      tools = tools.filter(t => t.category === activeTab);
    }

    return tools;
  }, [searchQuery, activeTab, planTier]);

  // Pinned / favourite tools (user preference)
  const pinnedTools = filteredTools.filter(t => t.isPinned);
  const recentTools = filteredTools.slice(0, 3); // mock recent

  const isLocked = (tool: Tool) => {
    if (!tool.requiresPlan) return false;
    return tool.requiresPlan === 'growth' && planTier === 'free' ||
           tool.requiresPlan === 'pro' && planTier !== 'pro';
  };

  const handleToolClick = (tool: Tool) => {
    if (isLocked(tool)) {
      navigate('/settings?tab=billing');
      return;
    }
    navigate(tool.path);
  };

  return (
    <div className="min-h-screen bg-app-bg pb-20 lg:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200 px-4 py-4 lg:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="heading-2">Tools</h1>
              <p className="text-sm text-gray-500">Discover everything Ledgr can do</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              Back
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tools..."
              className="w-full bg-white border border-gray-200 rounded-2xl pl-11 pr-4 py-3 text-sm placeholder:text-gray-400 focus:outline-none focus:border-brand-300"
            />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 lg:px-6 pt-6 space-y-8">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl w-fit">
          {(['all', 'daily', 'accounting', 'advanced'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'px-4 py-1.5 rounded-xl text-sm font-medium transition-colors capitalize',
                activeTab === tab 
                  ? 'bg-white shadow-sm text-brand-700' 
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Pinned / Favourites */}
        {pinnedTools.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Star className="h-4 w-4 text-amber-500" />
              <h3 className="font-semibold text-sm text-gray-700">Pinned tools</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {pinnedTools.map(tool => (
                <ToolCard key={tool.id} tool={tool} onClick={() => handleToolClick(tool)} isLocked={isLocked(tool)} />
              ))}
            </div>
          </section>
        )}

        {/* Recently used */}
        {recentTools.length > 0 && !searchQuery && (
          <section>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Clock className="h-4 w-4 text-gray-400" />
              <h3 className="font-semibold text-sm text-gray-700">Recently used</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {recentTools.map(tool => (
                <ToolCard key={tool.id} tool={tool} onClick={() => handleToolClick(tool)} isLocked={isLocked(tool)} />
              ))}
            </div>
          </section>
        )}

        {/* All Tools / Filtered */}
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="font-semibold text-sm text-gray-700">
              {activeTab === 'all' ? 'All tools' : `${activeTab} tools`}
            </h3>
            <span className="text-xs text-gray-400">{filteredTools.length} results</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredTools.length > 0 ? (
              filteredTools.map(tool => (
                <ToolCard 
                  key={tool.id} 
                  tool={tool} 
                  onClick={() => handleToolClick(tool)} 
                  isLocked={isLocked(tool)} 
                  showCategory 
                />
              ))
            ) : (
              <div className="col-span-full py-12 text-center text-gray-500">
                No tools match your search.
              </div>
            )}
          </div>
        </section>

        {/* Plan upgrade banner */}
        {planTier === 'free' && (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm">
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800">Unlock more tools on Growth</p>
                <p className="text-amber-700 mt-1">Inventory, Payroll, Bank Reconciliation and more are available on paid plans.</p>
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className="mt-3"
                  onClick={() => navigate('/settings?tab=billing')}
                >
                  View plans
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCard({ 
  tool, 
  onClick, 
  isLocked, 
  showCategory = false 
}: { 
  tool: Tool; 
  onClick: () => void; 
  isLocked: boolean; 
  showCategory?: boolean;
}) {
  const Icon = tool.icon;

  return (
    <button
      onClick={onClick}
      className={clsx(
        "group flex items-start gap-4 rounded-2xl border p-4 text-left transition-all active:scale-[0.985]",
        isLocked 
          ? "border-gray-200 bg-gray-50 opacity-75" 
          : "border-gray-200 hover:border-brand-300 hover:bg-brand-50/30"
      )}
    >
      <div className={clsx(
        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
        isLocked ? "bg-gray-200" : "bg-brand-100 text-brand-600"
      )}>
        <Icon className="h-4.5 w-4.5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-gray-900">{tool.label}</div>
          {isLocked && <Lock className="h-3.5 w-3.5 text-gray-400" />}
          {!isLocked && <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-brand-600 transition-colors" />}
        </div>
        
        <p className="text-xs text-gray-500 mt-0.5 pr-6 line-clamp-2">{tool.description}</p>

        {showCategory && (
          <div className="mt-2">
            <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              {tool.category}
            </span>
            {tool.requiresPlan && (
              <span className="ml-1.5 text-[10px] text-amber-600 font-medium">
                {tool.requiresPlan.toUpperCase()}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
