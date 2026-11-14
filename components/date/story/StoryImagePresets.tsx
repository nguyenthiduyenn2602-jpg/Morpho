import React, { useEffect, useState } from 'react';
import type { StoryTheaterImageConfig } from '../../../types';
import { useOS } from '../../../context/OSContext';
import { loadStoryImagePresets, saveStoryImagePreset, deleteStoryImagePreset, applyStoryImagePreset, type StoryImagePreset } from '../../../utils/storyImagePresets';
export default function StoryImagePresets({draft, actorIds, onChange}: {
    draft: StoryTheaterImageConfig; actorIds: string[]; onChange: (config: StoryTheaterImageConfig) => void;
}) {
    const { addToast } = useOS();
    const [presets, setPresets] = useState<StoryImagePreset[]>([]);
    const [selected, setSelected] = useState('');
    const [name, setName] = useState('');
    const [confirmAction, setConfirmAction] = useState<'update' | 'delete' | null>(null);
    const report = (error: unknown) => addToast(error instanceof Error ? error.message : '预设保存失败，请检查本地存储空间', 'error');
    useEffect(() => { try { setPresets(loadStoryImagePresets()); } catch (error) { report(error); } }, []);
    const save = (update = false) => {
        try {
            const next = saveStoryImagePreset(name, draft, update ? selected : undefined);
            setPresets(next); setSelected(next.find(p => p.name === name.trim())!.id); setName(name.trim()); setConfirmAction(null);
            addToast(update ? '预设已更新' : '配图预设已保存，可在其他剧情载入', 'success');
        } catch (error) { report(error); }
    };
    const remove = () => {
        try { setPresets(deleteStoryImagePreset(selected)); setSelected(''); setName(''); setConfirmAction(null); addToast('预设已删除，当前配图设置保留', 'success'); }
        catch (error) { report(error); }
    };
    const field = 'mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs';
    const button = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs disabled:opacity-40';
    return <section className='border-t border-slate-200 py-4'>
        <h3 className='text-sm font-semibold'>我的配图预设</h3>
        <p className='mt-1 text-[10px] leading-5 text-slate-500'>保存画师串、你与各角色的提示词、负面词和画幅，所有剧情共用。API 与自动配图开关保持当前设置。</p>
        <select aria-label='选择配图预设' className={field} value={selected} onChange={event => {
            const id = event.target.value; setSelected(id); setName(presets.find(p => p.id === id)?.name || ''); setConfirmAction(null);
        }}><option value=''>选择预设</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button type='button' className={button + ' mt-2 w-full'} disabled={!selected} onClick={() => {
            try {
                const preset = loadStoryImagePresets().find(p => p.id === selected);
                if (!preset) throw new Error('预设已不存在，请重新打开设置');
                onChange(applyStoryImagePreset(draft, preset, actorIds));
                const missing = actorIds.filter(id => !Object.prototype.hasOwnProperty.call(preset.config.characterAnchors,id)).length;
                addToast('预设已载入，请检查后保存配图设置' + (missing ? '；未匹配角色保留当前提示词' : ''), 'success');
            } catch (error) { report(error); }
        }}>载入到当前设置</button>
        <input aria-label='配图预设名称' maxLength={60} className={field} placeholder='自定义名称，例如：夜景约会 · 水彩' value={name} onChange={event => setName(event.target.value)} />
        <div className='mt-2 flex flex-wrap gap-2'>
            <button type='button' className={button} onClick={() => save()}>另存为新预设</button>
            <button type='button' className={button} disabled={!selected} onClick={() => setConfirmAction('update')}>更新所选预设</button>
            <button type='button' className={button + ' text-rose-600'} disabled={!selected} onClick={() => setConfirmAction('delete')}>删除</button>
        </div>
        {confirmAction && <div className='mt-2 rounded-xl bg-amber-50 p-3 text-xs'>
            <p>{confirmAction === 'delete' ? '确认删除' : '用当前填写的内容覆盖'}「{presets.find(p => p.id === selected)?.name}」？</p>
            <div className='mt-2 flex gap-2'><button type='button' className={button} onClick={() => confirmAction === 'delete' ? remove() : save(true)}>确认</button><button type='button' className={button} onClick={() => setConfirmAction(null)}>取消</button></div>
        </div>}
        <p className='mt-2 text-[10px] leading-5 text-slate-400'>角色按身份匹配；未匹配角色保留当前提示词。预设单独保存，载入后点击底部「保存配图设置」才应用到本剧情。</p>
    </section>;
}
