'use client';

/* eslint-disable react-hooks/set-state-in-effect -- 数据页在挂载时主动拉取并写入状态 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Type } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { fetchUsage, type UsageSummary } from '@/lib/admin-client';
import { EmptyState, ErrorBanner, LoadingBlock, SectionHeader, StatCard } from '@/components/admin/AdminUI';

const KIND_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
  'image-edit': '图片编辑',
};

const KIND_COLORS: Record<string, string> = {
  image: 'bg-primary/80',
  video: 'bg-violet-500/80',
  text: 'bg-emerald-500/80',
  'image-edit': 'bg-amber-500/80',
};

function dayKeys(days: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - index));
    keys.push(date.toISOString().slice(0, 10));
  }
  return keys;
}

export function AdminUsage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchUsage(days));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用量失败');
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const chart = useMemo(() => {
    if (!data) return null;
    const keys = dayKeys(data.days);
    const map = new Map<string, Record<string, number>>();
    for (const key of keys) map.set(key, {});
    for (const row of data.byDay) {
      if (!map.has(row.day)) map.set(row.day, {});
      map.get(row.day)![row.kind] = row.count;
    }
    const rows = keys.map(key => {
      const kinds = map.get(key) || {};
      const total = Object.values(kinds).reduce((sum, value) => sum + value, 0);
      return { day: key, kinds, total };
    });
    const max = Math.max(1, ...rows.map(row => row.total));
    return { rows, max };
  }, [data]);

  const kinds = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.byKind).filter(kind => data.byKind[kind] > 0);
  }, [data]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="用量统计"
        description="按 UTC 自然日统计任务创建与文本请求。0 配额表示不限。"
        actions={(
          <Select
            value={String(days)}
            onValueChange={value => setDays(Number(value))}
            options={[
              { value: '7', label: '近 7 天' },
              { value: '30', label: '近 30 天' },
              { value: '90', label: '近 90 天' },
            ]}
            className="w-32"
            size="sm"
          />
        )}
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!data && !error && <LoadingBlock />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="总请求" value={data.total} hint={`近 ${data.days} 天`} icon={BarChart3} />
            <StatCard label="图片任务" value={data.byKind.image || 0} hint="含批量并发生成的每一条任务" />
            <StatCard label="视频任务" value={data.byKind.video || 0} hint="插件视频任务" />
            <StatCard label="文本请求" value={(data.byKind.text || 0) + (data.byKind['image-edit'] || 0)} hint="对话、反推、优化与图片编辑" icon={Type} />
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">每日趋势</p>
              <div className="flex flex-wrap items-center gap-3">
                {kinds.map(kind => (
                  <span key={kind} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className={`size-2 rounded-full ${KIND_COLORS[kind] || 'bg-muted-foreground'}`} />
                    {KIND_LABELS[kind] || kind}
                  </span>
                ))}
              </div>
            </div>

            {chart && chart.rows.every(row => row.total === 0) ? (
              <div className="mt-4">
                <EmptyState icon={BarChart3} title="还没有用量" description="用户开始生成后，这里会出现每日趋势。" />
              </div>
            ) : chart && (
              <div className="mt-4 flex h-44 items-end gap-1 overflow-x-auto pb-1">
                {chart.rows.map(row => (
                  <div key={row.day} className="group flex min-w-[6px] flex-1 flex-col items-center justify-end gap-1">
                    <div
                      className="flex w-full max-w-6 flex-col-reverse overflow-hidden rounded-t-sm"
                      style={{ height: `${Math.max(row.total > 0 ? 4 : 0, (row.total / chart.max) * 100)}%` }}
                      title={`${row.day} · ${row.total}`}
                    >
                      {kinds.map(kind => {
                        const count = row.kinds[kind] || 0;
                        if (!count) return null;
                        return (
                          <div
                            key={kind}
                            className={KIND_COLORS[kind] || 'bg-muted-foreground'}
                            style={{ height: `${(count / row.total) * 100}%` }}
                          />
                        );
                      })}
                    </div>
                    {chart.rows.length <= 31 && (
                      <span className="origin-bottom-left -rotate-45 whitespace-nowrap text-[9px] text-muted-foreground">
                        {row.day.slice(5)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">用户</th>
                  <th className="px-3 py-2 text-right font-medium">总计</th>
                  <th className="px-3 py-2 text-right font-medium">图片</th>
                  <th className="px-3 py-2 text-right font-medium">视频</th>
                  <th className="px-3 py-2 text-right font-medium">文本</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.byUser.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">暂无用量记录</td>
                  </tr>
                )}
                {data.byUser.map(user => (
                  <tr key={user.userId || user.username}>
                    <td className="px-3 py-2.5">
                      <p className="truncate">{user.displayName}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">@{user.username}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{user.count}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{user.imageCount}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{user.videoCount}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{user.textCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
