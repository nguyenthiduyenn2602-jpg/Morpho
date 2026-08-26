import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    Briefcase,
    CaretRight,
    ChatsCircle,
    DownloadSimple,
    Heart,
    ImageSquare,
    MapPin,
    PaperPlaneTilt,
    Question,
    Shuffle,
    Sparkle,
    UserPlus,
    Users,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import type { CharacterExportData } from '../types';
import {
    affinityDelta,
    affinityStage,
    buildMihuiCharacterCard,
    clampAffinity,
    DEFAULT_MIHUI_PREFERENCES,
    generateMihuiPersona,
    generateMihuiReply,
    loadMihuiState,
    MihuiGender,
    MihuiMessage,
    MihuiPreferences,
    MihuiSession,
    MihuiState,
    saveMihuiState,
} from '../utils/mihui';

type Screen = 'home' | 'match' | 'chat';

const fieldClass = 'w-full rounded-2xl border border-emerald-100 bg-white/90 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 placeholder:text-slate-300';
const chipClass = 'rounded-full px-4 py-2 text-xs font-bold transition active:scale-95';

const messageId = () => `mh-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const sessionId = () => `mh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const PlaceholderAvatar: React.FC<{ size?: string; className?: string }> = ({ size = 'w-16 h-16', className = '' }) => (
    <div className={`${size} ${className} rounded-full bg-gradient-to-br from-slate-100 to-slate-300 text-slate-500 grid place-items-center border border-white shadow-sm shrink-0`}>
        <Question size={30} weight="bold" />
    </div>
);

const genderLabel: Record<MihuiGender, string> = {
    male: '男性', female: '女性', any: '不限', custom: '自定义',
};

const downloadCard = (card: CharacterExportData) => {
    const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${card.name || '密会角色'}_Card.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};

const MihuiApp: React.FC = () => {
    const { closeApp, apiConfig, userProfile, addCharacter, updateCharacter, addToast } = useOS();
    const [state, setState] = useState<MihuiState>(() => loadMihuiState());
    const [screen, setScreen] = useState<Screen>(() => state.activeSessionId ? 'chat' : 'home');
    const [draftPrefs, setDraftPrefs] = useState<MihuiPreferences>(() => ({ ...state.preferences }));
    const [matching, setMatching] = useState(false);
    const [sending, setSending] = useState(false);
    const [draft, setDraft] = useState('');
    const [showProfile, setShowProfile] = useState(false);
    const [showGraduation, setShowGraduation] = useState(false);
    const scrollerRef = useRef<HTMLDivElement>(null);

    const activeSession = useMemo(
        () => state.sessions.find(session => session.id === state.activeSessionId),
        [state.sessions, state.activeSessionId],
    );

    useEffect(() => saveMihuiState(state), [state]);
    useEffect(() => {
        if (screen !== 'chat') return;
        requestAnimationFrame(() => scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' }));
    }, [screen, activeSession?.messages.length, sending]);

    const patchPreferences = <K extends keyof MihuiPreferences>(key: K, value: MihuiPreferences[K]) => {
        setDraftPrefs(prev => ({ ...prev, [key]: value }));
    };

    const match = async (quick = false) => {
        setMatching(true);
        try {
            const prefs = quick ? { ...DEFAULT_MIHUI_PREFERENCES, ...state.preferences } : draftPrefs;
            const persona = await generateMihuiPersona(apiConfig, userProfile, prefs, quick);
            const now = Date.now();
            const session: MihuiSession = {
                id: sessionId(),
                persona,
                affinity: 6,
                createdAt: now,
                updatedAt: now,
                messages: [{ id: messageId(), role: 'assistant', content: persona.greeting, timestamp: now }],
            };
            setState(prev => ({
                version: 1,
                preferences: prefs,
                sessions: [session, ...prev.sessions].slice(0, 30),
                activeSessionId: session.id,
            }));
            setScreen('chat');
            addToast(`匹配到 ${persona.name}`, 'success');
        } catch (error: any) {
            addToast(error?.message || '匹配失败', 'error');
        } finally {
            setMatching(false);
        }
    };

    const openSession = (id: string) => {
        setState(prev => ({ ...prev, activeSessionId: id }));
        setScreen('chat');
    };

    const updateActive = (updater: (session: MihuiSession) => MihuiSession) => {
        setState(prev => ({
            ...prev,
            sessions: prev.sessions.map(session => session.id === prev.activeSessionId ? updater(session) : session),
        }));
    };

    const send = async () => {
        const content = draft.trim();
        if (!content || !activeSession || sending) return;
        const userMessage: MihuiMessage = { id: messageId(), role: 'user', content, timestamp: Date.now() };
        const requestSession = { ...activeSession, messages: [...activeSession.messages, userMessage] };
        setDraft('');
        setSending(true);
        updateActive(session => ({ ...session, messages: [...session.messages, userMessage], updatedAt: Date.now() }));
        try {
            const result = await generateMihuiReply(apiConfig, userProfile, requestSession);
            const assistantMessage: MihuiMessage = { id: messageId(), role: 'assistant', content: result.reply, timestamp: Date.now() };
            const nextAffinity = clampAffinity(activeSession.affinity + affinityDelta(result.signal, content));
            const becameFull = activeSession.affinity < 100 && nextAffinity >= 100;
            updateActive(session => {
                const affinity = clampAffinity(session.affinity + affinityDelta(result.signal, content));
                return { ...session, affinity, messages: [...session.messages, assistantMessage], updatedAt: Date.now() };
            });
            if (becameFull) setShowGraduation(true);
        } catch (error: any) {
            addToast(error?.message || '消息发送失败', 'error');
        } finally {
            setSending(false);
        }
    };

    const addToNeuralLink = async () => {
        if (!activeSession) return;
        const card = buildMihuiCharacterCard(activeSession);
        try {
            const created = await addCharacter();
            await updateCharacter(created.id, {
                name: card.name,
                description: card.description,
                systemPrompt: card.systemPrompt,
                worldview: card.worldview,
                memories: activeSession.messages.length ? [{
                    id: `mihui-memory-${Date.now()}`,
                    date: new Date().toISOString(),
                    summary: activeSession.messages.slice(-18).map(message => `${message.role === 'user' ? '用户' : card.name}：${message.content}`).join('\n'),
                    mood: '从密会相识后的共同回忆',
                }] : [],
            });
            updateActive(session => ({ ...session, graduatedAt: Date.now() }));
            setShowGraduation(false);
            addToast(`${card.name} 已加入神经链接`, 'success');
        } catch (error: any) {
            addToast(error?.message || '加入神经链接失败', 'error');
        }
    };

    const removeSession = () => {
        if (!activeSession || !window.confirm(`结束与「${activeSession.persona.name}」的匹配并删除本地聊天吗？`)) return;
        setState(prev => ({ ...prev, activeSessionId: undefined, sessions: prev.sessions.filter(s => s.id !== activeSession.id) }));
        setShowProfile(false);
        setScreen('home');
    };

    const back = () => {
        if (showProfile) return setShowProfile(false);
        if (screen === 'chat' || screen === 'match') return setScreen('home');
        closeApp();
    };

    const renderHome = () => (
        <div className="flex-1 overflow-y-auto px-5 pb-10">
            <section className="mt-4 rounded-[2rem] bg-gradient-to-br from-emerald-500 via-green-500 to-lime-400 p-6 text-white shadow-[0_22px_45px_-22px_rgba(16,185,129,.75)] relative overflow-hidden">
                <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/15" />
                <div className="absolute right-10 bottom-0 w-24 h-24 rounded-full bg-yellow-200/20" />
                <p className="text-[11px] font-bold tracking-[.35em] text-white/75">LOCAL ENCOUNTER</p>
                <h1 className="mt-3 text-4xl font-black tracking-tight">密会</h1>
                <p className="mt-2 max-w-[15rem] text-sm leading-6 text-white/85">今晚也许会遇见一个，本来不在你生活里的人。</p>
                <div className="mt-6 flex gap-3 relative">
                    <button onClick={() => setScreen('match')} className="flex-1 rounded-2xl bg-white px-4 py-3 text-sm font-black text-emerald-700 shadow-lg active:scale-[.98] transition">选择偏好</button>
                    <button onClick={() => match(true)} disabled={matching} className="flex-1 rounded-2xl bg-slate-900/85 px-4 py-3 text-sm font-black text-white active:scale-[.98] disabled:opacity-60 transition flex items-center justify-center gap-2">
                        <Shuffle size={18} /> {matching ? '匹配中…' : '快速匹配'}
                    </button>
                </div>
            </section>

            <div className="mt-7 flex items-center justify-between">
                <div>
                    <p className="text-lg font-black text-slate-800">最近遇见</p>
                    <p className="text-[11px] text-slate-400">聊天只保存在这台设备</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600">{state.sessions.length} 人</span>
            </div>

            <div className="mt-3 space-y-3">
                {!state.sessions.length && (
                    <div className="rounded-[1.75rem] border border-dashed border-emerald-200 bg-white/70 p-8 text-center">
                        <Users size={38} className="mx-auto text-emerald-300" />
                        <p className="mt-3 text-sm font-bold text-slate-600">还没有匹配记录</p>
                        <p className="mt-1 text-xs text-slate-400">资料越具体，遇见的人越像活在同一座城。</p>
                    </div>
                )}
                {state.sessions.map(session => {
                    const last = session.messages[session.messages.length - 1];
                    return (
                        <button key={session.id} onClick={() => openSession(session.id)} className="w-full rounded-[1.5rem] border border-emerald-50 bg-white p-4 text-left shadow-[0_12px_30px_-22px_rgba(15,118,110,.55)] flex items-center gap-3 active:scale-[.99] transition">
                            <PlaceholderAvatar size="w-14 h-14" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-black text-slate-800">{session.persona.name}</span>
                                    <span className="text-[10px] text-slate-400">{session.persona.age} · {session.persona.occupation}</span>
                                </div>
                                <p className="mt-1 truncate text-xs text-slate-500">{last?.content || '等待开场'}</p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-[10px] font-bold text-emerald-600">{affinityStage(session.affinity)}</p>
                                <p className="mt-1 text-[10px] text-slate-300">{session.affinity}%</p>
                            </div>
                            <CaretRight size={16} className="text-slate-300" />
                        </button>
                    );
                })}
            </div>
        </div>
    );

    const renderMatch = () => (
        <div className="flex-1 overflow-y-auto px-5 pb-10">
            <div className="mt-3">
                <p className="text-[11px] font-bold tracking-[.28em] text-emerald-500">MATCH FILTER</p>
                <h2 className="mt-1 text-3xl font-black text-slate-800">今晚想遇见谁？</h2>
                <p className="mt-2 text-xs leading-5 text-slate-400">偏好是方向，不是流水线。生成的人会有自己的生活、边界和脾气。</p>
            </div>

            <div className="mt-6 space-y-5">
                <section>
                    <label className="text-xs font-black text-slate-600">对方性别</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {(Object.keys(genderLabel) as MihuiGender[]).map(key => (
                            <button key={key} onClick={() => patchPreferences('gender', key)} className={`${chipClass} ${draftPrefs.gender === key ? 'bg-emerald-600 text-white shadow-md' : 'bg-white text-slate-500 border border-emerald-100'}`}>{genderLabel[key]}</button>
                        ))}
                    </div>
                    {draftPrefs.gender === 'custom' && <input className={`${fieldClass} mt-2`} value={draftPrefs.customGender} onChange={e => patchPreferences('customGender', e.target.value)} placeholder="写下你的自定义偏好" />}
                </section>

                <section>
                    <label className="text-xs font-black text-slate-600">年龄范围（所有人物均为成年人）</label>
                    <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <input type="number" min={18} max={99} className={fieldClass} value={draftPrefs.ageMin} onChange={e => patchPreferences('ageMin', Number(e.target.value))} />
                        <span className="text-slate-300">—</span>
                        <input type="number" min={18} max={99} className={fieldClass} value={draftPrefs.ageMax} onChange={e => patchPreferences('ageMax', Number(e.target.value))} />
                    </div>
                </section>

                {([
                    ['occupations', '职业', '例如：医生、编辑、创业者，留空则不限', Briefcase],
                    ['appearance', '外貌特点', '例如：黑发、戴眼镜、清瘦、成熟感', Sparkle],
                    ['style', '相处风格', '例如：慢热、毒舌、温柔、直球、有分寸', ChatsCircle],
                    ['relationship', '关系倾向', '例如：随缘、认真交往、先做朋友', Heart],
                ] as const).map(([key, label, placeholder, Icon]) => (
                    <section key={key}>
                        <label className="text-xs font-black text-slate-600 flex items-center gap-1.5"><Icon size={15} className="text-emerald-500" />{label}</label>
                        <input className={`${fieldClass} mt-2`} value={draftPrefs[key]} onChange={e => patchPreferences(key, e.target.value)} placeholder={placeholder} />
                    </section>
                ))}

                <section>
                    <label className="text-xs font-black text-slate-600">其他想说的</label>
                    <textarea className={`${fieldClass} mt-2 min-h-28 resize-none`} value={draftPrefs.custom} onChange={e => patchPreferences('custom', e.target.value)} placeholder="任何不适合塞进标签里的偏好、雷区或灵感……" />
                </section>
            </div>

            <button onClick={() => match(false)} disabled={matching} className="mt-7 w-full rounded-2xl bg-emerald-600 py-4 text-sm font-black text-white shadow-[0_16px_30px_-15px_rgba(5,150,105,.8)] disabled:opacity-60 active:scale-[.99] transition">
                {matching ? '正在穿过人群寻找…' : '开始匹配'}
            </button>
        </div>
    );

    const renderProfileSheet = () => {
        if (!activeSession || !showProfile) return null;
        const p = activeSession.persona;
        return (
            <div className="absolute inset-0 z-40 bg-black/35 backdrop-blur-sm flex items-end" onClick={() => setShowProfile(false)}>
                <div className="w-full max-h-[82%] overflow-y-auto rounded-t-[2.25rem] bg-[#f7fbf8] p-6 pb-10 shadow-2xl" onClick={e => e.stopPropagation()}>
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <PlaceholderAvatar size="w-20 h-20" />
                            <div><h3 className="text-2xl font-black text-slate-800">{p.name}</h3><p className="mt-1 text-xs text-slate-400">{p.age}岁 · {p.gender} · {p.city}</p></div>
                        </div>
                        <button onClick={() => setShowProfile(false)} className="w-10 h-10 rounded-full bg-white grid place-items-center text-slate-500"><X size={20} /></button>
                    </div>
                    <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-2xl bg-white p-4"><p className="text-[10px] font-bold text-emerald-500">职业</p><p className="mt-1 font-bold text-slate-700">{p.occupation}</p></div>
                        <div className="rounded-2xl bg-white p-4"><p className="text-[10px] font-bold text-emerald-500">关系倾向</p><p className="mt-1 font-bold text-slate-700">{p.relationshipIntent}</p></div>
                    </div>
                    {[[ '外貌印象', p.appearance ], [ '性格', p.personality ], [ '相处方式', p.socialStyle ], [ '个人背景', p.background ]].map(([label, value]) => (
                        <div key={label} className="mt-3 rounded-2xl bg-white p-4"><p className="text-[10px] font-bold text-emerald-500">{label}</p><p className="mt-1 text-sm leading-6 text-slate-600">{value}</p></div>
                    ))}
                    <button onClick={removeSession} className="mt-6 w-full rounded-2xl border border-rose-100 bg-rose-50 py-3 text-sm font-bold text-rose-500">结束这次匹配</button>
                </div>
            </div>
        );
    };

    const renderGraduation = () => {
        if (!activeSession || !showGraduation) return null;
        const card = buildMihuiCharacterCard(activeSession);
        return (
            <div className="absolute inset-0 z-50 bg-emerald-950/45 backdrop-blur-md grid place-items-center p-6">
                <div className="w-full rounded-[2rem] bg-white p-6 text-center shadow-2xl">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 grid place-items-center"><Heart size={30} weight="fill" /></div>
                    <h3 className="mt-4 text-2xl font-black text-slate-800">不只是一次匹配了</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">你和 {activeSession.persona.name} 已经积累了足够多的共同语境。可以把 ta 带回 Morpho，继续生活。</p>
                    <button onClick={addToNeuralLink} className="mt-6 w-full rounded-2xl bg-emerald-600 py-3.5 text-sm font-black text-white flex items-center justify-center gap-2"><UserPlus size={18} />加入神经链接</button>
                    <button onClick={() => { downloadCard(card); addToast('角色卡已下载', 'success'); }} className="mt-2 w-full rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-600 flex items-center justify-center gap-2"><DownloadSimple size={18} />下载角色卡</button>
                    <button onClick={() => setShowGraduation(false)} className="mt-3 text-xs font-bold text-slate-400">先继续聊聊</button>
                </div>
            </div>
        );
    };

    const renderChat = () => {
        if (!activeSession) return renderHome();
        const p = activeSession.persona;
        const stage = affinityStage(activeSession.affinity);
        return (
            <>
                <div className="px-4 pb-3 border-b border-emerald-100 bg-white/80 backdrop-blur-xl shrink-0">
                    <button onClick={() => setShowProfile(true)} className="w-full flex items-center gap-3 text-left">
                        <PlaceholderAvatar size="w-12 h-12" />
                        <div className="min-w-0 flex-1"><p className="font-black text-slate-800">{p.name}</p><p className="mt-0.5 text-[10px] text-slate-400">{p.age} · {p.occupation} · {p.city}</p></div>
                        <CaretRight size={17} className="text-slate-300" />
                    </button>
                    <div className="mt-3 flex items-center gap-2">
                        <span className="text-[10px] font-black text-emerald-600">{stage}</span>
                        <div className="h-1.5 flex-1 rounded-full bg-emerald-50 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-lime-400 transition-all duration-700" style={{ width: `${activeSession.affinity}%` }} /></div>
                        <span className="text-[10px] font-bold text-slate-400">{activeSession.affinity}</span>
                    </div>
                </div>

                <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-3 bg-[radial-gradient(circle_at_top,#ecfdf5_0,transparent_42%)]">
                    <div className="text-center text-[10px] text-slate-300">你们通过密会认识了 · 所有人物均为成年人</div>
                    {activeSession.messages.map(message => (
                        <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                            {message.role === 'assistant' && <PlaceholderAvatar size="w-8 h-8" />}
                            <div className={`max-w-[78%] rounded-[1.35rem] px-4 py-3 text-sm leading-6 shadow-sm ${message.role === 'user' ? 'bg-emerald-600 text-white rounded-br-md' : 'bg-white text-slate-700 border border-emerald-50 rounded-bl-md'}`}>{message.content}</div>
                        </div>
                    ))}
                    {sending && <div className="flex items-end gap-2"><PlaceholderAvatar size="w-8 h-8" /><div className="rounded-[1.35rem] rounded-bl-md bg-white border border-emerald-50 px-4 py-3 flex gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-bounce" /><span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-bounce [animation-delay:120ms]" /><span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-bounce [animation-delay:240ms]" /></div></div>}
                </div>

                <div className="shrink-0 border-t border-emerald-100 bg-white px-3 pt-2 pb-[calc(var(--safe-bottom)+.65rem)]">
                    <div className="flex items-center gap-1.5 pb-2 overflow-x-auto">
                        {[[ImageSquare, '照片'], [MapPin, '位置'], [Sparkle, '见面']].map(([Icon, label]: any) => <button key={label} onClick={() => addToast(`${label}入口已预留，下一阶段接入`, 'info')} className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 flex items-center gap-1"><Icon size={14} />{label}</button>)}
                        {activeSession.affinity >= 100 && <button onClick={() => setShowGraduation(true)} className="shrink-0 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700 flex items-center gap-1"><UserPlus size={14} />角色卡</button>}
                    </div>
                    <div className="flex items-end gap-2">
                        <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1} placeholder="说点什么……" className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-200" />
                        <button onClick={send} disabled={!draft.trim() || sending} className="w-11 h-11 rounded-2xl bg-emerald-600 text-white grid place-items-center disabled:bg-slate-200 active:scale-90 transition"><PaperPlaneTilt size={20} weight="fill" /></button>
                    </div>
                </div>
                {renderProfileSheet()}
                {renderGraduation()}
            </>
        );
    };

    return (
        <div className="h-full w-full flex flex-col bg-[#f7fbf8] text-slate-800 animate-fade-in relative overflow-hidden">
            <header className="shrink-0 px-4 pb-2 bg-white/70 backdrop-blur-xl" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="h-12 flex items-center gap-3">
                    <button onClick={back} className="w-10 h-10 rounded-full grid place-items-center text-slate-600 hover:bg-black/5 active:scale-90 transition" aria-label="返回"><ArrowLeft size={24} /></button>
                    <div className="min-w-0 flex-1"><p className="text-[10px] font-bold tracking-[.3em] text-emerald-500">MIHUI</p><p className="font-black text-slate-800">{screen === 'match' ? '偏好设置' : screen === 'chat' && activeSession ? activeSession.persona.name : '密会'}</p></div>
                    {screen === 'home' && <button onClick={() => setScreen('match')} className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center"><Shuffle size={20} /></button>}
                </div>
            </header>
            {screen === 'home' && renderHome()}
            {screen === 'match' && renderMatch()}
            {screen === 'chat' && renderChat()}
        </div>
    );
};

export default MihuiApp;
