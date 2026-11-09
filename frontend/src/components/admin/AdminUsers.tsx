'use client';

/* eslint-disable react-hooks/set-state-in-effect -- 数据页在挂载时主动拉取并写入状态 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, UserRound, Users } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  createUser,
  deleteUser,
  fetchUsers,
  updateUser,
  type AdminUser,
  type CreateUserInput,
} from '@/lib/admin-client';
import type { UserQuota } from '@/lib/auth-client';
import { EmptyState, ErrorBanner, Field, LoadingBlock, SectionHeader } from '@/components/admin/AdminUI';

const QUOTA_FIELDS: Array<{ key: keyof UserQuota; label: string }> = [
  { key: 'dailyImageTasks', label: '每日图片任务' },
  { key: 'dailyVideoTasks', label: '每日视频任务' },
  { key: 'dailyTextRequests', label: '每日文本请求' },
  { key: 'monthlyImageTasks', label: '每月图片任务' },
  { key: 'monthlyVideoTasks', label: '每月视频任务' },
  { key: 'monthlyTextRequests', label: '每月文本请求' },
  { key: 'maxPendingTasks', label: '待处理任务上限' },
  { key: 'maxParallelCount', label: '单次并发上限' },
];

interface FormState {
  username: string;
  displayName: string;
  password: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  quota: UserQuota;
}

const EMPTY_QUOTA: UserQuota = {
  dailyImageTasks: 50,
  dailyVideoTasks: 20,
  dailyTextRequests: 300,
  monthlyImageTasks: 1000,
  monthlyVideoTasks: 300,
  monthlyTextRequests: 6000,
  maxPendingTasks: 3,
  maxParallelCount: 4,
};

function emptyForm(): FormState {
  return {
    username: '',
    displayName: '',
    password: '',
    role: 'user',
    status: 'active',
    quota: { ...EMPTY_QUOTA },
  };
}

function quotaSummary(quota: UserQuota): string {
  if (quota.dailyImageTasks === 0 && quota.monthlyImageTasks === 0) return '不限';
  return `图片 ${quota.dailyImageTasks || '∞'}/日 · ${quota.monthlyImageTasks || '∞'}/月`;
}

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  const load = useCallback(async (keyword = '') => {
    setError(null);
    try {
      setUsers(await fetchUsers(keyword));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用户失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (user: AdminUser) => {
    setEditing(user);
    setForm({
      username: user.username,
      displayName: user.displayName,
      password: '',
      role: user.role,
      status: user.status,
      quota: { ...user.quota },
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setFormError(null);
    if (!editing && !form.username.trim()) {
      setFormError('请输入用户名');
      return;
    }
    if (!editing && form.password.length < 8) {
      setFormError('新用户密码至少 8 位');
      return;
    }
    if (editing && form.password && form.password.length < 8) {
      setFormError('新密码至少 8 位');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateUser(editing.id, {
          displayName: form.displayName,
          role: form.role,
          status: form.status,
          quota: form.quota,
          ...(form.password ? { password: form.password } : {}),
        });
      } else {
        const payload: CreateUserInput = {
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName,
          role: form.role,
          status: form.status,
          quota: form.quota,
        };
        await createUser(payload);
      }
      setDialogOpen(false);
      await load(search.trim());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (user: AdminUser) => {
    try {
      await updateUser(user.id, { status: user.status === 'active' ? 'disabled' : 'active' });
      await load(search.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteUser(deleting.id);
      setDeleting(null);
      await load(search.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setDeleting(null);
    }
  };

  const roleOptions = useMemo(() => [
    { value: 'user', label: '普通用户' },
    { value: 'admin', label: '管理员' },
  ], []);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="用户管理"
        description="创建账号、分配角色与配额、停用或重置密码。管理员默认不受配额限制。"
        actions={<Button size="sm" onClick={openCreate}><Plus className="size-3.5" />新建用户</Button>}
      />

      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="搜索用户名或昵称"
          className="h-8 pl-8"
        />
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load(search.trim())} />}
      {!users && !error && <LoadingBlock />}
      {users && users.length === 0 && (
        <EmptyState icon={Users} title="没有匹配的用户" description="换个关键词，或新建一个账号。" action={<Button size="sm" onClick={openCreate}>新建用户</Button>} />
      )}

      {users && users.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-muted/40 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">用户</th>
                <th className="px-3 py-2 font-medium">角色</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">配额</th>
                <th className="px-3 py-2 font-medium">最后登录</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map(user => (
                <tr key={user.id} className="bg-card">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex size-7 items-center justify-center rounded-full bg-muted">
                        <UserRound className="size-3.5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{user.displayName || user.username}</p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">@{user.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="h-5 text-[10px]">
                      {user.role === 'admin' ? '管理员' : '用户'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={user.status === 'active' ? 'secondary' : 'outline'} className="h-5 text-[10px]">
                      {user.status === 'active' ? '启用' : '停用'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{quotaSummary(user.quota)}</td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '从未登录'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon-xs" title="编辑" onClick={() => openEdit(user)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => void handleToggleStatus(user)}>
                        {user.status === 'active' ? '停用' : '启用'}
                      </Button>
                      <Button variant="ghost" size="icon-xs" title="删除" className="text-destructive" onClick={() => setDeleting(user)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `编辑用户 · ${editing.username}` : '新建用户'}</DialogTitle>
            <DialogDescription>
              配额填 0 表示不限。普通用户默认使用站点设置里的新用户配额。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="用户名">
                <Input
                  value={form.username}
                  onChange={event => setForm(prev => ({ ...prev, username: event.target.value }))}
                  disabled={Boolean(editing)}
                  placeholder="3-32 位字母或数字"
                />
              </Field>
              <Field label="显示名称">
                <Input
                  value={form.displayName}
                  onChange={event => setForm(prev => ({ ...prev, displayName: event.target.value }))}
                  placeholder="可选"
                />
              </Field>
              <Field label={editing ? '重置密码（留空不改）' : '密码'} hint={editing ? undefined : '至少 8 位'}>
                <Input
                  type="password"
                  value={form.password}
                  onChange={event => setForm(prev => ({ ...prev, password: event.target.value }))}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="角色">
                <Select
                  value={form.role}
                  onValueChange={value => setForm(prev => ({ ...prev, role: value as 'admin' | 'user' }))}
                  options={roleOptions}
                />
              </Field>
            </div>

            <div className="rounded-xl border border-border p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">配额</p>
                <Select
                  value={form.status}
                  onValueChange={value => setForm(prev => ({ ...prev, status: value as 'active' | 'disabled' }))}
                  options={[
                    { value: 'active', label: '启用' },
                    { value: 'disabled', label: '停用' },
                  ]}
                  className="w-24"
                  size="sm"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {QUOTA_FIELDS.map(field => (
                  <Field key={field.key} label={field.label}>
                    <Input
                      type="number"
                      min={0}
                      value={form.quota[field.key]}
                      onChange={event => setForm(prev => ({
                        ...prev,
                        quota: {
                          ...prev.quota,
                          [field.key]: Math.max(0, Number(event.target.value) || 0),
                        },
                      }))}
                    />
                  </Field>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">0 = 不限；待处理与单次并发上限至少为 1。</p>
            </div>

            {formError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {formError}
              </div>
            )}
          </div>

          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除用户</DialogTitle>
            <DialogDescription>
              确定删除 {deleting?.displayName || deleting?.username} 吗？该用户的登录会话会立即失效，
              历史任务会保留但不再归属任何账号。
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
