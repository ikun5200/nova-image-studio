'use client';

/* eslint-disable react-hooks/set-state-in-effect -- 数据页在挂载时主动拉取并写入状态 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, ListChecks, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { deleteTask, fetchTasks, type AdminTask } from '@/lib/admin-client';
import { EmptyState, ErrorBanner, LoadingBlock, SectionHeader } from '@/components/admin/AdminUI';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: '排队中', label: '排队中' },
  { value: 'processing', label: '生成中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
];

function statusBadge(status: string) {
  if (status === 'completed') return <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">完成</Badge>;
  if (status === 'failed') return <Badge variant="destructive">失败</Badge>;
  if (status === 'processing') return <Badge variant="secondary">生成中</Badge>;
  return <Badge variant="outline">排队中</Badge>;
}

export function AdminTasks() {
  const [items, setItems] = useState<AdminTask[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminTask | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchTasks({ status, limit: PAGE_SIZE, offset });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载任务失败');
    }
  }, [offset, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [status]);

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteTask(deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setDeleting(null);
    }
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <SectionHeader
        title="任务管理"
        description="查看全站任务、定位失败原因，或清理过期任务与产物。"
        actions={(
          <Select
            value={status}
            onValueChange={setStatus}
            options={STATUS_OPTIONS}
            className="w-36"
            size="sm"
          />
        )}
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!items && !error && <LoadingBlock />}
      {items && items.length === 0 && (
        <EmptyState icon={ListChecks} title="没有匹配的任务" description="调整筛选条件，或等待用户提交任务。" />
      )}

      {items && items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">任务</th>
                  <th className="px-3 py-2 font-medium">用户</th>
                  <th className="px-3 py-2 font-medium">模式</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">创建时间</th>
                  <th className="px-3 py-2 font-medium">备注</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map(task => (
                  <tr key={task.id}>
                    <td className="max-w-[180px] px-3 py-2.5">
                      <p className="truncate font-mono text-[10px]">{task.id}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="truncate">{task.displayName || task.username}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">@{task.username}</p>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{task.mode}</td>
                    <td className="px-3 py-2.5">{statusBadge(task.status)}</td>
                    <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{new Date(task.createdAt).toLocaleString()}</td>
                    <td className="max-w-[240px] px-3 py-2.5">
                      <p className="truncate text-[11px] text-muted-foreground" title={task.error || task.warning || ''}>
                        {task.error || task.warning || '—'}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {task.status === 'completed' && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => window.open(`/api/nova/images/${encodeURIComponent(task.id)}/0`, '_blank', 'noopener')}
                          >
                            <ExternalLink className="size-3" />
                            查看
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-xs" className="text-destructive" title="删除任务" onClick={() => setDeleting(task)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                <ChevronLeft className="size-3" />
                上一页
              </Button>
              <Button variant="outline" size="xs" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                下一页
                <ChevronRight className="size-3" />
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除任务</DialogTitle>
            <DialogDescription>
              删除任务会同时清理其生成的图片与插件素材，且不可恢复。确定删除 {deleting?.id} 吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
