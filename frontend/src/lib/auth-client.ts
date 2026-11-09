'use client';

/** 会话、登录与账号管理的前端客户端。所有请求都带 Cookie（同源默认）。 */

export type UserRole = 'admin' | 'user';

export interface UserQuota {
  dailyImageTasks: number;
  dailyVideoTasks: number;
  dailyTextRequests: number;
  monthlyImageTasks: number;
  monthlyVideoTasks: number;
  monthlyTextRequests: number;
  maxPendingTasks: number;
  maxParallelCount: number;
}

export interface NovaUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'disabled';
  quota: UserQuota;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
}

export interface PublicSettings {
  siteName: string;
  registrationEnabled: boolean;
  allowByok: boolean;
  allowUserModelOverride: boolean;
  announcement: string;
  setupRequired: boolean;
  /** false = 本地单用户模式（NOVA_AUTH_DISABLED=true），继续使用浏览器本地模型配置。 */
  serverMode?: boolean;
}

export type AuthStatus = PublicSettings;

export interface SessionPayload {
  user: NovaUser;
  settings: PublicSettings;
}

export class AuthError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const record = (data && typeof data === 'object') ? data as { error?: string; code?: string } : {};
    throw new AuthError(record.error || `请求失败 (${response.status})`, response.status, record.code);
  }
  return data as T;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return request<AuthStatus>('/api/nova/auth/status');
}

export async function fetchSession(): Promise<SessionPayload | null> {
  try {
    return await request<SessionPayload>('/api/nova/auth/me');
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) return null;
    throw error;
  }
}

export async function login(username: string, password: string): Promise<SessionPayload> {
  return request<SessionPayload>('/api/nova/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(): Promise<void> {
  await request('/api/nova/auth/logout', { method: 'POST', body: '{}' });
}

export async function setupAdmin(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<SessionPayload> {
  return request<SessionPayload>('/api/nova/auth/setup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function registerUser(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<SessionPayload> {
  return request<SessionPayload>('/api/nova/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request('/api/nova/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/** 个人用量与配额。 */
export interface MyUsage {
  quota: UserQuota;
  today: Record<string, number>;
  month: Record<string, number>;
}

export async function fetchMyUsage(): Promise<MyUsage> {
  return request<MyUsage>('/api/nova/me/usage');
}
