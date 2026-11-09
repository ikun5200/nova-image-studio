'use client';

/* eslint-disable react-hooks/set-state-in-effect -- 数据页在挂载时主动拉取并写入状态 */

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  HardDrive,
  ListChecks,
  Server,
  Users,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchOverview, type Overview } from '@/lib/admin-client';
import { EmptyState, ErrorBanner, LoadingBlock, SectionHeader, StatCard } from '@/components/admin/AdminUI';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusBadge(status: string) {
  if (status === 'completed') return <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">完成</Badge>;
  if (status === 'failed') return <Badge variant="destructive">失败</Badge>;
  if (status === 'processing') return <Badge variant="secondary">生成中</Badge>;
  return <Badge variant="outline">排队中</Badge>;
}

export function AdminDashboard({ onNavigate }: { onNavigate: (section: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!data) return <LoadingBlock />;

  const queue = data.queue;
  const failureRate = data.tasks.today > 0
    ? Math.round((data.tasks.todayFailed / data.tasks.today) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="总览"
        description="服务器运行状态、今日任务与最近活动。"
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={() => onNavigate('users')}>管理用户</Button>
            <Button size="sm" onClick={() => onNavigate('providers')}>配置模型</Button>
          </>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="用户"
          value={data.users.total}
          hint={`${data.users.active} 个启用 · ${data.users.admins} 个管理员`}
          icon={Users}
        />
        <StatCard
          label="今日任务"
          value={data.tasks.today}
          hint={`完成 ${data.tasks.todayCompleted} · 失败 ${data.tasks.todayFailed}`}
          icon={ListChecks}
        />
        <StatCard
          label="队列"
          value={queue ? queue.pendingCount : 0}
          hint={queue ? `生成中 ${queue.processingCount} · 排队 ${queue.queuedCount}` : '队列状态不可用'}
          icon={Activity}
          tone={queue && !queue.acceptingNewTasks ? 'warning' : 'default'}
        />
        <StatCard
          label="今日失败率"
          value={`${failureRate}%`}
          hint={`近 7 天任务 ${data.tasks.week}`}
          icon={failureRate > 20 ? XCircle : CheckCircle2}
          tone={failureRate > 20 ? 'danger' : 'success'}
        />
      </div>

      {queue && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Cpu className="size-4 text-muted-foreground" />
              队列与并发
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>服务并发上限 {queue.configuredConcurrency}</span>
              {queue.acceptingNewTasks
                ? <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">接受新任务</Badge>
                : <Badge variant="destructive">已暂停接收</Badge>}
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${Math.min(100, queue.maxQueueSize > 0 ? (queue.pendingCount / queue.maxQueueSize) * 100 : 0)}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>待处理 {queue.pendingCount}</span>
            <span>队列上限 {queue.maxQueueSize}</span>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-medium">最近任务</p>
            <Button variant="ghost" size="xs" onClick={() => onNavigate('tasks')}>查看全部</Button>
          </div>
          {data.recentTasks.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={ListChecks} title="还没有任务" description="用户提交生成任务后会出现在这里。" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.recentTasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{task.username}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">{task.id}</p>
                  </div>
                  <div className="hidden text-right text-[11px] text-muted-foreground sm:block">
                    <p>{task.mode}</p>
                    <p>{new Date(task.createdAt).toLocaleString()}</p>
                  </div>
                  {statusBadge(task.status)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium">近 7 天活跃用户</p>
            <div className="mt-3 space-y-2">
              {data.topUsers.length === 0 && <p className="text-xs text-muted-foreground">暂无用量记录</p>}
              {data.topUsers.map(user => {
                const max = data.topUsers[0]?.count || 1;
                return (
                  <div key={user.userId || user.username} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="truncate">{user.displayName || user.username}</span>
                      <span className="tabular-nums text-muted-foreground">{user.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${(user.count / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Server className="size-4 text-muted-foreground" />
              系统
            </div>
            <dl className="mt-3 space-y-2 text-[11px]">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">版本</dt><dd className="font-mono">v{data.system.version}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">运行时长</dt><dd>{formatUptime(data.system.uptimeSeconds)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Node</dt><dd className="font-mono">{data.system.nodeVersion}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">数据库</dt><dd>{formatBytes(data.system.databaseBytes)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">插件</dt><dd>{data.plugins.installed} 个{data.plugins.failures > 0 ? ` · ${data.plugins.failures} 个失败` : ''}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">密钥主密码</dt><dd>{data.system.secretKeyFromEnv ? '环境变量' : '数据目录文件'}</dd></div>
            </dl>
            <p className="mt-3 flex items-start gap-1.5 break-all text-[10px] text-muted-foreground">
              <HardDrive className="mt-0.5 size-3 shrink-0" />
              {data.system.databasePath}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Clock className="size-3" />
        数据按 UTC 自然日统计
      </div>
    </div>
  );
}
