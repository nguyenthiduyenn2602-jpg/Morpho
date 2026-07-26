
import React, { useRef, useState } from 'react';
import Modal from '../os/Modal';
import { CharacterProfile, Message, EmojiCategory, DailySchedule, ScheduleSlot, ApiPreset, APIConfig } from '../../types';
import ScheduleCard from '../schedule/ScheduleCard';
import EmotionSettingsPanel from './EmotionSettingsPanel';
import { isTranslationLangPreset, normalizeTranslationLangLabel, TRANSLATION_LANG_MAX_LENGTH, TRANSLATION_LANG_PRESETS } from '../../utils/translationLang';
import type { ContextRangeMode, ContextRangeSnapshot } from '../../utils/chatContextRange';

interface ChatModalsProps {
    modalType: string;
    setModalType: (v: any) => void;
    // Data Props
    transferAmt: string;
    setTransferAmt: (v: string) => void;
    transferNote: string;
    setTransferNote: (v: string) => void;
    emojiImportText: string;
    setEmojiImportText: (v: string) => void;
    settingsContextLimit: number;
    setSettingsContextLimit: (v: number) => void;
    settingsContextRangeMode: ContextRangeMode;
    setSettingsContextRangeMode: (v: ContextRangeMode) => void;
    settingsHideSysLogs: boolean;
    setSettingsHideSysLogs: (v: boolean) => void;
    preserveContext: boolean;
    setPreserveContext: (v: boolean) => void;
    editContent: string;
    setEditContent: (v: string) => void;
    
    // New Category Props
    newCategoryName: string;
    setNewCategoryName: (v: string) => void;
    onAddCategory: () => void;

    // Emoji rename Props
    newEmojiName: string;
    setNewEmojiName: (v: string) => void;
    onRenameEmoji: () => void;

    // Archive Props
    archivePrompts: {id: string, name: string, content: string}[];
    selectedPromptId: string;
    setSelectedPromptId: (id: string) => void;
    editingPrompt: {id: string, name: string, content: string} | null;
    setEditingPrompt: (p: any) => void;
    isSummarizing: boolean;
    archiveProgress?: string;

    // Selection Props
    selectedMessage: Message | null;
    selectedEmoji: {name: string, url: string} | null;
    selectedCategory: EmojiCategory | null;
    activeCharacter: CharacterProfile;
    messages: Message[];
    allHistoryMessages?: Message[];
    contextRangeSnapshot?: ContextRangeSnapshot;

    // Handlers
    onTransfer: () => void;
    onImportEmoji: () => void;
    onSaveSettings: () => void;
    onBgUpload: (file: File) => void;
    onRemoveBg: () => void;
    onClearHistory: () => void;
    onArchive: () => void;
    onCreatePrompt: () => void;
    onEditPrompt: () => void;
    onSavePrompt: () => void;
    onDeletePrompt: (id: string) => void;
    onSetHistoryStart: (id: number | undefined) => void;
    onRestoreAdaptiveContext?: () => void;
    onJumpToMessageInChat?: (id: number) => void;
    onEnterSelectionMode: () => void;
    onReplyMessage: () => void;
    onEditMessageStart: () => void;
    onConfirmEditMessage: () => void;
    onDeleteMessage: () => void;
    onCopyMessage: () => void;
    onDeleteEmoji: () => void;
    onDeleteCategory: () => void;
    // Category Visibility
    allCharacters?: CharacterProfile[];
    onSaveCategoryVisibility?: (categoryId: string, allowedCharacterIds: string[] | undefined) => void;
    // Translation
    translationEnabled?: boolean;
    onToggleTranslation?: () => void;
    translateSourceLang?: string;
    translateTargetLang?: string;
    onSetTranslateSourceLang?: (lang: string) => void;
    onSetTranslateLang?: (lang: string) => void;
    // XHS toggle
    xhsEnabled?: boolean;
    onToggleXhs?: () => void;
    // HTML mode
    htmlModeEnabled?: boolean;
    onToggleHtmlMode?: () => void;
    htmlModeCustomPrompt?: string;
    setHtmlModeCustomPrompt?: (v: string) => void;
    // Voice TTS
    chatVoiceEnabled?: boolean;
    onToggleChatVoice?: () => void;
    chatVoiceLang?: string;
    onSetChatVoiceLang?: (lang: string) => void;
    // Voice generation from long-press
    onGenerateVoice?: () => void;
    voiceAvailable?: boolean; // true if char has voiceProfile configured
    onDownloadVoice?: () => void;
    voiceDownloadable?: boolean; // true if the selected message already has generated voice
    // Schedule
    scheduleData?: DailySchedule | null;
    isScheduleGenerating?: boolean;
    onScheduleEdit?: (index: number, slot: ScheduleSlot) => void;
    onScheduleDelete?: (index: number) => void;
    onScheduleReroll?: () => void;
    onScheduleCoverChange?: (dataUrl: string) => void;
    onScheduleStyleChange?: (style: 'lifestyle' | 'mindful') => void;
    onPlayTheater?: (index: number) => void;
    // Schedule master toggle
    isScheduleFeatureEnabled?: boolean;
    onToggleScheduleFeature?: () => void;
    // Memory Palace force vectorize
    isMemoryPalaceEnabled?: boolean;
    isVectorizing?: boolean;
    /** 待处理条数（排除热区的真实缓冲区口径）：null=未算出/未开弹窗，0=已全同步 */
    vectorizePendingCount?: number | null;
    /** 处理中的逐轮进度文案，如「第 2 轮 · 剩余 340 条」 */
    vectorizeProgress?: string;
    onForceVectorize?: () => void;
    // Emotion (embedded under schedule modal, synced on/off with scheduleStyle)
    apiPresets?: ApiPreset[];
    onAddApiPreset?: (name: string, config: APIConfig) => void;
    onSaveEmotion?: (config: NonNullable<CharacterProfile['emotionConfig']>) => void;
    onClearBuffs?: () => void;
}

interface TranslationLanguagePickerProps {
    label: string;
    value?: string;
    tone: 'source' | 'target';
    inputPlaceholder: string;
    onSelect?: (lang: string) => void;
}

const TranslationLanguagePicker: React.FC<TranslationLanguagePickerProps> = ({
    label,
    value,
    tone,
    inputPlaceholder,
    onSelect,
}) => {
    const [customLang, setCustomLang] = useState('');
    const selectedClass = tone === 'source' ? 'bg-slate-700 text-white' : 'bg-primary text-white';
    const customSelected = !!value && !isTranslationLangPreset(value);
    const normalizedCustomLang = normalizeTranslationLangLabel(customLang);

    const applyCustomLang = () => {
        if (!normalizedCustomLang) return;
        onSelect?.(normalizedCustomLang);
        setCustomLang('');
    };

    return (
        <div>
            <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">{label}</label>
            <div className="flex flex-wrap gap-1.5">
                {TRANSLATION_LANG_PRESETS.map(lang => (
                    <button
                        type="button"
                        key={`${tone}-${lang}`}
                        onClick={() => onSelect?.(lang)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${value === lang ? selectedClass : 'bg-slate-100 text-slate-500'}`}
                    >
                        {lang}
                    </button>
                ))}
                {customSelected && (
                    <button
                        type="button"
                        onClick={() => value && onSelect?.(value)}
                        className={`max-w-full px-2.5 py-1 rounded-full text-[11px] font-bold transition-all truncate ${selectedClass}`}
                        title={value}
                    >
                        {value}
                    </button>
                )}
            </div>
            <div className="mt-2 flex gap-1.5">
                <input
                    value={customLang}
                    onChange={e => setCustomLang(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            applyCustomLang();
                        }
                    }}
                    maxLength={TRANSLATION_LANG_MAX_LENGTH}
                    placeholder={inputPlaceholder}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 outline-none focus:border-primary"
                />
                <button
                    type="button"
                    onClick={applyCustomLang}
                    disabled={!normalizedCustomLang}
                    className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${normalizedCustomLang ? selectedClass : 'bg-slate-100 text-slate-300'}`}
                >
                    套用
                </button>
            </div>
        </div>
    );
};

const ChatModals: React.FC<ChatModalsProps> = ({
    modalType, setModalType,
    transferAmt, setTransferAmt,
    transferNote, setTransferNote,
    emojiImportText, setEmojiImportText,
    settingsContextLimit, setSettingsContextLimit,
    settingsContextRangeMode, setSettingsContextRangeMode,
    settingsHideSysLogs, setSettingsHideSysLogs,
    preserveContext, setPreserveContext,
    editContent, setEditContent,
    newCategoryName, setNewCategoryName, onAddCategory,
    newEmojiName, setNewEmojiName, onRenameEmoji,
    archivePrompts, selectedPromptId, setSelectedPromptId,
    editingPrompt, setEditingPrompt, isSummarizing, archiveProgress,
    selectedMessage, selectedEmoji, selectedCategory, activeCharacter, messages,
    allHistoryMessages = [],
    contextRangeSnapshot,
    onTransfer, onImportEmoji, onSaveSettings,
    onBgUpload, onRemoveBg, onClearHistory,
    onArchive, onCreatePrompt, onEditPrompt, onSavePrompt, onDeletePrompt,
    onSetHistoryStart, onRestoreAdaptiveContext, onJumpToMessageInChat, onEnterSelectionMode, onReplyMessage, onEditMessageStart, onConfirmEditMessage, onDeleteMessage, onCopyMessage, onDeleteEmoji, onDeleteCategory,
    allCharacters = [], onSaveCategoryVisibility,
    translationEnabled, onToggleTranslation, translateSourceLang, translateTargetLang, onSetTranslateSourceLang, onSetTranslateLang,
    xhsEnabled, onToggleXhs,
    htmlModeEnabled, onToggleHtmlMode, htmlModeCustomPrompt, setHtmlModeCustomPrompt,
    chatVoiceEnabled, onToggleChatVoice, chatVoiceLang, onSetChatVoiceLang,
    onGenerateVoice, voiceAvailable, onDownloadVoice, voiceDownloadable,
    scheduleData, isScheduleGenerating, onScheduleEdit, onScheduleDelete, onScheduleReroll, onScheduleCoverChange,
    onScheduleStyleChange, onPlayTheater,
    isScheduleFeatureEnabled, onToggleScheduleFeature,
    isMemoryPalaceEnabled, isVectorizing, vectorizePendingCount, vectorizeProgress, onForceVectorize,
    apiPresets, onAddApiPreset, onSaveEmotion, onClearBuffs,
}) => {
    const bgInputRef = useRef<HTMLInputElement>(null);
    const [visibilitySelection, setVisibilitySelection] = useState<Set<string>>(new Set());
    const [historyPage, setHistoryPage] = useState(0);
    const [historySearch, setHistorySearch] = useState('');
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);
    const HISTORY_PAGE_SIZE = 50;
    const HISTORY_SEARCH_MAX = 200;
    const LONG_PRESS_MS = 450;

    const startHistoryLongPress = (msgId: number) => {
        longPressTriggeredRef.current = false;
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = window.setTimeout(() => {
            longPressTriggeredRef.current = true;
            if (onJumpToMessageInChat) {
                setModalType('none');
                setHistoryPage(0);
                setHistorySearch('');
                onJumpToMessageInChat(msgId);
            }
        }, LONG_PRESS_MS);
    };
    const cancelHistoryLongPress = () => {
        if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };
    const handleHistoryItemClick = (msgId: number) => {
        if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
        }
        // 范围内直接设置；范围外由上层直接提示先调整拉杆。
        onSetHistoryStart(msgId);
    };

    // 模糊匹配：query 的所有字符按顺序在 content 里出现即算命中（大小写不敏感）。
    // 中文按字符级 subsequence 匹配，英文同理。
    const fuzzyMatch = (content: string, query: string): boolean => {
        if (!query) return true;
        const c = content.toLowerCase();
        const q = query.toLowerCase();
        if (c.includes(q)) return true;
        let idx = 0;
        for (const ch of q) {
            const found = c.indexOf(ch, idx);
            if (found < 0) return false;
            idx = found + 1;
        }
        return true;
    };

    // 高亮命中的连续子串（优先），否则不高亮（subsequence 命中时高亮意义不大）。
    const renderHighlighted = (text: string, query: string, baseClass: string) => {
        if (!query) return <span className={baseClass}>{text}</span>;
        const lower = text.toLowerCase();
        const q = query.toLowerCase();
        const idx = lower.indexOf(q);
        if (idx < 0) return <span className={baseClass}>{text}</span>;
        return (
            <span className={baseClass}>
                {text.slice(0, idx)}
                <mark className="bg-yellow-200 text-slate-800 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
                {text.slice(idx + q.length)}
            </span>
        );
    };

    const openVisibilityModal = () => {
        if (selectedCategory) {
            setVisibilitySelection(new Set(selectedCategory.allowedCharacterIds || []));
            setModalType('category-visibility');
        }
    };

    const toggleVisibilityChar = (charId: string) => {
        setVisibilitySelection(prev => {
            const next = new Set(prev);
            if (next.has(charId)) next.delete(charId);
            else next.add(charId);
            return next;
        });
    };

    const handleSaveVisibility = () => {
        if (selectedCategory && onSaveCategoryVisibility) {
            const ids = Array.from(visibilitySelection);
            onSaveCategoryVisibility(selectedCategory.id, ids.length > 0 ? ids : undefined);
        }
        setModalType('none');
    };

    return (
        <>
            <Modal 
                isOpen={modalType === 'transfer'} title="Credits 转账" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onTransfer} className="flex-1 py-3 bg-orange-500 text-white rounded-2xl">确认</button></>}
            >
                <input type="number" value={transferAmt} onChange={e => setTransferAmt(e.target.value)} placeholder="金额" className="w-full bg-slate-100 rounded-2xl px-5 py-4 text-lg font-bold" autoFocus />
                <input type="text" value={transferNote} onChange={e => setTransferNote(e.target.value)} maxLength={30} placeholder="添加转账留言（选填）" className="w-full bg-slate-100 rounded-2xl px-5 py-3 text-sm mt-3" />
            </Modal>

            {/* New Category Modal */}
            <Modal 
                isOpen={modalType === 'add-category'} title="新建表情分类" onClose={() => setModalType('none')}
                footer={<button onClick={onAddCategory} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">创建</button>}
            >
                <input 
                    value={newCategoryName} 
                    onChange={e => setNewCategoryName(e.target.value)} 
                    placeholder="输入分类名称..." 
                    className="w-full bg-slate-100 rounded-2xl px-5 py-4 text-base font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-slate-700" 
                    autoFocus 
                />
            </Modal>

            <Modal 
                isOpen={modalType === 'emoji-import'} title="表情注入" onClose={() => setModalType('none')}
                footer={<button onClick={onImportEmoji} className="w-full py-4 bg-primary text-white font-bold rounded-2xl">添加至当前分类</button>}
            >
                <div className="space-y-3">
                    <p className="text-xs text-slate-400">表情将导入到你当前选中的分类。</p>
                    <textarea value={emojiImportText} onChange={e => setEmojiImportText(e.target.value)} placeholder="Name--URL (每行一个)" className="w-full h-40 bg-slate-100 rounded-2xl p-4 resize-none" />
                </div>
            </Modal>

            <Modal 
                isOpen={modalType === 'chat-settings'} title="聊天设置" onClose={() => setModalType('none')}
                footer={<button onClick={onSaveSettings} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存设置</button>}
            >
                <div className="space-y-6">
                     <div>
                         <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">聊天背景</label>
                         <div onClick={() => bgInputRef.current?.click()} className="h-24 bg-slate-100 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-primary/50 overflow-hidden relative">
                             {activeCharacter.chatBackground ? <img src={activeCharacter.chatBackground} className="w-full h-full object-cover opacity-60" /> : <span className="text-xs text-slate-400">点击上传图片 (原画质)</span>}
                             {activeCharacter.chatBackground && <span className="absolute z-10 text-xs bg-white/80 px-2 py-1 rounded">更换</span>}
                         </div>
                         <input type="file" ref={bgInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && onBgUpload(e.target.files[0])} />
                         {activeCharacter.chatBackground && <button onClick={onRemoveBg} className="text-[10px] text-red-400 mt-1">移除背景</button>}
                     </div>
                     <div>
                         {activeCharacter.autoArchiveEnabled && settingsContextRangeMode === 'adaptive' ? (
                             <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3.5">
                                 <div className="flex items-start justify-between gap-3">
                                     <div>
                                         <div className="text-xs font-bold text-violet-700">自适应全自动记忆中</div>
                                         <p className="text-[10px] text-violet-600/80 mt-1 leading-relaxed">
                                             原文范围自动跟随记忆宫殿水位线，更早内容通过向量记忆召回。非特殊需求请勿调整。
                                         </p>
                                         {activeCharacter.contextUserStartMessageId && (
                                             <p className="text-[10px] text-sky-700 mt-1.5 leading-relaxed">
                                                 当前另有用户断点，实际原文范围会在自适应上限内进一步缩小。
                                             </p>
                                         )}
                                     </div>
                                     <div className="shrink-0 flex flex-col gap-1.5">
                                         <button
                                             type="button"
                                             onClick={() => setSettingsContextRangeMode('manual')}
                                             className="px-3 py-1.5 rounded-xl bg-white border border-violet-200 text-[11px] font-bold text-violet-700"
                                         >
                                             自定义范围
                                         </button>
                                         {activeCharacter.contextUserStartMessageId && (
                                             <button
                                                 type="button"
                                                 onClick={onRestoreAdaptiveContext}
                                                 className="px-3 py-1.5 rounded-xl bg-violet-600 text-[11px] font-bold text-white"
                                             >
                                                 一键还原
                                             </button>
                                         )}
                                     </div>
                                 </div>
                             </div>
                         ) : (
                             <>
                                 <div className="flex items-center justify-between gap-2 mb-2">
                                     <label className="text-xs font-bold text-slate-400 uppercase">上下文最大条数 ({settingsContextLimit})</label>
                                     {activeCharacter.autoArchiveEnabled && (
                                         <button
                                             type="button"
                                             onClick={onRestoreAdaptiveContext}
                                             className="text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-100 rounded-full px-2.5 py-1"
                                         >
                                             一键恢复自适应
                                         </button>
                                     )}
                                 </div>
                                 <input
                                     type="range"
                                     min="20"
                                     max="5000"
                                     step="10"
                                     value={settingsContextLimit}
                                     onChange={e => {
                                         setSettingsContextRangeMode('manual');
                                         setSettingsContextLimit(parseInt(e.target.value));
                                     }}
                                     className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-primary"
                                 />
                                 <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>20 (省流)</span><span>5000 (最大范围)</span></div>
                                 {activeCharacter.autoArchiveEnabled && (
                                     <p className="text-[10px] text-amber-600 mt-2 leading-relaxed">
                                         自定义只改变 AI 可直接读取的原文范围，不会回退记忆宫殿水位线，也不会让旧消息重新向量化。
                                     </p>
                                 )}
                             </>
                         )}
                     </div>

                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={() => setSettingsHideSysLogs(!settingsHideSysLogs)}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">隐藏系统日志</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${settingsHideSysLogs ? 'bg-primary' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${settingsHideSysLogs ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             开启后隐藏见面/小程序等自动产生的灰色提示（转账、戳一戳、发图提示除外）。
                         </p>
                     </div>

                     {/* Translation Settings */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleTranslation}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">消息翻译</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${translationEnabled ? 'bg-primary' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${translationEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                             开启后，AI 消息自动翻译为「选」的语言显示，点「译」切换到目标语言。
                         </p>
                         {translationEnabled && (
                             <div className="mt-3 space-y-3">
                                 <TranslationLanguagePicker
                                     label="选（气泡显示语言）"
                                     value={translateSourceLang}
                                     tone="source"
                                     inputPlaceholder="自定义，如 粤语"
                                     onSelect={onSetTranslateSourceLang}
                                 />
                                 <TranslationLanguagePicker
                                     label="译（翻译目标语言）"
                                     value={translateTargetLang}
                                     tone="target"
                                     inputPlaceholder="自定义，如 中文（繁體）"
                                     onSelect={onSetTranslateLang}
                                 />
                                 {/* Preview */}
                                 <div className="text-[11px] text-center text-slate-500 bg-slate-50 rounded-lg py-2">
                                     选<span className="font-bold text-slate-700">{translateSourceLang || '?'}</span> 译<span className="font-bold text-primary">{translateTargetLang || '?'}</span>
                                 </div>
                             </div>
                         )}
                     </div>

                     {/* XHS Toggle */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleXhs}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">小红书</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${xhsEnabled ? 'bg-red-400' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${xhsEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             开启后，角色在聊天中可以搜索、浏览、发帖、评论小红书。需要在全局设置中配置 MCP 或 Cookie。
                         </p>
                     </div>

                     {/* HTML 模块模式 */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleHtmlMode}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">HTML 模块模式</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${htmlModeEnabled ? 'bg-fuchsia-500' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${htmlModeEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             开启后注入"用 [html]...[/html] 包裹的精美卡片"提示词，AI 会在合适场景输出邀请函 / 票据 / 通知等可视化模块。
                         </p>
                         {htmlModeEnabled && (
                             <div className="mt-3">
                                 <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">自定义提示词补充（追加在内置提示词之后，不会覆盖）</label>
                                 <textarea
                                     value={htmlModeCustomPrompt || ''}
                                     onChange={e => setHtmlModeCustomPrompt?.(e.target.value)}
                                     placeholder="比如：偏好暖色调 / 默认风格走 minimal 杂志感 / 票据类必须含二维码占位…"
                                     className="w-full h-28 bg-slate-50 rounded-2xl p-3 text-[12px] resize-none border border-slate-200 focus:outline-none focus:border-fuchsia-300"
                                 />
                                 <p className="text-[10px] text-slate-400 mt-1">留空则只使用内置提示词。</p>
                             </div>
                         )}
                     </div>

                     {/* Voice TTS */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleChatVoice}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">语音消息</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${chatVoiceEnabled ? 'bg-emerald-400' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${chatVoiceEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                             开启后，AI 回复自动生成语音条（需配置 MiniMax 和角色语音）。
                         </p>
                         {chatVoiceEnabled && (
                             <div className="mt-3">
                                 <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">语音语种</label>
                                 <div className="flex flex-wrap gap-1.5">
                                     {[{v:'',l:'默认'},{v:'en',l:'English'},{v:'ja',l:'日本語'},{v:'ko',l:'한국어'},{v:'fr',l:'Français'},{v:'es',l:'Español'}].map(opt => (
                                         <button key={opt.v} onClick={() => onSetChatVoiceLang?.(opt.v)}
                                             className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${chatVoiceLang === opt.v ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                             {opt.l}
                                         </button>
                                     ))}
                                 </div>
                                 {chatVoiceLang && <p className="text-[10px] text-emerald-600/70 mt-1.5">选择非默认语种时，AI 台词会先翻译再生成语音。</p>}
                             </div>
                         )}
                     </div>

                     {/* 时间感知 / 自定义时区 / 线下时间感知 已统一迁移至「神经链接」角色设定页 */}

                     <div className="pt-2 border-t border-slate-100">
                         <button onClick={() => setModalType('history-manager')} className="w-full py-3 bg-slate-50 text-slate-600 font-bold rounded-2xl border border-slate-200 active:scale-95 transition-transform flex items-center justify-center gap-2">
                             查看原文范围 / 设置用户断点
                         </button>
                         <p className="text-[10px] text-slate-400 mt-2 text-center">查看拉杆上限、记忆水位线，并可在最大范围内进一步缩小 AI 原文范围。</p>
                     </div>
                     
                     {/* 记忆宫殿：一键向量化所有聊天记录 */}
                     {isMemoryPalaceEnabled && onForceVectorize && (
                         <div className="pt-2 border-t border-slate-100">
                             <button
                                 onClick={onForceVectorize}
                                 disabled={isVectorizing}
                                 className="w-full py-3 bg-emerald-50 text-emerald-600 font-bold rounded-2xl border border-emerald-200 active:scale-95 transition-transform flex items-center justify-center gap-2 disabled:opacity-70"
                             >
                                 {isVectorizing
                                     ? `🏰 ${vectorizeProgress || '存进记忆宫殿中...'}`
                                     : (vectorizePendingCount != null && vectorizePendingCount > 0)
                                         ? `🏰 一键存进记忆宫殿 · 待处理 ${vectorizePendingCount} 条`
                                         : (vectorizePendingCount === 0)
                                             ? '🏰 记忆宫殿已同步 · 无待处理'
                                             : '🏰 一键把所有聊天存进记忆宫殿'}
                             </button>
                             <p className="text-[10px] text-slate-400 mt-2 text-center leading-relaxed">
                                 {isVectorizing
                                     ? '正在分批交给副 API 处理，保持应用打开、先别切走～完成前请勿清空聊天。'
                                     : <>将所有未处理的聊天记录交给记忆宫殿处理，完成后可安全清空聊天。<br/><span className="text-slate-300">看不懂这是什么的话不需要操作此按钮。</span></>}
                             </p>
                         </div>
                     )}

                     <div className="pt-2 border-t border-slate-100">
                         <label className="text-xs font-bold text-red-400 uppercase mb-3 block">危险区域 (Danger Zone)</label>
                         <div className="flex items-center gap-2 mb-3 cursor-pointer" onClick={() => setPreserveContext(!preserveContext)}>
                             <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${preserveContext ? 'bg-primary border-primary' : 'bg-slate-100 border-slate-300'}`}>
                                 {preserveContext && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                             </div>
                             <span className="text-sm text-slate-600">清空时保留最后10条记录 (维持语境)</span>
                         </div>
                         <button onClick={onClearHistory} className="w-full py-3 bg-red-50 text-red-500 font-bold rounded-2xl border border-red-100 active:scale-95 transition-transform flex items-center justify-center gap-2">
                             执行清空
                         </button>
                     </div>
                </div>
            </Modal>

            {/* Archive Settings Modal */}
            <Modal isOpen={modalType === 'archive-settings'} title="记忆归档设置" onClose={() => { if (!isSummarizing) setModalType('none'); }} footer={
                isSummarizing ?
                <div className="w-full py-3 bg-slate-100 text-indigo-600 font-bold rounded-2xl text-center flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>{archiveProgress || '归档中...'}</div> :
                <button onClick={onArchive} disabled={isSummarizing} className="w-full py-3 bg-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200">开始归档</button>
            }>
                <div className="space-y-4">
                    {(() => {
                        const palaceOn = !!(activeCharacter as any).memoryPalaceEnabled;
                        const autoOn = !!(activeCharacter as any).autoArchiveEnabled;
                        const activePrompt = archivePrompts.find(p => p.id === selectedPromptId);
                        const activeName = activePrompt?.name || '理性精炼 (Rational)';
                        if (palaceOn && autoOn) {
                            return (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-[11px] text-emerald-800 leading-relaxed">
                                    ✅ <b>自动归档已开启</b>。palace 处理后系统会按日期自动把聊天归档到"本月日度总结"。<br/>
                                    自动归档走的是 <b>记忆宫殿内置风格</b>（保证向量检索质量稳定），
                                    下方模板<b>只对这里的"开始归档"按钮生效</b>——你在这换风格不会影响自动归档。
                                </div>
                            );
                        }
                        if (palaceOn && !autoOn) {
                            return (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900 leading-relaxed">
                                    ⚠️ 记忆宫殿已开，但<b>自动归档没开</b>——记忆宫殿只在后台默默建记忆，不会写进月度总结。<br/>
                                    想让它自动写 → 神经链接 → 角色 → 记忆宫殿开关下面的 <b>"📚 自动归档"</b>；
                                    或者继续用下方按钮手动按当前选中的 <b>「{activeName}」</b> 风格跑。
                                </div>
                            );
                        }
                        return (
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-700 leading-relaxed">
                                📋 <b>纯手动模式</b>（没开记忆宫殿）。下方按钮会用选中的
                                <b className="text-slate-900"> 「{activeName}」</b> 风格把聊天按天总结到"本月日度总结"。
                                归档完会自动隐藏已总结的旧消息（保留最近一部分可见）。
                            </div>
                        );
                    })()}
                    <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                        <label className="text-[10px] font-bold text-indigo-400 uppercase mb-2 block">选择提示词模板</label>
                        <div className="flex flex-col gap-2">
                            {archivePrompts.map(p => {
                                const isSelected = selectedPromptId === p.id;
                                return (
                                <div key={p.id} onClick={() => setSelectedPromptId(p.id)} className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between ${isSelected ? 'bg-white border-indigo-500 shadow-sm ring-1 ring-indigo-500' : 'bg-white/50 border-indigo-200 hover:bg-white'}`}>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className={`text-xs font-bold ${isSelected ? 'text-indigo-700' : 'text-slate-600'}`}>{p.name}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={(e) => { e.stopPropagation(); setSelectedPromptId(p.id); onEditPrompt(); }} className="text-[10px] text-slate-400 hover:text-indigo-500 px-2 py-1 rounded bg-slate-100 hover:bg-indigo-50">编辑/查看</button>
                                        {!p.id.startsWith('preset_') && (
                                            <button onClick={(e) => { e.stopPropagation(); onDeletePrompt(p.id); }} className="text-[10px] text-red-300 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50">×</button>
                                        )}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                        <button onClick={onCreatePrompt} className="mt-3 w-full py-2 text-xs font-bold text-indigo-500 border border-dashed border-indigo-300 rounded-lg hover:bg-indigo-100">+ 新建自定义提示词</button>
                    </div>
                    <div className="text-[10px] text-slate-400 bg-slate-50 p-3 rounded-xl leading-relaxed">
                        • <b>理性精炼</b>: 适合生成条理清晰的事件日志，便于 AI 长期记忆检索。<br/>
                        • <b>日记风格</b>: 适合生成第一人称的角色日记，更有代入感和情感色彩。<br/>
                        • 支持变量: <code>{'${dateStr}'}</code>, <code>{'${char.name}'}</code>, <code>{'${userProfile.name}'}</code>, <code>{'${rawLog}'}</code>
                    </div>
                </div>
            </Modal>

            {/* Prompt Editor Modal */}
            <Modal isOpen={modalType === 'prompt-editor'} title="编辑提示词" onClose={() => setModalType('archive-settings')} footer={<button onClick={onSavePrompt} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存预设</button>}>
                <div className="space-y-3">
                    <input 
                        value={editingPrompt?.name || ''} 
                        onChange={e => setEditingPrompt((prev: any) => prev ? {...prev, name: e.target.value} : null)}
                        placeholder="预设名称"
                        className="w-full px-4 py-2 bg-slate-100 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <textarea 
                        value={editingPrompt?.content || ''} 
                        onChange={e => setEditingPrompt((prev: any) => prev ? {...prev, content: e.target.value} : null)}
                        className="w-full h-64 bg-slate-100 rounded-xl p-3 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 leading-relaxed"
                        placeholder="输入提示词内容..."
                    />
                </div>
            </Modal>

            {/* History Manager Modal */}
            <Modal
                isOpen={modalType === 'history-manager'} title="AI 原文读取范围" onClose={() => { setModalType('none'); setHistoryPage(0); setHistorySearch(''); }}
                footer={<><button onClick={() => onSetHistoryStart(undefined)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">清除用户断点</button><button onClick={() => { setModalType('none'); setHistoryPage(0); setHistorySearch(''); }} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">完成</button></>}
            >
                <div className="space-y-2 max-h-[50vh] overflow-y-auto no-scrollbar p-1">
                    <p className="text-xs text-slate-400 text-center mb-2"><b>短按</b>消息 = 设置用户断点（只能缩小范围） · <b>长按</b>消息 = 跳转查看原文</p>
                    <div className="grid gap-2 mb-2">
                        <div className="bg-violet-50 border border-violet-200 rounded-xl p-2.5 text-[11px] text-violet-800 leading-relaxed">
                            <b>紫色 · 记忆宫殿水位线</b>：此前消息已经处理，不会因调整上下文再次向量化。
                        </div>
                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-2.5 text-[11px] text-orange-800 leading-relaxed">
                            <b>橙色 · 最大范围起点</b>：由{contextRangeSnapshot?.mode === 'adaptive' ? '全自动记忆' : `拉杆 ${settingsContextLimit} 条`}决定，用户断点不能越过它读取更早内容。
                        </div>
                        {contextRangeSnapshot?.userStartMessageId && (
                            <div className="bg-sky-50 border border-sky-200 rounded-xl p-2.5 text-[11px] text-sky-800 leading-relaxed">
                                <b>蓝色 · 用户断点</b>：只在最大范围内进一步隐藏更早原文；被移动中的最大范围越过后会自动失效。
                            </div>
                        )}
                    </div>
                    <div className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 pb-1.5 -mx-1 px-1">
                        <div className="relative">
                            <input
                                type="text"
                                value={historySearch}
                                onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(0); }}
                                placeholder="模糊搜索历史消息（关键词 / 字符顺序匹配）"
                                className="w-full pl-8 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-colors"
                            />
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                            </svg>
                            {historySearch && (
                                <button onClick={() => { setHistorySearch(''); setHistoryPage(0); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-base leading-none">×</button>
                            )}
                        </div>
                    </div>
                    {(() => {
                        const reversed = allHistoryMessages.slice().reverse();
                        const query = historySearch.trim();
                        const filtered = query ? reversed.filter(m => fuzzyMatch(m.content || '', query)) : reversed;
                        const limited = query ? filtered.slice(0, HISTORY_SEARCH_MAX) : filtered;
                        const totalPages = Math.max(1, Math.ceil(limited.length / HISTORY_PAGE_SIZE));
                        const pageMessages = limited.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE);
                        const hwm = contextRangeSnapshot?.hwm || 0;
                        const maxCut = contextRangeSnapshot?.maxRangeStartMessageId;
                        const userCut = contextRangeSnapshot?.userStartMessageId;
                        const effectiveCut = contextRangeSnapshot?.effectiveStartMessageId;
                        return (<>
                            {query && (
                                <div className="text-xs text-slate-500 px-1 py-1">
                                    找到 <b className="text-primary">{filtered.length}</b> 条匹配
                                    {filtered.length > HISTORY_SEARCH_MAX && <span className="text-slate-400">（仅显示前 {HISTORY_SEARCH_MAX} 条）</span>}
                                </div>
                            )}
                            {!query && filtered.length === 0 && (
                                <div className="text-xs text-slate-400 text-center py-4">暂无历史消息</div>
                            )}
                            {query && filtered.length === 0 && (
                                <div className="text-xs text-slate-400 text-center py-4">没有匹配的消息</div>
                            )}
                            {limited.length > HISTORY_PAGE_SIZE && (
                                <div className="flex items-center justify-between px-1 py-1">
                                    <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyPage === 0} className={`px-3 py-1 text-xs rounded-lg ${historyPage === 0 ? 'text-slate-300' : 'text-primary hover:bg-primary/10'}`}>上一页</button>
                                    <span className="text-xs text-slate-400">{historyPage + 1} / {totalPages}（共 {limited.length} 条）</span>
                                    <button onClick={() => setHistoryPage(p => Math.min(totalPages - 1, p + 1))} disabled={historyPage >= totalPages - 1} className={`px-3 py-1 text-xs rounded-lg ${historyPage >= totalPages - 1 ? 'text-slate-300' : 'text-primary hover:bg-primary/10'}`}>下一页</button>
                                </div>
                            )}
                            {pageMessages.map(m => {
                                const isWatermark = hwm === m.id;
                                const isMaxStart = maxCut === m.id;
                                const isUserStart = userCut === m.id;
                                const isHidden = !!(effectiveCut && m.id < effectiveCut);
                                const isVectorized = hwm > 0 && m.id <= hwm;
                                const cls = isUserStart
                                    ? 'bg-sky-50 border-sky-300 ring-1 ring-sky-300'
                                    : isMaxStart
                                        ? 'bg-orange-50 border-orange-300 ring-1 ring-orange-300'
                                        : isWatermark
                                            ? 'bg-violet-50 border-violet-300 ring-1 ring-violet-300'
                                            : isHidden
                                                ? 'bg-slate-50 border-slate-100 opacity-55'
                                                : 'bg-white border-slate-100 hover:bg-slate-50';
                                const contentClass = isHidden ? 'text-slate-400 line-through decoration-slate-300/70' : 'text-slate-500';
                                return (
                                    <div
                                        key={m.id}
                                        id={`history-msg-${m.id}`}
                                        onClick={() => handleHistoryItemClick(m.id)}
                                        onPointerDown={() => startHistoryLongPress(m.id)}
                                        onPointerUp={cancelHistoryLongPress}
                                        onPointerLeave={cancelHistoryLongPress}
                                        onPointerCancel={cancelHistoryLongPress}
                                        onContextMenu={(e) => e.preventDefault()}
                                        className={`p-3 rounded-xl border cursor-pointer text-xs flex gap-2 items-start transition-colors select-none ${cls}`}
                                    >
                                        <span className="text-slate-400 font-mono whitespace-nowrap pt-0.5">[{new Date(m.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}]</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-slate-600 mb-0.5">{m.role === 'user' ? '我' : activeCharacter.name}</div>
                                            <div className="truncate">{renderHighlighted(m.content || '', query, contentClass)}</div>
                                        </div>
                                        <div className="flex flex-wrap justify-end gap-1 max-w-[42%]">
                                            {isWatermark && <span className="text-violet-600 font-bold text-[9px] bg-white px-1.5 rounded-full border border-violet-200">水位线</span>}
                                            {isMaxStart && <span className="text-orange-600 font-bold text-[9px] bg-white px-1.5 rounded-full border border-orange-200">最大范围</span>}
                                            {isUserStart && <span className="text-sky-600 font-bold text-[9px] bg-white px-1.5 rounded-full border border-sky-200">用户断点</span>}
                                            {!isWatermark && !isMaxStart && !isUserStart && isHidden && <span className="text-slate-400 font-bold text-[9px] bg-white px-1.5 rounded-full border border-slate-200">AI 不读原文</span>}
                                            {!isWatermark && !isMaxStart && !isUserStart && isVectorized && !isHidden && <span className="text-violet-400 font-bold text-[9px] bg-white px-1.5 rounded-full border border-violet-100">已向量化</span>}
                                        </div>
                                    </div>
                                );
                            })}
                            {limited.length > HISTORY_PAGE_SIZE && (
                                <div className="flex items-center justify-center px-1 pt-2">
                                    <span className="text-xs text-slate-400">{historyPage + 1} / {totalPages}</span>
                                </div>
                            )}
                        </>);
                    })()}
                </div>
            </Modal>

            <Modal isOpen={modalType === 'message-options'} title="消息操作" onClose={() => setModalType('none')}>
                <div className="space-y-3">
                    <button onClick={onEnterSelectionMode} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        多选 / 批量删除
                    </button>
                    <button onClick={onReplyMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        引用 / 回复
                    </button>
                    {selectedMessage?.type === 'text' && (
                        <button onClick={onEditMessageStart} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            编辑内容
                        </button>
                    )}
                    {selectedMessage?.type === 'text' && (
                        <button onClick={onCopyMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            复制文字
                        </button>
                    )}
                    {voiceAvailable && selectedMessage?.role === 'assistant' && selectedMessage?.type === 'text' && onGenerateVoice && (
                        <button onClick={() => { onGenerateVoice(); setModalType('none'); }} className="w-full py-3 bg-emerald-50 text-emerald-600 font-medium rounded-2xl active:bg-emerald-100 transition-colors flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" /></svg>
                            转换语音
                        </button>
                    )}
                    {voiceDownloadable && onDownloadVoice && (
                        <button onClick={() => { onDownloadVoice(); setModalType('none'); }} className="w-full py-3 bg-sky-50 text-sky-600 font-medium rounded-2xl active:bg-sky-100 transition-colors flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                            下载语音
                        </button>
                    )}
                    <button onClick={onDeleteMessage} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl active:bg-red-100 transition-colors flex items-center justify-center gap-2">
                        删除消息
                    </button>
                </div>
            </Modal>
            
             <Modal
                isOpen={modalType === 'delete-emoji'} title="删除表情包" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onDeleteEmoji} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl">删除</button></>}
            >
                <div className="flex flex-col items-center gap-4 py-2">
                    {Array.isArray(selectedEmoji) ? (
                        <div className="flex flex-wrap justify-center gap-2 max-h-48 overflow-y-auto no-scrollbar w-full px-2">
                            {selectedEmoji.map((e: any, idx: number) => (
                                <img key={idx} src={e.url} className="w-16 h-16 object-contain rounded-xl border border-slate-200" />
                            ))}
                        </div>
                    ) : (
                        selectedEmoji && <img src={selectedEmoji.url} className="w-24 h-24 object-contain rounded-xl border" />
                    )}
                    <p className="text-center text-sm text-slate-500">
                        {Array.isArray(selectedEmoji) ? `确定要删除这 ${selectedEmoji.length} 个表情包吗？` : "确定要删除这个表情包吗？"}
                    </p>
                </div>
            </Modal>

            {/* Emoji Options Modal (shown on long-press) */}
            <Modal isOpen={modalType === 'emoji-options'} title="表情包操作" onClose={() => setModalType('none')}>
                <div className="flex flex-col items-center gap-4 py-1">
                    {selectedEmoji && !Array.isArray(selectedEmoji) && (
                        <div className="flex flex-col items-center gap-2">
                            <img src={selectedEmoji.url} className="w-20 h-20 object-contain rounded-xl border border-slate-200" />
                            <span className="text-sm font-medium text-slate-600 max-w-[12rem] truncate">{selectedEmoji.name}</span>
                        </div>
                    )}
                    <div className="w-full space-y-3">
                        <button
                            onClick={() => { if (selectedEmoji && !Array.isArray(selectedEmoji)) setNewEmojiName(selectedEmoji.name); setModalType('rename-emoji'); }}
                            className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                            </svg>
                            修改名称
                        </button>
                        <button
                            onClick={() => setModalType('delete-emoji')}
                            className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl active:bg-red-100 transition-colors flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                            删除
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Rename Emoji Modal */}
            <Modal
                isOpen={modalType === 'rename-emoji'} title="修改表情包名称" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onRenameEmoji} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}
            >
                <input
                    value={newEmojiName}
                    onChange={e => setNewEmojiName(e.target.value)}
                    placeholder="输入表情包名称..."
                    className="w-full bg-slate-100 rounded-2xl px-5 py-4 text-base font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-slate-700"
                    autoFocus
                />
            </Modal>

            {/* Delete Category Modal */}
            <Modal
                isOpen={modalType === 'delete-category'} title="删除分类" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onDeleteCategory} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl">删除</button></>}
            >
                <div className="py-4 text-center">
                    <p className="text-sm text-slate-600">确定要删除分类 <br/><span className="font-bold">"{selectedCategory?.name}"</span> 吗？</p>
                    <p className="text-[10px] text-red-400 mt-2">注意：分类下的所有表情也将被删除！</p>
                </div>
            </Modal>

            {/* Category Options Modal (shown on long-press) */}
            <Modal isOpen={modalType === 'category-options'} title="分类操作" onClose={() => setModalType('none')}>
                <div className="space-y-3">
                    <button onClick={openVisibilityModal} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                        设置可见角色
                    </button>
                    {selectedCategory && !selectedCategory.isSystem && selectedCategory.id !== 'default' && (
                        <button onClick={() => setModalType('delete-category')} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl active:bg-red-100 transition-colors flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                            删除分类
                        </button>
                    )}
                </div>
            </Modal>

            {/* Category Visibility Modal */}
            <Modal
                isOpen={modalType === 'category-visibility'} title={`"${selectedCategory?.name}" 可见角色`} onClose={() => setModalType('none')}
                footer={<button onClick={handleSaveVisibility} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存设置</button>}
            >
                <div className="space-y-3">
                    <p className="text-xs text-slate-400 leading-relaxed">
                        选择哪些角色可以使用此表情分组。不勾选任何角色表示所有角色均可使用。
                    </p>
                    <div className="space-y-2 max-h-[40vh] overflow-y-auto no-scrollbar">
                        {allCharacters.map(c => (
                            <div
                                key={c.id}
                                onClick={() => toggleVisibilityChar(c.id)}
                                className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${visibilitySelection.has(c.id) ? 'bg-primary/5 border-primary/30' : 'bg-white border-slate-100 hover:bg-slate-50'}`}
                            >
                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors shrink-0 ${visibilitySelection.has(c.id) ? 'bg-primary border-primary' : 'bg-slate-100 border-slate-300'}`}>
                                    {visibilitySelection.has(c.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                                </div>
                                <img src={c.avatar} className="w-9 h-9 rounded-xl object-cover" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm text-slate-700">{c.name}</div>
                                    <div className="text-[10px] text-slate-400 truncate">{c.description}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    {visibilitySelection.size > 0 && (
                        <div className="text-[11px] text-center text-slate-500 bg-slate-50 rounded-lg py-2">
                            已选 <span className="font-bold text-primary">{visibilitySelection.size}</span> 个角色可使用此分组
                        </div>
                    )}
                </div>
            </Modal>

            <Modal
                isOpen={modalType === 'edit-message'} title="编辑内容" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onConfirmEditMessage} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}
            >
                <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full h-32 bg-slate-100 rounded-2xl p-4 resize-none focus:ring-1 focus:ring-primary/20 transition-all text-sm leading-relaxed"
                />
            </Modal>

            {/* Schedule Modal */}
            <Modal
                isOpen={modalType === 'schedule'} title={`${activeCharacter?.name || '角色'}の日程/情绪`} onClose={() => setModalType('none')}
            >
                <div className="max-h-[70vh] overflow-y-auto -mx-2 px-2">
                    {/* 总开关：关闭时不调副 API、不生成日程、不注入情绪 buff */}
                    {onToggleScheduleFeature && (
                        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-2xl p-3">
                            <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0 pr-3">
                                    <p className="text-xs font-bold text-slate-700">日程与情绪 Buff</p>
                                    <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">
                                        {isScheduleFeatureEnabled
                                            ? '已开启：角色会有今日日程，并在聊天中带上当下情绪。'
                                            : '已关闭：不调副 API，不生成日程，不注入情绪 buff。'}
                                    </p>
                                </div>
                                <button
                                    onClick={onToggleScheduleFeature}
                                    aria-label="切换日程与情绪总开关"
                                    className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center flex-shrink-0 ${isScheduleFeatureEnabled ? 'bg-primary' : 'bg-slate-300'}`}
                                >
                                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${isScheduleFeatureEnabled ? 'translate-x-4' : ''}`}></div>
                                </button>
                            </div>
                        </div>
                    )}

                    {isScheduleFeatureEnabled && (
                        <>
                            {/* Schedule Style Selector */}
                            {onScheduleStyleChange && (
                                <div className="mb-4">
                                    {!activeCharacter?.scheduleStyle && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-3">
                                            <p className="text-xs text-amber-700 font-bold mb-1">请选择日程风格</p>
                                            <p className="text-[11px] text-amber-600 leading-relaxed">
                                                不同风格会影响角色的内心独白生成方式。选择后会自动重新生成今日日程。
                                            </p>
                                        </div>
                                    )}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => onScheduleStyleChange('lifestyle')}
                                            disabled={isScheduleGenerating}
                                            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                                                (activeCharacter?.scheduleStyle || 'lifestyle') === 'lifestyle'
                                                    ? 'bg-violet-100 border-violet-300 text-violet-700'
                                                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                            }`}
                                        >
                                            <span className="block text-sm mb-0.5">生活系</span>
                                            <span className="block text-[10px] opacity-70 font-normal">虚构日常 · 跑步做饭逛街</span>
                                        </button>
                                        <button
                                            onClick={() => onScheduleStyleChange('mindful')}
                                            disabled={isScheduleGenerating}
                                            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                                                activeCharacter?.scheduleStyle === 'mindful'
                                                    ? 'bg-teal-100 border-teal-300 text-teal-700'
                                                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                            }`}
                                        >
                                            <span className="block text-sm mb-0.5">意识系</span>
                                            <span className="block text-[10px] opacity-70 font-normal">真实内心 · 不虚构不说谎</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            <ScheduleCard
                                schedule={scheduleData || null}
                                character={activeCharacter}
                                compact={false}
                                onEdit={onScheduleEdit}
                                onDelete={onScheduleDelete}
                                onReroll={onScheduleReroll}
                                onCoverImageChange={onScheduleCoverChange}
                                onPlayTheater={onPlayTheater}
                                isGenerating={isScheduleGenerating}
                            />
                            <p className="text-[10px] text-slate-400 text-center mt-3 leading-relaxed">
                                点击日程项可编辑 · 长按可删除
                            </p>

                            {/* 情绪 / 意识流 API — 与日程强制同步 */}
                            {activeCharacter && apiPresets && onAddApiPreset && onSaveEmotion && onClearBuffs && (
                                <EmotionSettingsPanel
                                    char={activeCharacter}
                                    apiPresets={apiPresets}
                                    addApiPreset={onAddApiPreset}
                                    onSave={onSaveEmotion}
                                    onClearBuffs={onClearBuffs}
                                />
                            )}
                        </>
                    )}
                </div>
            </Modal>
        </>
    );
};

export default ChatModals;
