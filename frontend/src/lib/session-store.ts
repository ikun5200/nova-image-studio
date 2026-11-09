'use client';

/**
 * 会话快照。
 *
 * Next.js 静态导出会把客户端模块拆到多个 chunk；在极少数情况下同一个
 * context 模块可能被重复打包，导致 Provider 与 Consumer 拿到不同的 context
 * 对象。会话信息同时写入 localStorage，作为 context 缺失时的可靠兜底。
 */

import type { NovaUser, PublicSettings } from '@/lib/auth-client';

const SESSION_SNAPSHOT_KEY = 'nova-session-snapshot';

export interface SessionSnapshot {
  user: NovaUser;
  settings: PublicSettings;
}

export function saveSessionSnapshot(snapshot: SessionSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    /* 隐私模式忽略 */
  }
}

export function readSessionSnapshot(): SessionSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed?.user?.id || !parsed.user.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSessionSnapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}
