'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AuthError,
  fetchAuthStatus,
  fetchSession,
  login,
  registerUser,
  type AuthStatus,
} from '@/lib/auth-client';
import { fetchServerModels, hydrateServerModels } from '@/lib/server-models';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchAuthStatus();
        if (cancelled) return;
        if (next.setupRequired) {
          window.location.replace('/setup/');
          return;
        }
        setStatus(next);
        const session = await fetchSession();
        if (cancelled) return;
        if (session) {
          try {
            hydrateServerModels(await fetchServerModels());
          } catch { /* 目录读取失败不阻塞进入工作台 */ }
          window.location.replace('/');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '无法连接服务器');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'register') {
        await registerUser({ username, password, displayName });
      } else {
        await login(username, password);
      }
      try {
        hydrateServerModels(await fetchServerModels());
      } catch { /* 模型目录稍后由 AuthGate 再取一次 */ }
      window.location.replace('/');
    } catch (err) {
      if (err instanceof AuthError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '登录失败');
      }
      setSubmitting(false);
    }
  }, [displayName, mode, password, username]);

  const siteName = status?.siteName || 'Nova Studio';
  const canRegister = Boolean(status?.registrationEnabled);

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
      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
            <Sparkles className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{siteName}</p>
            <p className="text-xs text-muted-foreground">AI 视频 / 图像生成工作台</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-5">
            <h1 className="text-lg font-semibold tracking-tight">
              {mode === 'login' ? '登录' : '创建账号'}
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {mode === 'login'
                ? '使用管理员分配或自助注册的账号继续。'
                : '注册后即可使用管理员配置好的模型。'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'register' && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">昵称（可选）</span>
                <Input
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  placeholder="显示名称"
                  autoComplete="nickname"
                  className="h-9"
                />
              </label>
            )}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">用户名</span>
              <Input
                value={username}
                onChange={event => setUsername(event.target.value)}
                placeholder="3-32 位字母或数字"
                autoComplete="username"
                autoFocus
                required
                className="h-9"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">密码</span>
              <Input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder={mode === 'register' ? '至少 8 位' : '请输入密码'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                className="h-9"
              />
            </label>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="h-9 w-full" disabled={submitting || !status}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {submitting ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
              {!submitting && <ArrowRight className="size-3.5" />}
            </Button>
          </form>

          {canRegister && (
            <div className="mt-4 border-t border-border pt-3 text-center text-xs text-muted-foreground">
              {mode === 'login' ? (
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                >
                  没有账号？注册一个
                </button>
              ) : (
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                >
                  已有账号？返回登录
                </button>
              )}
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          账号与模型由部署管理员统一管理
        </p>
      </div>
    </div>
  );
}
