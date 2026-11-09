'use client';

/* eslint-disable react-hooks/set-state-in-effect -- 数据页在挂载时主动拉取并写入状态 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, KeyRound, Package, Pencil, RefreshCw, Trash2 } from 'lucide-react';
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
import {
  deletePluginCredential,
  fetchPlugins,
  savePluginCredential,
  type AdminPluginSnapshot,
} from '@/lib/admin-client';
import { EmptyState, ErrorBanner, Field, LoadingBlock, SectionHeader } from '@/components/admin/AdminUI';

export function AdminPlugins() {
  const [data, setData] = useState<AdminPluginSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async (reload = false) => {
    setError(null);
    if (reload) setRefreshing(true);
    try {
      if (reload) {
        await fetch('/api/nova/plugins?reload=1', { cache: 'no-store' });
      }
      setData(await fetchPlugins());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载插件失败');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (pluginId: string) => {
    const credential = data?.credentials[pluginId];
    setEditing(pluginId);
    setApiKey('');
    setBaseUrl(credential?.baseUrl || '');
    setFormError(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!apiKey.trim() && !data?.credentials[editing]?.configured) {
      setFormError('首次配置需要填写 API Key');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await savePluginCredential(editing, {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        baseUrl: baseUrl.trim(),
      });
      setEditing(null);
      await load();
      setNotice('插件凭据已保存');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deletePluginCredential(deleting);
      setDeleting(null);
      await load();
      setNotice('插件凭据已删除');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setDeleting(null);
    }
  };

  if (!data) {
    return error ? <ErrorBanner message={error} onRetry={() => void load()} /> : <LoadingBlock />;
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="视频插件"
        description="插件本体由服务器目录安装；这里管理所有用户共享的上游凭据。"
        actions={(
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            重新扫描目录
          </Button>
        )}
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-400">
          <span>{notice}</span>
          <button type="button" className="text-[11px] underline-offset-4 hover:underline" onClick={() => setNotice(null)}>关闭</button>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
        <FolderOpen className="mt-0.5 size-3.5 shrink-0" />
        <span className="break-all">插件目录：<code className="font-mono">{data.pluginsDir}</code></span>
      </div>

      {data.plugins.length === 0 && data.failures.length === 0 && (
        <EmptyState
          icon={Package}
          title="还没有安装插件"
          description="把插件目录放进上面的路径后点击「重新扫描目录」。"
        />
      )}

      <div className="space-y-3">
        {data.plugins.map(plugin => {
          const credential = data.credentials[plugin.id];
          return (
            <div key={plugin.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{plugin.name}</p>
                    <span className="font-mono text-[11px] text-muted-foreground">v{plugin.version}</span>
                    <Badge variant={credential?.configured ? 'secondary' : 'outline'} className="h-5 text-[10px]">
                      {credential?.configured ? '凭据已配置' : '未配置凭据'}
                    </Badge>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{plugin.id}</span>
                    {credential?.baseUrl && <span className="break-all">{credential.baseUrl}</span>}
                  </p>
                  {credential?.configured && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <KeyRound className="size-3" />
                      {credential.apiKeyMasked}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => openEdit(plugin.id)}>
                    <Pencil className="size-3.5" />
                    {credential?.configured ? '修改凭据' : '配置凭据'}
                  </Button>
                  {credential?.configured && (
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(plugin.id)}>
                      <Trash2 className="size-3.5" />
                      删除
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {data.failures.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4" />
            加载失败的插件（{data.failures.length}）
          </p>
          <div className="mt-2 space-y-1.5">
            {data.failures.map(failure => (
              <div key={failure.id} className="rounded-lg border border-destructive/20 bg-background/60 px-3 py-2">
                <p className="font-mono text-[11px]">{failure.id}</p>
                <p className="mt-0.5 break-all text-[11px] text-destructive">{failure.error}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>插件凭据 · {editing}</DialogTitle>
            <DialogDescription>
              保存后所有用户共享该凭据；密钥加密落库，不会下发到浏览器。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field
              label="API Key"
              hint={data.credentials[editing || '']?.configured
                ? `当前：${data.credentials[editing || ''].apiKeyMasked}。留空表示不修改。`
                : undefined}
            >
              <Input
                type="password"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
                autoComplete="off"
                placeholder="插件上游的 API Key"
              />
            </Field>
            <Field label="API 基地址" hint="留空则使用插件 manifest 里申报的默认地址。">
              <Input
                value={baseUrl}
                onChange={event => setBaseUrl(event.target.value)}
                placeholder="https://..."
              />
            </Field>
            {formError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{formError}</p>}
          </div>
          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除插件凭据</DialogTitle>
            <DialogDescription>删除后，用户提交该插件的任务会失败，直到重新配置凭据。</DialogDescription>
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
