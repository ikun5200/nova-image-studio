'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthError, fetchAuthStatus, setupAdmin } from '@/lib/auth-client';
import { fetchServerModels, hydrateServerModels } from '@/lib/server-models';

export default function SetupPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [siteName, setSiteName] = useState('Nova Studio');
  const [username, setUsername] = useState('admin');
  const [displayName, setDisplayName] = useState('管理员');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchAuthStatus();
        if (cancelled) return;
        setSiteName(status.siteName || 'Nova Studio');
        if (!status.setupRequired) {
          window.location.replace('/login/');
          return;
        }
        setAllowed(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '无法连接服务器');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      await setupAdmin({ username, password, displayName });
      try {
        hydrateServerModels(await fetchServerModels());
      } catch { /* ignore */ }
      window.location.replace('/');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : err instanceof Error ? err.message : '初始化失败');
      setSubmitting(false);
    }
  };

  if (allowed === null && !error) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(60rem 40rem at 15% -10%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 60%), radial-gradient(50rem 35rem at 110% 110%, color-mix(in oklab, var(--primary) 10%, transparent), transparent 55%)',
        }}
      />
      <div className="relative w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
            <ShieldCheck className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{siteName}</p>
            <p className="text-xs text-muted-foreground">首次部署初始化</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight">创建管理员账号</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            这是服务器的第一个账号，拥有用户、模型、配额与系统设置的全部权限。
            初始化完成后，请妥善保管密码。
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">管理员用户名</span>
              <Input
                value={username}
                onChange={event => setUsername(event.target.value)}
                autoComplete="username"
                required
                className="h-9"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">显示名称</span>
              <Input
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                className="h-9"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">密码</span>
              <Input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="至少 8 位"
                autoComplete="new-password"
                required
                className="h-9"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">确认密码</span>
              <Input
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
                className="h-9"
              />
            </label>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="h-9 w-full" disabled={submitting || !allowed}>
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              {submitting ? '初始化中…' : '完成初始化'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
