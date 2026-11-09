'use client';

/* eslint-disable react-hooks/set-state-in-effect -- 数据页在挂载时主动拉取并写入状态 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  ImageIcon,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ServerCog,
  Trash2,
  Type,
} from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import {
  createModel,
  createProvider,
  deleteModel,
  deleteProvider,
  fetchModels,
  fetchProviders,
  saveDefaults,
  testProvider,
  updateModel,
  updateProvider,
  type ModelInput,
  type ModelRecord,
  type ProviderInput,
  type ProviderRecord,
} from '@/lib/admin-client';
import type { DefaultModels } from '@/lib/nova-models';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorBanner, Field, LoadingBlock, SectionHeader } from '@/components/admin/AdminUI';

const PROVIDER_KINDS = [
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'anthropic-messages', label: 'Claude Messages' },
  { value: 'grok', label: 'Grok / xAI' },
  { value: 'doubao', label: '豆包 Seedream' },
  { value: 'alibaba-dashscope', label: '阿里百炼' },
];

const IMAGE_PROTOCOLS = [
  { value: 'openai', label: 'OpenAI Images' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'grok', label: 'Grok' },
  { value: 'doubao', label: '豆包' },
  { value: 'alibaba-dashscope', label: '阿里百炼' },
];

const TEXT_PROTOCOLS = [
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'openai-chat-completions', label: 'OpenAI Chat Completions' },
  { value: 'anthropic-messages', label: 'Claude Messages' },
  { value: 'google-gemini', label: 'Google Gemini' },
];

const OUTPUT_SIZES = [
  { value: '512', label: '512' },
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

const PRESETS = [
  { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image' },
  { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image' },
  { value: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite Image' },
  { value: 'antigravity-gemini-image', label: 'Antigravity Gemini Image' },
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'gpt-image-2.6', label: 'GPT Image 2.6' },
  { value: 'gpt-image-2.6-pro', label: 'GPT Image 2.6 Pro' },
  { value: 'grok-imagine-image', label: 'Grok Imagine' },
  { value: 'grok-imagine-image-quality', label: 'Grok Imagine Quality' },
  { value: 'grok-imagine-image-edit', label: 'Grok Imagine Edit' },
  { value: 'doubao-seedream', label: '豆包 Seedream' },
  { value: 'alibaba-qwen-image', label: '阿里 Qwen Image' },
  { value: 'alibaba-wan-image', label: '阿里 Wan Image' },
];

const TASK_DEFAULT_FIELDS: Array<{ key: keyof DefaultModels; label: string; kind: 'image' | 'text' | 'slice' }> = [
  { key: 'textToImage', label: '文生图', kind: 'image' },
  { key: 'imageToImage', label: '图生图', kind: 'image' },
  { key: 'reversePrompt', label: '反推提示词', kind: 'text' },
  { key: 'agent', label: 'Agent', kind: 'text' },
  { key: 'promptOptimize', label: '提示词优化', kind: 'text' },
  { key: 'layoutSpec', label: '构图模式', kind: 'text' },
  { key: 'imageDescribe', label: '图片描述', kind: 'text' },
  { key: 'sliceDecomposition', label: 'AI 拆图', kind: 'text' },
  { key: 'sliceReconstruct', label: '网页复刻', kind: 'text' },
  { key: 'sliceImageEdit', label: '切图图片编辑', kind: 'slice' },
];

interface ProviderForm {
  name: string;
  kind: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
}

interface ModelForm {
  name: string;
  upstreamId: string;
  useType: 'image' | 'text';
  protocol: string;
  enabled: boolean;
  maxRefImages: number;
  maxOutputSize: string;
  supportsAdvancedParams: boolean;
  builtinPreset: string;
  note: string;
}

function emptyProviderForm(): ProviderForm {
  return { name: '', kind: 'openai-compatible', baseUrl: '', apiKey: '', enabled: true };
}

function emptyModelForm(providerKind: string): ModelForm {
  return {
    name: '',
    upstreamId: '',
    useType: 'image',
    protocol: inferProtocol(providerKind, 'image'),
    enabled: true,
    maxRefImages: 14,
    maxOutputSize: '4K',
    supportsAdvancedParams: providerKind === 'openai-compatible',
    builtinPreset: inferPreset(providerKind, ''),
    note: '',
  };
}

function inferProtocol(kind: string, useType: 'image' | 'text'): string {
  if (useType === 'image') {
    if (kind === 'google') return 'google';
    if (kind === 'grok') return 'grok';
    if (kind === 'doubao') return 'doubao';
    if (kind === 'alibaba-dashscope') return 'alibaba-dashscope';
    return 'openai';
  }
  if (kind === 'google') return 'google-gemini';
  if (kind === 'anthropic-messages') return 'anthropic-messages';
  return 'openai-chat-completions';
}

function inferPreset(kind: string, upstreamId: string): string {
  const id = upstreamId.toLowerCase();
  if (kind === 'grok') return id.includes('quality') ? 'grok-imagine-image-quality' : id.includes('edit') ? 'grok-imagine-image-edit' : 'grok-imagine-image';
  if (kind === 'doubao') return 'doubao-seedream';
  if (kind === 'alibaba-dashscope') return id.includes('wan2') ? 'alibaba-wan-image' : 'alibaba-qwen-image';
  if (kind === 'google' || (id.includes('gemini') && id.includes('image'))) {
    if (id.includes('lite')) return 'gemini-3.1-flash-lite-image';
    if (id.includes('3.1') && id.includes('flash')) return 'gemini-3.1-flash-image-preview';
    if (id.includes('pro')) return 'gemini-3-pro-image-preview';
    if (id.includes('2.5')) return 'gemini-2.5-flash-image';
    return kind === 'google' ? 'gemini-3-pro-image-preview' : 'antigravity-gemini-image';
  }
  return 'gpt-image-2';
}

function providerKindLabel(kind: string): string {
  return PROVIDER_KINDS.find(option => option.value === kind)?.label || kind;
}

function modelProtocolLabel(model: ModelRecord): string {
  const list = model.useType === 'image' ? IMAGE_PROTOCOLS : TEXT_PROTOCOLS;
  return list.find(option => option.value === model.protocol)?.label || model.protocol;
}

export function AdminProviders() {
  const [providers, setProviders] = useState<ProviderRecord[] | null>(null);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [defaults, setDefaults] = useState<DefaultModels | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderRecord | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm);
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<ProviderRecord | null>(null);

  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelRecord | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm>(() => emptyModelForm('openai-compatible'));
  const [savingModel, setSavingModel] = useState(false);
  const [modelFormError, setModelFormError] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<ModelRecord | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    providerId: string;
    models: Array<{ id: string; name: string }>;
    selected: Record<string, boolean>;
    useType: 'image' | 'text';
  } | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextProviders, nextModels] = await Promise.all([fetchProviders(), fetchModels()]);
      setProviders(nextProviders);
      setModels(nextModels.models);
      setDefaults(nextModels.defaults);
      setSelectedProviderId(current => (
        nextProviders.some(provider => provider.id === current) ? current : (nextProviders[0]?.id || '')
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载供应商失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedProvider = providers?.find(provider => provider.id === selectedProviderId) || null;
  const providerModels = useMemo(
    () => models.filter(model => model.providerId === selectedProviderId),
    [models, selectedProviderId],
  );
  const imageModels = models.filter(model => model.useType === 'image' && model.enabled);
  const textModels = models.filter(model => model.useType === 'text' && model.enabled);
  const sliceModels = imageModels.filter(model => model.protocol === 'openai');

  const openCreateProvider = () => {
    setEditingProvider(null);
    setProviderForm(emptyProviderForm());
    setProviderFormError(null);
    setProviderDialogOpen(true);
  };

  const openEditProvider = (provider: ProviderRecord) => {
    setEditingProvider(provider);
    setProviderForm({
      name: provider.name,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      apiKey: '',
      enabled: provider.enabled,
    });
    setProviderFormError(null);
    setProviderDialogOpen(true);
  };

  const handleSaveProvider = async () => {
    setProviderFormError(null);
    if (!providerForm.name.trim() || !providerForm.baseUrl.trim()) {
      setProviderFormError('名称与 Base URL 不能为空');
      return;
    }
    if (!editingProvider && !providerForm.apiKey.trim()) {
      setProviderFormError('新建供应商需要填写 API Key');
      return;
    }
    setSavingProvider(true);
    try {
      const payload: ProviderInput = {
        name: providerForm.name.trim(),
        kind: providerForm.kind,
        baseUrl: providerForm.baseUrl.trim(),
        enabled: providerForm.enabled,
      };
      if (providerForm.apiKey.trim()) payload.apiKey = providerForm.apiKey.trim();
      if (editingProvider) {
        await updateProvider(editingProvider.id, payload);
      } else {
        const created = await createProvider(payload);
        setSelectedProviderId(created.id);
      }
      setProviderDialogOpen(false);
      await load();
      setNotice('供应商已保存');
    } catch (err) {
      setProviderFormError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingProvider(false);
    }
  };

  const handleDeleteProvider = async () => {
    if (!deletingProvider) return;
    try {
      await deleteProvider(deletingProvider.id);
      setDeletingProvider(null);
      await load();
      setNotice('供应商及其模型已删除');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setDeletingProvider(null);
    }
  };

  const handleTestProvider = async (provider: ProviderRecord) => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await testProvider(provider.id);
      const selected: Record<string, boolean> = {};
      for (const model of result.models) selected[model.id] = false;
      setTestResult({
        providerId: provider.id,
        models: result.models,
        selected,
        useType: provider.kind === 'google' || provider.kind === 'anthropic-messages' ? 'text' : 'image',
      });
      setNotice(`上游返回 ${result.count} 个模型`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接测试失败');
    } finally {
      setTesting(false);
    }
  };

  const handleImportSelected = async () => {
    if (!testResult) return;
    const provider = providers?.find(item => item.id === testResult.providerId);
    if (!provider) return;
    const chosen = testResult.models.filter(model => testResult.selected[model.id]);
    if (chosen.length === 0) {
      setError('请先勾选要导入的模型');
      return;
    }
    setImporting(true);
    setError(null);
    const failures: string[] = [];
    for (const item of chosen) {
      try {
        await createModel({
          providerId: provider.id,
          name: item.name || item.id,
          upstreamId: item.id,
          useType: testResult.useType,
          protocol: inferProtocol(provider.kind, testResult.useType),
          // 交给后端按协议推断能力默认值，避免把 OpenAI 的 14 张参考图套到 Grok 等模型上。
          capabilities: {},
        });
      } catch (err) {
        failures.push(`${item.id}: ${err instanceof Error ? err.message : '失败'}`);
      }
    }
    setImporting(false);
    await load();
    setTestResult(null);
    setNotice(failures.length === 0
      ? `已导入 ${chosen.length} 个模型`
      : `导入完成，${failures.length} 个失败：${failures.slice(0, 3).join('；')}`);
  };

  const openCreateModel = () => {
    if (!selectedProvider) return;
    setEditingModel(null);
    setModelForm(emptyModelForm(selectedProvider.kind));
    setModelFormError(null);
    setModelDialogOpen(true);
  };

  const openEditModel = (model: ModelRecord) => {
    setEditingModel(model);
    const capabilities = model.capabilities || {};
    setModelForm({
      name: model.name,
      upstreamId: model.upstreamId,
      useType: model.useType,
      protocol: model.protocol,
      enabled: model.enabled,
      maxRefImages: Number(capabilities.maxRefImages ?? 14),
      maxOutputSize: String(capabilities.maxOutputSize ?? '4K'),
      supportsAdvancedParams: Boolean(capabilities.supportsAdvancedParams),
      builtinPreset: String(capabilities.builtinPreset ?? inferPreset(selectedProvider?.kind || 'openai-compatible', model.upstreamId)),
      note: String(capabilities.note ?? ''),
    });
    setModelFormError(null);
    setModelDialogOpen(true);
  };

  const handleSaveModel = async () => {
    if (!selectedProvider) return;
    setModelFormError(null);
    if (!modelForm.name.trim() || !modelForm.upstreamId.trim()) {
      setModelFormError('模型名称与上游 ID 不能为空');
      return;
    }
    setSavingModel(true);
    try {
      const capabilities = modelForm.useType === 'image'
        ? {
          maxRefImages: modelForm.maxRefImages,
          maxOutputSize: modelForm.maxOutputSize,
          supportsAdvancedParams: modelForm.supportsAdvancedParams,
          builtinPreset: modelForm.builtinPreset,
        }
        : { note: modelForm.note };
      const payload: ModelInput = {
        providerId: selectedProvider.id,
        name: modelForm.name.trim(),
        upstreamId: modelForm.upstreamId.trim(),
        useType: modelForm.useType,
        protocol: modelForm.protocol,
        capabilities,
        enabled: modelForm.enabled,
      };
      if (editingModel) {
        await updateModel(editingModel.id, payload);
      } else {
        await createModel(payload);
      }
      setModelDialogOpen(false);
      await load();
      setNotice('模型已保存');
    } catch (err) {
      setModelFormError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingModel(false);
    }
  };

  const handleDeleteModel = async () => {
    if (!deletingModel) return;
    try {
      await deleteModel(deletingModel.id);
      setDeletingModel(null);
      await load();
      setNotice('模型已删除');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setDeletingModel(null);
    }
  };

  const handleSaveDefaults = async () => {
    if (!defaults) return;
    try {
      const next = await saveDefaults(defaults);
      setDefaults(next);
      setNotice('默认模型已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存默认模型失败');
    }
  };

  const modelOptions = (kind: 'image' | 'text' | 'slice') => {
    const list = kind === 'image' ? imageModels : kind === 'text' ? textModels : sliceModels;
    return list.map(model => ({ value: model.id, label: `${model.name} · ${model.providerName || ''}` }));
  };

  if (!providers) {
    return error ? <ErrorBanner message={error} onRetry={() => void load()} /> : <LoadingBlock />;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="供应商与模型"
        description="API Key 加密保存在服务器。模型配置好之后，用户端即可直接选择使用。"
        actions={<Button size="sm" onClick={openCreateProvider}><Plus className="size-3.5" />添加供应商</Button>}
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-400">
          <span>{notice}</span>
          <button type="button" className="text-[11px] underline-offset-4 hover:underline" onClick={() => setNotice(null)}>关闭</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2">
          {providers.length === 0 && (
            <EmptyState icon={ServerCog} title="还没有供应商" description="先添加一个上游供应商并填入 API Key。" action={<Button size="sm" onClick={openCreateProvider}>添加供应商</Button>} />
          )}
          {providers.map(provider => (
            <button
              key={provider.id}
              type="button"
              onClick={() => setSelectedProviderId(provider.id)}
              className={cn(
                'w-full rounded-xl border p-3 text-left transition-colors',
                provider.id === selectedProviderId
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:bg-muted/40',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{provider.name}</span>
                <Badge variant={provider.enabled ? 'secondary' : 'outline'} className="h-5 text-[10px]">
                  {provider.enabled ? '启用' : '停用'}
                </Badge>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{providerKindLabel(provider.kind)}</p>
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{provider.baseUrl}</p>
              <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                <KeyRound className="size-3" />
                {provider.hasApiKey ? provider.apiKeyMasked : '未配置 Key'}
              </p>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {!selectedProvider ? (
            <EmptyState icon={ServerCog} title="选择一个供应商" description="右侧会显示它的模型与操作。" />
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{selectedProvider.name}</p>
                      <Badge variant="outline" className="h-5 text-[10px]">{providerKindLabel(selectedProvider.kind)}</Badge>
                    </div>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{selectedProvider.baseUrl}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => void handleTestProvider(selectedProvider)} disabled={testing}>
                      <RefreshCw className={cn('size-3.5', testing && 'animate-spin')} />
                      {testing ? '测试中…' : '测试连接'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEditProvider(selectedProvider)}>
                      <Pencil className="size-3.5" />
                      编辑
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeletingProvider(selectedProvider)}>
                      <Trash2 className="size-3.5" />
                      删除
                    </Button>
                  </div>
                </div>
              </div>

              {testResult && testResult.providerId === selectedProvider.id && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">上游模型列表（{testResult.models.length}）</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">勾选后可按统一用途导入，导入后可再单独调整能力参数。</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={testResult.useType}
                        onValueChange={value => setTestResult(prev => prev ? { ...prev, useType: value as 'image' | 'text' } : prev)}
                        options={[{ value: 'image', label: '导入为图片模型' }, { value: 'text', label: '导入为文本模型' }]}
                        className="w-40"
                        size="sm"
                      />
                      <Button size="sm" onClick={() => void handleImportSelected()} disabled={importing}>
                        <Download className="size-3.5" />
                        {importing ? '导入中…' : '导入所选'}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border">
                    {testResult.models.length === 0 && <p className="p-3 text-xs text-muted-foreground">上游没有返回模型。</p>}
                    {testResult.models.map(model => (
                      <label key={model.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-muted/30">
                        <input
                          type="checkbox"
                          checked={Boolean(testResult.selected[model.id])}
                          onChange={event => setTestResult(prev => prev ? {
                            ...prev,
                            selected: { ...prev.selected, [model.id]: event.target.checked },
                          } : prev)}
                          className="size-3.5 accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{model.id}</span>
                        <span className="truncate text-[10px] text-muted-foreground">{model.name !== model.id ? model.name : ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">模型</p>
                    <p className="text-[11px] text-muted-foreground">{providerModels.length} 个</p>
                  </div>
                  <Button size="sm" onClick={openCreateModel}><Plus className="size-3.5" />添加模型</Button>
                </div>
                {providerModels.length === 0 ? (
                  <div className="p-4">
                    <EmptyState icon={ImageIcon} title="还没有模型" description="手动添加，或先测试连接再批量导入。" action={<Button size="sm" onClick={openCreateModel}>添加模型</Button>} />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">模型</th>
                          <th className="px-4 py-2 font-medium">用途</th>
                          <th className="px-4 py-2 font-medium">协议</th>
                          <th className="px-4 py-2 font-medium">状态</th>
                          <th className="px-4 py-2 text-right font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {providerModels.map(model => (
                          <tr key={model.id}>
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{model.name}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{model.upstreamId}</p>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center gap-1 text-[11px]">
                                {model.useType === 'image' ? <ImageIcon className="size-3" /> : <Type className="size-3" />}
                                {model.useType === 'image' ? '图片' : '文本'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-[11px] text-muted-foreground">{modelProtocolLabel(model)}</td>
                            <td className="px-4 py-2.5">
                              <Switch
                                size="sm"
                                checked={model.enabled}
                                onCheckedChange={async checked => {
                                  try {
                                    await updateModel(model.id, { enabled: checked });
                                    await load();
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : '更新失败');
                                  }
                                }}
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon-xs" onClick={() => openEditModel(model)}><Pencil className="size-3.5" /></Button>
                                <Button variant="ghost" size="icon-xs" className="text-destructive" onClick={() => setDeletingModel(model)}><Trash2 className="size-3.5" /></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">全局默认模型</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">用户未设置个人默认时使用这里的选择。</p>
          </div>
          <Button size="sm" onClick={() => void handleSaveDefaults()}>保存默认模型</Button>
        </div>
        {defaults && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {TASK_DEFAULT_FIELDS.map(field => {
              const options = modelOptions(field.kind);
              return (
                <Field key={field.key} label={field.label}>
                  <Select
                    value={defaults[field.key] || ''}
                    onValueChange={value => setDefaults(prev => prev ? { ...prev, [field.key]: value } : prev)}
                    options={options}
                    placeholder={options.length === 0 ? '暂无可用模型' : '未设置'}
                    size="sm"
                  />
                </Field>
              );
            })}
          </div>
        )}
      </div>

      {/* 供应商弹窗 */}
      <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProvider ? `编辑供应商 · ${editingProvider.name}` : '添加供应商'}</DialogTitle>
            <DialogDescription>
              API Key 会使用服务器主密钥加密后落库，管理接口只返回掩码。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="名称">
              <Input value={providerForm.name} onChange={event => setProviderForm(prev => ({ ...prev, name: event.target.value }))} placeholder="例如：OpenAI 官方" />
            </Field>
            <Field label="类型">
              <Select
                value={providerForm.kind}
                onValueChange={value => setProviderForm(prev => ({ ...prev, kind: value }))}
                options={PROVIDER_KINDS}
              />
            </Field>
            <Field label="Base URL">
              <Input value={providerForm.baseUrl} onChange={event => setProviderForm(prev => ({ ...prev, baseUrl: event.target.value }))} placeholder="https://api.openai.com" />
            </Field>
            <Field
              label="API Key"
              hint={editingProvider ? `当前：${editingProvider.apiKeyMasked || '未配置'}。留空表示不修改。` : undefined}
            >
              <Input
                type="password"
                value={providerForm.apiKey}
                onChange={event => setProviderForm(prev => ({ ...prev, apiKey: event.target.value }))}
                placeholder={editingProvider ? '留空保持不变' : 'sk-...'}
                autoComplete="off"
              />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <span className="text-xs font-medium">启用该供应商</span>
              <Switch checked={providerForm.enabled} onCheckedChange={checked => setProviderForm(prev => ({ ...prev, enabled: checked }))} />
            </label>
            {providerFormError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{providerFormError}</p>}
          </div>
          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setProviderDialogOpen(false)}>取消</Button>
            <Button onClick={() => void handleSaveProvider()} disabled={savingProvider}>{savingProvider ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 模型弹窗 */}
      <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingModel ? `编辑模型 · ${editingModel.name}` : '添加模型'}</DialogTitle>
            <DialogDescription>上游 ID 是发给供应商的真实模型名，展示名只影响用户界面。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="展示名称">
                <Input value={modelForm.name} onChange={event => setModelForm(prev => ({ ...prev, name: event.target.value }))} placeholder="例如：GPT Image 2" />
              </Field>
              <Field label="上游模型 ID">
                <Input value={modelForm.upstreamId} onChange={event => setModelForm(prev => ({ ...prev, upstreamId: event.target.value }))} placeholder="gpt-image-2" />
              </Field>
              <Field label="用途">
                <Select
                  value={modelForm.useType}
                  onValueChange={value => {
                    const useType = value as 'image' | 'text';
                    setModelForm(prev => ({
                      ...prev,
                      useType,
                      protocol: inferProtocol(selectedProvider?.kind || 'openai-compatible', useType),
                      builtinPreset: inferPreset(selectedProvider?.kind || 'openai-compatible', prev.upstreamId),
                    }));
                  }}
                  options={[{ value: 'image', label: '图片' }, { value: 'text', label: '文本' }]}
                />
              </Field>
              <Field label="协议">
                <Select
                  value={modelForm.protocol}
                  onValueChange={value => setModelForm(prev => ({ ...prev, protocol: value }))}
                  options={modelForm.useType === 'image' ? IMAGE_PROTOCOLS : TEXT_PROTOCOLS}
                />
              </Field>
            </div>

            {modelForm.useType === 'image' ? (
              <div className="grid gap-3 rounded-xl border border-border p-3.5 sm:grid-cols-2">
                <Field label="最大参考图数量">
                  <Input
                    type="number"
                    min={0}
                    max={32}
                    value={modelForm.maxRefImages}
                    onChange={event => setModelForm(prev => ({ ...prev, maxRefImages: Math.max(0, Number(event.target.value) || 0) }))}
                  />
                </Field>
                <Field label="最大输出尺寸">
                  <Select value={modelForm.maxOutputSize} onValueChange={value => setModelForm(prev => ({ ...prev, maxOutputSize: value }))} options={OUTPUT_SIZES} />
                </Field>
                <Field label="内置预设">
                  <Select value={modelForm.builtinPreset} onValueChange={value => setModelForm(prev => ({ ...prev, builtinPreset: value }))} options={PRESETS} />
                </Field>
                <label className="flex items-center justify-between gap-3 self-end rounded-lg border border-border px-3 py-2">
                  <span className="text-xs font-medium">高级参数（质量/背景）</span>
                  <Switch checked={modelForm.supportsAdvancedParams} onCheckedChange={checked => setModelForm(prev => ({ ...prev, supportsAdvancedParams: checked }))} />
                </label>
              </div>
            ) : (
              <Field label="备注" hint="仅展示用，例如模型能力说明。">
                <Input value={modelForm.note} onChange={event => setModelForm(prev => ({ ...prev, note: event.target.value }))} />
              </Field>
            )}

            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <span className="text-xs font-medium">启用该模型</span>
              <Switch checked={modelForm.enabled} onCheckedChange={checked => setModelForm(prev => ({ ...prev, enabled: checked }))} />
            </label>

            {modelFormError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{modelFormError}</p>}
          </div>
          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setModelDialogOpen(false)}>取消</Button>
            <Button onClick={() => void handleSaveModel()} disabled={savingModel}>{savingModel ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingProvider)} onOpenChange={open => { if (!open) setDeletingProvider(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除供应商</DialogTitle>
            <DialogDescription>
              删除 {deletingProvider?.name} 会同时删除其下所有模型。已提交的任务不受影响，但用户将无法再选择这些模型。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDeletingProvider(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void handleDeleteProvider()}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingModel)} onOpenChange={open => { if (!open) setDeletingModel(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除模型</DialogTitle>
            <DialogDescription>确定删除 {deletingModel?.name} 吗？</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDeletingModel(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void handleDeleteModel()}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
