import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    ArrowClockwise,
    Briefcase,
    CaretRight,
    ChatsCircle,
    DownloadSimple,
    CurrencyCircleDollar,
    Eye,
    EyeSlash,
    Heart,
    ImageSquare,
    MapPin,
    Palette,
    PaperPlaneTilt,
    Question,
    Shuffle,
    Sparkle,
    Trash,
    UserPlus,
    Users,
    Wrench,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, type CharacterExportData, type CharacterProfile } from '../types';
import { processImage } from '../utils/file';
import { DB } from '../utils/db';
import { mergePalaceFragmentsIntoMemories, processNewMessages } from '../utils/memoryPalace/pipeline';
import {
    affinityDelta,
    affinityStage,
    buildMihuiFamiliarContinuity,
    buildMihuiFamiliarMemorySummary,
    buildMihuiRevealLine,
    buildMihuiCharacterCard,
    clampAffinity,
    DEFAULT_MIHUI_PREFERENCES,
    DEFAULT_MIHUI_GAZE,
    DEFAULT_MIHUI_TUNING,
    generateMihuiGazeReaction,
    generateMihuiFamiliarPersona,
    generateMihuiPersona,
    generateMihuiReply,
    loadMihuiState,
    mihuiMessageSummary,
    MihuiGender,
    MihuiGazeContext,
    MihuiGazeSettings,
    MihuiMessage,
    MihuiPreferences,
    MihuiSession,
    MihuiState,
    MihuiThemeId,
    MihuiTuning,
    pickMihuiFamiliar,
    planMihuiGaze,
    removeMihuiMessage,
    saveMihuiState,
} from '../utils/mihui';

type Screen = 'home' | 'match' | 'chat';

interface MihuiGazeNotice {
    characterId: string;
    name: string;
    avatar?: string;
    message: string;
    messages?: string[];
    timestamp: number;
    lines?: string[];
}

const fieldClass = 'w-full rounded-2xl border border-[var(--mh-border)] bg-[var(--mh-panel)] px-4 py-3 text-sm text-[var(--mh-text)] outline-none transition focus:border-[var(--mh-accent)] focus:ring-4 focus:ring-[var(--mh-soft)] placeholder:text-[var(--mh-muted)]';
const chipClass = 'rounded-full px-4 py-2 text-xs font-bold transition active:scale-95';

interface MihuiThemeDefinition {
    id: MihuiThemeId;
    name: string;
    subtitle: string;
    colors: string[];
    vars: Record<string, string>;
}

const MIHUI_THEMES: Record<MihuiThemeId, MihuiThemeDefinition> = {
    noir: {
        id: 'noir', name: '夜色密语', subtitle: '默认黑粉', colors: ['#292126', '#8c5366', '#f1e3e8', '#ffffff'],
        vars: {
            '--mh-bg': '#f6f0f2', '--mh-panel': '#ffffff', '--mh-text': '#292126', '--mh-muted': '#89757d',
            '--mh-border': '#e7d4db', '--mh-accent': '#8c5366', '--mh-accent-strong': '#292126', '--mh-on-accent': '#f4e5ea',
            '--mh-soft': '#f1e3e8', '--mh-soft-2': '#eadce1', '--mh-user-bubble': '#33272d', '--mh-user-text': '#f7e9ee',
            '--mh-assistant-bubble': '#ffffff', '--mh-assistant-text': '#3b3035', '--mh-glow': '#f2e5e9',
            '--mh-hero-1': '#171316', '--mh-hero-2': '#33252b', '--mh-hero-3': '#a87686',
        },
    },
    pink: {
        id: 'pink', name: '莹色入梦', subtitle: '柔粉梦境', colors: ['#f7d1ee', '#fce0f6', '#fbd4d6', '#efbbbc'],
        vars: {
            '--mh-bg': '#fff5fb', '--mh-panel': '#fffafd', '--mh-text': '#593744', '--mh-muted': '#9a7181',
            '--mh-border': '#efbbbc', '--mh-accent': '#cf7197', '--mh-accent-strong': '#a94f76', '--mh-on-accent': '#fff7fb',
            '--mh-soft': '#fce0f6', '--mh-soft-2': '#f7d1ee', '--mh-user-bubble': '#efbbbc', '--mh-user-text': '#54313d',
            '--mh-assistant-bubble': '#fce0f6', '--mh-assistant-text': '#593744', '--mh-glow': '#f7d1ee',
            '--mh-hero-1': '#b95f88', '--mh-hero-2': '#e99fbd', '--mh-hero-3': '#fbd4d6',
        },
    },
    crimson: {
        id: 'crimson', name: '深绯夜宴', subtitle: '红黑鎏金', colors: ['#710014', '#b38f6f', '#f2f1ed', '#161616'],
        vars: {
            '--mh-bg': '#eee9e3', '--mh-panel': '#f8f6f2', '--mh-text': '#161616', '--mh-muted': '#776257',
            '--mh-border': '#cdb8aa', '--mh-accent': '#710014', '--mh-accent-strong': '#161616', '--mh-on-accent': '#f2f1ed',
            '--mh-soft': '#e8ddd5', '--mh-soft-2': '#d9c6b8', '--mh-user-bubble': '#710014', '--mh-user-text': '#f2f1ed',
            '--mh-assistant-bubble': '#f2f1ed', '--mh-assistant-text': '#161616', '--mh-glow': '#d9c6b8',
            '--mh-hero-1': '#161616', '--mh-hero-2': '#43040d', '--mh-hero-3': '#710014',
        },
    },
};

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
    const { closeApp, openApp, apiConfig, userProfile, characters, addCharacter, updateCharacter, setActiveCharacterId, openDateWithChar, addToast, memoryPalaceConfig } = useOS();
    const [state, setState] = useState<MihuiState>(() => loadMihuiState());
    const [screen, setScreen] = useState<Screen>(() => state.activeSessionId ? 'chat' : 'home');
    const [draftPrefs, setDraftPrefs] = useState<MihuiPreferences>(() => ({ ...state.preferences }));
    const [matching, setMatching] = useState(false);
    const [matchError, setMatchError] = useState('');
    const [sending, setSending] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [draft, setDraft] = useState('');
    const [selectedMessage, setSelectedMessage] = useState<MihuiMessage | null>(null);
    const [showProfile, setShowProfile] = useState(false);
    const [showGraduation, setShowGraduation] = useState(false);
    const [showLocation, setShowLocation] = useState(false);
    const [showTransfer, setShowTransfer] = useState(false);
    const [showAppearance, setShowAppearance] = useState(false);
    const [showTuning, setShowTuning] = useState(false);
    const [draftTuning, setDraftTuning] = useState<MihuiTuning>(() => ({ ...(state.tuning || DEFAULT_MIHUI_TUNING) }));
    const [showGazeSettings, setShowGazeSettings] = useState(false);
    const [draftGaze, setDraftGaze] = useState<MihuiGazeSettings>(() => ({ ...(state.gaze || DEFAULT_MIHUI_GAZE), events: [...(state.gaze?.events || [])] }));
    const [gazeBanner, setGazeBanner] = useState<MihuiGazeNotice | null>(null);
    const [gazeBarrage, setGazeBarrage] = useState<MihuiGazeNotice | null>(null);
    const [testingGazeBarrage, setTestingGazeBarrage] = useState(false);
    const [locationName, setLocationName] = useState('');
    const [locationAddress, setLocationAddress] = useState('');
    const [transferAmount, setTransferAmount] = useState('');
    const [transferNote, setTransferNote] = useState('');
    const [openingMeetup, setOpeningMeetup] = useState(false);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);

    const activeSession = useMemo(
        () => state.sessions.find(session => session.id === state.activeSessionId),
        [state.sessions, state.activeSessionId],
    );
    const activeTheme = MIHUI_THEMES[state.theme || 'noir'];
    const themeStyle = activeTheme.vars as React.CSSProperties;

    const familiarCharacter = (session: MihuiSession) => session.familiar
        ? characters.find(character => character.id === session.familiar?.characterId)
        : undefined;
    const isRevealed = (session: MihuiSession) => Boolean(session.familiar?.revealedAt);
    const displayName = (session: MihuiSession) => isRevealed(session)
        ? (familiarCharacter(session)?.name || session.familiar?.realName || session.persona.name)
        : session.persona.name;
    const displayAvatar = (session: MihuiSession, messageTimestamp?: number) => {
        const revealedAt = session.familiar?.revealedAt;
        if (!revealedAt || (messageTimestamp != null && messageTimestamp < revealedAt)) return '';
        return familiarCharacter(session)?.avatar || session.familiar?.avatar || '';
    };
    const renderSessionAvatar = (session: MihuiSession, size: string, messageTimestamp?: number) => {
        const avatar = displayAvatar(session, messageTimestamp);
        return avatar
            ? <img src={avatar} alt={displayName(session)} className={`${size} shrink-0 rounded-full border border-white object-cover shadow-sm`} />
            : <PlaceholderAvatar size={size} />;
    };

    useEffect(() => saveMihuiState(state), [state]);
    useEffect(() => {
        if (!gazeBanner) return;
        const timer = window.setTimeout(() => setGazeBanner(null), 6500);
        return () => window.clearTimeout(timer);
    }, [gazeBanner]);
    useEffect(() => {
        if (!gazeBarrage) return;
        const timer = window.setTimeout(() => setGazeBarrage(null), 9000);
        return () => window.clearTimeout(timer);
    }, [gazeBarrage]);
    useEffect(() => {
        if (screen !== 'chat') return;
        requestAnimationFrame(() => scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' }));
    }, [screen, activeSession?.messages.length, sending]);

    const patchPreferences = <K extends keyof MihuiPreferences>(key: K, value: MihuiPreferences[K]) => {
        setDraftPrefs(prev => ({ ...prev, [key]: value }));
    };

    const loadFamiliarContinuity = async (character: CharacterProfile): Promise<string> => {
        try {
            // includeProcessed=true：即使私聊已被记忆宫殿归档，也仍可供密会熟人续接。
            const recent = await DB.getRecentMessagesByCharId(character.id, 36, true);
            return buildMihuiFamiliarContinuity(character, recent);
        } catch (error) {
            console.warn('[Mihui] 读取熟人连续上下文失败，回退角色长期记忆', error);
            return buildMihuiFamiliarContinuity(character, []);
        }
    };

    const syncFamiliarContinuity = async (session: MihuiSession): Promise<void> => {
        const familiar = session.familiar;
        if (!familiar) return;
        const character = characters.find(item => item.id === familiar.characterId);
        if (!character) return;
        const memoryId = `mihui-live-${session.id}`;
        const now = Date.now();
        const continuity = buildMihuiFamiliarMemorySummary(session, character.name, userProfile.name || '用户');
        // 密会原文落入原角色的隐藏消息流：聊天 UI 不展示，但记忆宫殿可以按自己的
        // 高水位、热区和自动总结设置正常提取，不另造一套总结算法。
        const storedMessages = await DB.getMessagesByCharId(character.id, true);
        const storedIds = new Set(storedMessages
            .filter(message => message.metadata?.source === 'mihui' && message.metadata?.mihuiSessionId === session.id)
            .map(message => message.metadata?.mihuiMessageId));
        for (const message of session.messages) {
            if (storedIds.has(message.id)) continue;
            await DB.saveMessage({
                charId: character.id,
                role: message.role,
                type: 'text',
                content: mihuiMessageSummary(message),
                timestamp: message.timestamp,
                metadata: {
                    source: 'mihui',
                    mihuiSessionId: session.id,
                    mihuiMessageId: message.id,
                    alias: session.persona.name,
                },
            });
        }

        const mpEmb = memoryPalaceConfig?.embedding;
        const configuredLLM = memoryPalaceConfig?.lightLLM;
        const mpLLM = configuredLLM?.baseUrl
            ? configuredLLM
            : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
        const usePalace = Boolean(character.memoryPalaceEnabled && mpEmb?.baseUrl && mpEmb?.apiKey && mpLLM.baseUrl);
        const palaceResult = usePalace
            ? await processNewMessages([], character.id, character.name, mpEmb!, mpLLM, userProfile.name || '', false)
            : null;
        const nextMemory = {
            id: memoryId,
            date: new Date(now).toISOString(),
            summary: continuity,
            mood: familiar.revealedAt ? '密会身份已经揭晓' : '在密会中以化名保持联系',
        };
        await updateCharacter(character.id, previous => {
            const memories = previous.memories || [];
            const index = memories.findIndex(memory => memory.id === memoryId);
            let nextMemories = usePalace
                ? memories.filter(memory => memory.id !== memoryId)
                : index >= 0
                    ? memories.map((memory, memoryIndex) => memoryIndex === index ? nextMemory : memory)
                    : [...memories, nextMemory];
            if (usePalace && previous.autoArchiveEnabled && palaceResult?.autoArchive?.fragments?.length) {
                nextMemories = mergePalaceFragmentsIntoMemories(nextMemories, palaceResult.autoArchive.fragments);
            }
            return {
                mihuiContinuity: continuity,
                memories: nextMemories,
                ...(usePalace && previous.autoArchiveEnabled && palaceResult?.autoArchive
                    ? { hideBeforeMessageId: Math.max(previous.hideBeforeMessageId || 0, palaceResult.autoArchive.hideBeforeMessageId) }
                    : {}),
            };
        });
    };

    // 兼容更新前已经存在的熟人密会：只要重新进入该会话，就把旧记录补写回原角色。
    useEffect(() => {
        if (screen !== 'chat' || !activeSession?.familiar) return;
        void syncFamiliarContinuity(activeSession)
            .catch(error => console.warn('[Mihui] 旧熟人会话自动迁移失败', error));
    }, [screen, activeSession?.id, activeSession?.messages.length, activeSession?.familiar?.revealedAt]);

    const match = async (quick = false) => {
        if (matching) return;
        if (!apiConfig.baseUrl?.trim() || !apiConfig.model?.trim()) {
            const message = '全局 API 尚未配置完整，请先在系统设置中填写接口地址并选择模型';
            setMatchError(message);
            addToast(message, 'error');
            return;
        }
        setMatchError('');
        setMatching(true);
        try {
            const prefs = quick ? { ...DEFAULT_MIHUI_PREFERENCES, ...state.preferences } : draftPrefs;
            const familiar = quick ? pickMihuiFamiliar(characters, state.sessions) : undefined;
            const familiarContinuity = familiar ? await loadFamiliarContinuity(familiar) : '';
            const persona = familiar
                ? await generateMihuiFamiliarPersona(apiConfig, userProfile, familiar, prefs, familiarContinuity, state.tuning)
                : await generateMihuiPersona(apiConfig, userProfile, prefs, quick, state.tuning);
            const now = Date.now();
            const session: MihuiSession = {
                id: sessionId(),
                persona,
                affinity: 6,
                createdAt: now,
                updatedAt: now,
                messages: [{ id: messageId(), role: 'assistant', content: persona.greeting, timestamp: now }],
                ...(familiar ? {
                    familiar: {
                        characterId: familiar.id,
                        realName: familiar.name,
                        avatar: familiar.avatar,
                        description: familiar.description,
                        systemPrompt: familiar.systemPrompt,
                        worldview: familiar.worldview,
                    },
                } : {}),
            };
            if (familiar) await syncFamiliarContinuity(session).catch(error => console.warn('[Mihui] 初始熟人记忆回写失败', error));
            setState(prev => ({
                ...prev,
                version: 1,
                preferences: prefs,
                sessions: [session, ...prev.sessions].slice(0, 30),
                activeSessionId: session.id,
            }));
            setScreen('chat');
            addToast(`匹配到 ${persona.name}`, 'success');
        } catch (error: any) {
            const message = error?.message || '匹配失败，请检查全局 API';
            setMatchError(message);
            addToast(message, 'error');
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

    const revealFamiliar = async (target: MihuiSession): Promise<string | undefined> => {
        const familiar = target.familiar;
        if (!familiar) return undefined;
        const character = characters.find(item => item.id === familiar.characterId);
        if (!character) throw new Error('这位熟人的原角色卡已经不存在了');
        if (familiar.revealedAt && familiar.syncedAt) return character.id;

        const now = Date.now();
        const line = familiar.revealLine || buildMihuiRevealLine(character);
        const transcript = target.messages.slice(-24)
            .map(message => `${message.role === 'user' ? (userProfile.name || '用户') : target.persona.name}：${mihuiMessageSummary(message)}`)
            .join('\n');
        const memoryId = `mihui-reveal-${target.id}`;

        if (!familiar.syncedAt) {
            await updateCharacter(character.id, previous => ({
                memories: previous.memories.some(memory => memory.id === memoryId)
                    ? previous.memories
                    : [...previous.memories, {
                        id: memoryId,
                        date: new Date(now).toISOString(),
                        summary: `你曾在「密会」中使用化名「${target.persona.name}」与${userProfile.name || '用户'}相遇，身份后来揭晓。密会记录：\n${transcript}`,
                        mood: '原来是你——密会身份揭晓',
                    }],
            }));
            await DB.saveMessage({
                charId: character.id,
                role: 'assistant',
                type: 'text',
                content: line,
                timestamp: now,
                metadata: { source: 'mihui-reveal', mihuiSessionId: target.id, alias: target.persona.name },
            });
        }

        const alreadyHasLine = target.messages.some(message => message.content === line);
        const revealedSession: MihuiSession = {
            ...target,
            linkedCharacterId: character.id,
            familiar: { ...target.familiar!, realName: character.name, avatar: character.avatar, revealedAt: target.familiar?.revealedAt || now, revealLine: line, syncedAt: now },
            messages: alreadyHasLine ? target.messages : [...target.messages, { id: messageId(), role: 'assistant', type: 'text', content: line, timestamp: now }],
            updatedAt: now,
        };
        updateActive(() => revealedSession);
        await syncFamiliarContinuity(revealedSession)
            .catch(error => console.warn('[Mihui] 揭晓后的熟人记忆回写失败', error));
        addToast(`原来是 ${character.name}`, 'success');
        return character.id;
    };

    const maybeTriggerGaze = async (
        session: MihuiSession,
        previousAffinity: number,
        nextAffinity: number,
        explicitContext?: MihuiGazeContext,
    ) => {
        const gaze = state.gaze || DEFAULT_MIHUI_GAZE;
        if (!gaze.enabled) return;
        const hiddenFamiliarId = session.familiar && !session.familiar.revealedAt ? session.familiar.characterId : undefined;
        const watcherPool = characters.filter(character =>
            character.id !== hiddenFamiliarId
            && (character.activeMsg2Config?.enabled === true || character.proactiveConfig?.enabled === true),
        );
        if (!watcherPool.length) return;

        const now = Date.now();
        const plannedByState = planMihuiGaze(gaze, session, previousAffinity, nextAffinity, now);
        const plan = explicitContext && gaze.barrageEnabled
            ? { ...plannedByState, trigger: 'barrage' as const, checksSinceLast: 0 }
            : plannedByState;
        if (!plan.trigger) {
            setState(prev => ({
                ...prev,
                sessions: prev.sessions.map(item => item.id === session.id
                    ? { ...item, gazeChecksSinceLast: plan.checksSinceLast }
                    : item),
            }));
            return;
        }

        const latestWatcherId = [...gaze.events].reverse().find(event => event.characterId)?.characterId;
        const preferredPool = watcherPool.length > 1 ? watcherPool.filter(character => character.id !== latestWatcherId) : watcherPool;
        const watcher = preferredPool[Math.floor(Math.random() * preferredPool.length)] || watcherPool[0];
        try {
            const milestoneContext: MihuiGazeContext | undefined = plan.milestone
                ? { type: 'affinity', threshold: plan.milestone }
                : undefined;
            const reaction = await generateMihuiGazeReaction(
                apiConfig,
                userProfile,
                watcher,
                plan.trigger,
                nextAffinity,
                explicitContext || milestoneContext,
            );
            const timestamp = Date.now();
            await Promise.all(reaction.messages.map((message, index) => DB.saveMessage({
                charId: watcher.id,
                role: 'assistant',
                type: 'text',
                content: message,
                timestamp: timestamp + index,
                metadata: { source: 'mihui-gaze', mihuiSessionId: session.id, kind: plan.trigger },
            })));
            const notice: MihuiGazeNotice = {
                characterId: watcher.id,
                name: watcher.name,
                avatar: watcher.avatar,
                message: reaction.message,
                messages: reaction.messages,
                timestamp,
                lines: reaction.barrageLines,
            };
            setState(prev => {
                const previousGaze = prev.gaze || DEFAULT_MIHUI_GAZE;
                return {
                    ...prev,
                    gaze: {
                        ...previousGaze,
                        events: [...previousGaze.events.filter(event => timestamp - event.timestamp < 72 * 60 * 60 * 1000), {
                            type: plan.trigger!, timestamp, characterId: watcher.id,
                        }].slice(-24),
                    },
                    sessions: prev.sessions.map(item => item.id === session.id ? {
                        ...item,
                        gazeChecksSinceLast: 0,
                        gazeBannerCount: (item.gazeBannerCount || 0) + (plan.trigger === 'banner' ? 1 : 0),
                        gazeBarrageCount: (item.gazeBarrageCount || 0) + (plan.trigger === 'barrage' ? 1 : 0),
                        gazeAffinityMilestones: plan.milestone
                            ? Array.from(new Set([
                                ...(item.gazeAffinityMilestones || []),
                                ...(plan.milestone === 80 ? [30 as const, 80 as const] : [30 as const]),
                            ]))
                            : item.gazeAffinityMilestones,
                    } : item),
                };
            });
            if (plan.trigger === 'barrage') setGazeBarrage(notice);
            else setGazeBanner(notice);
        } catch (error) {
            console.warn('[Mihui] 危险凝视生成失败，本轮不触发彩蛋', error);
        }
    };

    const testGazeBarrage = async () => {
        if (testingGazeBarrage) return;
        const hiddenFamiliarId = activeSession?.familiar && !activeSession.familiar.revealedAt
            ? activeSession.familiar.characterId
            : undefined;
        const watcherPool = characters.filter(character =>
            character.id !== hiddenFamiliarId
            && (character.activeMsg2Config?.enabled === true || character.proactiveConfig?.enabled === true),
        );
        if (!watcherPool.length) {
            addToast('没有可参与测试的主动消息角色', 'error');
            return;
        }
        setTestingGazeBarrage(true);
        try {
            const watcher = watcherPool[Math.floor(Math.random() * watcherPool.length)] || watcherPool[0];
            const reaction = await generateMihuiGazeReaction(
                apiConfig,
                userProfile,
                watcher,
                'barrage',
                activeSession?.affinity || 60,
            );
            setShowGazeSettings(false);
            setGazeBarrage({
                characterId: watcher.id,
                name: watcher.name,
                avatar: watcher.avatar,
                message: reaction.message,
                messages: reaction.messages,
                timestamp: Date.now(),
                lines: reaction.barrageLines,
            });
        } catch (error) {
            console.warn('[Mihui] 催命弹幕调试失败', error);
            addToast(error instanceof Error ? error.message : '催命弹幕调试失败', 'error');
        } finally {
            setTestingGazeBarrage(false);
        }
    };

    const openGazeMessage = (notice: MihuiGazeNotice) => {
        setGazeBanner(null);
        setGazeBarrage(null);
        setActiveCharacterId(notice.characterId);
        openApp(AppID.Chat);
    };

    const sendUserMessage = async (userMessage: MihuiMessage, affinityText: string) => {
        if (!activeSession || sending || regenerating) return;
        const requestSession = { ...activeSession, messages: [...activeSession.messages, userMessage] };
        setSending(true);
        updateActive(session => ({ ...session, messages: [...session.messages, userMessage], updatedAt: Date.now() }));
        try {
            const sourceCharacter = requestSession.familiar
                ? characters.find(character => character.id === requestSession.familiar?.characterId)
                : undefined;
            const familiarContinuity = sourceCharacter ? await loadFamiliarContinuity(sourceCharacter) : '';
            const result = await generateMihuiReply(apiConfig, userProfile, requestSession, sourceCharacter, familiarContinuity, state.tuning);
            const replyTurnId = `mh-turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const replyTimestamp = Date.now();
            const assistantMessages: MihuiMessage[] = result.bubbles.map((content, index) => ({
                id: messageId(), role: 'assistant', type: 'text', content, turnId: replyTurnId, timestamp: replyTimestamp + index,
            }));
            if (result.location) assistantMessages.push({
                id: messageId(), role: 'assistant', type: 'location', content: result.location.name,
                location: result.location, turnId: replyTurnId, timestamp: replyTimestamp + assistantMessages.length,
            });
            if (result.transfer) assistantMessages.push({
                id: messageId(), role: 'assistant', type: 'transfer', content: '[转账]',
                transfer: { ...result.transfer, status: 'pending' }, turnId: replyTurnId, timestamp: replyTimestamp + assistantMessages.length,
            });
            const pendingUserTransfer = [...requestSession.messages].reverse()
                .find(message => message.role === 'user' && message.type === 'transfer' && !message.transfer?.receipt && message.transfer?.status === 'pending');
            const settledMessages = pendingUserTransfer && result.transferAction
                ? requestSession.messages.map(message => message.id === pendingUserTransfer.id
                    ? { ...message, transfer: { ...message.transfer!, status: result.transferAction === 'accept' ? 'accepted' as const : 'returned' as const } }
                    : message)
                : requestSession.messages;
            if (pendingUserTransfer && result.transferAction) assistantMessages.push({
                id: messageId(), role: 'assistant', type: 'transfer', content: '[转账回执]',
                transfer: { amount: pendingUserTransfer.transfer!.amount, status: result.transferAction === 'accept' ? 'accepted' : 'returned', receipt: true },
                turnId: replyTurnId, timestamp: replyTimestamp + assistantMessages.length,
            });
            const nextAffinity = clampAffinity(activeSession.affinity + affinityDelta(result.signal, affinityText));
            const becameFull = activeSession.affinity < 100 && nextAffinity >= 100;
            const completedSession: MihuiSession = {
                ...requestSession,
                affinity: nextAffinity,
                messages: [...settledMessages, ...assistantMessages],
                updatedAt: Date.now(),
            };
            updateActive(session => {
                const affinity = clampAffinity(session.affinity + affinityDelta(result.signal, affinityText));
                const messages = pendingUserTransfer && result.transferAction
                    ? session.messages.map(message => message.id === pendingUserTransfer.id
                        ? { ...message, transfer: { ...message.transfer!, status: result.transferAction === 'accept' ? 'accepted' as const : 'returned' as const } }
                        : message)
                    : session.messages;
                return { ...session, affinity, messages: [...messages, ...assistantMessages], updatedAt: Date.now() };
            });
            if (requestSession.familiar) await syncFamiliarContinuity(completedSession)
                .catch(error => console.warn('[Mihui] 熟人密会记忆回写失败', error));
            if (becameFull && requestSession.familiar && !requestSession.familiar.revealedAt) {
                await revealFamiliar({ ...requestSession, affinity: nextAffinity, messages: [...settledMessages, ...assistantMessages] });
                setShowGraduation(true);
            } else if (becameFull) {
                setShowGraduation(true);
            }
            const gazeContext: MihuiGazeContext | undefined = userMessage.type === 'location' && userMessage.location
                ? { type: 'location', name: userMessage.location.name, address: userMessage.location.address }
                : userMessage.type === 'transfer' && userMessage.transfer && !userMessage.transfer.receipt
                    ? { type: 'transfer', amount: userMessage.transfer.amount, note: userMessage.transfer.note }
                    : undefined;
            void maybeTriggerGaze(completedSession, activeSession.affinity, nextAffinity, gazeContext);
        } catch (error: any) {
            addToast(error?.message || '消息发送失败', 'error');
        } finally {
            setSending(false);
        }
    };

    const send = async () => {
        const content = draft.trim();
        if (!content || !activeSession || sending || regenerating) return;
        setDraft('');
        await sendUserMessage({ id: messageId(), role: 'user', type: 'text', content, timestamp: Date.now() }, content);
    };

    const sendPhoto = async (file?: File) => {
        if (!file || !activeSession || sending || regenerating) return;
        try {
            const dataUrl = await processImage(file, { maxWidth: 600, quality: 0.6, forceJpeg: true });
            await sendUserMessage({ id: messageId(), role: 'user', type: 'image', content: dataUrl, timestamp: Date.now() }, '用户分享了一张照片');
        } catch (error: any) {
            addToast(error?.message || '照片处理失败', 'error');
        } finally {
            if (photoInputRef.current) photoInputRef.current.value = '';
        }
    };

    const sendLocation = async () => {
        const name = locationName.trim();
        const address = locationAddress.trim();
        if (!name || !activeSession || sending || regenerating) return;
        setShowLocation(false);
        setLocationName('');
        setLocationAddress('');
        await sendUserMessage({
            id: messageId(), role: 'user', type: 'location', content: name, timestamp: Date.now(),
            location: { name, ...(address ? { address } : {}) },
        }, `分享位置：${name}${address ? `，${address}` : ''}`);
    };

    const sendTransfer = async () => {
        const amount = Number(transferAmount);
        if (!activeSession || sending || regenerating || !Number.isFinite(amount) || amount <= 0) return;
        const rounded = Math.min(999999, Math.round(amount * 100) / 100);
        const note = transferNote.trim();
        setShowTransfer(false);
        setTransferAmount('');
        setTransferNote('');
        await sendUserMessage({
            id: messageId(), role: 'user', type: 'transfer', content: '[转账]', timestamp: Date.now(),
            transfer: { amount: rounded, ...(note ? { note } : {}), status: 'pending' },
        }, `向对方转账 ¥${rounded}${note ? `，留言：${note}` : ''}`);
    };

    const settleIncomingTransfer = (target: MihuiMessage, status: 'accepted' | 'returned') => {
        if (!activeSession || target.role !== 'assistant' || target.type !== 'transfer' || target.transfer?.status !== 'pending') return;
        const receipt: MihuiMessage = {
            id: messageId(), role: 'user', type: 'transfer', content: '[转账回执]', timestamp: Date.now(),
            transfer: { amount: target.transfer.amount, status, receipt: true },
        };
        const nextSession: MihuiSession = {
            ...activeSession,
            messages: [...activeSession.messages.map(message => message.id === target.id
                ? { ...message, transfer: { ...message.transfer!, status } }
                : message), receipt],
            updatedAt: Date.now(),
        };
        updateActive(() => nextSession);
        if (nextSession.familiar) void syncFamiliarContinuity(nextSession)
            .catch(error => console.warn('[Mihui] 转账回执记忆回写失败', error));
        addToast(status === 'accepted' ? '已接收转账' : '已退回转账', 'success');
    };

    const buildLinkedCharacter = async (): Promise<string> => {
        if (!activeSession) throw new Error('当前匹配已经失效');
        const sourceCharacter = activeSession.familiar
            ? characters.find(item => item.id === activeSession.familiar?.characterId)
            : undefined;
        // 老版本曾把 linkedCharacterId 直接写成真实熟人 id；绝不能把原角色卡改成化名。
        const existing = activeSession.linkedCharacterId && activeSession.linkedCharacterId !== activeSession.familiar?.characterId
            ? characters.find(item => item.id === activeSession.linkedCharacterId)
            : undefined;
        const card = buildMihuiCharacterCard(activeSession);
        const linked = existing || await addCharacter();
        const transcript = activeSession.messages.slice(-30)
            .map(message => `${message.role === 'user' ? (userProfile.name || '用户') : activeSession.persona.name}：${mihuiMessageSummary(message)}`)
            .join('\n');
        const familiarMeetingRule = sourceCharacter ? `\n[后台真实身份规则]\n你实际上是「${sourceCharacter.name}」，必须保留以下真实人设、情感和说话习惯：\n${sourceCharacter.systemPrompt}\n${sourceCharacter.worldview || ''}\n但这次见面仍是密会化名阶段。你必须以「${activeSession.persona.name}」的外在身份赴约，像与陌生网友第一次线下见面一样自然谨慎；不能主动说出真名、神经链接身份或完整共同经历，也不能直接否认你认识用户。可以回避、装傻、试探或露出轻微熟悉感。` : '';
        const memoryEntry = {
            id: `mihui-meet-memory-${activeSession.id}`,
            date: new Date().toISOString(),
            summary: transcript,
            mood: sourceCharacter ? '以密会化名第一次线下见面' : '从密会相识后的共同回忆',
        };
        await updateCharacter(linked.id, previous => {
            const previousMemories = previous.memories || [];
            const memoryIndex = previousMemories.findIndex(memory => memory.id === memoryEntry.id);
            return {
            name: card.name,
            description: card.description,
            systemPrompt: `${card.systemPrompt || ''}${familiarMeetingRule}`,
            worldview: `${card.worldview || ''}\n\n密会最新聊天（见面必须承接）：\n${transcript}`,
            memories: memoryIndex >= 0
                ? previousMemories.map((memory, index) => index === memoryIndex ? memoryEntry : memory)
                : [...previousMemories, memoryEntry],
            };
        });
        updateActive(session => ({ ...session, linkedCharacterId: linked.id, updatedAt: Date.now() }));
        return linked.id;
    };

    const openMeetup = async () => {
        if (!activeSession || openingMeetup) return;
        setOpeningMeetup(true);
        try {
            const characterId = await buildLinkedCharacter();
            if (!characterId) throw new Error('没有找到可以见面的角色');
            openDateWithChar(characterId, AppID.Mihui);
        } catch (error: any) {
            addToast(error?.message || '见面模式打开失败', 'error');
            setOpeningMeetup(false);
        }
    };

    const regenerateLastReply = async () => {
        if (!activeSession || sending || regenerating) return;
        const messages = activeSession.messages;
        const targetIndex = messages.length - 1;
        const target = messages[targetIndex];
        if (!target || target.role !== 'assistant') {
            addToast('只能重新生成最后一条 AI 回复', 'info');
            return;
        }
        const targetTurnId = target.turnId;
        const turnStartIndex = targetTurnId
            ? messages.findIndex(message => message.role === 'assistant' && message.turnId === targetTurnId)
            : targetIndex;
        const history = messages.slice(0, Math.max(0, turnStartIndex));
        if (!history.some(message => message.role === 'user')) {
            addToast('匹配开场白暂不支持重新生成', 'info');
            return;
        }
        setSelectedMessage(null);
        setRegenerating(true);
        try {
            const sourceCharacter = activeSession.familiar
                ? characters.find(character => character.id === activeSession.familiar?.characterId)
                : undefined;
            const familiarContinuity = sourceCharacter ? await loadFamiliarContinuity(sourceCharacter) : '';
            const result = await generateMihuiReply(apiConfig, userProfile, { ...activeSession, messages: history }, sourceCharacter, familiarContinuity, state.tuning);
            const replyTurnId = targetTurnId || `mh-turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const replyTimestamp = Date.now();
            const replacements: MihuiMessage[] = result.bubbles.map((content, index) => ({
                id: messageId(), role: 'assistant', type: 'text', content, turnId: replyTurnId, timestamp: replyTimestamp + index,
            }));
            if (result.location) replacements.push({
                id: messageId(), role: 'assistant', type: 'location', content: result.location.name,
                location: result.location, turnId: replyTurnId, timestamp: replyTimestamp + replacements.length,
            });
            if (result.transfer) replacements.push({
                id: messageId(), role: 'assistant', type: 'transfer', content: '[转账]',
                transfer: { ...result.transfer, status: 'pending' }, turnId: replyTurnId, timestamp: replyTimestamp + replacements.length,
            });
            const applyReplacements = (session: MihuiSession): MihuiSession => {
                const firstIndex = targetTurnId
                    ? session.messages.findIndex(message => message.role === 'assistant' && message.turnId === targetTurnId)
                    : session.messages.findIndex(message => message.id === target.id);
                const retained = targetTurnId
                    ? session.messages.filter(message => message.turnId !== targetTurnId)
                    : session.messages.filter(message => message.id !== target.id);
                retained.splice(Math.max(0, firstIndex), 0, ...replacements);
                return { ...session, messages: retained, updatedAt: Date.now() };
            };
            const replacedSession = applyReplacements(activeSession);
            updateActive(applyReplacements);
            if (activeSession.familiar) await syncFamiliarContinuity(replacedSession)
                .catch(error => console.warn('[Mihui] 重生成后的熟人记忆回写失败', error));
            addToast('已换一种回复，好感度保持不变', 'success');
        } catch (error: any) {
            addToast(error?.message || '重新生成失败', 'error');
        } finally {
            setRegenerating(false);
        }
    };

    const deleteSelectedMessage = () => {
        if (!selectedMessage) return;
        const deletedId = selectedMessage.id;
        const nextSession = activeSession ? removeMihuiMessage(activeSession, deletedId) : undefined;
        updateActive(session => removeMihuiMessage(session, deletedId));
        if (nextSession?.familiar) void syncFamiliarContinuity(nextSession)
            .catch(error => console.warn('[Mihui] 删除消息后的熟人记忆回写失败', error));
        setSelectedMessage(null);
        addToast('消息已删除，好感度保持不变', 'success');
    };

    const addToNeuralLink = async () => {
        if (!activeSession) return;
        const card = buildMihuiCharacterCard(activeSession);
        try {
            const existing = activeSession.linkedCharacterId && characters.find(item => item.id === activeSession.linkedCharacterId);
            const created = existing || await addCharacter();
            await updateCharacter(created.id, {
                name: card.name,
                description: card.description,
                systemPrompt: card.systemPrompt,
                worldview: card.worldview,
                memories: activeSession.messages.length ? [{
                    id: `mihui-memory-${Date.now()}`,
                    date: new Date().toISOString(),
                    summary: activeSession.messages.slice(-18).map(message => `${message.role === 'user' ? '用户' : card.name}：${mihuiMessageSummary(message)}`).join('\n'),
                    mood: '从密会相识后的共同回忆',
                }] : [],
            });
            updateActive(session => ({ ...session, linkedCharacterId: created.id, graduatedAt: Date.now() }));
            setShowGraduation(false);
            addToast(`${card.name} 已加入神经链接`, 'success');
        } catch (error: any) {
            addToast(error?.message || '加入神经链接失败', 'error');
        }
    };

    const removeSession = () => {
        if (!activeSession || !window.confirm(`结束与「${displayName(activeSession)}」的匹配并删除本地聊天吗？`)) return;
        setState(prev => ({ ...prev, activeSessionId: undefined, sessions: prev.sessions.filter(s => s.id !== activeSession.id) }));
        setShowProfile(false);
        setScreen('home');
    };

    const back = () => {
        if (showGazeSettings) return setShowGazeSettings(false);
        if (showTuning) return setShowTuning(false);
        if (showAppearance) return setShowAppearance(false);
        if (showProfile) return setShowProfile(false);
        if (screen === 'chat' || screen === 'match') return setScreen('home');
        closeApp();
    };

    const renderHome = () => (
        <div className="flex-1 overflow-y-auto px-5 pb-10">
            <section className="mt-4 rounded-[2rem] bg-gradient-to-br from-[var(--mh-hero-1)] via-[var(--mh-hero-2)] to-[var(--mh-hero-3)] p-6 text-white shadow-[0_22px_45px_-22px_rgba(67,40,50,.72)] relative overflow-hidden">
                <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/15" />
                <div className="absolute right-10 bottom-0 w-24 h-24 rounded-full bg-white/10" />
                <p className="text-[11px] font-bold tracking-[.35em] text-white/75">LOCAL ENCOUNTER</p>
                <h1 className="mt-3 text-4xl font-black tracking-tight">密会</h1>
                <p className="mt-2 max-w-[15rem] text-sm leading-6 text-white/85">今晚也许会遇见一个，本来不在你生活里的人。</p>
                <div className="mt-6 flex gap-3 relative">
                    <button onClick={() => { setMatchError(''); setScreen('match'); }} className="flex-1 rounded-2xl bg-[var(--mh-panel)] px-4 py-3 text-sm font-black text-[var(--mh-accent)] shadow-lg active:scale-[.98] transition">选择偏好</button>
                    <button onClick={() => match(true)} disabled={matching} className="flex-1 rounded-2xl bg-[var(--mh-accent-strong)] px-4 py-3 text-sm font-black text-[var(--mh-on-accent)] active:scale-[.98] disabled:opacity-60 transition flex items-center justify-center gap-2">
                        <Shuffle size={18} /> {matching ? '匹配中…' : '快速匹配'}
                    </button>
                </div>
            </section>

            {matchError && <div className="mt-3 rounded-2xl border border-[#e4c5cf] bg-[#f8e9ee] px-4 py-3 text-xs leading-5 text-[#8b4e62]">{matchError}</div>}

            <div className="mt-7 flex items-center justify-between">
                <div>
                    <p className="text-lg font-black text-slate-800">最近遇见</p>
                    <p className="text-[11px] text-slate-400">聊天只保存在这台设备</p>
                </div>
                <span className="rounded-full bg-[var(--mh-soft)] px-3 py-1 text-xs font-bold text-[var(--mh-accent)]">{state.sessions.length} 人</span>
            </div>

            <div className="mt-3 space-y-3">
                {!state.sessions.length && (
                    <div className="rounded-[1.75rem] border border-dashed border-[#d9b8c3] bg-white/70 p-8 text-center">
                        <Users size={38} className="mx-auto text-[#bd8d9d]" />
                        <p className="mt-3 text-sm font-bold text-slate-600">还没有匹配记录</p>
                        <p className="mt-1 text-xs text-slate-400">资料越具体，遇见的人越像活在同一座城。</p>
                    </div>
                )}
                {state.sessions.map(session => {
                    const last = session.messages[session.messages.length - 1];
                    const revealed = isRevealed(session);
                    return (
                        <button key={session.id} onClick={() => openSession(session.id)} className="w-full rounded-[1.5rem] border border-[var(--mh-border)] bg-[var(--mh-panel)] p-4 text-left shadow-[0_12px_30px_-22px_rgba(74,45,56,.45)] flex items-center gap-3 active:scale-[.99] transition">
                            {renderSessionAvatar(session, 'w-14 h-14')}
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-black text-slate-800">{displayName(session)}</span>
                                    <span className="text-[10px] text-slate-400">{revealed ? `曾用化名 ${session.persona.name}` : `${session.persona.age} · ${session.persona.occupation}`}</span>
                                </div>
                                <p className="mt-1 truncate text-xs text-slate-500">{last ? mihuiMessageSummary(last) : '等待开场'}</p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-[10px] font-bold text-[var(--mh-accent)]">{affinityStage(session.affinity)}</p>
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
                <p className="text-[11px] font-bold tracking-[.28em] text-[var(--mh-accent)]">MATCH FILTER</p>
                <h2 className="mt-1 text-3xl font-black text-slate-800">今晚想遇见谁？</h2>
                <p className="mt-2 text-xs leading-5 text-slate-400">偏好是方向，不是流水线。生成的人会有自己的生活、边界和脾气。</p>
                {matchError && <div className="mt-4 rounded-2xl border border-[#e4c5cf] bg-[#f8e9ee] px-4 py-3 text-xs leading-5 text-[#8b4e62]">{matchError}</div>}
            </div>

            <div className="mt-6 space-y-5">
                <section>
                    <label className="text-xs font-black text-slate-600">对方性别</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {(Object.keys(genderLabel) as MihuiGender[]).map(key => (
                            <button key={key} onClick={() => patchPreferences('gender', key)} className={`${chipClass} ${draftPrefs.gender === key ? 'bg-[var(--mh-accent)] text-[var(--mh-on-accent)] shadow-md' : 'bg-[var(--mh-panel)] text-[var(--mh-muted)] border border-[var(--mh-border)]'}`}>{genderLabel[key]}</button>
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
                        <label className="text-xs font-black text-slate-600 flex items-center gap-1.5"><Icon size={15} className="text-[var(--mh-accent)]" />{label}</label>
                        <input className={`${fieldClass} mt-2`} value={draftPrefs[key]} onChange={e => patchPreferences(key, e.target.value)} placeholder={placeholder} />
                    </section>
                ))}

                <section>
                    <label className="text-xs font-black text-slate-600">其他想说的</label>
                    <textarea className={`${fieldClass} mt-2 min-h-28 resize-none`} value={draftPrefs.custom} onChange={e => patchPreferences('custom', e.target.value)} placeholder="任何不适合塞进标签里的偏好、雷区或灵感……" />
                </section>
            </div>

            <button onClick={() => match(false)} disabled={matching} className="mt-7 w-full rounded-2xl bg-[var(--mh-accent-strong)] py-4 text-sm font-black text-[var(--mh-on-accent)] shadow-[0_16px_30px_-15px_rgba(54,35,43,.75)] disabled:opacity-60 active:scale-[.99] transition">
                {matching ? '正在穿过人群寻找…' : '开始匹配'}
            </button>
        </div>
    );

    const renderProfileSheet = () => {
        if (!activeSession || !showProfile) return null;
        const p = activeSession.persona;
        const hiddenFamiliar = activeSession.familiar && !activeSession.familiar.revealedAt;
        const revealedFamiliar = activeSession.familiar?.revealedAt;
        return (
            <div className="absolute inset-0 z-40 bg-black/35 backdrop-blur-sm flex items-end" onClick={() => setShowProfile(false)}>
                <div className="w-full max-h-[82%] overflow-y-auto rounded-t-[2.25rem] bg-[var(--mh-bg)] p-6 pb-10 shadow-2xl" onClick={e => e.stopPropagation()}>
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            {renderSessionAvatar(activeSession, 'w-20 h-20')}
                            <div><h3 className="text-2xl font-black text-slate-800">{displayName(activeSession)}</h3><p className="mt-1 text-xs text-slate-400">{revealedFamiliar ? `曾用化名 ${p.name}` : `${p.age}岁 · ${p.gender} · ${p.city}`}</p></div>
                        </div>
                        <button onClick={() => setShowProfile(false)} className="w-10 h-10 rounded-full bg-[var(--mh-panel)] grid place-items-center text-[var(--mh-muted)]"><X size={20} /></button>
                    </div>
                    {hiddenFamiliar ? (
                        <div className="mt-6 rounded-2xl border border-[var(--mh-border)] bg-[var(--mh-panel)] p-6 text-center">
                            <Question size={28} className="mx-auto text-[#bd8d9d]" />
                            <p className="mt-3 font-black text-slate-700">对方暂未公开更多资料</p>
                            <p className="mt-1 text-xs leading-5 text-slate-400">先聊聊看，也许会发现一点熟悉的痕迹。</p>
                        </div>
                    ) : (
                        <>
                            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                                <div className="rounded-2xl bg-[var(--mh-panel)] p-4"><p className="text-[10px] font-bold text-[var(--mh-accent)]">职业</p><p className="mt-1 font-bold text-slate-700">{p.occupation}</p></div>
                                <div className="rounded-2xl bg-[var(--mh-panel)] p-4"><p className="text-[10px] font-bold text-[var(--mh-accent)]">关系倾向</p><p className="mt-1 font-bold text-slate-700">{p.relationshipIntent}</p></div>
                            </div>
                            {[[ '外貌印象', p.appearance ], [ '性格', p.personality ], [ '相处方式', p.socialStyle ], [ '个人背景', p.background ]].map(([label, value]) => (
                                <div key={label} className="mt-3 rounded-2xl bg-[var(--mh-panel)] p-4"><p className="text-[10px] font-bold text-[var(--mh-accent)]">{label}</p><p className="mt-1 text-sm leading-6 text-slate-600">{value}</p></div>
                            ))}
                        </>
                    )}
                    <button onClick={removeSession} className="mt-6 w-full rounded-2xl border border-rose-100 bg-rose-50 py-3 text-sm font-bold text-rose-500">结束这次匹配</button>
                </div>
            </div>
        );
    };

    const renderGraduation = () => {
        if (!activeSession || !showGraduation) return null;
        if (activeSession.familiar?.revealedAt) {
            const characterId = activeSession.familiar.characterId;
            return (
                <div className="absolute inset-0 z-50 bg-black/55 backdrop-blur-md grid place-items-center p-6">
                    <div className="w-full rounded-[2rem] bg-[var(--mh-panel)] p-6 text-center shadow-2xl">
                        <div className="flex justify-center">{renderSessionAvatar(activeSession, 'w-20 h-20')}</div>
                        <p className="mt-4 text-[10px] font-black tracking-[.3em] text-[var(--mh-accent)]">IDENTITY REVEALED</p>
                        <h3 className="mt-1 text-2xl font-black text-slate-800">原来是 {displayName(activeSession)}</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-500">{activeSession.familiar.revealLine || `在密会里使用「${activeSession.persona.name}」这个化名的人，原来一直是 ta。`}</p>
                        <button onClick={() => { setActiveCharacterId(characterId); openApp(AppID.Chat); setShowGraduation(false); }} className="mt-6 w-full rounded-2xl bg-[var(--mh-accent-strong)] py-3.5 text-sm font-black text-[var(--mh-on-accent)] flex items-center justify-center gap-2"><ChatsCircle size={18} />去单聊看看</button>
                        <button onClick={() => setShowGraduation(false)} className="mt-3 text-xs font-bold text-slate-400">先留在密会</button>
                    </div>
                </div>
            );
        }
        const card = buildMihuiCharacterCard(activeSession);
        return (
            <div className="absolute inset-0 z-50 bg-black/55 backdrop-blur-md grid place-items-center p-6">
                <div className="w-full rounded-[2rem] bg-[var(--mh-panel)] p-6 text-center shadow-2xl">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-[var(--mh-soft)] text-[var(--mh-accent)] grid place-items-center"><Heart size={30} weight="fill" /></div>
                    <h3 className="mt-4 text-2xl font-black text-slate-800">不只是一次匹配了</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">你和 {activeSession.persona.name} 已经积累了足够多的共同语境。可以把 ta 带回 Morpho，继续生活。</p>
                    <button onClick={addToNeuralLink} className="mt-6 w-full rounded-2xl bg-[var(--mh-accent-strong)] py-3.5 text-sm font-black text-[var(--mh-on-accent)] flex items-center justify-center gap-2"><UserPlus size={18} />加入神经链接</button>
                    <button onClick={() => { downloadCard(card); addToast('角色卡已下载', 'success'); }} className="mt-2 w-full rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-600 flex items-center justify-center gap-2"><DownloadSimple size={18} />下载角色卡</button>
                    <button onClick={() => setShowGraduation(false)} className="mt-3 text-xs font-bold text-slate-400">先继续聊聊</button>
                </div>
            </div>
        );
    };

    const renderMessageOptions = () => {
        if (!activeSession || !selectedMessage) return null;
        const lastMessage = activeSession.messages[activeSession.messages.length - 1];
        const canRegenerate = selectedMessage.role === 'assistant'
            && (lastMessage?.id === selectedMessage.id || Boolean(selectedMessage.turnId && selectedMessage.turnId === lastMessage?.turnId))
            && activeSession.messages.some(message => message.role === 'user');
        return (
            <div className="absolute inset-0 z-[65] flex items-end bg-black/45 backdrop-blur-sm" onClick={() => setSelectedMessage(null)}>
                <div className="w-full rounded-t-[2rem] bg-[var(--mh-bg)] p-5 pb-[calc(var(--safe-bottom)+1.25rem)] shadow-2xl" onClick={event => event.stopPropagation()}>
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--mh-soft-2)]" />
                    <p className="line-clamp-3 rounded-2xl bg-[var(--mh-panel)] px-4 py-3 text-xs leading-5 text-[var(--mh-muted)]">{mihuiMessageSummary(selectedMessage)}</p>
                    {canRegenerate && (
                        <button onClick={regenerateLastReply} disabled={regenerating} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--mh-accent-strong)] py-3.5 text-sm font-black text-[var(--mh-on-accent)] disabled:opacity-50">
                            <ArrowClockwise size={18} className={regenerating ? 'animate-spin' : ''} />重新生成这次回复
                        </button>
                    )}
                    {selectedMessage.role === 'assistant' && !canRegenerate && (
                        <p className="mt-3 text-center text-[11px] text-[#9e8991]">为保证后续上下文连贯，仅最后一条 AI 回复可以重新生成</p>
                    )}
                    <button onClick={deleteSelectedMessage} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#e5cbd4] bg-white py-3.5 text-sm font-black text-[#a14f69]">
                        <Trash size={18} />删除这条消息
                    </button>
                    <button onClick={() => setSelectedMessage(null)} className="mt-2 w-full py-3 text-sm font-bold text-[var(--mh-muted)]">取消</button>
                </div>
            </div>
        );
    };

    const renderLocationSheet = () => {
        if (!showLocation) return null;
        return (
            <div className="absolute inset-0 z-[60] flex items-end bg-black/45 backdrop-blur-sm" onClick={() => setShowLocation(false)}>
                <div className="w-full rounded-t-[2rem] bg-[var(--mh-bg)] p-5 pb-[calc(var(--safe-bottom)+1.25rem)] shadow-2xl" onClick={event => event.stopPropagation()}>
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--mh-soft-2)]" />
                    <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--mh-soft)] text-[var(--mh-accent)]"><MapPin size={22} weight="fill" /></div><div><p className="font-black text-slate-800">发送位置</p><p className="text-[11px] text-slate-400">只生成本地卡片，不读取真实定位</p></div></div>
                    <input value={locationName} onChange={event => setLocationName(event.target.value)} className={`${fieldClass} mt-5`} placeholder="位置名称，例如：三里屯太古里" autoFocus />
                    <input value={locationAddress} onChange={event => setLocationAddress(event.target.value)} className={`${fieldClass} mt-3`} placeholder="详细地址或备注（可选）" />
                    <button onClick={sendLocation} disabled={!locationName.trim()} className="mt-4 w-full rounded-2xl bg-[var(--mh-accent-strong)] py-3.5 text-sm font-black text-[var(--mh-on-accent)] disabled:opacity-40">发送位置卡片</button>
                    <button onClick={() => setShowLocation(false)} className="mt-2 w-full py-3 text-sm font-bold text-[var(--mh-muted)]">取消</button>
                </div>
            </div>
        );
    };

    const renderTransferSheet = () => {
        if (!showTransfer) return null;
        const amount = Number(transferAmount);
        return (
            <div className="absolute inset-0 z-[60] flex items-end bg-black/45 backdrop-blur-sm" onClick={() => setShowTransfer(false)}>
                <div className="w-full rounded-t-[2rem] bg-[var(--mh-bg)] p-5 pb-[calc(var(--safe-bottom)+1.25rem)] shadow-2xl" onClick={event => event.stopPropagation()}>
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--mh-soft-2)]" />
                    <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--mh-soft)] text-[var(--mh-accent)]"><CurrencyCircleDollar size={23} weight="fill" /></div><div><p className="font-black text-[var(--mh-text)]">发起转账</p><p className="text-[11px] text-[var(--mh-muted)]">金额只用于剧情互动，不关联真实支付</p></div></div>
                    <div className="mt-5 rounded-2xl border border-[var(--mh-border)] bg-[var(--mh-panel)] px-4 py-3"><span className="text-lg font-black text-[var(--mh-accent)]">¥</span><input type="number" min="0.01" max="999999" step="0.01" value={transferAmount} onChange={event => setTransferAmount(event.target.value)} className="ml-2 w-[calc(100%-2rem)] bg-transparent text-2xl font-black text-[var(--mh-text)] outline-none" placeholder="0.00" autoFocus /></div>
                    <input value={transferNote} onChange={event => setTransferNote(event.target.value.slice(0, 80))} className={`${fieldClass} mt-3`} placeholder="转账留言（可选）" />
                    <button onClick={sendTransfer} disabled={!Number.isFinite(amount) || amount <= 0} className="mt-4 w-full rounded-2xl bg-[var(--mh-accent-strong)] py-3.5 text-sm font-black text-[var(--mh-on-accent)] disabled:opacity-40">确认转账</button>
                    <button onClick={() => setShowTransfer(false)} className="mt-2 w-full py-3 text-sm font-bold text-[var(--mh-muted)]">取消</button>
                </div>
            </div>
        );
    };

    const renderTuningSheet = () => {
        if (!showTuning) return null;
        const routeOptions = [
            { id: 'abyss' as const, label: '深渊' },
            { id: 'standard' as const, label: '标准' },
            { id: 'decent' as const, label: '体面' },
        ];
        const creativeOptions = [
            { id: 'faithful' as const, label: '贴合设定' },
            { id: 'balanced' as const, label: '灵活平衡' },
            { id: 'free' as const, label: '自由发挥' },
        ];
        const optionClass = (selected: boolean) => `rounded-2xl border px-3 py-3 text-left transition active:scale-[.98] ${selected
            ? 'border-[var(--mh-accent)] bg-[var(--mh-soft)] shadow-sm'
            : 'border-[var(--mh-border)] bg-[var(--mh-panel)]'}`;
        return (
            <div className="absolute inset-0 z-[69] flex items-end bg-black/45 backdrop-blur-sm" onClick={() => setShowTuning(false)}>
                <div className="w-full max-h-[86%] overflow-y-auto rounded-t-[2.25rem] bg-[var(--mh-bg)] p-5 pb-[calc(var(--safe-bottom)+1.25rem)] shadow-2xl" onClick={event => event.stopPropagation()}>
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--mh-soft-2)]" />
                    <div className="flex items-center justify-between">
                        <div><p className="text-[10px] font-black tracking-[.28em] text-[var(--mh-accent)]">MIHUI TUNING</p><h3 className="mt-1 text-xl font-black text-[var(--mh-text)]">密会调校</h3></div>
                        <button onClick={() => setShowTuning(false)} className="grid h-10 w-10 place-items-center rounded-full bg-[var(--mh-panel)] text-[var(--mh-muted)]"><X size={19} /></button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--mh-muted)]">只影响密会中的人物生成与每轮聊天，不改变全局 API 设置。</p>

                    <section className="mt-6">
                        <div className="flex items-end justify-between"><h4 className="text-sm font-black text-[var(--mh-text)]">航线模式</h4><span className="text-[10px] text-[var(--mh-muted)]">关系边界与推进方式</span></div>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                            {routeOptions.map(option => (
                                <button key={option.id} type="button" onClick={() => setDraftTuning(prev => ({ ...prev, routeMode: option.id }))} className={optionClass(draftTuning.routeMode === option.id)}>
                                    <strong className="block text-xs text-[var(--mh-text)]">{option.label}</strong>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="mt-6">
                        <div className="flex items-end justify-between"><h4 className="text-sm font-black text-[var(--mh-text)]">角色发挥</h4><span className="text-[10px] text-[var(--mh-muted)]">模型自由度</span></div>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                            {creativeOptions.map(option => (
                                <button key={option.id} type="button" onClick={() => setDraftTuning(prev => ({ ...prev, creativeMode: option.id }))} className={optionClass(draftTuning.creativeMode === option.id)}>
                                    <strong className="block text-xs text-[var(--mh-text)]">{option.label}</strong>
                                </button>
                            ))}
                        </div>
                    </section>

                    <div className="mt-6 rounded-2xl border border-[var(--mh-border)] bg-[var(--mh-panel)] px-4 py-3 text-[11px] leading-5 text-[var(--mh-muted)]">
                        无论选择哪条航线，人物都会保留基本体面与约会诚意；消费和付出会遵循年龄、职业与经济能力，不靠虚构财富制造慷慨。
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setState(prev => ({ ...prev, tuning: { ...draftTuning } }));
                            setShowTuning(false);
                            addToast('密会调校已保存，将从下一轮聊天生效', 'success');
                        }}
                        className="mt-5 w-full rounded-2xl bg-[var(--mh-accent-strong)] py-4 text-sm font-black text-[var(--mh-on-accent)] shadow-lg active:scale-[.99] transition"
                    >
                        保存调校
                    </button>
                </div>
            </div>
        );
    };

    const renderGazeSettingsSheet = () => {
        if (!showGazeSettings) return null;
        const frequencyOptions = [
            { id: 'occasional' as const, label: '偶尔', note: '更像一次意外撞见' },
            { id: 'balanced' as const, label: '适中', note: '有存在感，不会催得太紧' },
            { id: 'lively' as const, label: '热闹', note: '更容易被熟人察觉' },
        ];
        const barrageCooldownOptions = [2, 6, 12, 24];
        const watcherCount = characters.filter(character => character.activeMsg2Config?.enabled === true || character.proactiveConfig?.enabled === true).length;
        return (
            <div className="absolute inset-0 z-[69] flex items-end bg-black/45 backdrop-blur-sm" onClick={() => setShowGazeSettings(false)}>
                <div className="w-full max-h-[86%] overflow-y-auto rounded-t-[2.25rem] bg-[var(--mh-bg)] p-5 pb-[calc(var(--safe-bottom)+1.25rem)] shadow-2xl" onClick={event => event.stopPropagation()}>
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--mh-soft-2)]" />
                    <div className="flex items-center justify-between">
                        <div><p className="text-[10px] font-black tracking-[.28em] text-[var(--mh-accent)]">DANGEROUS GAZE</p><h3 className="mt-1 text-xl font-black text-[var(--mh-text)]">危险凝视</h3></div>
                        <button onClick={() => setShowGazeSettings(false)} className="grid h-10 w-10 place-items-center rounded-full bg-[var(--mh-panel)] text-[var(--mh-muted)]"><X size={19} /></button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--mh-muted)]">让已开启主动消息的角色偶尔察觉你正在使用密会。角色只知道“你上线了”，不会读取这里的聊天正文。</p>

                    <section className="mt-6 rounded-2xl border border-[var(--mh-border)] bg-[var(--mh-panel)] p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div><h4 className="text-sm font-black text-[var(--mh-text)]">开启凝视</h4><p className="mt-1 text-[10px] leading-4 text-[var(--mh-muted)]">当前可参与角色 {watcherCount} 位</p></div>
                            <button type="button" onClick={() => setDraftGaze(prev => ({ ...prev, enabled: !prev.enabled }))} className={`relative h-7 w-12 rounded-full transition ${draftGaze.enabled ? 'bg-[var(--mh-accent)]' : 'bg-slate-300'}`} aria-label={draftGaze.enabled ? '关闭危险凝视' : '开启危险凝视'}>
                                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${draftGaze.enabled ? 'left-6' : 'left-1'}`} />
                            </button>
                        </div>
                    </section>

                    <section className={`mt-5 transition ${draftGaze.enabled ? '' : 'opacity-45 pointer-events-none'}`}>
                        <div className="flex items-end justify-between"><h4 className="text-sm font-black text-[var(--mh-text)]">出现频率</h4><span className="text-[10px] text-[var(--mh-muted)]">普通横幅每次密会最多 1-2 次</span></div>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                            {frequencyOptions.map(option => {
                                const selected = draftGaze.frequency === option.id;
                                return <button key={option.id} type="button" onClick={() => setDraftGaze(prev => ({ ...prev, frequency: option.id }))} className={`rounded-2xl border px-3 py-3 text-left transition active:scale-[.98] ${selected ? 'border-[var(--mh-accent)] bg-[var(--mh-soft)] shadow-sm' : 'border-[var(--mh-border)] bg-[var(--mh-panel)]'}`}><strong className="block text-xs text-[var(--mh-text)]">{option.label}</strong><span className="mt-1 block text-[9px] leading-4 text-[var(--mh-muted)]">{option.note}</span></button>;
                            })}
                        </div>
                    </section>

                    <section className={`mt-5 rounded-2xl border border-[var(--mh-border)] bg-[var(--mh-panel)] p-4 transition ${draftGaze.enabled ? '' : 'opacity-45 pointer-events-none'}`}>
                        <div className="flex items-center justify-between gap-4">
                            <div><h4 className="text-sm font-black text-[var(--mh-text)]">催命弹幕</h4><p className="mt-1 text-[10px] leading-4 text-[var(--mh-muted)]">暧昧升高时偶发；同一冷却期内最多一次</p></div>
                            <button type="button" onClick={() => setDraftGaze(prev => ({ ...prev, barrageEnabled: !prev.barrageEnabled }))} className={`relative h-7 w-12 rounded-full transition ${draftGaze.barrageEnabled ? 'bg-[var(--mh-accent)]' : 'bg-slate-300'}`} aria-label={draftGaze.barrageEnabled ? '关闭催命弹幕' : '开启催命弹幕'}>
                                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${draftGaze.barrageEnabled ? 'left-6' : 'left-1'}`} />
                            </button>
                        </div>
                        <div className={`mt-4 transition ${draftGaze.barrageEnabled ? '' : 'opacity-45 pointer-events-none'}`}>
                            <div className="flex items-center justify-between"><span className="text-xs font-bold text-[var(--mh-text)]">轰炸冷却</span><span className="text-[10px] text-[var(--mh-muted)]">最低 2 小时</span></div>
                            <div className="mt-2 grid grid-cols-4 gap-2">
                                {barrageCooldownOptions.map(hours => {
                                    const selected = draftGaze.barrageCooldownHours === hours;
                                    return <button key={hours} type="button" onClick={() => setDraftGaze(prev => ({ ...prev, barrageCooldownHours: hours }))} className={`rounded-xl border py-2 text-xs font-black transition active:scale-95 ${selected ? 'border-[var(--mh-accent)] bg-[var(--mh-soft)] text-[var(--mh-accent)]' : 'border-[var(--mh-border)] bg-[var(--mh-bg)] text-[var(--mh-muted)]'}`}>{hours} 小时</button>;
                                })}
                            </div>
                            <button
                                type="button"
                                onClick={testGazeBarrage}
                                disabled={testingGazeBarrage || watcherCount === 0}
                                className="mt-3 w-full rounded-xl border border-dashed border-[var(--mh-accent)] bg-[var(--mh-soft)] py-2.5 text-xs font-black text-[var(--mh-accent)] transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                {testingGazeBarrage ? '正在呼叫抓包角色…' : '立即试放催命弹幕'}
                            </button>
                            <p className="mt-2 text-[9px] leading-4 text-[var(--mh-muted)]">调试会调用一轮全局 API，但不写入私聊、不占正式触发次数，也不重置冷却。</p>
                        </div>
                    </section>

                    <div className="mt-5 rounded-2xl border border-[var(--mh-border)] bg-[var(--mh-panel)] px-4 py-3 text-[11px] leading-5 text-[var(--mh-muted)]">每次真正触发横幅或弹幕，都会额外调用一轮全局 API，让角色按自己的设定临场生成消息；触发判断本身不调用 API。</div>
                    <button type="button" onClick={() => {
                        setState(prev => ({ ...prev, gaze: { ...draftGaze, events: prev.gaze?.events || [] } }));
                        setShowGazeSettings(false);
                        addToast('危险凝视设置已保存', 'success');
                    }} className="mt-5 w-full rounded-2xl bg-[var(--mh-accent-strong)] py-4 text-sm font-black text-[var(--mh-on-accent)] shadow-lg active:scale-[.99] transition">保存设置</button>
                </div>
            </div>
        );
    };

    const renderAppearanceSheet = () => {
        if (!showAppearance) return null;
        return (
            <div className="absolute inset-0 z-[68] flex items-end bg-black/45 backdrop-blur-sm" onClick={() => setShowAppearance(false)}>
                <div className="w-full max-h-[86%] overflow-y-auto rounded-t-[2.25rem] bg-[var(--mh-bg)] p-5 pb-[calc(var(--safe-bottom)+1.25rem)] shadow-2xl" onClick={event => event.stopPropagation()}>
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--mh-soft-2)]" />
                    <div className="flex items-center justify-between">
                        <div><p className="text-[10px] font-black tracking-[.28em] text-[var(--mh-accent)]">MIHUI APPEARANCE</p><h3 className="mt-1 text-xl font-black text-[var(--mh-text)]">密会装扮</h3></div>
                        <button onClick={() => setShowAppearance(false)} className="grid h-10 w-10 place-items-center rounded-full bg-[var(--mh-panel)] text-[var(--mh-muted)]"><X size={19} /></button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--mh-muted)]">只更换密会 App 的界面、文字与聊天气泡，不影响 Morpho 的其他软件。</p>
                    <div className="mt-5 space-y-4">
                        {(Object.values(MIHUI_THEMES) as MihuiThemeDefinition[]).map(theme => {
                            const selected = state.theme === theme.id || (!state.theme && theme.id === 'noir');
                            const previewStyle = theme.vars as React.CSSProperties;
                            return (
                                <button
                                    key={theme.id}
                                    type="button"
                                    onClick={() => setState(prev => ({ ...prev, theme: theme.id }))}
                                    style={previewStyle}
                                    className={`w-full overflow-hidden rounded-[1.6rem] border-2 bg-[var(--mh-panel)] p-4 text-left transition active:scale-[.99] ${selected ? 'border-[var(--mh-accent)] shadow-lg' : 'border-transparent'}`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div><strong className="block text-sm text-[var(--mh-text)]">{theme.name}</strong><span className="mt-0.5 block text-[10px] text-[var(--mh-muted)]">{theme.subtitle}</span></div>
                                        <div className="flex -space-x-1.5">{theme.colors.map(color => <span key={color} className="h-7 w-7 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: color }} />)}</div>
                                    </div>
                                    <div className="mt-4 rounded-2xl bg-[var(--mh-bg)] p-3">
                                        <span className="block w-fit max-w-[82%] rounded-2xl rounded-bl-md border border-[var(--mh-border)] bg-[var(--mh-assistant-bubble)] px-3 py-2 text-[11px] text-[var(--mh-assistant-text)]">今晚有空吗？ᗜᴗᗜ</span>
                                        <span className="ml-auto mt-2 block w-fit max-w-[82%] rounded-2xl rounded-br-md bg-[var(--mh-user-bubble)] px-3 py-2 text-[11px] text-[var(--mh-user-text)]">那要看你准备带我去哪。</span>
                                    </div>
                                    <span className={`mt-3 block text-center text-[11px] font-black ${selected ? 'text-[var(--mh-accent)]' : 'text-[var(--mh-muted)]'}`}>{selected ? '✓ 正在使用' : '一键换上'}</span>
                                </button>
                            );
                        })}
                    </div>
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
                <div className="px-4 pb-3 border-b border-[var(--mh-border)] bg-[var(--mh-panel)] backdrop-blur-xl shrink-0">
                    <button onClick={() => setShowProfile(true)} className="w-full flex items-center gap-3 text-left">
                        {renderSessionAvatar(activeSession, 'w-12 h-12')}
                        <div className="min-w-0 flex-1"><p className="font-black text-slate-800">{displayName(activeSession)}</p><p className="mt-0.5 text-[10px] text-slate-400">{isRevealed(activeSession) ? `曾用化名 ${p.name}` : `${p.age} · ${p.occupation} · ${p.city}`}</p></div>
                        <CaretRight size={17} className="text-slate-300" />
                    </button>
                    <div className="mt-3 flex items-center gap-2">
                        <span className="text-[10px] font-black text-[var(--mh-accent)]">{stage}</span>
                        <div className="h-1.5 flex-1 rounded-full bg-[var(--mh-soft)] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-[var(--mh-accent-strong)] to-[var(--mh-accent)] transition-all duration-700" style={{ width: `${activeSession.affinity}%` }} /></div>
                        <span className="text-[10px] font-bold text-slate-400">{activeSession.affinity}</span>
                    </div>
                </div>

                <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-3" style={{ background: 'radial-gradient(circle at top, var(--mh-glow) 0, transparent 44%)' }}>
                    <div className="text-center text-[10px] text-slate-300">你们通过密会认识了 · 所有人物均为成年人</div>
                    {activeSession.messages.map((message, index) => (
                        <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                            {message.role === 'assistant' && renderSessionAvatar(activeSession, 'w-8 h-8', message.timestamp)}
                            <div
                                onClick={() => setSelectedMessage(message)}
                                onContextMenu={event => { event.preventDefault(); setSelectedMessage(message); }}
                                className={message.type === 'location' || message.type === 'transfer'
                                    ? 'max-w-[78%] text-left'
                                    : `max-w-[78%] rounded-[1.35rem] px-4 py-3 text-left text-sm leading-6 shadow-sm ${message.role === 'user' ? 'bg-[var(--mh-user-bubble)] text-[var(--mh-user-text)] rounded-br-md' : 'bg-[var(--mh-assistant-bubble)] text-[var(--mh-assistant-text)] border border-[var(--mh-border)] rounded-bl-md'}`}
                                role="button"
                                tabIndex={0}
                                aria-label="打开消息操作"
                            >
                                {message.type === 'image' ? (
                                    <img src={message.content} alt="聊天照片" className="max-h-80 w-full rounded-xl object-cover" />
                                ) : message.type === 'location' ? (
                                    <span className="block min-w-52 rounded-2xl border border-[var(--mh-border)] bg-[var(--mh-panel)] p-3 text-[var(--mh-text)] shadow-sm">
                                        <span className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--mh-accent)] text-[var(--mh-on-accent)]"><MapPin size={22} weight="fill" /></span><span className="min-w-0"><strong className="block truncate text-sm">{message.location?.name || message.content}</strong>{message.location?.address && <small className="mt-0.5 block truncate text-[10px] text-[var(--mh-muted)]">{message.location.address}</small>}</span></span>
                                        <span className="mt-3 block border-t border-[var(--mh-border)] pt-2 text-[10px] text-[var(--mh-muted)]">位置 · 点击可管理消息</span>
                                    </span>
                                ) : message.type === 'transfer' ? (
                                    message.transfer?.receipt ? (
                                        <span className="block rounded-xl border border-[var(--mh-border)] bg-[var(--mh-panel)] px-3 py-2 text-[11px] text-[var(--mh-muted)] shadow-sm">{message.role === 'user' ? '你' : displayName(activeSession)}{message.transfer.status === 'accepted' ? '已接收' : '已退回'}转账 · ¥{message.transfer.amount}</span>
                                    ) : (
                                        <span className="block min-w-56 overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--mh-accent)] to-[var(--mh-accent-strong)] text-[var(--mh-on-accent)] shadow-md">
                                            <span className="flex items-center gap-3 px-4 py-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15"><CurrencyCircleDollar size={25} weight="fill" /></span><span><strong className="block text-xl">¥{message.transfer?.amount || 0}</strong><small className="block max-w-40 truncate opacity-75">{message.transfer?.note || '转账给你'}</small></span></span>
                                            <span className="block border-t border-white/15 bg-black/10 px-4 py-2 text-[10px] opacity-80">{message.transfer?.status === 'accepted' ? '已接收' : message.transfer?.status === 'returned' ? '已退回' : message.role === 'assistant' ? '待你处理' : '等待对方处理'}</span>
                                            {message.role === 'assistant' && message.transfer?.status === 'pending' && <span className="flex gap-2 px-3 pb-3 pt-1"><button onClick={event => { event.stopPropagation(); settleIncomingTransfer(message, 'returned'); }} className="flex-1 rounded-xl bg-white/15 py-2 text-xs font-bold">退回</button><button onClick={event => { event.stopPropagation(); settleIncomingTransfer(message, 'accepted'); }} className="flex-1 rounded-xl bg-white py-2 text-xs font-black text-[var(--mh-accent)]">接收</button></span>}
                                        </span>
                                    )
                                ) : message.content}
                            </div>
                            {message.role === 'assistant' && index === activeSession.messages.length - 1 && activeSession.messages.some(item => item.role === 'user') && (
                                <button onClick={regenerateLastReply} disabled={sending || regenerating} className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--mh-soft-2)] text-[var(--mh-accent)] disabled:opacity-40" aria-label="重新生成最后一条回复">
                                    <ArrowClockwise size={14} className={regenerating ? 'animate-spin' : ''} />
                                </button>
                            )}
                        </div>
                    ))}
                    {(sending || regenerating) && <div className="flex items-end gap-2">{renderSessionAvatar(activeSession, 'w-8 h-8')}<div className="rounded-[1.35rem] rounded-bl-md bg-[var(--mh-assistant-bubble)] border border-[var(--mh-border)] px-4 py-3 flex gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--mh-accent)] animate-bounce" /><span className="w-1.5 h-1.5 rounded-full bg-[var(--mh-accent)] animate-bounce [animation-delay:120ms]" /><span className="w-1.5 h-1.5 rounded-full bg-[var(--mh-accent)] animate-bounce [animation-delay:240ms]" /></div></div>}
                </div>

                <div className="shrink-0 border-t border-[var(--mh-border)] bg-[var(--mh-panel)] px-3 pt-2 pb-[calc(var(--safe-bottom)+.65rem)]">
                    <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={event => sendPhoto(event.target.files?.[0])} />
                    <div className="flex items-center gap-1.5 pb-2 overflow-x-auto">
                        <button onClick={() => photoInputRef.current?.click()} disabled={sending || regenerating} className="shrink-0 rounded-full bg-[var(--mh-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--mh-accent)] flex items-center gap-1 disabled:opacity-40"><ImageSquare size={14} />照片</button>
                        <button onClick={() => setShowLocation(true)} disabled={sending || regenerating} className="shrink-0 rounded-full bg-[var(--mh-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--mh-accent)] flex items-center gap-1 disabled:opacity-40"><MapPin size={14} />位置</button>
                        <button onClick={() => setShowTransfer(true)} disabled={sending || regenerating} className="shrink-0 rounded-full bg-[var(--mh-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--mh-accent)] flex items-center gap-1 disabled:opacity-40"><CurrencyCircleDollar size={14} />转账</button>
                        <button onClick={openMeetup} disabled={openingMeetup || sending || regenerating} className="shrink-0 rounded-full bg-[var(--mh-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--mh-accent)] flex items-center gap-1 disabled:opacity-40"><Sparkle size={14} />{openingMeetup ? '正在打开…' : '见面'}</button>
                        {activeSession.affinity >= 100 && <button onClick={() => setShowGraduation(true)} className="shrink-0 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700 flex items-center gap-1">{activeSession.familiar?.revealedAt ? <Heart size={14} weight="fill" /> : <UserPlus size={14} />}{activeSession.familiar?.revealedAt ? '原来是你' : '角色卡'}</button>}
                    </div>
                    <div className="flex items-end gap-2">
                        <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1} placeholder="说点什么……" disabled={regenerating} className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl bg-[var(--mh-soft)] px-4 py-3 text-sm text-[var(--mh-text)] outline-none focus:ring-2 focus:ring-[var(--mh-accent)] disabled:opacity-60" />
                        <button onClick={send} disabled={!draft.trim() || sending || regenerating} className="w-11 h-11 rounded-2xl bg-[var(--mh-accent-strong)] text-[var(--mh-on-accent)] grid place-items-center disabled:bg-slate-200 active:scale-90 transition"><PaperPlaneTilt size={20} weight="fill" /></button>
                    </div>
                </div>
                {renderProfileSheet()}
                {renderGraduation()}
                {renderMessageOptions()}
                {renderLocationSheet()}
                {renderTransferSheet()}
                {renderAppearanceSheet()}
                {renderTuningSheet()}
            </>
        );
    };

    return (
        <div className="h-full w-full flex flex-col bg-[var(--mh-bg)] text-[var(--mh-text)] animate-fade-in relative overflow-hidden" style={themeStyle}>
            <header className="shrink-0 px-4 pb-2 bg-[var(--mh-panel)] backdrop-blur-xl" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="h-12 flex items-center gap-3">
                    <button onClick={back} className="w-10 h-10 rounded-full grid place-items-center text-slate-600 hover:bg-black/5 active:scale-90 transition" aria-label="返回"><ArrowLeft size={24} /></button>
                    <div className="min-w-0 flex-1"><p className="text-[10px] font-bold tracking-[.3em] text-[var(--mh-accent)]">MIHUI</p><p className="font-black text-[var(--mh-text)]">{screen === 'match' ? '偏好设置' : '密会'}</p></div>
                    {screen === 'home' && <button onClick={() => { const gaze = state.gaze || DEFAULT_MIHUI_GAZE; setDraftGaze({ ...gaze, events: [...gaze.events] }); setShowGazeSettings(true); }} className={`w-10 h-10 rounded-full grid place-items-center transition ${state.gaze?.enabled ? 'bg-[var(--mh-soft)] text-[var(--mh-accent)]' : 'bg-slate-100 text-slate-400'}`} aria-label="危险凝视设置">{state.gaze?.enabled ? <Eye size={20} weight="fill" /> : <EyeSlash size={20} />}</button>}
                    <button onClick={() => setShowAppearance(true)} className="w-10 h-10 rounded-full bg-[var(--mh-soft)] text-[var(--mh-accent)] grid place-items-center" aria-label="密会装扮"><Palette size={20} /></button>
                    {screen === 'home' && <button onClick={() => { setDraftTuning({ ...(state.tuning || DEFAULT_MIHUI_TUNING) }); setShowTuning(true); }} className="w-10 h-10 rounded-full bg-[var(--mh-soft)] text-[var(--mh-accent)] grid place-items-center" aria-label="密会调校"><Wrench size={20} /></button>}
                </div>
            </header>
            {matching && (
                <div className="absolute inset-0 z-[70] grid place-items-center bg-[#160f13]/55 px-8 backdrop-blur-sm">
                    <div className="w-full max-w-xs rounded-[2rem] border border-white/10 bg-[#241b20] px-6 py-7 text-center shadow-2xl">
                        <div className="mx-auto h-11 w-11 rounded-full border-2 border-[#d0a0ae]/25 border-t-[#d0a0ae] animate-spin" />
                        <p className="mt-5 text-base font-black text-[#f2e5e9]">正在穿过人群寻找</p>
                        <p className="mt-2 text-xs leading-5 text-[#bba5ad]">正在调用全局 API 生成人物档案，完成后会直接进入聊天。</p>
                    </div>
                </div>
            )}
            {screen === 'home' && renderHome()}
            {screen === 'match' && renderMatch()}
            {screen === 'chat' && renderChat()}
            {screen !== 'chat' && renderAppearanceSheet()}
            {screen !== 'chat' && renderTuningSheet()}
            {renderGazeSettingsSheet()}
            {gazeBanner && (
                <div className="absolute left-3 right-3 z-[86] flex flex-col gap-2 animate-fade-in" style={{ top: 'calc(var(--safe-top) + .55rem)' }}>
                    {(gazeBanner.messages?.length ? gazeBanner.messages : [gazeBanner.message]).slice(0, 3).map((message, index) => (
                        <button key={`${gazeBanner.timestamp}-${index}`} type="button" onClick={() => openGazeMessage(gazeBanner)} className="flex w-full min-w-0 items-center gap-3 rounded-[1.35rem] border border-white/60 bg-slate-950/88 px-4 py-3 text-left text-[#303139] shadow-2xl backdrop-blur-xl">
                            {gazeBanner.avatar ? <img src={gazeBanner.avatar} alt={gazeBanner.name} className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <PlaceholderAvatar size="w-11 h-11" className="!rounded-xl" />}
                            <span className="w-0 min-w-0 flex-1 overflow-hidden"><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{gazeBanner.name}</strong><small className="shrink-0 text-[10px] text-[#666872]">现在</small></span><span className="mt-0.5 block w-full text-xs leading-5 text-[#454750]" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={message}>{message}</span></span>
                        </button>
                    ))}
                </div>
            )}
            {gazeBarrage && (
                <div className="absolute inset-0 z-[85] overflow-hidden bg-black/35 backdrop-blur-[1px]" onClick={() => setGazeBarrage(null)}>
                    <style>{`@keyframes mihui-barrage-slide { from { transform: translateX(118vw); } to { transform: translateX(-145%); } }`}</style>
                    {(() => {
                        const sourceLines = (gazeBarrage.lines?.length ? gazeBarrage.lines : [gazeBarrage.message]).filter(Boolean).slice(0, 3);
                        return Array.from({ length: 36 }, (_, index) => {
                            const line = sourceLines[index % sourceLines.length] || gazeBarrage.message;
                            const lane = (index * 11 + (index % 4) * 3) % 84;
                            const duration = 6.2 + (index % 7) * .42;
                            const delay = -((index * .71) % 7.6);
                            return (
                                <div
                                    key={`${index}-${line}`}
                                    className="pointer-events-none absolute left-0 whitespace-nowrap rounded-full border border-white/15 bg-black/75 px-4 py-2 font-black text-white shadow-lg"
                                    style={{
                                        top: `${4 + lane}%`,
                                        fontSize: `${12 + (index % 4)}px`,
                                        opacity: .72 + (index % 4) * .08,
                                        animation: `mihui-barrage-slide ${duration}s linear ${delay}s infinite`,
                                    }}
                                >
                                    {line}
                                </div>
                            );
                        });
                    })()}
                    <button type="button" onClick={event => { event.stopPropagation(); openGazeMessage(gazeBarrage); }} className="absolute bottom-[calc(var(--safe-bottom)+2rem)] left-1/2 -translate-x-1/2 rounded-full bg-[var(--mh-accent-strong)] px-6 py-3 text-sm font-black text-[var(--mh-on-accent)] shadow-2xl">
                        回 {gazeBarrage.name} 的消息
                    </button>
                </div>
            )}
        </div>
    );
};

export default MihuiApp;
