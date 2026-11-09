'use client';

/* eslint-disable react-hooks/set-state-in-effect -- 数据页在挂载时主动拉取并写入状态 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchAudit, type AuditItem } from '@/lib/admin-client';
import { EmptyState, ErrorBanner, LoadingBlock, SectionHeader } from '@/components/admin/AdminUI';

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  'setup.admin': '初始化管理员',
  'auth.register': '用户注册',
  'auth.change_password': '修改密码',
  'user.create': '创建用户',
  'user.update': '更新用户',
  'user.delete': '删除用户',
  'provider.create': '创建供应商',
  'provider.update': '更新供应商',
  'provider.delete': '删除供应商',
  'model.create': '创建模型',
  'model.update': '更新模型',
  'model.delete': '删除模型',
  'defaults.update': '更新默认模型',
  'settings.update': '更新站点设置',
  'task.delete': '删除任务',
  'plugin.credential.update': '更新插件凭据',
  'plugin.credential.delete': '删除插件凭据',
};

export function AdminAudit() {
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await fetchAudit(PAGE_SIZE, offset));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审计日志失败');
    }
  }, [offset]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="操作审计"
        description="记录管理员对用户、模型、设置与任务的关键操作。"
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!items && !error && <LoadingBlock />}
      {items && items.length === 0 && (
        <EmptyState icon={ScrollText} title="暂无审计记录" description="管理员执行操作后会出现在这里。" />
      )}

      {items && items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">操作者</th>
                  <th className="px-3 py-2 font-medium">动作</th>
                  <th className="px-3 py-2 font-medium">对象</th>
                  <th className="px-3 py-2 font-medium">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map(item => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5">{item.actorName || '系统'}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        {ACTION_LABELS[item.action] || item.action}
                      </span>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 font-mono text-[10px] text-muted-foreground" title={item.target}>
                      {item.target || '—'}
                    </td>
                    <td className="max-w-[260px] px-3 py-2.5">
                      {item.detail ? (
                        <details>
                          <summary className="cursor-pointer text-[10px] text-muted-foreground">查看</summary>
                          <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
                            {JSON.stringify(item.detail, null, 2)}
                          </pre>
                        </details>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                <ChevronLeft className="size-3" />
                上一页
              </Button>
              <Button variant="outline" size="xs" disabled={items.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>
                下一页
                <ChevronRight className="size-3" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
