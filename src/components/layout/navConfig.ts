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
  BarChart2,
  Sparkles,
} from 'lucide-react';

export const NAV_SECTIONS = [
  {
    label: 'AI',
    items: [
      {
        label: 'Ledgr AI',
        path: '/chat',
        icon: Sparkles,
      },
    ],
  },
  {
    label: 'Overview',
    items: [
      {
        label: 'Dashboard',
        path: '/dashboard',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        label: 'Income',
        path: '/income',
        icon: DollarSign,
      },
      {
        label: 'Expenses',
        path: '/expenses',
        icon: Receipt,
      },
      {
        label: 'Invoices',
        path: '/invoices',
        icon: FileText,
      },
      {
        label: 'Payroll',
        path: '/payroll',
        icon: Users,
      },
    ],
  },
  {
    label: 'Inventory',
    items: [
      {
        label: 'Products',
        path: '/products',
        icon: Package,
      },
    ],
  },
  {
    label: 'Accounting',
    items: [
      {
        label: 'Accounts',
        path: '/accounts',
        icon: BookOpen,
      },
      {
        label: 'Tax',
        path: '/tax',
        icon: Percent,
      },
      {
        label: 'Assets',
        path: '/assets',
        icon: Landmark,
      },
      {
        label: 'Reports',
        path: '/reports',
        icon: BarChart2,
      },
    ],
  },
  {
    label: 'Contacts',
    items: [
      {
        label: 'Contacts',
        path: '/contacts',
        icon: BookUser,
      },
    ],
  },
];