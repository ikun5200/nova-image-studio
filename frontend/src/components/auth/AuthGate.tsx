'use client';

/* eslint-disable react-hooks/set-state-in-effect -- 数据页在挂载时主动拉取并写入状态 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  fetchAuthStatus,
  fetchSession,
  logout as logoutRequest,
  type NovaUser,
  type PublicSettings,
} from '@/lib/auth-client';
import { fetchServerModels, hydrateServerModels, clearServerModels } from '@/lib/server-models';
import { SessionProvider } from '@/lib/session-context';
import { saveSessionSnapshot, clearSessionSnapshot } from '@/lib/session-store';

type GateState =
  | { status: 'loading' }
  | { status: 'ready'; user: NovaUser; settings: PublicSettings }
  | { status: 'error'; message: string };

/**
 * 登录门禁：未初始化跳 /setup，未登录跳 /login，已登录则把服务端模型目录
 * 落到本地并渲染工作台。所有子页面都在这个门禁后面。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'loading' });
  const [siteName, setSiteName] = useState('Nova Studio');

  const bootstrap = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const status = await fetchAuthStatus();
      setSiteName(status.siteName || 'Nova Studio');
      if (status.setupRequired) {
        clearSessionSnapshot();
        window.location.replace('/setup/');
        return;
      }
      const session = await fetchSession();
      if (!session) {
        clearSessionSnapshot();
        window.location.replace('/login/');
        return;
      }
      saveSessionSnapshot({ user: session.user, settings: session.settings });
      // 本地单用户模式（NOVA_AUTH_DISABLED=true）继续使用浏览器里的 BYOK 配置。
      if (session.settings.serverMode !== false) {
        try {
          const models = await fetchServerModels();
          hydrateServerModels(models);
        } catch (error) {
          console.warn('[auth] 读取服务端模型目录失败', error);
        }
      }
      setState({ status: 'ready', user: session.user, settings: session.settings });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '无法连接服务器',
      });
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearSessionSnapshot();
      clearServerModels();
      window.location.replace('/login/');
    }
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background text-foreground">
        <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">{siteName}</p>
          <p className="mt-1 text-xs text-muted-foreground">正在验证登录状态…</p>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="text-sm font-medium">无法连接服务器</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{state.message}</p>
          <Button className="mt-4" onClick={() => void bootstrap()}>
            <RefreshCw className="size-3.5" />
            重试
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SessionProvider
      value={{
        user: state.user,
        settings: state.settings,
        refresh: bootstrap,
        logout,
      }}
    >
      {children}
    </SessionProvider>
  );
}
