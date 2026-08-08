import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, ImageSquare, LinkSimple, SpinnerGap, Trash, XCircle } from '@phosphor-icons/react';
import type { APIConfig, CharacterProfile, ImageGenerationApiConfig, ImageGenerationChannel } from '../../types';
import {
    DEFAULT_IMAGE_API_URL,
    DEFAULT_IMAGE_CHANNEL,
    imageApiSignature,
    isImageApiVerified,
    testImageApiConnection,
} from '../../utils/imageGeneration';

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

const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100';

const ImageGenerationSettingsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    char,
    apiConfig,
    instantActive,
    updateCharacter,
    updateApiConfig,
    addToast,
}) => {
    const savedApi = apiConfig.imageGeneration;
    const savedChar = char.imageGeneration;
    const savedReferenceUrl = /^https?:\/\//i.test(savedChar?.referenceImage || '') ? savedChar!.referenceImage! : '';
    const savedMxApiUrl = savedApi?.channel ? savedApi.baseUrl : DEFAULT_IMAGE_API_URL;
    const [baseUrl, setBaseUrl] = useState(savedMxApiUrl);
    const [apiKey, setApiKey] = useState(savedApi?.apiKey || '');
    const [channel, setChannel] = useState<ImageGenerationChannel>(savedApi?.channel || DEFAULT_IMAGE_CHANNEL);
    const [enabled, setEnabled] = useState(!!savedChar?.enabled);
    const [allowProactive, setAllowProactive] = useState(!!savedChar?.allowProactive);
    const [anchors, setAnchors] = useState(savedChar?.appearanceAnchors || '');
    const [referenceImage, setReferenceImage] = useState(savedReferenceUrl);
    const [referencePreview, setReferencePreview] = useState(savedReferenceUrl);
    const [referenceStatus, setReferenceStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(savedReferenceUrl ? 'loading' : 'idle');
    const [previewNonce, setPreviewNonce] = useState(0);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setBaseUrl(savedApi?.channel ? savedApi.baseUrl : DEFAULT_IMAGE_API_URL);
        setApiKey(savedApi?.apiKey || '');
        setChannel(savedApi?.channel || DEFAULT_IMAGE_CHANNEL);
        setEnabled(!!savedChar?.enabled);
        setAllowProactive(!!savedChar?.allowProactive);
        setAnchors(savedChar?.appearanceAnchors || '');
        const nextReference = /^https?:\/\//i.test(savedChar?.referenceImage || '') ? savedChar!.referenceImage! : '';
        setReferenceImage(nextReference);
        setReferencePreview(nextReference);
        setReferenceStatus(nextReference ? 'loading' : 'idle');
        setPreviewNonce(value => value + 1);
    }, [isOpen, char.id, savedApi, savedChar]);

    const draftApi = useMemo<ImageGenerationApiConfig>(() => ({
        baseUrl: baseUrl.trim() || DEFAULT_IMAGE_API_URL,
        apiKey: apiKey.trim(),
        channel,
        verifiedAt: savedApi?.verifiedAt,
        verifiedSignature: savedApi?.verifiedSignature,
    }), [baseUrl, apiKey, channel, savedApi?.verifiedAt, savedApi?.verifiedSignature]);
    const connected = isImageApiVerified(draftApi);

    if (!isOpen) return null;

    const validatedReference = (): string | null => {
        const value = referenceImage.trim();
        if (!value) return '';
        try {
            const parsed = new URL(value);
            if (!/^https?:$/.test(parsed.protocol)) throw new Error();
        } catch {
            addToast('参考图必须是完整的 http(s) 图片 URL', 'error');
            return null;
        }
        if (referenceStatus !== 'success' || referencePreview !== value) {
            addToast('请先点“加载预览”，确认参考图可以正常打开', 'error');
            return null;
        }
        return value;
    };

    const save = (close = true) => {
        const referenceUrl = validatedReference();
        if (referenceUrl === null) return;
        updateApiConfig({ imageGeneration: draftApi });
        updateCharacter(char.id, {
            imageGeneration: {
                enabled,
                allowProactive,
                appearanceAnchors: anchors.trim(),
                referenceImage: referenceUrl || undefined,
            },
        });
        addToast('生图设置已保存', 'success');
        if (close) onClose();
    };

    const testAndSave = async () => {
        const referenceUrl = validatedReference();
        if (referenceUrl === null) return;
        setTesting(true);
        try {
            await testImageApiConnection(draftApi);
            const verified: ImageGenerationApiConfig = {
                ...draftApi,
                verifiedAt: Date.now(),
                verifiedSignature: imageApiSignature(draftApi),
            };
            updateApiConfig({ imageGeneration: verified });
            updateCharacter(char.id, {
                imageGeneration: {
                    enabled,
                    allowProactive,
                    appearanceAnchors: anchors.trim(),
                    referenceImage: referenceUrl || undefined,
                },
            });
            addToast('生图 API 已连通并保存', 'success');
        } catch (error: any) {
            addToast(error?.message || '生图 API 连接失败', 'error');
        } finally {
            setTesting(false);
        }
    };

    const loadReferencePreview = () => {
        const value = referenceImage.trim();
        if (!value) {
            setReferencePreview('');
            setReferenceStatus('idle');
            return;
        }
        try {
            const parsed = new URL(value);
            if (!/^https?:$/.test(parsed.protocol)) throw new Error();
            setReferenceImage(value);
            setReferencePreview(value);
            setReferenceStatus('loading');
            setPreviewNonce(nonce => nonce + 1);
        } catch {
            setReferencePreview('');
            setReferenceStatus('error');
            addToast('请输入完整的 http(s) 图片 URL', 'error');
        }
    };

    return (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/25 backdrop-blur-[2px]" onClick={onClose}>
            <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-[30px] bg-[#f8fafc] shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur-xl">
                    <div>
                        <h2 className="text-base font-bold text-slate-800">{char.name} · 生图</h2>
                        <p className="mt-0.5 text-[11px] text-slate-400">本地私聊专用 · 图片自动进入聊天与相册</p>
                    </div>
                    <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500">×</button>
                </div>

                <div className="space-y-5 p-5 pb-[calc(24px+env(safe-area-inset-bottom))]">
                    {instantActive && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
                            Instant Push 当前已启用。生图指令不会发送到云端；关闭 Instant Push、改用本地回复时，本功能才会触发。
                        </div>
                    )}

                    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="font-bold text-slate-800">开启角色生图</div>
                                <div className="mt-1 text-[11px] text-slate-400">开启后，明确索图会直接调用 API，不再二次确认</div>
                            </div>
                            <button type="button" onClick={() => setEnabled(v => !v)} className={`relative h-7 w-12 rounded-full transition ${enabled ? 'bg-pink-500' : 'bg-slate-200'}`}>
                                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${enabled ? 'left-6' : 'left-1'}`} />
                            </button>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                            <div>
                                <div className="text-sm font-semibold text-slate-700">允许角色主动发图</div>
                                <div className="mt-1 text-[11px] text-slate-400">默认关闭；开启后角色仍会被要求极低频使用</div>
                            </div>
                            <button type="button" onClick={() => setAllowProactive(v => !v)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${allowProactive ? 'bg-violet-500' : 'bg-slate-200'}`}>
                                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${allowProactive ? 'left-6' : 'left-1'}`} />
                            </button>
                        </div>
                    </section>

                    <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-slate-800">图片 API</h3>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${connected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                {connected ? <CheckCircle weight="fill" /> : <XCircle weight="fill" />}
                                {connected ? '已连通' : '未检测'}
                            </span>
                        </div>
                        <label className="block text-xs font-semibold text-slate-500">API 地址
                            <input className={`${inputClass} mt-1.5`} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={DEFAULT_IMAGE_API_URL} />
                        </label>
                        <label className="block text-xs font-semibold text-slate-500">API Key
                            <input type="password" autoComplete="off" className={`${inputClass} mt-1.5`} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
                        </label>
                        <label className="block text-xs font-semibold text-slate-500">通道
                            <select className={`${inputClass} mt-1.5`} value={channel} onChange={e => setChannel(e.target.value as ImageGenerationChannel)}>
                                <option value="default">default · 特价通道（固定 low 质量）</option>
                                <option value="official">official · 官方通道（medium 质量）</option>
                            </select>
                        </label>
                        <button type="button" disabled={testing} onClick={testAndSave} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-white disabled:opacity-60">
                            {testing && <SpinnerGap className="animate-spin" />}
                            {testing ? '检测中…' : '检测连接并保存'}
                        </button>
                    </section>

                    <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <div>
                            <h3 className="font-bold text-slate-800">人物锚点</h3>
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">只写固定外形，例如发型、发色、瞳色和常见服饰特征。场景、动作与穿着可由当前聊天决定。</p>
                        </div>
                        <textarea
                            className={`${inputClass} min-h-28 resize-none leading-relaxed`}
                            value={anchors}
                            onChange={e => setAnchors(e.target.value)}
                            placeholder="例如：黑色微卷短发，灰蓝色瞳孔，眉眼锋利；常穿深色衬衫或长外套。"
                        />
                    </section>

                    <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <div>
                            <h3 className="font-bold text-slate-800">参考图（可选）</h3>
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">填写一条无需登录、可公开访问的图片直链。加载成功后会显示预览，生图时直接把该 URL 交给模型。</p>
                        </div>
                        <div className="flex gap-2">
                            <input
                                className={inputClass}
                                value={referenceImage}
                                onChange={e => {
                                    setReferenceImage(e.target.value);
                                    setReferencePreview('');
                                    setReferenceStatus('idle');
                                }}
                                placeholder="https://example.com/character.jpg"
                                inputMode="url"
                            />
                            <button type="button" onClick={loadReferencePreview} className="flex shrink-0 items-center gap-1 rounded-2xl bg-pink-500 px-3 text-xs font-bold text-white">
                                <LinkSimple weight="bold" /> 加载
                            </button>
                        </div>
                        {referencePreview ? (
                            <div className="relative overflow-hidden rounded-2xl bg-slate-100">
                                <img
                                    key={previewNonce}
                                    src={referencePreview}
                                    className="h-56 w-full object-contain"
                                    alt="角色参考图预览"
                                    referrerPolicy="no-referrer"
                                    onLoad={() => setReferenceStatus('success')}
                                    onError={() => setReferenceStatus('error')}
                                />
                                <button type="button" onClick={() => { setReferenceImage(''); setReferencePreview(''); setReferenceStatus('idle'); }} className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                                    <Trash weight="bold" />
                                </button>
                                <span className={`absolute bottom-2 left-2 rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur ${referenceStatus === 'success' ? 'bg-emerald-500/90 text-white' : referenceStatus === 'error' ? 'bg-rose-500/90 text-white' : 'bg-black/55 text-white'}`}>
                                    {referenceStatus === 'success' ? '加载成功' : referenceStatus === 'error' ? '加载失败' : '正在加载…'}
                                </span>
                            </div>
                        ) : (
                            <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 text-slate-300">
                                <ImageSquare className="h-7 w-7" weight="duotone" />
                                <span className="text-xs font-bold">加载成功后在这里显示预览</span>
                            </div>
                        )}
                        {referenceStatus === 'error' && <p className="text-xs text-rose-500">图片无法打开。请确认它是图片直链，并且没有登录或防盗链限制。</p>}
                    </section>

                    <button type="button" onClick={() => save(true)} className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-slate-300">
                        保存设置
                    </button>
                    <p className="text-center text-[10px] leading-relaxed text-slate-400">默认生成 1152×2048（9:16）竖版图片；default 使用 low，official 使用 medium。API Key 只保存在你的本地数据与完整备份中。</p>
                </div>
            </div>
        </div>
    );
};

export default ImageGenerationSettingsModal;
