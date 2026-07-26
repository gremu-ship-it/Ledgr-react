import {
  LayoutDashboard,
  DollarSign,
  Receipt,
  FileText,
  Users,
  BookUser,
  Package,
  BookOpen,
  Percent,
  Landmark,
  Coins,
  BarChart2,
  Sparkles,
  Warehouse,
  ArrowLeftRight,
  GitBranch,
  Lock,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export interface NavItemConfig {
  labelKey: string;
  path: string;
  icon: LucideIcon;
}

export interface NavSectionConfig {
  labelKey: string;
  items: NavItemConfig[];
}

export const NAV_SECTIONS: NavSectionConfig[] = [
  {
    labelKey: 'navigation.sections.ai',
    items: [
      { labelKey: 'navigation.items.ledgrAi', path: '/chat', icon: Sparkles },
    ],
  },
  {
    labelKey: 'navigation.sections.overview',
    items: [
      { labelKey: 'navigation.items.dashboard', path: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    labelKey: 'navigation.sections.finance',
    items: [
      { labelKey: 'navigation.items.income', path: '/income', icon: DollarSign },
      { labelKey: 'navigation.items.expenses', path: '/expenses', icon: Receipt },
      { labelKey: 'navigation.items.invoices', path: '/invoices', icon: FileText },
      { labelKey: 'navigation.items.payroll', path: '/payroll', icon: Users },
    ],
  },
  {
    labelKey: 'navigation.sections.inventory',
    items: [
      { labelKey: 'navigation.items.products', path: '/products', icon: Package },
      { labelKey: 'navigation.items.warehouse', path: '/warehouse', icon: Warehouse },
      { labelKey: 'navigation.items.transfers', path: '/transfers', icon: ArrowLeftRight },
    ],
  },
  {
    labelKey: 'navigation.sections.accounting',
    items: [
      { labelKey: 'navigation.items.accounts', path: '/accounts', icon: BookOpen },
      { labelKey: 'navigation.items.tax', path: '/tax', icon: Percent },
      { labelKey: 'navigation.items.assets', path: '/assets', icon: Landmark },
      { labelKey: 'navigation.items.capital', path: '/capital', icon: Coins },
      { labelKey: 'navigation.items.reports', path: '/reports', icon: BarChart2 },
      { labelKey: 'navigation.items.journals', path: '/journals', icon: ScrollText },
      { labelKey: 'navigation.items.bankReconciliation', path: '/bank-reconcile', icon: Landmark },
      { labelKey: 'navigation.items.periods', path: '/periods', icon: Lock },
      { labelKey: 'navigation.items.auditLog', path: '/audit', icon: ShieldCheck },
    ],
  },
  {
    labelKey: 'navigation.sections.organisation',
    items: [
      { labelKey: 'navigation.items.contacts', path: '/contacts', icon: BookUser },
      { labelKey: 'navigation.items.branches', path: '/branches', icon: GitBranch },
    ],
  },
];
