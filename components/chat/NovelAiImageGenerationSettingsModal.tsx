import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, MagicWand, SpinnerGap, XCircle } from '@phosphor-icons/react';
import type { APIConfig, CharacterProfile, NovelAiImageGenerationApiConfig } from '../../types';
import {
    DEFAULT_NAI_IMAGE_API_URL,
    DEFAULT_NAI_IMAGE_MODEL,
    DEFAULT_NAI_NEGATIVE_TAGS,
    DEFAULT_NAI_QUALITY_TAGS,
    DEFAULT_NAI_SAMPLER,
    isNovelAiApiVerified,
    novelAiApiSignature,
    testNovelAiConnection,
} from '../../utils/novelAiImageGeneration';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    char: CharacterProfile;
    apiConfig: APIConfig;
    instantActive: boolean;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
    updateApiConfig: (updates: Partial<APIConfig>) => void;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const inputClass = 'mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100';
const labelClass = 'block text-xs font-semibold text-slate-500';

const defaultApi = (): NovelAiImageGenerationApiConfig => ({
    baseUrl: DEFAULT_NAI_IMAGE_API_URL,
    apiKey: '',
    model: DEFAULT_NAI_IMAGE_MODEL,
    width: 832,
    height: 1216,
    sampler: DEFAULT_NAI_SAMPLER,
    steps: 28,
    scale: 5,
    qualityToggle: true,
});

const NovelAiImageGenerationSettingsModal: React.FC<Props> = ({
    isOpen, onClose, char, apiConfig, instantActive, updateCharacter, updateApiConfig, addToast,
}) => {
    const savedApi = apiConfig.novelAiImageGeneration;
    const savedChar = char.novelAiImageGeneration;
    const [draftApi, setDraftApi] = useState<NovelAiImageGenerationApiConfig>({ ...defaultApi(), ...savedApi });
    const [enabled, setEnabled] = useState(!!savedChar?.enabled);
    const [allowProactive, setAllowProactive] = useState(!!savedChar?.allowProactive);
    const [characterTags, setCharacterTags] = useState(savedChar?.characterTags || '');
    const [styleTags, setStyleTags] = useState(savedChar?.styleTags || '');
    const [qualityTags, setQualityTags] = useState(savedChar?.qualityTags || DEFAULT_NAI_QUALITY_TAGS);
    const [negativeTags, setNegativeTags] = useState(savedChar?.negativeTags || DEFAULT_NAI_NEGATIVE_TAGS);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setDraftApi({ ...defaultApi(), ...apiConfig.novelAiImageGeneration });
        setEnabled(!!char.novelAiImageGeneration?.enabled);
        setAllowProactive(!!char.novelAiImageGeneration?.allowProactive);
        setCharacterTags(char.novelAiImageGeneration?.characterTags || '');
        setStyleTags(char.novelAiImageGeneration?.styleTags || '');
        setQualityTags(char.novelAiImageGeneration?.qualityTags || DEFAULT_NAI_QUALITY_TAGS);
        setNegativeTags(char.novelAiImageGeneration?.negativeTags || DEFAULT_NAI_NEGATIVE_TAGS);
    }, [isOpen, char.id, apiConfig.novelAiImageGeneration, char.novelAiImageGeneration]);

    const connected = useMemo(() => isNovelAiApiVerified(draftApi), [draftApi]);
    if (!isOpen) return null;

    const characterConfig = () => ({
        enabled,
        allowProactive,
        characterTags: characterTags.trim(),
        styleTags: styleTags.trim(),
        qualityTags: qualityTags.trim(),
        negativeTags: negativeTags.trim(),
    });

    const normalizedApi = (): NovelAiImageGenerationApiConfig => ({
        ...draftApi,
        baseUrl: draftApi.baseUrl.trim() || DEFAULT_NAI_IMAGE_API_URL,
        apiKey: draftApi.apiKey.trim(),
        model: draftApi.model.trim() || DEFAULT_NAI_IMAGE_MODEL,
        width: Math.max(64, Math.round(Number(draftApi.width) / 64) * 64),
        height: Math.max(64, Math.round(Number(draftApi.height) / 64) * 64),
        steps: Math.min(50, Math.max(1, Number(draftApi.steps) || 28)),
        scale: Math.min(20, Math.max(1, Number(draftApi.scale) || 5)),
    });

    const save = () => {
        updateApiConfig({ novelAiImageGeneration: normalizedApi() });
        updateCharacter(char.id, { novelAiImageGeneration: characterConfig() });
        addToast('生图 2.0 设置已保存', 'success');
        onClose();
    };

    const testAndSave = async () => {
        setTesting(true);
        try {
            const next = normalizedApi();
            await testNovelAiConnection(next);
            const verified = {
                ...next,
                verifiedAt: Date.now(),
                verifiedSignature: novelAiApiSignature(next),
            };
            setDraftApi(verified);
            updateApiConfig({ novelAiImageGeneration: verified });
            updateCharacter(char.id, { novelAiImageGeneration: characterConfig() });
            addToast('NovelAI 端点可达，设置已保存', 'success');
        } catch (error: any) {
            addToast(error?.message || 'NovelAI 连接检测失败', 'error');
        } finally {
            setTesting(false);
        }
    };

    const updateApi = <K extends keyof NovelAiImageGenerationApiConfig>(key: K, value: NovelAiImageGenerationApiConfig[K]) => {
        setDraftApi(previous => ({ ...previous, [key]: value }));
    };

    return (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/25 backdrop-blur-[2px]" onClick={onClose}>
            <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[30px] bg-[#f8fafc] shadow-2xl" onClick={event => event.stopPropagation()}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur-xl">
                    <div>
                        <h2 className="flex items-center gap-2 text-base font-bold text-slate-800"><MagicWand className="text-violet-500" weight="fill" />{char.name} · 生图 2.0</h2>
                        <p className="mt-0.5 text-[11px] text-slate-400">NovelAI 文生图 · 画师串与角色标签分层注入</p>
                    </div>
                    <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500">×</button>
                </div>

                <div className="space-y-5 p-5 pb-[calc(24px+env(safe-area-inset-bottom))]">
                    {instantActive && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
                            生图 2.0 只在当前设备本地执行。触发索图时本轮会自动留在本地，云端主动消息接收不受影响。
                        </div>
                    )}
                    {enabled && char.imageGeneration?.enabled && (
                        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs leading-relaxed text-violet-700">
                            旧生图与 2.0 同时开启时，本角色优先使用 NovelAI 2.0；旧设置不会被删除。
                        </div>
                    )}

                    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <Toggle title="开启生图 2.0" detail="用户明确索图时直接调用，不弹二次付费确认" value={enabled} onChange={setEnabled} color="violet" />
                        <div className="mt-4 border-t border-slate-100 pt-4">
                            <Toggle title="允许角色主动发图" detail="默认关闭；开启后仍限制为极低频" value={allowProactive} onChange={setAllowProactive} color="pink" />
                        </div>
                    </section>

                    <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-slate-800">NovelAI 接口</h3>
                                <p className="mt-1 text-[11px] text-slate-400">官方地址或兼容 /ai/generate-image 的中转地址</p>
                            </div>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${connected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                {connected ? <CheckCircle weight="fill" /> : <XCircle weight="fill" />}{connected ? '端点可达' : '未检测'}
                            </span>
                        </div>
                        <label className={labelClass}>API 地址
                            <input className={inputClass} value={draftApi.baseUrl} onChange={e => updateApi('baseUrl', e.target.value)} placeholder={DEFAULT_NAI_IMAGE_API_URL} />
                        </label>
                        <label className={labelClass}>API Key
                            <input type="password" autoComplete="off" className={inputClass} value={draftApi.apiKey} onChange={e => updateApi('apiKey', e.target.value)} placeholder="NovelAI token / 中转 Key" />
                        </label>
                        <label className={labelClass}>模型
                            <input list="nai-models" className={inputClass} value={draftApi.model} onChange={e => updateApi('model', e.target.value)} />
                            <datalist id="nai-models">
                                <option value="nai-diffusion-4-5-full" />
                                <option value="nai-diffusion-4-5-curated" />
                                <option value="nai-diffusion-4-full" />
                                <option value="nai-diffusion-3" />
                            </datalist>
                        </label>
                        <button type="button" disabled={testing} onClick={testAndSave} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-white disabled:opacity-60">
                            {testing && <SpinnerGap className="animate-spin" />}{testing ? '检测中…' : '检测端点并保存'}
                        </button>
                        <p className="text-[10px] leading-relaxed text-slate-400">检测不会提交生图任务或扣除 Anlas；部分中转不支持 OPTIONS 时可直接保存后实测。</p>
                    </section>

                    <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <div>
                            <h3 className="font-bold text-slate-800">提示词分层</h3>
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">用英文逗号分隔。生成时按“质量 → 画师串 → 人物 → 当前场景”合并并自动去重。</p>
                        </div>
                        <TagArea label="人物固定标签" value={characterTags} onChange={setCharacterTags} placeholder="1boy, black hair, golden eyes, mature male" />
                        <TagArea label="画师串 / 风格" value={styleTags} onChange={setStyleTags} placeholder="artist:name, semi-realistic, cinematic lighting" />
                        <TagArea label="质量标签" value={qualityTags} onChange={setQualityTags} />
                        <TagArea label="负面标签" value={negativeTags} onChange={setNegativeTags} />
                    </section>

                    <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <h3 className="font-bold text-slate-800">生成参数</h3>
                        <label className={labelClass}>画幅
                            <select className={inputClass} value={`${draftApi.width}x${draftApi.height}`} onChange={e => {
                                const [width, height] = e.target.value.split('x').map(Number);
                                setDraftApi(previous => ({ ...previous, width, height }));
                            }}>
                                <option value="832x1216">竖图 832×1216</option>
                                <option value="1024x1024">方图 1024×1024</option>
                                <option value="1216x832">横图 1216×832</option>
                                <option value="768x1344">长竖图 768×1344</option>
                            </select>
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            <NumberField label="Steps" value={draftApi.steps} min={1} max={50} step={1} onChange={value => updateApi('steps', value)} />
                            <NumberField label="CFG" value={draftApi.scale} min={1} max={20} step={0.5} onChange={value => updateApi('scale', value)} />
                            <label className={labelClass}>采样器
                                <select className={`${inputClass} px-2`} value={draftApi.sampler} onChange={e => updateApi('sampler', e.target.value)}>
                                    <option value="k_euler_ancestral">Euler a</option>
                                    <option value="k_euler">Euler</option>
                                    <option value="k_dpmpp_2m">DPM++ 2M</option>
                                    <option value="k_dpmpp_sde">DPM++ SDE</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <button type="button" onClick={save} className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-slate-300">保存设置</button>
                    <p className="text-center text-[10px] leading-relaxed text-slate-400">API Key 仅保存在本地数据与完整备份中；群聊和云端主动消息不会读取它。</p>
                </div>
            </div>
        </div>
    );
};

const Toggle: React.FC<{ title: string; detail: string; value: boolean; onChange: (value: boolean) => void; color: 'violet' | 'pink' }> = ({ title, detail, value, onChange, color }) => (
    <div className="flex items-center justify-between gap-3">
        <div><div className="font-bold text-slate-800">{title}</div><div className="mt-1 text-[11px] text-slate-400">{detail}</div></div>
        <button type="button" onClick={() => onChange(!value)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${value ? (color === 'violet' ? 'bg-violet-500' : 'bg-pink-500') : 'bg-slate-200'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${value ? 'left-6' : 'left-1'}`} />
        </button>
    </div>
);

const TagArea: React.FC<{ label: string; value: string; onChange: (value: string) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
    <label className={labelClass}>{label}
        <textarea className={`${inputClass} min-h-20 resize-y leading-relaxed`} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </label>
);

const NumberField: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }> = ({ label, value, min, max, step, onChange }) => (
    <label className={labelClass}>{label}<input type="number" className={`${inputClass} px-2`} value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} /></label>
);

export default NovelAiImageGenerationSettingsModal;
