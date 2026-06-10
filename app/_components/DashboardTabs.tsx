// =============================================================================
// DashboardTabs — nav de 3 tabs del dashboard, compartido
// =============================================================================

import Link from 'next/link';

export type TabKey = 'marketing' | 'comercial' | 'revenue' | 'general';

// Orden 8A: Vista General primero — es el panel de salud, lo demás es detalle.
const TABS: Array<{ key: TabKey; label: string; href: string }> = [
  { key: 'general', label: 'Vista General', href: '/general' },
  { key: 'marketing', label: 'Marketing', href: '/' },
  { key: 'comercial', label: 'Comercial', href: '/comercial' },
  { key: 'revenue', label: 'Revenue', href: '/revenue' },
];

export function DashboardTabs({ active }: { active: TabKey }) {
  return (
    <nav
      className="flex items-center gap-1 mb-8 border-b"
      style={{ borderColor: 'var(--card-border)' }}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`px-4 py-3 text-lg font-medium transition-colors ${isActive ? '-mb-px border-b-2' : ''}`}
            style={{
              borderColor: isActive ? 'var(--accent-yellow)' : 'transparent',
              color: isActive ? 'var(--accent-yellow)' : 'var(--text-dim)',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
