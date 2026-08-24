import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageSquare, X } from '@phosphor-icons/react';
import type { StoryTheaterEntry, StoryTheaterImageConfig } from '../../../types';
import { useOS } from '../../../context/OSContext';

interface Props {
    entry: StoryTheaterEntry;
    onChange: (entry: StoryTheaterEntry) => Promise<void> | void;
}

const fallback = (entry: StoryTheaterEntry): StoryTheaterImageConfig => ({
    enabled: entry.imageGeneration?.enabled === true,
    styleTags: entry.imageGeneration?.styleTags || '',
    width: entry.imageGeneration?.width || 1216,
    height: entry.imageGeneration?.height || 832,
    userAnchor: entry.imageGeneration?.userAnchor || '',
    characterAnchors: entry.imageGeneration?.characterAnchors || {},
});

const Toggle: React.FC<{ value: boolean; onChange: (value: boolean) => void }> = ({ value, onChange }) => <button type='button' aria-pressed={value} onClick={() => onChange(!value)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${value ? 'bg-violet-600' : 'bg-slate-200'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${value ? 'left-6' : 'left-1'}`} /></button>;

const StoryImageSettingsButton: React.FC<Props> = ({ entry, onChange }) => {
    const { apiConfig, addToast } = useOS();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<StoryTheaterImageConfig>(() => fallback(entry));
    useEffect(() => { if (open) setDraft(fallback(entry)); }, [entry, open]);
    const globalReady = Boolean(apiConfig.novelAiImageGeneration?.baseUrl && apiConfig.novelAiImageGeneration?.apiKey && apiConfig.novelAiImageGeneration?.model);
    const save = async () => {
        if (draft.enabled && !globalReady) {
            addToast('请先在任一私聊的“生图 2.0”里配置全局 URL、Key 和模型', 'error');
            return;
        }
        await onChange({ ...entry, imageGeneration: draft, updatedAt: Date.now() });
        addToast(draft.enabled ? '本剧情自动配图已开启' : '本剧情自动配图已关闭', 'success');
        setOpen(false);
    };
    return <>
        <button type='button' onClick={() => setOpen(true)} className={`relative grid h-9 w-9 place-items-center rounded-full ${entry.imageGeneration?.enabled ? 'text-violet-600' : ''}`} title='剧情配图' aria-label='剧情配图'><ImageSquare size={18} weight={entry.imageGeneration?.enabled ? 'fill' : 'regular'} />{entry.imageGeneration?.enabled && <span className='absolute right-1 top-1 h-2 w-2 rounded-full border border-stone-100 bg-emerald-500' />}</button>
        {open && createPortal(<div
            className='story-theme fixed inset-0 z-[95] flex items-end justify-center overflow-hidden overscroll-contain'
            style={{ position: 'fixed', paddingTop: 'max(12px, env(safe-area-inset-top))', backgroundColor: 'rgba(2, 6, 23, .35)' }}
            onClick={() => setOpen(false)}
            role='presentation'
        >
            <div
                className='story-safe-sheet relative flex max-h-[88dvh] w-full max-w-sm flex-col overflow-hidden rounded-t-[28px] bg-stone-100 shadow-2xl'
                style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
                onClick={event => event.stopPropagation()}
                role='dialog'
                aria-modal='true'
                aria-labelledby='story-image-settings-title'
            >
                <div className='shrink-0 px-5 pb-4 pt-5'>
                    <div className='flex items-start gap-4'><div className='min-w-0 flex-1'><div className='text-[9px] font-bold uppercase tracking-[.22em] text-violet-500'>Story illustration</div><h2 id='story-image-settings-title' className='mt-1 text-lg font-semibold'>本剧情自动配图</h2><p className='mt-1 text-[10px] leading-5 text-slate-500'>接口、Key、模型、采样器、Steps 与 CFG 统一读取全局生图 2.0。</p></div><button type='button' onClick={() => setOpen(false)} className='grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white' aria-label='关闭配图设置'><X size={17} /></button></div>
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain border-y border-slate-200 px-5'>
                    <div className='py-4'><div className='flex items-center justify-between gap-4'><div><div className='text-sm font-semibold'>每轮生成一张</div><p className='mt-1 text-[10px] leading-5 text-slate-500'>正文先显示，随后结合本轮与近期上下文画图。</p></div><Toggle value={draft.enabled} onChange={enabled => setDraft(current => ({ ...current, enabled }))} /></div></div>
                    {!globalReady && <div className='mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10px] leading-5 text-amber-700'>全局生图 2.0 尚未完整配置。可以先填写本页，开启前需到私聊生图 2.0 设置 URL、Key 与模型。</div>}
                    <label className='block border-t border-slate-200 py-4'><span className='text-[10px] font-bold text-slate-500'>本剧情画师串 / 风格</span><textarea value={draft.styleTags || ''} onChange={event => setDraft(current => ({ ...current, styleTags: event.target.value }))} placeholder='artist:name, cinematic lighting, detailed background' className='mt-1.5 min-h-28 w-full resize-y rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-5 outline-none' /></label>
                    <label className='block border-t border-slate-200 py-4'><span className='text-[10px] font-bold text-slate-500'>配图画幅</span><select value={`${draft.width}x${draft.height}`} onChange={event => { const [width, height] = event.target.value.split('x').map(Number); setDraft(current => ({ ...current, width, height })); }} className='mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs outline-none'><option value='1216x832'>横图 1216×832（默认）</option><option value='1344x768'>宽横图 1344×768</option><option value='1024x1024'>方图 1024×1024</option><option value='832x1216'>竖图 832×1216</option><option value='768x1344'>长竖图 768×1344</option></select></label>
                    <p className='border-t border-slate-200 py-4 text-[10px] leading-5 text-slate-400'>人物锚点在“剧情设置 → 让谁参与”下方调整；多人场景会按本轮真正出镜的人物组合标签。</p>
                </div>
                <div className='shrink-0 px-5 pt-4'><button type='button' onClick={() => void save()} className='h-12 w-full rounded-2xl bg-slate-900 text-xs font-bold text-white'>保存配图设置</button></div>
            </div>
        </div>, document.body)}
    </>;
};

export default StoryImageSettingsButton;
