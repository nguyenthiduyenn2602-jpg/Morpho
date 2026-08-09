import React, { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, Check, SlidersHorizontal, X } from '@phosphor-icons/react';
import type { StoryTheaterPresetDocument } from '../../../types';
import { applyStoryPresetChoice, estimateStoryTokens } from '../../../utils/storyTheater';
import { STORY_PRESET_SIMPLE_CHOICES } from './StoryPresetMaker';

interface Props {
    document: StoryTheaterPresetDocument;
    hasOverride: boolean;
    onApply: (document: StoryTheaterPresetDocument) => Promise<void> | void;
    onReset: () => Promise<void> | void;
    onClose: () => void;
}

const StoryQuickPresetPanel: React.FC<Props> = ({ document, hasOverride, onApply, onReset, onClose }) => {
    const [draft, setDraft] = useState<StoryTheaterPresetDocument>(() => ({ ...document, generation: { ...document.generation }, prompts: document.prompts.map(prompt => ({ ...prompt })) }));
    const [page, setPage] = useState(0);
    const [saving, setSaving] = useState(false);
    const pages = useMemo(() => STORY_PRESET_SIMPLE_CHOICES.filter(choice => choice.ids.some(id => draft.prompts.some(prompt => prompt.id === id))), [draft.prompts]);
    const current = pages[Math.min(page, Math.max(0, pages.length - 1))];
    const tokenEstimate = useMemo(() => estimateStoryTokens(draft.prompts.filter(prompt => prompt.enabled).map(prompt => prompt.content).join('\n') + (draft.assistantPrefill || '')), [draft]);

    const choose = (id?: string) => {
        if (!current) return;
        setDraft(value => applyStoryPresetChoice(value, current.ids, id));
    };

    const apply = async () => {
        setSaving(true);
        try { await onApply(draft); onClose(); }
        finally { setSaving(false); }
    };

    return <div className='absolute inset-0 z-40 bg-slate-950/35 flex items-end sm:items-center justify-center' onClick={onClose}>
        <section onClick={event => event.stopPropagation()} className='w-full max-w-xl max-h-[82%] rounded-t-[28px] sm:rounded-[28px] bg-stone-100 shadow-2xl flex flex-col overflow-hidden'>
            <header className='shrink-0 px-5 pt-5 pb-4 border-b border-slate-200'>
                <div className='flex items-center gap-3'><span className='w-9 h-9 rounded-full bg-slate-900 text-white grid place-items-center'><SlidersHorizontal size={17} /></span><div className='min-w-0 flex-1'><div className='text-[9px] tracking-[.2em] uppercase font-bold text-violet-500'>Quick preset</div><h2 className='text-sm font-bold truncate'>{document.name}</h2></div><button onClick={onClose} className='w-9 h-9 rounded-full grid place-items-center'><X size={18} /></button></div>
                <div className='mt-3 flex items-center justify-between text-[9px] text-slate-400'><span>仅覆盖本剧情，不修改预设库</span><span>当前预设约 {tokenEstimate.toLocaleString()} tokens</span></div>
            </header>

            <main className='flex-1 overflow-y-auto px-5 py-6'>
                {current ? <>
                    <div className='text-[9px] font-bold text-violet-500'>{page + 1} / {pages.length}</div>
                    <h3 className='mt-1 text-3xl font-serif font-semibold'>{current.label}</h3>
                    <p className='mt-2 text-[11px] leading-5 text-slate-500'>{current.hint}</p>
                    <div className='mt-6 border-y border-slate-200 divide-y divide-slate-200'>{current.options.map(option => {
                        const activeId = current.ids.find(id => draft.prompts.find(prompt => prompt.id === id)?.enabled);
                        const selected = option.id ? activeId === option.id : !activeId;
                        return <button key={option.id || 'default'} onClick={() => choose(option.id)} className='w-full py-3.5 flex items-center gap-3 text-left'><span className={`w-5 h-5 rounded-full border grid place-items-center ${selected ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-300 text-transparent'}`}><Check size={12} weight='bold' /></span><span className='text-xs font-semibold'>{option.label}</span></button>;
                    })}</div>
                </> : <div className='py-12 text-center text-xs text-slate-400'>这个预设没有可用于默认版的选项</div>}
            </main>

            <footer className='story-safe-sheet shrink-0 px-5 pt-3 border-t border-slate-200'>
                <div className='flex items-center justify-between'><button disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))} className='w-10 h-10 rounded-full border border-slate-200 bg-white grid place-items-center disabled:opacity-25'><CaretLeft size={17} /></button><div className='flex gap-1'>{pages.map((_item, index) => <button key={index} onClick={() => setPage(index)} className={`h-1.5 rounded-full transition-all ${index === page ? 'w-5 bg-violet-600' : 'w-1.5 bg-slate-300'}`} />)}</div><button disabled={page >= pages.length - 1} onClick={() => setPage(value => Math.min(pages.length - 1, value + 1))} className='w-10 h-10 rounded-full border border-slate-200 bg-white grid place-items-center disabled:opacity-25'><CaretRight size={17} /></button></div>
                <div className='mt-3 flex gap-2'>{hasOverride && <button onClick={async () => { await onReset(); onClose(); }} className='px-4 py-3 rounded-xl border border-slate-200 text-[10px] font-bold text-slate-500'>恢复原预设</button>}<button disabled={saving || !current} onClick={apply} className='flex-1 py-3 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-40'>{saving ? '应用中' : '应用到本剧情'}</button></div>
            </footer>
        </section>
    </div>;
};

export default StoryQuickPresetPanel;
