'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Cpu, ImageIcon, Save, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  isSliceCapableImageModel,
  loadRegistry,
  saveRegistry,
  type DefaultModels,
  type ImageModelConfig,
  type TextModelConfig,
} from '@/lib/nova-models';
import { isUserDefaultOverrideAllowed, resetUserModelDefaults } from '@/lib/server-models';
import { useOptionalSession } from '@/lib/session-context';

const TASK_FIELDS: Array<{
  key: keyof DefaultModels;
  label: string;
  hint?: string;
  kind: 'image' | 'text' | 'slice-image';
}> = [
  { key: 'textToImage', label: '文生图默认模型', kind: 'image' },
  { key: 'imageToImage', label: '图生图默认模型', kind: 'image' },
  { key: 'reversePrompt', label: '反推提示词默认模型', kind: 'text' },
  { key: 'agent', label: 'Agent 默认模型', kind: 'text' },
  { key: 'promptOptimize', label: '提示词优化默认模型', kind: 'text' },
  { key: 'layoutSpec', label: '构图模式默认模型', kind: 'text', hint: '建议用能力更强的模型' },
  { key: 'imageDescribe', label: '图片描述默认模型', kind: 'text' },
  { key: 'sliceDecomposition', label: 'AI 拆图默认模型', kind: 'text', hint: '需要视觉能力' },
  { key: 'sliceReconstruct', label: '网页复刻默认模型', kind: 'text', hint: '建议用能力较强的模型' },
  { key: 'sliceImageEdit', label: '切图图片编辑默认模型', kind: 'slice-image', hint: '仅 OpenAI 协议支持带蒙版编辑' },
];

function modelLabel(model: { name: string; modelId: string }): string {
  return model.name.trim() || model.modelId;
}

export function ServerModelsSettings() {
  const session = useOptionalSession();
  const registry = useMemo(() => loadRegistry(), []);
  const [defaults, setDefaults] = useState<DefaultModels>(registry.defaults);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowOverride = isUserDefaultOverrideAllowed();

  const imageModels: ImageModelConfig[] = registry.imageModels;
  const textModels: TextModelConfig[] = registry.textModels;
  const sliceModels = imageModels.filter(isSliceCapableImageModel);

  const imageOptions = imageModels.map(model => ({ value: model.id, label: modelLabel(model) }));
  const textOptions = textModels.map(model => ({ value: model.id, label: modelLabel(model) }));
  const sliceOptions = sliceModels.map(model => ({ value: model.id, label: modelLabel(model) }));

  const optionsFor = (kind: 'image' | 'text' | 'slice-image') => {
    if (kind === 'image') return imageOptions;
    if (kind === 'text') return textOptions;
    return sliceOptions;
  };

  const handleSave = () => {
    setError(null);
    if (!allowOverride) {
      setError('管理员已关闭个人默认模型覆盖');
      return;
    }
    saveRegistry({ ...registry, defaults });
    window.dispatchEvent(new Event('nova-model-registry-updated'));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    resetUserModelDefaults();
    const fresh = loadRegistry();
    setDefaults(fresh.defaults);
    window.dispatchEvent(new Event('nova-model-registry-updated'));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
            <Cpu className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">模型由部署管理员统一配置</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              这里展示当前账号可用的模型。API Key 保存在服务器上，不会下发到浏览器。
              {session?.user.role === 'admin' && (
                <> 需要增删模型或修改密钥，请前往 <a href="/admin/" className="font-medium text-foreground underline-offset-4 hover:underline">管理员后台</a>。</>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ImageIcon className="size-4 text-muted-foreground" />
            图片模型
            <span className="ml-auto text-xs font-normal text-muted-foreground">{imageModels.length} 个</span>
          </div>
          <ul className="mt-3 space-y-1.5">
            {imageModels.length === 0 && <li className="text-xs text-muted-foreground">管理员尚未配置可用图片模型</li>}
            {imageModels.map(model => (
              <li key={model.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{modelLabel(model)}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{model.modelId}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Type className="size-4 text-muted-foreground" />
            文本模型
            <span className="ml-auto text-xs font-normal text-muted-foreground">{textModels.length} 个</span>
          </div>
          <ul className="mt-3 space-y-1.5">
            {textModels.length === 0 && <li className="text-xs text-muted-foreground">管理员尚未配置可用文本模型</li>}
            {textModels.map(model => (
              <li key={model.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{modelLabel(model)}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{model.modelId}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">个人默认模型</p>
            <p className="mt-1 text-xs text-muted-foreground">
              只影响当前浏览器，不会改变其他用户。管理员默认值作为兜底。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {allowOverride && (
              <Button variant="outline" size="sm" onClick={handleReset}>
                恢复管理员默认
              </Button>
            )}
            <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={!allowOverride}>
              {saved ? <CheckCircle2 className="size-3.5" /> : <Save className="size-3.5" />}
              {saved ? '已保存' : '保存个人默认'}
            </Button>
          </div>
        </div>

        {!allowOverride && (
          <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            管理员已关闭个人默认模型覆盖，所有用户统一使用后台配置。
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {TASK_FIELDS.map(field => {
            const options = optionsFor(field.kind);
            return (
              <div key={field.key} className="space-y-1.5">
                <label className="text-xs text-muted-foreground">{field.label}</label>
                <Select
                  value={defaults[field.key] || ''}
                  onValueChange={value => setDefaults(prev => ({ ...prev, [field.key]: value }))}
                  options={options}
                  disabled={!allowOverride || options.length === 0}
                  placeholder={options.length === 0 ? '暂无可用模型' : '使用管理员默认'}
                />
                {field.hint && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
