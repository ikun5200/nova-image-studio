'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  LayoutDashboard,
  ListChecks,
  LogOut,
  ScrollText,
  ServerCog,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/session-context';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { AdminUsers } from '@/components/admin/AdminUsers';
import { AdminProviders } from '@/components/admin/AdminProviders';
import { AdminTasks } from '@/components/admin/AdminTasks';
import { AdminUsage } from '@/components/admin/AdminUsage';
import { AdminSettings } from '@/components/admin/AdminSettings';
import { AdminAudit } from '@/components/admin/AdminAudit';

type SectionKey = 'overview' | 'users' | 'providers' | 'tasks' | 'usage' | 'settings' | 'audit';

const NAV_ITEMS: Array<{ key: SectionKey; label: string; icon: LucideIcon }> = [
  { key: 'overview', label: '总览', icon: LayoutDashboard },
  { key: 'users', label: '用户', icon: Users },
  { key: 'providers', label: '供应商与模型', icon: ServerCog },
  { key: 'tasks', label: '任务', icon: ListChecks },
  { key: 'usage', label: '用量', icon: BarChart3 },
  { key: 'settings', label: '站点设置', icon: Settings },
  { key: 'audit', label: '操作审计', icon: ScrollText },
];

export function AdminApp() {
  const { user, settings, logout } = useSession();
  const [section, setSection] = useState<SectionKey>('overview');

  const content = (() => {
    switch (section) {
      case 'users': return <AdminUsers />;
      case 'providers': return <AdminProviders />;
      case 'tasks': return <AdminTasks />;
      case 'usage': return <AdminUsage />;
      case 'settings': return <AdminSettings />;
      case 'audit': return <AdminAudit />;
      default: return <AdminDashboard onNavigate={key => setSection(key as SectionKey)} />;
    }
  })();

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-card">
              <Shield className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{settings.siteName}</p>
              <p className="text-[10px] text-muted-foreground">管理员后台</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="hidden h-5 text-[10px] sm:inline-flex">
              {user.displayName || user.username}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => { window.location.href = '/'; }}>
              <ArrowLeft className="size-3.5" />
              <span className="hidden sm:inline">返回工作台</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">退出</span>
            </Button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-3 pb-2 lg:hidden">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSection(item.key)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                section === item.key
                  ? 'bg-primary/10 font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60',
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-6">
        <aside className="hidden w-52 shrink-0 lg:block">
          <nav className="sticky top-20 space-y-1">
            {NAV_ITEMS.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors',
                  section === item.key
                    ? 'bg-primary/10 font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          {content}
        </main>
      </div>
    </div>
  );
}
