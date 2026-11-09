'use client';

/* eslint-disable react-hooks/set-state-in-effect -- 数据页在挂载时主动拉取并写入状态 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, HardDrive, Save, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchSettings,
  fetchSystem,
  saveSettings,
  type AdminSettings as SettingsPayload,
  type SystemInfo,
} from '@/lib/admin-client';
import type { UserQuota } from '@/lib/auth-client';
import { ErrorBanner, Field, LoadingBlock, SectionHeader, ToggleRow } from '@/components/admin/AdminUI';

const QUOTA_FIELDS: Array<{ key: keyof UserQuota; label: string; hint?: string }> = [
  { key: 'dailyImageTasks', label: '每日图片任务' },
  { key: 'dailyVideoTasks', label: '每日视频任务' },
  { key: 'dailyTextRequests', label: '每日文本请求' },
  { key: 'monthlyImageTasks', label: '每月图片任务' },
  { key: 'monthlyVideoTasks', label: '每月视频任务' },
  { key: 'monthlyTextRequests', label: '每月文本请求' },
  { key: 'maxPendingTasks', label: '待处理任务上限', hint: '至少 1' },
  { key: 'maxParallelCount', label: '单次并发上限', hint: '至少 1' },
];

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function AdminSettings() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextSettings, nextSystem] = await Promise.all([fetchSettings(), fetchSystem()]);
      setSettings(nextSettings);
      setSystem(nextSystem);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载设置失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const next = await saveSettings({
        siteName: settings.siteName,
        publicBaseUrl: settings.publicBaseUrl,
        registrationEnabled: settings.registrationEnabled,
        allowByok: settings.allowByok,
        allowUserModelOverride: settings.allowUserModelOverride,
        announcement: settings.announcement,
        sessionDays: settings.sessionDays,
        defaultUserQuota: settings.defaultUserQuota,
      });
      setSettings(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return error ? <ErrorBanner message={error} onRetry={() => void load()} /> : <LoadingBlock />;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="站点设置"
        description="控制注册、密钥模式、新用户默认配额与会话有效期。"
        actions={(
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saved ? <CheckCircle2 className="size-3.5" /> : <Save className="size-3.5" />}
            {saving ? '保存中…' : saved ? '已保存' : '保存设置'}
          </Button>
        )}
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="站点名称" hint="显示在登录页、侧栏与设置中。">
          <Input
            value={settings.siteName}
            onChange={event => setSettings(prev => prev ? { ...prev, siteName: event.target.value } : prev)}
            maxLength={80}
          />
        </Field>
        <Field label="登录会话有效期（天）" hint="修改后对新登录生效；现有会话到期后失效。">
          <Input
            type="number"
            min={1}
            max={365}
            value={settings.sessionDays}
            onChange={event => setSettings(prev => prev ? { ...prev, sessionDays: Math.max(1, Number(event.target.value) || 1) } : prev)}
          />
        </Field>
      </div>

      <Field
        label="公开访问地址"
        hint="视频插件的参考素材会用这个地址交给上游拉取。局域网可填 http://192.168.31.88:3030，外网填 https://你的域名。留空时回退到 NOVA_PUBLIC_BASE_URL，再回退到请求 Host。"
      >
        <div className="flex gap-2">
          <Input
            value={settings.publicBaseUrl || ''}
            onChange={event => setSettings(prev => prev ? { ...prev, publicBaseUrl: event.target.value } : prev)}
            placeholder="http://192.168.31.88:3030"
          />
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setSettings(prev => prev ? { ...prev, publicBaseUrl: window.location.origin } : prev)}
          >
            使用当前地址
          </Button>
        </div>
      </Field>

      <Field label="站点公告" hint="留空则不显示。公告会出现在工作台顶部。">
        <Textarea
          value={settings.announcement}
          onChange={event => setSettings(prev => prev ? { ...prev, announcement: event.target.value } : prev)}
          rows={3}
          maxLength={2000}
          placeholder="例如：本周六 02:00-04:00 维护，期间暂停新任务。"
        />
      </Field>

      <div className="space-y-2">
        <ToggleRow
          title="开放自助注册"
          description="关闭后只能由管理员在「用户管理」里创建账号。"
          checked={settings.registrationEnabled}
          onCheckedChange={checked => setSettings(prev => prev ? { ...prev, registrationEnabled: checked } : prev)}
        />
        <ToggleRow
          title="允许用户自带密钥（BYOK）"
          description="开启后，用户可在本地配置供应商与插件凭据，服务器仍优先使用管理员配置。关闭时所有请求必须走服务端模型。"
          checked={settings.allowByok}
          onCheckedChange={checked => setSettings(prev => prev ? { ...prev, allowByok: checked } : prev)}
        />
        <ToggleRow
          title="允许个人默认模型覆盖"
          description="关闭后所有用户统一使用管理员配置的默认模型。"
          checked={settings.allowUserModelOverride}
          onCheckedChange={checked => setSettings(prev => prev ? { ...prev, allowUserModelOverride: checked } : prev)}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">新用户默认配额</p>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          仅对之后创建或注册的普通用户生效。0 表示不限；管理员账号默认不限。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUOTA_FIELDS.map(field => (
            <Field key={field.key} label={field.label} hint={field.hint}>
              <Input
                type="number"
                min={0}
                value={settings.defaultUserQuota[field.key]}
                onChange={event => setSettings(prev => prev ? {
                  ...prev,
                  defaultUserQuota: {
                    ...prev.defaultUserQuota,
                    [field.key]: Math.max(0, Number(event.target.value) || 0),
                  },
                } : prev)}
              />
            </Field>
          ))}
        </div>
      </div>

      {system && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">系统信息</p>
          </div>
          <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
            <div className="flex justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
              <dt className="text-muted-foreground">版本</dt><dd className="font-mono">v{system.version}</dd>
            </div>
            <div className="flex justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
              <dt className="text-muted-foreground">Node</dt><dd className="font-mono">{system.nodeVersion}</dd>
            </div>
            <div className="flex justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
              <dt className="text-muted-foreground">数据库大小</dt><dd>{formatBytes(system.databaseBytes)}</dd>
            </div>
            <div className="flex justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
              <dt className="text-muted-foreground">主密钥来源</dt><dd>{system.secretKeyFromEnv ? 'NOVA_SECRET_KEY' : '数据目录文件'}</dd>
            </div>
            <div className="flex justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
              <dt className="text-muted-foreground">CDP</dt><dd>{system.cdpEnabled ? '已启用' : '未启用'}</dd>
            </div>
            <div className="flex justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
              <dt className="text-muted-foreground">数据目录</dt><dd className="truncate font-mono" title={system.dataDir}>{system.dataDir}</dd>
            </div>
          </dl>
          <p className="mt-3 break-all text-[10px] text-muted-foreground">
            数据库：<code className="font-mono">{system.databasePath}</code>
          </p>
        </div>
      )}
    </div>
  );
}
