import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, CaretLeft, CaretRight, Check, FloppyDisk, GearSix, ImageSquare, PencilSimple, Plus, SkipBack, SkipForward, Sparkle, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { CharacterProfile } from '../types';
import { useBlobRefUrl } from '../utils/blobRef';
import {
    type CharacterHandbookEntry,
    type CharacterHandbookRun,
    type HandbookChibiPreset,
    type HandbookChibiSettings,
    DEFAULT_HANDBOOK_CHIBI_PRESET,
    generateAndSaveHandbookImages,
    generateCharacterHandbookText,
    loadCharacterHandbooks,
    loadHandbookChibiSettings,
    localDiaryDate,
    resolveHandbookChibiPreset,
    saveHandbookChibiSettings,
} from '../utils/characterHandbook';

type CoverConfig = {
    color: string;
    accent: string;
    fontColor?: string;
    backgroundImage?: string;
    title: string;
    subtitle: string;
    avatarX: number;
    avatarY: number;
    avatarSize: number;
};

const COVER_STORAGE_KEY = 'morpho_handbook_cover_v1';
const BOOK_COLORS = ['#cdd8c5', '#dacbbf', '#cbd7e2', '#d9cad9', '#ded4b9', '#c5d9d4'];
const ACCENT_COLORS = ['#4f6250', '#72594f', '#51677b', '#745873', '#74643f', '#466a64'];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const makeDefaultCover = (character: CharacterProfile, index: number): CoverConfig => ({
    color: BOOK_COLORS[index % BOOK_COLORS.length],
    accent: ACCENT_COLORS[index % ACCENT_COLORS.length],
    fontColor: ACCENT_COLORS[index % ACCENT_COLORS.length],
    title: character.name,
    subtitle: '日常手账',
    avatarX: 18,
    avatarY: 16,
    avatarSize: 54,
});

const loadCoverConfigs = (): Record<string, CoverConfig> => {
    try {
        const raw = localStorage.getItem(COVER_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const prepareCoverImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('图片格式不支持'));
        image.onload = () => {
            const maxSide = 1200;
            const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const context = canvas.getContext('2d');
            if (!context) return reject(new Error('图片处理失败'));
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.84));
        };
        image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
});

const Avatar: React.FC<{ character: CharacterProfile; size?: number }> = ({ character, size = 48 }) => (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white/55 text-sm font-semibold shadow-[0_4px_14px_rgba(61,53,45,0.10)]" style={{ width: size, height: size }}>
        {character.avatar ? <img src={character.avatar} alt="" draggable={false} className="h-full w-full object-cover" /> : <span>{character.name.slice(0, 1).toUpperCase()}</span>}
    </div>
);

const ChibiPortrait: React.FC<{ character: CharacterProfile; image?: string }> = ({ character, image }) => {
    const imageUrl = useBlobRefUrl(image);
    return (
        <div className="relative aspect-square w-full overflow-hidden rounded-[20px] border-[6px] border-white bg-white shadow-[0_10px_24px_rgba(69,55,47,0.18)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_68%,rgba(236,218,211,.6),transparent_48%)]" />
            {imageUrl ? (
                <img src={imageUrl} alt={`${character.name}的Q版手账贴图`} draggable={false} className="relative z-10 h-full w-full object-cover" />
            ) : character.avatar ? (
                <img src={character.avatar} alt="" draggable={false} className="relative z-10 h-full w-full object-contain p-3 opacity-55" />
            ) : (
                <div className="relative z-10 grid h-full place-items-center text-[42px] font-semibold text-[#87766e]">{character.name.slice(0, 1).toUpperCase()}</div>
            )}
            {!imageUrl && <span className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-2 py-1 text-[8px] tracking-[0.08em] text-[#756b62] shadow-sm">等待Q版贴图</span>}
        </div>
    );
};

const CensoredText: React.FC<{ text: string }> = ({ text }) => {
    const [revealed, setRevealed] = useState(false);
    return (
        <button
            type="button"
            onClick={() => setRevealed(value => !value)}
            aria-label={revealed ? '重新涂黑内容' : '点击查看涂黑内容'}
            className={`mx-0.5 inline rounded-[3px] px-1 py-0.5 text-[11px] transition-colors ${revealed ? 'bg-[#ddd2c6] text-[#554a42]' : 'bg-[#292724] text-transparent shadow-[inset_0_-2px_0_rgba(255,255,255,.1)]'}`}
        >
            {text}
        </button>
    );
};

const RichRun: React.FC<{ run: CharacterHandbookRun }> = ({ run }) => {
    const style = run.style || 'normal';
    if (style === 'censored') return <CensoredText text={run.text} />;
    const className = style === 'highlight' ? 'mx-0.5 rounded-sm bg-[#f7e36f]/70 px-1'
        : style === 'wave' ? 'mx-0.5 underline decoration-[#8db7c8] decoration-wavy underline-offset-4'
        : style === 'strike' ? 'mx-0.5 line-through decoration-[#cf7d91] decoration-2'
        : style === 'emphasis' ? 'font-bold text-[#b85879]'
        : style === 'handwritten' ? 'text-[13px] italic text-[#5d5249]'
        : style === 'messy' ? 'inline-block rotate-[-1deg] text-[13px] italic text-[#855b6b]'
        : '';
    return <span className={className}>{run.text}</span>;
};

const DiaryCopy: React.FC<{ entry: CharacterHandbookEntry }> = ({ entry }) => (
    <div className="space-y-2.5 text-[12px] leading-[1.72]">
        {entry.paragraphs.map((paragraph, index) => (
            <p key={index} className={index >= Math.max(2, entry.paragraphs.length - 2) ? 'pr-[44%]' : ''}>
                {paragraph.runs.map((run, runIndex) => <RichRun key={runIndex} run={run} />)}
            </p>
        ))}
    </div>
);

const BookCover: React.FC<{
    character: CharacterProfile;
    config: CoverConfig;
    editing?: boolean;
    onAvatarMove?: (x: number, y: number) => void;
    onAvatarResize?: (size: number) => void;
}> = ({ character, config, editing = false, onAvatarMove, onAvatarResize }) => {
    const coverRef = useRef<HTMLDivElement>(null);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const pinchStart = useRef<{ distance: number; size: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const moveAvatar = (event: React.PointerEvent) => {
        if (!editing || !pointers.current.has(event.pointerId) || !coverRef.current) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const activePointers = Array.from(pointers.current.values());
        if (activePointers.length >= 2 && onAvatarResize) {
            const [first, second] = activePointers;
            const distance = Math.hypot(second.x - first.x, second.y - first.y);
            if (!pinchStart.current) pinchStart.current = { distance, size: config.avatarSize };
            onAvatarResize(clamp(pinchStart.current.size * (distance / Math.max(1, pinchStart.current.distance)), 36, 116));
            return;
        }
        if (!onAvatarMove) return;
        const rect = coverRef.current.getBoundingClientRect();
        const rawX = clamp(((event.clientX - rect.left) / rect.width) * 100, 8, 92);
        const rawY = clamp(((event.clientY - rect.top) / rect.height) * 100, 8, 75);
        onAvatarMove(
            Math.abs(rawX - 50) < 3 ? 50 : rawX,
            Math.abs(rawY - 50) < 3 ? 50 : rawY,
        );
    };

    const releasePointer = (event: React.PointerEvent) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) pinchStart.current = null;
        if (pointers.current.size === 0) setDragging(false);
    };

    return (
        <div
            ref={coverRef}
            className={`handbook-cover relative h-full w-full overflow-hidden rounded-[24px] ${editing ? 'touch-none ring-2 ring-white/90' : ''}`}
            style={{
                backgroundColor: config.color,
                color: config.accent,
                backgroundImage: config.backgroundImage ? `linear-gradient(180deg, rgba(255,255,255,.08), rgba(35,28,23,.12)), url(${config.backgroundImage})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
            }}
            onPointerMove={moveAvatar}
            onPointerUp={releasePointer}
            onPointerCancel={releasePointer}
        >
            <div className="absolute inset-y-0 left-0 w-[10px] bg-black/[0.045]" />
            <div className="absolute inset-y-6 left-[15px] border-l border-dashed border-white/35" />
            <div className="absolute -right-9 -top-8 h-36 w-36 rounded-full bg-white/15" />
            <div className="absolute bottom-16 right-5 h-12 w-12 rotate-12 rounded-[18px] border border-white/25" />
            {editing && dragging && (
                <>
                    <div className={`pointer-events-none absolute inset-y-0 left-1/2 z-20 border-l ${config.avatarX === 50 ? 'border-[#fff] shadow-[0_0_4px_rgba(65,55,45,.35)]' : 'border-white/55'} border-dashed`} />
                    <div className={`pointer-events-none absolute inset-x-0 top-1/2 z-20 border-t ${config.avatarY === 50 ? 'border-[#fff] shadow-[0_0_4px_rgba(65,55,45,.35)]' : 'border-white/55'} border-dashed`} />
                </>
            )}
            <div
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${editing ? 'cursor-grab ring-2 ring-white ring-offset-2 ring-offset-transparent active:cursor-grabbing' : ''}`}
                style={{ left: `${config.avatarX}%`, top: `${config.avatarY}%` }}
                onPointerDown={(event) => {
                    if (!editing) return;
                    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                    setDragging(true);
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
            >
                <Avatar character={character} size={config.avatarSize} />
                {editing && <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#4a4640] px-2 py-1 text-[9px] font-medium text-white shadow">拖动头像</span>}
            </div>
            <div className="absolute bottom-7 left-7 right-6" style={{ color: config.fontColor || config.accent }}>
                <div className="truncate text-[21px] font-semibold tracking-[0.04em]">{config.title}</div>
                <div className="mt-1 text-[11px] tracking-[0.18em] opacity-75">{config.subtitle}</div>
                <div className="mt-4 h-px w-12 bg-current opacity-25" />
            </div>
        </div>
    );
};

const HandbookDiaryPage: React.FC<{
    character: CharacterProfile;
    entry: CharacterHandbookEntry;
    revealStep?: number;
    generating?: boolean;
    regeneratingPart?: 'text' | 'still' | 'chibi' | null;
    onRegenerate: (kind: 'text' | 'still' | 'chibi') => void;
}> = ({ character, entry, revealStep = 4, generating = false, regeneratingPart = null, onRegenerate }) => {
    const stillUrl = useBlobRefUrl(entry.stillImage);
    const dateParts = entry.date.split('-');
    return (
        <article className="handbook-paper relative h-full overflow-hidden rounded-[22px] border border-[#e6dccd] bg-[#fffaf0] px-7 pb-7 pt-8 text-[#4b433b] shadow-[0_18px_45px_rgba(80,65,50,0.12)]">
            <div className="absolute left-7 top-0 h-7 w-16 -rotate-2 bg-[#f6d88c]/70" />
            <header className="relative z-10 grid grid-cols-[.92fr_1.08fr] items-start gap-3">
                <div className={`pt-1 transition-all duration-700 ${revealStep >= 1 ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
                    <div className="text-[26px] font-semibold tracking-tight">{Number(dateParts[1])}月{Number(dateParts[2])}日</div>
                    <div className="mt-1 text-[12px] text-[#71695f]">{entry.weather.emoji} {entry.weather.description}{entry.weather.temp == null ? '' : ` / ${entry.weather.temp}℃`}</div>
                    <div className="mt-3 inline-flex rounded-full bg-[#efd7df] px-3 py-1 text-[10px] text-[#7c5463]">心情 · {entry.mood}</div>
                    <div className="mt-3 text-[9px] tracking-[0.14em] text-[#a09387]">日常随笔</div>
                </div>
                <div className={`relative aspect-[4/3] overflow-hidden rounded-[14px] bg-gradient-to-br from-[#c9d4c7] via-[#ede4d2] to-[#d3b9aa] shadow-inner transition-all duration-700 ${revealStep >= 2 ? 'scale-100 opacity-100' : 'scale-[.94] opacity-0'}`}>
                    {stillUrl ? <img src={stillUrl} alt="手账静物横图" className="h-full w-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-[9px] tracking-[0.12em] text-[#746d65]"><ImageSquare size={20} className="mb-1" />等待静物图</div>}
                </div>
            </header>
            <div className={`relative z-10 mt-4 transition-all duration-700 ${revealStep >= 3 ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}><DiaryCopy entry={entry} /></div>
            <div className={`absolute bottom-5 right-4 w-[42%] rotate-[2.5deg] transition-all duration-700 ${revealStep >= 4 ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}><ChibiPortrait character={character} image={entry.chibiImage} /></div>
            <div className="absolute bottom-12 left-7 text-[10px] tracking-[0.14em] text-[#9b9186]">— {character.name}</div>
            <div className="absolute bottom-3 left-4 z-30 flex gap-1">
                {([['text', '文字'], ['still', '图片1'], ['chibi', '图片2']] as const).map(([kind, label]) => (
                    <button key={kind} type="button" disabled={Boolean(regeneratingPart) || generating} onClick={() => onRegenerate(kind)} className="flex items-center gap-0.5 rounded-full border border-[#ded3c4] bg-[#fffaf0]/90 px-2 py-1 text-[8px] text-[#82776c] shadow-sm backdrop-blur disabled:opacity-45" aria-label={`重新生成${label}`}>
                        <ArrowClockwise size={9} className={regeneratingPart === kind ? 'animate-spin' : ''} />{regeneratingPart === kind ? '生成中' : label}
                    </button>
                ))}
            </div>
            {generating && (
                <div className="absolute inset-x-0 bottom-5 z-30 flex justify-center">
                    <div className="flex items-center gap-2 rounded-full bg-[#575f50] px-5 py-2.5 text-[10px] tracking-[0.08em] text-white shadow-[0_8px_22px_rgba(70,78,64,.24)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />{entry.imageStatus === 'generating' ? '正在绘制手账贴图' : '正在生成今日手账'}</div>
                </div>
            )}
        </article>
    );
};

const EmptyGeneratingPage: React.FC = () => (
    <div className="handbook-paper relative h-full overflow-hidden rounded-[22px] border border-[#e6dccd] bg-[#fffaf0] shadow-[0_18px_45px_rgba(80,65,50,0.12)]">
        <div className="absolute inset-x-0 bottom-5 flex justify-center"><div className="flex items-center gap-2 rounded-full bg-[#575f50] px-5 py-2.5 text-[10px] tracking-[0.08em] text-white shadow-[0_8px_22px_rgba(70,78,64,.24)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />正在整理今天的回忆</div></div>
    </div>
);

const EndPage: React.FC<{ onGenerate: (regenerate: boolean) => void }> = ({ onGenerate }) => (
    <div className="handbook-paper relative flex h-full flex-col items-center justify-center overflow-hidden rounded-[22px] border border-[#e6dccd] bg-[#fffaf0] px-8 text-center text-[#514a42] shadow-[0_18px_45px_rgba(80,65,50,0.12)]">
        <div className="absolute left-8 right-8 top-11 border-t border-dashed border-[#d9cdbd]" />
        <Sparkle size={25} weight="duotone" className="mb-4 text-[#c49786]" />
        <h2 className="text-[18px] font-semibold">这是目前最后一页</h2>
        <p className="mt-2 max-w-[230px] text-[11px] leading-5 text-[#8b8176]">今天的新故事会从一张空白纸开始，再一页页浮现。</p>
        <div className="mt-7 grid w-full grid-cols-2 gap-2">
            <button type="button" onClick={() => onGenerate(true)} className="flex items-center justify-center gap-1.5 rounded-full border border-[#d9cdbd] px-3 py-3 text-[10px] active:bg-black/[0.03]"><ArrowClockwise size={13} /> 重新生成</button>
            <button type="button" onClick={() => onGenerate(false)} className="rounded-full bg-[#575f50] px-3 py-3 text-[10px] font-semibold tracking-[0.06em] text-white shadow-[0_8px_20px_rgba(69,78,61,0.18)] active:scale-[0.98]">查看今日手账</button>
        </div>
        <p className="absolute bottom-7 text-[9px] tracking-[0.14em] text-[#aaa095]">不会在打开时自动调用 API</p>
    </div>
);

const ChibiSettingsPanel: React.FC<{
    initial: HandbookChibiSettings;
    characters: CharacterProfile[];
    onClose: () => void;
    onSave: (settings: HandbookChibiSettings) => Promise<void>;
}> = ({ initial, characters, onClose, onSave }) => {
    const [draft, setDraft] = useState<HandbookChibiSettings>(() => ({
        selectedPresetId: initial.selectedPresetId,
        customPresets: initial.customPresets.map(preset => ({ ...preset })),
        characterAnchors: Object.fromEntries(Object.entries(initial.characterAnchors || {}).map(([charId, anchor]) => [charId, { ...anchor }])),
    }));
    const [saving, setSaving] = useState(false);
    const presets = [DEFAULT_HANDBOOK_CHIBI_PRESET, ...draft.customPresets];
    const selected = resolveHandbookChibiPreset(draft);
    const readOnly = selected.builtIn === true;

    const updateSelected = (patch: Partial<HandbookChibiPreset>) => {
        if (readOnly) return;
        setDraft(current => ({
            ...current,
            customPresets: current.customPresets.map(preset => preset.id === current.selectedPresetId ? { ...preset, ...patch } : preset),
        }));
    };
    const createPreset = () => {
        const id = `handbook-chibi-${Date.now()}`;
        const copy: HandbookChibiPreset = {
            ...selected,
            id,
            name: `${selected.name} · 自定义`,
            builtIn: false,
        };
        setDraft(current => ({ ...current, selectedPresetId: id, customPresets: [...current.customPresets, copy] }));
    };
    const removePreset = () => {
        if (readOnly) return;
        setDraft(current => ({
            ...current,
            selectedPresetId: DEFAULT_HANDBOOK_CHIBI_PRESET.id,
            customPresets: current.customPresets.filter(preset => preset.id !== current.selectedPresetId),
        }));
    };
    const save = async () => {
        setSaving(true);
        try { await onSave(draft); } finally { setSaving(false); }
    };

    const fieldClass = 'mt-1.5 w-full rounded-2xl border border-[#ded7ce] bg-white/80 px-3 py-2.5 text-[11px] text-[#5a5149] outline-none disabled:bg-[#eeeae3] disabled:text-[#918981]';
    return (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/25 backdrop-blur-[2px]" onClick={onClose}>
            <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-[#f6f2eb] shadow-2xl" onClick={event => event.stopPropagation()}>
                <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e1dbd1] bg-[#f8f5f0]/95 px-5 py-4 backdrop-blur">
                    <div><h2 className="flex items-center gap-2 text-[16px] font-semibold"><GearSix size={18} /> Q版生图设置</h2><p className="mt-1 text-[10px] text-[#958b80]">手账本独立配置 · 不修改角色原画师串</p></div>
                    <button type="button" onClick={onClose} aria-label="关闭Q版设置" className="grid h-9 w-9 place-items-center rounded-full bg-white/70"><X size={16} /></button>
                </header>
                <div className="space-y-4 p-5" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 1.5rem)' }}>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-800">
                        如果你不知道这些参数是什么，请不要修改。默认预设为只读；需要换画师串时请先“新建预设”。
                    </div>
                    <section className="space-y-3 rounded-3xl bg-white/75 p-4 shadow-sm ring-1 ring-[#e7e0d7]">
                        <label className="block text-[10px] font-semibold text-[#766d64]">当前预设
                            <select className={fieldClass} value={draft.selectedPresetId} onChange={event => setDraft(current => ({ ...current, selectedPresetId: event.target.value }))}>
                                {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}{preset.builtIn ? '（默认）' : ''}</option>)}
                            </select>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={createPreset} className="flex items-center justify-center gap-1.5 rounded-2xl border border-[#d8cfc4] bg-white py-2.5 text-[11px]"><Plus size={14} /> 新建预设</button>
                            <button type="button" disabled={readOnly} onClick={removePreset} className="flex items-center justify-center gap-1.5 rounded-2xl border border-[#e1cfd0] bg-white py-2.5 text-[11px] text-[#a2676b] disabled:opacity-35"><Trash size={14} /> 删除当前预设</button>
                        </div>
                    </section>
                    <section className="space-y-3 rounded-3xl bg-white/75 p-4 shadow-sm ring-1 ring-[#e7e0d7]">
                        <label className="block text-[10px] font-semibold text-[#766d64]">预设名称<input disabled={readOnly} className={fieldClass} value={selected.name} onChange={event => updateSelected({ name: event.target.value })} /></label>
                        <label className="block text-[10px] font-semibold text-[#766d64]">Q版画师串 / 正向标签<textarea disabled={readOnly} className={`${fieldClass} min-h-36 resize-y leading-5`} value={selected.styleTags} onChange={event => updateSelected({ styleTags: event.target.value })} /></label>
                        <label className="block text-[10px] font-semibold text-[#766d64]">负面标签<textarea disabled={readOnly} className={`${fieldClass} min-h-40 resize-y leading-5`} value={selected.negativeTags} onChange={event => updateSelected({ negativeTags: event.target.value })} /></label>
                        <div className="grid grid-cols-3 gap-2">
                            <label className="block text-[10px] font-semibold text-[#766d64]">引导值<input disabled={readOnly} type="number" min="1" max="20" step="0.5" className={fieldClass} value={selected.scale} onChange={event => updateSelected({ scale: Number(event.target.value) })} /></label>
                            <label className="block text-[10px] font-semibold text-[#766d64]">步数<input disabled={readOnly} type="number" min="1" max="50" step="1" className={fieldClass} value={selected.steps} onChange={event => updateSelected({ steps: Number(event.target.value) })} /></label>
                            <label className="block text-[10px] font-semibold text-[#766d64]">采样器<select disabled={readOnly} className={`${fieldClass} px-2`} value={selected.sampler} onChange={event => updateSelected({ sampler: event.target.value })}><option value="k_euler_ancestral">Euler a</option><option value="k_euler">Euler</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_dpmpp_sde">DPM++ SDE</option></select></label>
                        </div>
                        <p className="text-[10px] leading-5 text-[#998f84]">Q版固定使用 1024×1024（1:1 方图）。画师预设只控制共同画风。</p>
                    </section>
                    <section className="space-y-3 rounded-3xl bg-white/75 p-4 shadow-sm ring-1 ring-[#e7e0d7]">
                        <div><h3 className="text-[11px] font-semibold text-[#6d645b]">每本手账的Q版人物锚点</h3><p className="mt-1 text-[9px] leading-4 text-[#998f84]">各角色独立保存。生成时只使用这里的锚点、参考图、上方画师预设和当日心情。</p></div>
                        {characters.map(character => {
                            const anchor = draft.characterAnchors[character.id] || { characterTags: '', referenceImageUrl: '' };
                            const updateAnchor = (patch: Partial<typeof anchor>) => setDraft(current => ({ ...current, characterAnchors: { ...current.characterAnchors, [character.id]: { ...(current.characterAnchors[character.id] || { characterTags: '', referenceImageUrl: '' }), ...patch } } }));
                            return <div key={character.id} className="rounded-2xl border border-[#e5ddd3] bg-[#faf8f4] p-3">
                                <div className="text-[11px] font-semibold text-[#625950]">{character.name}</div>
                                <label className="mt-2 block text-[10px] font-semibold text-[#766d64]">Q版人物锚点提示词<textarea className={`${fieldClass} min-h-24 resize-y leading-5`} value={anchor.characterTags} onChange={event => updateAnchor({ characterTags: event.target.value })} placeholder="发型、发色、眼睛、服装等固定人物特征" /></label>
                                <label className="mt-2 block text-[10px] font-semibold text-[#766d64]">Q版参考图 URL<input type="url" className={fieldClass} value={anchor.referenceImageUrl} onChange={event => updateAnchor({ referenceImageUrl: event.target.value })} placeholder="https://…（允许外链读取的图片直链）" /></label>
                            </div>;
                        })}
                    </section>
                    <button type="button" disabled={saving} onClick={() => void save()} className="w-full rounded-2xl bg-[#596151] py-3.5 text-[12px] font-semibold text-white disabled:opacity-50">{saving ? '保存中…' : '保存Q版设置'}</button>
                </div>
            </div>
        </div>
    );
};

const HandbookApp: React.FC = () => {
    const { closeApp, characters, groups, userProfile, apiConfig, realtimeConfig, addToast, showError } = useOS();
    const [openCharacterId, setOpenCharacterId] = useState<string | null>(null);
    const [coverConfigs, setCoverConfigs] = useState<Record<string, CoverConfig>>(loadCoverConfigs);
    const [draftCover, setDraftCover] = useState<CoverConfig | null>(null);
    const [pageIndex, setPageIndex] = useState(0);
    const [direction, setDirection] = useState<'next' | 'prev'>('next');
    const [generationState, setGenerationState] = useState<'idle' | 'generating'>('idle');
    const [revealStep, setRevealStep] = useState(0);
    const [entries, setEntries] = useState<CharacterHandbookEntry[]>([]);
    const [loadingEntries, setLoadingEntries] = useState(false);
    const [chibiSettingsOpen, setChibiSettingsOpen] = useState(false);
    const [chibiSettings, setChibiSettings] = useState<HandbookChibiSettings>({ selectedPresetId: DEFAULT_HANDBOOK_CHIBI_PRESET.id, customPresets: [], characterAnchors: {} });
    const [regeneratingPart, setRegeneratingPart] = useState<'text' | 'still' | 'chibi' | null>(null);

    const notebooks = useMemo(() => characters.map((character, index) => ({ character, config: coverConfigs[character.id] ?? makeDefaultCover(character, index) })), [characters, coverConfigs]);
    const openNotebook = notebooks.find(item => item.character.id === openCharacterId) ?? null;
    const today = localDiaryDate();
    const hasGeneratingSlot = generationState === 'generating' && !entries.some(entry => entry.date === today);
    const pageCount = entries.length + 2 + (hasGeneratingSlot ? 1 : 0);

    useEffect(() => {
        try { localStorage.setItem(COVER_STORAGE_KEY, JSON.stringify(coverConfigs)); } catch { /* ignore */ }
    }, [coverConfigs]);

    useEffect(() => {
        loadHandbookChibiSettings().then(setChibiSettings).catch(error => console.warn('[Handbook] chibi settings load failed:', error));
    }, []);

    const openChibiSettings = async () => {
        setChibiSettings(await loadHandbookChibiSettings());
        setChibiSettingsOpen(true);
    };
    const persistChibiSettings = async (settings: HandbookChibiSettings) => {
        try {
            const saved = await saveHandbookChibiSettings(settings);
            setChibiSettings(saved);
            setChibiSettingsOpen(false);
            addToast('手账Q版生图设置已保存', 'success');
        } catch (error) {
            showError('保存Q版设置失败', error instanceof Error ? error.message : String(error));
        }
    };

    useEffect(() => {
        if (!openCharacterId) {
            setEntries([]);
            return;
        }
        let alive = true;
        setLoadingEntries(true);
        loadCharacterHandbooks(openCharacterId)
            .then(value => { if (alive) setEntries(value); })
            .catch(error => { if (alive) console.warn('[Handbook] load failed:', error); })
            .finally(() => { if (alive) setLoadingEntries(false); });
        return () => { alive = false; };
    }, [openCharacterId]);

    useEffect(() => {
        if (pageIndex > pageCount - 1) setPageIndex(Math.max(0, pageCount - 1));
    }, [pageCount, pageIndex]);

    const goToPage = (next: number) => {
        const safeNext = clamp(next, 0, pageCount - 1);
        setDirection(safeNext >= pageIndex ? 'next' : 'prev');
        setPageIndex(safeNext);
    };
    const beginEditCover = () => { if (openNotebook) setDraftCover({ ...openNotebook.config }); };
    const saveCover = () => {
        if (!openNotebook || !draftCover) return;
        setCoverConfigs(previous => ({ ...previous, [openNotebook.character.id]: draftCover }));
        setDraftCover(null);
    };
    const uploadCoverImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !file.type.startsWith('image/')) return;
        try {
            const backgroundImage = await prepareCoverImage(file);
            setDraftCover(current => current ? ({ ...current, backgroundImage }) : current);
        } catch (error) {
            console.warn('[Handbook] Cover image unavailable:', error);
        }
    };
    const showTodayPage = async (regenerate: boolean) => {
        if (!openNotebook || generationState === 'generating') return;
        const existingIndex = entries.findIndex(entry => entry.date === today);
        if (!regenerate && existingIndex >= 0) {
            goToPage(existingIndex + 1);
            return;
        }

        const remaining = entries.filter(entry => entry.date !== today);
        setEntries(remaining);
        setGenerationState('generating');
        setRevealStep(0);
        setDirection('next');
        setPageIndex(remaining.length + 1);
        try {
            const entry = await generateCharacterHandbookText({
                char: openNotebook.character,
                characters,
                groups,
                userProfile,
                apiConfig,
                realtimeConfig,
            });
            const insertEntry = (next: CharacterHandbookEntry) => {
                setEntries(previous => [...previous.filter(item => item.id !== next.id), next].sort((a, b) => a.date.localeCompare(b.date)));
            };
            insertEntry(entry);
            setRevealStep(1);
            window.setTimeout(() => setRevealStep(previous => Math.max(previous, 3)), 380);
            const finished = await generateAndSaveHandbookImages(entry, openNotebook.character, apiConfig, updated => {
                insertEntry(updated);
                setRevealStep(updated.chibiImage ? 4 : updated.stillImage ? 3 : 2);
            });
            insertEntry(finished);
            setRevealStep(4);
            if (finished.imageStatus === 'ready') addToast('今日手账和两张贴图已生成，并保存到角色相册', 'success');
            else if (finished.imageStatus === 'partial') addToast('手账已生成，部分贴图失败；成功图片已保存到角色相册', 'info');
            else if (finished.imageStatus === 'failed') addToast('手账正文已保存，但两张贴图生成失败', 'info');
            else addToast('今日手账已生成', 'success');
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            showError('手账生成失败', details);
            setEntries(remaining);
            setPageIndex(remaining.length + 1);
        } finally {
            setGenerationState('idle');
        }
    };

    const regenerateEntryPart = async (entry: CharacterHandbookEntry, kind: 'text' | 'still' | 'chibi') => {
        if (!openNotebook || generationState === 'generating' || regeneratingPart) return;
        const insertEntry = (next: CharacterHandbookEntry) => {
            setEntries(previous => [...previous.filter(item => item.id !== next.id), next].sort((a, b) => a.date.localeCompare(b.date)));
        };
        setRegeneratingPart(kind);
        try {
            if (kind === 'text') {
                const replacement = await generateCharacterHandbookText({ char: openNotebook.character, characters, groups, userProfile, apiConfig, realtimeConfig, existingEntry: entry });
                insertEntry(replacement);
                addToast('这页手账文字已重新生成', 'success');
            } else {
                const replacement = await generateAndSaveHandbookImages(entry, openNotebook.character, apiConfig, insertEntry, [kind]);
                insertEntry(replacement);
                const previousImage = kind === 'still' ? entry.stillImage : entry.chibiImage;
                const nextImage = kind === 'still' ? replacement.stillImage : replacement.chibiImage;
                if (!nextImage || nextImage === previousImage) addToast(`${kind === 'still' ? '图片1' : '图片2'}重新生成未完成，原图已保留`, 'info');
                else addToast(`${kind === 'still' ? '图片1' : '图片2'}已重新生成并保存到角色相册`, 'success');
            }
        } catch (error) {
            showError('重新生成失败', error instanceof Error ? error.message : String(error));
        } finally {
            setRegeneratingPart(null);
        }
    };

    if (openNotebook) {
        const activeCover = draftCover ?? openNotebook.config;
        const visibleEntry = pageIndex >= 1 && pageIndex <= entries.length ? entries[pageIndex - 1] : null;
        const blankGeneratingPage = hasGeneratingSlot && pageIndex === entries.length + 1;
        return (
            <div className="flex h-full w-full flex-col overflow-hidden bg-[#f2efe9] text-[#45413b]">
                <style>{`
                    @keyframes handbook-page-next { from { opacity: .25; transform: translateX(22px) rotateY(-4deg); } to { opacity: 1; transform: none; } }
                    @keyframes handbook-page-prev { from { opacity: .25; transform: translateX(-22px) rotateY(4deg); } to { opacity: 1; transform: none; } }
                    .handbook-page-next { animation: handbook-page-next .28s cubic-bezier(.2,.8,.2,1); }
                    .handbook-page-prev { animation: handbook-page-prev .28s cubic-bezier(.2,.8,.2,1); }
                    .handbook-paper { background-image: radial-gradient(rgba(92,75,58,.055) .7px, transparent .7px); background-size: 5px 5px; }
                    .handbook-cover { box-shadow: inset 8px 0 14px rgba(56,48,40,.06), 0 20px 45px rgba(67,55,44,.16); }
                `}</style>
                <header className="shrink-0 border-b border-[#ded9d0] bg-[#f5f2ed]/95" style={{ paddingTop: 'var(--chrome-top, 0px)' }}>
                    <div className="flex h-14 items-center gap-2 px-3">
                        <button type="button" onClick={() => { setOpenCharacterId(null); setDraftCover(null); }} aria-label="返回手账本列表" className="grid h-9 w-9 place-items-center rounded-full text-[#625d55] active:bg-black/5"><CaretLeft size={20} weight="bold" /></button>
                        <div className="min-w-0 flex-1">
                            <h1 className="truncate text-[15px] font-semibold">{openNotebook.character.name}的手账本</h1>
                            <p className="text-[10px] text-[#8b857b]">第 {pageIndex + 1} 页 · 共 {pageCount} 页</p>
                        </div>
                        {pageIndex === 0 && !draftCover && <button type="button" onClick={beginEditCover} className="flex items-center gap-1 rounded-full bg-white/70 px-3 py-2 text-[10px] shadow-sm active:scale-[0.98]"><PencilSimple size={13} /> 编辑封面</button>}
                        {draftCover && <div className="flex gap-1"><button type="button" onClick={() => setDraftCover(null)} aria-label="取消编辑" className="grid h-8 w-8 place-items-center rounded-full bg-white/65"><X size={15} /></button><button type="button" onClick={saveCover} aria-label="保存封面" className="grid h-8 w-8 place-items-center rounded-full bg-[#596151] text-white"><Check size={15} weight="bold" /></button></div>}
                        <button type="button" onClick={() => void openChibiSettings()} aria-label="Q版生图设置" className="grid h-9 w-9 place-items-center rounded-full text-[#625d55] active:bg-black/5"><GearSix size={18} /></button>
                    </div>
                </header>

                <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-6" style={{ containerType: 'size' }}>
                    <div
                        key={`${pageIndex}-${direction}`}
                        className={`shrink-0 ${direction === 'next' ? 'handbook-page-next' : 'handbook-page-prev'}`}
                        style={{
                            // 在 B 系纸张基础上略微加长，给 3～5 段正文与贴图留出更舒展的纵向空间。
                            aspectRatio: '1 / 1.55',
                            width: 'min(370px, calc(100cqw - 2.5rem), calc((100cqh - 3rem) / 1.55))',
                        }}
                    >
                        {pageIndex === 0 && <BookCover character={openNotebook.character} config={activeCover} editing={Boolean(draftCover)} onAvatarMove={(avatarX, avatarY) => setDraftCover(current => current ? ({ ...current, avatarX, avatarY }) : current)} onAvatarResize={(avatarSize) => setDraftCover(current => current ? ({ ...current, avatarSize }) : current)} />}
                        {visibleEntry && <HandbookDiaryPage character={openNotebook.character} entry={visibleEntry} revealStep={visibleEntry.date === today && generationState === 'generating' ? revealStep : 4} generating={visibleEntry.date === today && generationState === 'generating'} regeneratingPart={regeneratingPart} onRegenerate={kind => void regenerateEntryPart(visibleEntry, kind)} />}
                        {blankGeneratingPage && <EmptyGeneratingPage />}
                        {!loadingEntries && pageIndex === pageCount - 1 && <EndPage onGenerate={showTodayPage} />}
                        {loadingEntries && pageIndex > 0 && <div className="handbook-paper grid h-full place-items-center rounded-[22px] border border-[#e6dccd] bg-[#fffaf0] text-[11px] text-[#8b8176]">正在翻开手账……</div>}
                    </div>

                    {draftCover && (
                        <div className="absolute inset-x-5 bottom-5 z-20 rounded-[20px] border border-white/70 bg-[#f8f5f0]/95 p-4 shadow-[0_14px_40px_rgba(65,55,46,0.22)] backdrop-blur">
                            <div className="flex items-center justify-between"><span className="text-[11px] font-semibold">封面设计</span><span className="text-[9px] text-[#938a80]">拖动封面上的头像</span></div>
                            <div className="mt-3 flex gap-2">
                                {BOOK_COLORS.map((color, index) => <button key={color} type="button" aria-label={`封面颜色 ${index + 1}`} onClick={() => setDraftCover(current => current ? ({ ...current, color, accent: ACCENT_COLORS[index], fontColor: ACCENT_COLORS[index] }) : current)} className={`h-7 flex-1 rounded-full ${draftCover.color === color ? 'ring-2 ring-[#5e5a53] ring-offset-2' : ''}`} style={{ backgroundColor: color }} />)}
                            </div>
                            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#ded7ce] bg-white/55 px-3 py-2">
                                <span className="text-[10px] font-medium text-[#756c63]">封面字体颜色</span>
                                <input type="color" value={draftCover.fontColor || draftCover.accent} onChange={event => setDraftCover({ ...draftCover, fontColor: event.target.value })} className="ml-auto h-7 w-10 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="封面字体颜色" />
                                <span className="font-mono text-[9px] uppercase text-[#958b80]">{draftCover.fontColor || draftCover.accent}</span>
                            </div>
                            <div className="mt-3 flex items-center gap-2">
                                <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#ded7ce] bg-white/65 px-3 py-2 text-[10px] active:bg-white">
                                    <UploadSimple size={13} /> 上传封面图片
                                    <input type="file" accept="image/*" onChange={uploadCoverImage} className="hidden" />
                                </label>
                                {draftCover.backgroundImage && <button type="button" onClick={() => setDraftCover({ ...draftCover, backgroundImage: undefined })} className="grid h-8 w-8 place-items-center rounded-xl border border-[#ded7ce] bg-white/65" aria-label="移除封面图片"><Trash size={13} /></button>}
                                <div className="ml-auto flex min-w-0 flex-1 items-center gap-2 pl-1">
                                    <span className="shrink-0 text-[9px] text-[#8e857b]">头像大小</span>
                                    <input type="range" min="36" max="116" value={draftCover.avatarSize} onChange={event => setDraftCover({ ...draftCover, avatarSize: Number(event.target.value) })} className="h-1 min-w-0 flex-1 accent-[#596151]" aria-label="头像大小" />
                                </div>
                            </div>
                            <p className="mt-2 text-[9px] text-[#9b9288]">拖动时会出现中心定位线；触屏设备可在头像上双指等比缩放。</p>
                            <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                                <input value={draftCover.title} onChange={event => setDraftCover({ ...draftCover, title: event.target.value })} maxLength={16} className="min-w-0 rounded-xl border border-[#ded7ce] bg-white/70 px-3 py-2 text-[11px] outline-none" placeholder="手账标题" />
                                <input value={draftCover.subtitle} onChange={event => setDraftCover({ ...draftCover, subtitle: event.target.value })} maxLength={18} className="min-w-0 rounded-xl border border-[#ded7ce] bg-white/70 px-3 py-2 text-[11px] outline-none" placeholder="副标题" />
                                <button type="button" onClick={saveCover} className="flex items-center gap-1 rounded-xl bg-[#596151] px-3 text-[10px] text-white"><FloppyDisk size={13} /> 保存</button>
                            </div>
                        </div>
                    )}
                </main>

                {!draftCover && (
                    <nav className="flex min-h-[72px] shrink-0 items-start justify-between border-t border-[#ddd7ce] bg-[#f7f4ef] px-4 pt-3" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 0.75rem)' }}>
                        <button type="button" onClick={() => goToPage(0)} disabled={pageIndex === 0} className="flex items-center gap-1 rounded-full px-2 py-2 text-[10px] text-[#777067] disabled:opacity-30"><SkipBack size={15} /> 封面</button>
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={() => goToPage(pageIndex - 1)} disabled={pageIndex === 0} aria-label="上一页" className="grid h-9 w-9 place-items-center rounded-full border border-[#ddd4c8] bg-white/55 disabled:opacity-30"><CaretLeft size={16} /></button>
                            <div className="flex gap-1.5">{Array.from({ length: pageCount }).map((_, index) => <span key={index} className={`h-1.5 rounded-full transition-all ${index === pageIndex ? 'w-5 bg-[#5d6255]' : 'w-1.5 bg-[#c8c1b7]'}`} />)}</div>
                            <button type="button" onClick={() => goToPage(pageIndex + 1)} disabled={pageIndex === pageCount - 1} aria-label="下一页" className="grid h-9 w-9 place-items-center rounded-full border border-[#ddd4c8] bg-white/55 disabled:opacity-30"><CaretRight size={16} /></button>
                        </div>
                        <button type="button" onClick={() => goToPage(pageCount - 1)} disabled={pageIndex === pageCount - 1} className="flex items-center gap-1 rounded-full px-2 py-2 text-[10px] text-[#777067] disabled:opacity-30">末页 <SkipForward size={15} /></button>
                    </nav>
                )}
                {chibiSettingsOpen && <ChibiSettingsPanel initial={chibiSettings} characters={characters} onClose={() => setChibiSettingsOpen(false)} onSave={persistChibiSettings} />}
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-y-auto bg-[#f3f1ec] text-[#45413b]">
            <header className="sticky top-0 z-10 border-b border-[#dedbd4] bg-[#f3f1ec]/95 backdrop-blur" style={{ paddingTop: 'var(--chrome-top, 0px)' }}>
                <div className="flex h-14 items-center gap-3 px-4">
                    <button type="button" onClick={closeApp} aria-label="关闭手账本" className="grid h-9 w-9 place-items-center rounded-full text-[#625d55] active:bg-black/5"><CaretLeft size={21} weight="bold" /></button>
                    <div className="min-w-0 flex-1"><h1 className="text-[16px] font-semibold">手账本</h1><p className="text-[11px] text-[#8b857b]">每个角色一本</p></div>
                    <button type="button" onClick={() => void openChibiSettings()} aria-label="Q版生图设置" className="grid h-9 w-9 place-items-center rounded-full text-[#625d55] active:bg-black/5"><GearSix size={19} /></button>
                </div>
            </header>
            <main className="px-5 py-6">
                {notebooks.length > 0 ? <div className="grid grid-cols-2 gap-5">{notebooks.map(({ character, config }) => <button key={character.id} type="button" onClick={() => { setEntries([]); setOpenCharacterId(character.id); setPageIndex(0); setGenerationState('idle'); setRevealStep(0); }} className="aspect-[3/4] min-w-0 text-left transition-transform active:scale-[0.98]"><BookCover character={character} config={config} /></button>)}</div> : <div className="py-16 text-center text-sm text-[#8b857b]">神经链接中还没有角色</div>}
            </main>
            {chibiSettingsOpen && <ChibiSettingsPanel initial={chibiSettings} characters={characters} onClose={() => setChibiSettingsOpen(false)} onSave={persistChibiSettings} />}
        </div>
    );
};

export default HandbookApp;
