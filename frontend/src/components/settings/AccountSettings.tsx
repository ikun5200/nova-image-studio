'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogOut, Shield, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  changePassword,
  fetchMyUsage,
  type MyUsage,
} from '@/lib/auth-client';
import { useOptionalSession } from '@/lib/session-context';

function usageLine(label: string, used: number, limit: number): string {
  if (limit <= 0) return `${label}：${used}（不限）`;
  return `${label}：${used} / ${limit}`;
}

export function AccountSettings() {
  const session = useOptionalSession();
  const [usage, setUsage] = useState<MyUsage | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchMyUsage();
        if (!cancelled) setUsage(next);
      } catch {
        /* 用量读取失败不阻塞账号页 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChangePassword = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setMessage('密码已修改，请使用新密码重新登录');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      window.setTimeout(() => {
        session?.logout();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改密码失败');
    } finally {
      setSubmitting(false);
    }
  }, [confirmPassword, currentPassword, newPassword, session]);

  if (!session) {
    return <p className="text-sm text-muted-foreground">未获取到登录信息</p>;
  }

  const { user, settings, logout } = session;
  const quota = usage?.quota || user.quota;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-muted">
            <UserRound className="size-5 text-muted-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{user.displayName || user.username}</p>
              <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="h-5 px-1.5 text-[10px]">
                {user.role === 'admin' ? '管理员' : '用户'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">@{user.username} · {settings.siteName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user.role === 'admin' && (
            <Button variant="outline" size="sm" onClick={() => { window.location.href = '/admin/'; }}>
              <Shield className="size-3.5" />
              管理员后台
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut className="size-3.5" />
            退出登录
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border p-4">
        <p className="text-sm font-medium">今日与本月用量</p>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <p>{usageLine('图片任务（今日）', usage?.today.image || 0, quota.dailyImageTasks)}</p>
          <p>{usageLine('图片任务（本月）', usage?.month.image || 0, quota.monthlyImageTasks)}</p>
          <p>{usageLine('视频任务（今日）', usage?.today.video || 0, quota.dailyVideoTasks)}</p>
          <p>{usageLine('视频任务（本月）', usage?.month.video || 0, quota.monthlyVideoTasks)}</p>
          <p>{usageLine('文本请求（今日）', usage?.today.text || 0, quota.dailyTextRequests)}</p>
          <p>{usageLine('文本请求（本月）', usage?.month.text || 0, quota.monthlyTextRequests)}</p>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          同时最多 {quota.maxPendingTasks} 个待处理任务，单次最多并发生成 {quota.maxParallelCount} 张。额度由管理员配置。
        </p>
      </div>

      <form onSubmit={handleChangePassword} className="rounded-xl border border-border p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">修改密码</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">当前密码</span>
            <Input
              type="password"
              value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">新密码</span>
            <Input
              type="password"
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">确认新密码</span>
            <Input
              type="password"
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
        </div>
        {error && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        {message && <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
        <Button type="submit" size="sm" className="mt-3" disabled={submitting}>
          {submitting ? '提交中…' : '更新密码'}
        </Button>
        <p className="mt-2 text-[11px] text-muted-foreground">修改后所有设备上的登录会话会失效。</p>
      </form>
    </div>
  );
}
