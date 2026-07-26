import React, { useMemo, useState } from 'react';
import {
    ArrowLeft,
    ArrowRight,
    Check,
    Copy,
    LockKey,
    TerminalWindow,
    WarningCircle,
} from '@phosphor-icons/react';
import { isDevDebugAvailable } from '../utils/devDebug';
import {
    collectAndEvaluateLoyalUserEligibility,
    LOYAL_RECRUITMENT_CUTOFF_ISO,
    LOYAL_RECRUITMENT_CRITERIA_VERSION,
    type LoyalEligibilityResult,
} from '../utils/loyalUserEligibility';
import {
    isValidQQ,
    normalizeQQ,
    readLoyalRecruitmentAttempt,
    submitQualifiedQQ,
    writeLoyalRecruitmentAttempt,
    type LoyalRecruitmentAttempt,
} from '../utils/loyalUserRecruitment';

type Phase = 'intro' | 'qq' | 'scanning' | 'submitting' | 'technical' | 'failed' | 'pending' | 'not_selected' | 'success';

const DISCORD_COMMUNITY_URL = 'https://discord.gg/rvqBaTUgR';

const SCAN_LINES = [
    '读取截止日前的互动索引',
    '核验角色链接与时间证据',
    '计算神经链接记忆沉淀',
    '检查记忆宫殿有效节点',
];

const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

function maskQQ(qq: string): string {
    if (qq.length <= 5) return qq;
    return `${qq.slice(0, 3)}${'*'.repeat(Math.max(2, qq.length - 5))}${qq.slice(-2)}`;
}

const DebugResult: React.FC<{ result: LoyalEligibilityResult | null }> = ({ result }) => {
    if (!result || !isDevDebugAvailable()) return null;
    return (
        <div className="mt-4 border-t border-emerald-300/15 pt-3 font-mono text-[10px] leading-relaxed text-emerald-100/55 select-text">
            <div>
                DEV SCORE {result.score}/100 · PATH {result.qualificationPath?.toUpperCase() || 'NONE'} · GATE {result.hardGatePassed ? 'PASS' : 'FAIL'}
            </div>
            <div>
                ACTIVE {result.breakdown.recentActivity}/50 · CHAR {result.breakdown.customCharacter}/15 · MEMORY {result.breakdown.neuralMemory}/25 · PALACE {result.breakdown.memoryPalace}/10
            </div>
            <div>
                DAYS {result.metrics.recentActiveDays} · WEEKS {result.metrics.recentActiveWeeks} · MSG {result.metrics.recentUserMessages} · CHAR DAYS {result.metrics.maxPreCutoffCharacterActiveDays ?? 'LEGACY'} · MEM {result.metrics.memoryUnits} · NODE {result.metrics.palaceNodes}
            </div>
            <div>
                NEURAL JUL {result.metrics.neuralMemoryEntriesSinceJuly ?? 'LEGACY'} · JUN {result.metrics.neuralMemoryEntriesSinceJune ?? 'LEGACY'} · ALL {result.metrics.neuralMemoryEntriesTotal ?? 'LEGACY'}
            </div>
        </div>
    );
};

const TerminalFrame: React.FC<{
    eyebrow: string;
    children: React.ReactNode;
}> = ({ eyebrow, children }) => (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 animate-fade-in">
        <div className="absolute inset-0 bg-[#020504]/85 backdrop-blur-lg" />
        <section
            className="recruit-terminal relative flex w-full max-w-[390px] flex-col overflow-hidden rounded-[28px] border border-emerald-300/20 bg-[#050a08]/95 text-emerald-50 shadow-[0_30px_100px_rgba(0,0,0,0.72),0_0_60px_rgba(52,211,153,0.08)]"
            aria-live="polite"
        >
            <style>{`
                @keyframes recruitScan { from { transform: translateY(-120%); } to { transform: translateY(520%); } }
                @keyframes recruitLine { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
                @keyframes recruitPulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
                .recruit-terminal::after {
                    content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .16;
                    background: repeating-linear-gradient(180deg, transparent 0 3px, rgba(167,243,208,.07) 4px);
                    mix-blend-mode: screen;
                }
            `}</style>
            <div className="relative z-10 flex items-center justify-between border-b border-emerald-300/15 px-5 py-4 font-mono">
                <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-300/10 text-emerald-300">
                        <TerminalWindow size={17} weight="bold" />
                    </span>
                    <div>
                        <div className="text-[10px] font-bold tracking-[0.2em] text-emerald-200/80">SULLYOS / ACCESS</div>
                        <div className="mt-0.5 text-[9px] tracking-wider text-emerald-100/35">{eyebrow}</div>
                    </div>
                </div>
                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.85)]" style={{ animation: 'recruitPulse 1.8s ease-in-out infinite' }} />
            </div>
            <div className="relative z-10 p-5 sm:p-6">
                {children}
            </div>
        </section>
    </div>
);

const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', children, ...props }) => (
    <button
        type="button"
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 text-sm font-black text-[#052018] transition-transform active:scale-[0.98] disabled:opacity-40 ${className}`}
        {...props}
    >
        {children}
    </button>
);

interface LoyalUserRecruitmentControllerProps {
    onClose: () => void;
}

export const LoyalUserRecruitmentController: React.FC<LoyalUserRecruitmentControllerProps> = ({ onClose }) => {
    const savedAttempt = useMemo(() => readLoyalRecruitmentAttempt(), []);
    const [phase, setPhase] = useState<Phase>(() => {
        if (savedAttempt?.status === 'registered') return 'success';
        if (savedAttempt?.status === 'passed_pending') return 'pending';
        if (savedAttempt?.status === 'not_selected') return 'not_selected';
        if (savedAttempt?.status === 'qualified_pending_qq') return 'qq';
        if (savedAttempt?.status === 'failed') return 'failed';
        return 'intro';
    });
    const [qq, setQQ] = useState(savedAttempt?.qq || '');
    const [error, setError] = useState('');
    const [scanIndex, setScanIndex] = useState(0);
    const [evaluation, setEvaluation] = useState<LoyalEligibilityResult | null>(savedAttempt?.evaluation || null);
    const [group, setGroup] = useState(savedAttempt?.group || '');
    const [password, setPassword] = useState(savedAttempt?.password || '');
    const [copied, setCopied] = useState<'group' | 'password' | null>(null);

    const normalizedQQ = normalizeQQ(qq);

    const register = async (attempt: LoyalRecruitmentAttempt) => {
        setPhase('submitting');
        setError('');
        try {
            const registration = await submitQualifiedQQ(attempt.qq || '');
            if (!registration.granted) {
                const notSelectedAttempt: LoyalRecruitmentAttempt = {
                    status: 'not_selected',
                    criteriaVersion: attempt.criteriaVersion,
                    evaluatedAt: attempt.evaluatedAt,
                    evaluation: attempt.evaluation,
                };
                writeLoyalRecruitmentAttempt(notSelectedAttempt);
                setPhase('not_selected');
                return;
            }
            const registeredAttempt: LoyalRecruitmentAttempt = {
                ...attempt,
                status: 'registered',
                group: registration.group,
                password: registration.password,
                registeredAt: Date.now(),
            };
            writeLoyalRecruitmentAttempt(registeredAttempt);
            setGroup(registration.group);
            setPassword(registration.password);
            setPhase('success');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '登记服务暂不可用');
            setPhase('pending');
        }
    };

    const handleEvaluate = async () => {
        if (!isValidQQ(normalizedQQ)) {
            setError('请输入 5～12 位、非 0 开头的 QQ 号');
            return;
        }
        setError('');
        setPhase('scanning');
        setScanIndex(0);
        const progressTimer = window.setInterval(() => {
            setScanIndex(current => Math.min(SCAN_LINES.length - 1, current + 1));
        }, 390);

        try {
            const sealedQualifiedResult = savedAttempt?.status === 'qualified_pending_qq'
                && savedAttempt.evaluation?.passed
                ? savedAttempt.evaluation
                : null;
            const [result] = await Promise.all([
                sealedQualifiedResult
                    ? Promise.resolve(sealedQualifiedResult)
                    : collectAndEvaluateLoyalUserEligibility(),
                wait(1750),
            ]);
            setEvaluation(result);
            if (isDevDebugAvailable()) console.info('[Recruitment] local evaluation', result);

            if (!result.passed) {
                writeLoyalRecruitmentAttempt({
                    status: 'failed',
                    criteriaVersion: result.criteriaVersion,
                    evaluatedAt: Date.now(),
                    evaluation: result,
                });
                setPhase('failed');
                return;
            }

            const pendingAttempt: LoyalRecruitmentAttempt = {
                status: 'passed_pending',
                criteriaVersion: result.criteriaVersion,
                evaluatedAt: sealedQualifiedResult && savedAttempt
                    ? savedAttempt.evaluatedAt
                    : Date.now(),
                qq: normalizedQQ,
                evaluation: result,
            };
            writeLoyalRecruitmentAttempt(pendingAttempt);
            await register(pendingAttempt);
        } catch (cause) {
            // 技术失败不写 attempt，不消耗唯一一次检测机会。
            setError(cause instanceof Error ? cause.message : '本地档案读取失败');
            setPhase('technical');
        } finally {
            window.clearInterval(progressTimer);
        }
    };

    const retryRegistration = () => {
        const pending = readLoyalRecruitmentAttempt();
        if (!pending || pending.status !== 'passed_pending' || !pending.qq) {
            setError('未找到待登记凭证');
            return;
        }
        setQQ(pending.qq);
        setEvaluation(pending.evaluation || null);
        void register(pending);
    };

    const copyValue = async (kind: 'group' | 'password', value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(kind);
            window.setTimeout(() => setCopied(current => current === kind ? null : current), 1200);
        } catch { /* ignore */ }
    };

    if (phase === 'intro') {
        return (
            <TerminalFrame eyebrow="COMMUNITY MIGRATION · QQ ACCESS">
                <div style={{ animation: 'recruitLine .28s ease-out both' }}>
                    <div className="mb-5 flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-emerald-300/60">
                        <LockKey size={13} weight="bold" /> COMMUNITY ROUTE UPDATED
                    </div>
                    <h2 className="max-w-[300px] text-[27px] font-black leading-[1.18] tracking-tight text-white">
                        社区入口调整说明
                    </h2>
                    <p className="mt-3 text-[13px] leading-6 text-emerald-50/55">
                        Discord 社区已经扩大，并承载公告、反馈、创作交流与后续活动等全部社区功能。
                    </p>
                    <div className="mt-4 border-l-2 border-emerald-300/30 pl-3 text-[12px] leading-5 text-emerald-50/48">
                        QQ 之后只保留一个较小的日常水群。作者不再继续承担 3000 人群的扩容费用，转为更低人数规格，因此新的 QQ 群会对进入成员设置一定限制。
                    </div>
                    <p className="mt-4 text-[11px] leading-5 text-emerald-50/38">
                        现群成员可依据 2026 年 7 月 20 日 19:00 前的本机存档进行一次资格检测。结果生成后立即封存，不提供复检。
                    </p>
                    <div className="mt-7 space-y-2.5">
                        <PrimaryButton onClick={() => setPhase('qq')}>
                            我是现群成员，继续 <ArrowRight size={16} weight="bold" />
                        </PrimaryButton>
                        <button type="button" onClick={onClose} className="min-h-11 w-full text-xs font-bold text-emerald-50/35 active:text-emerald-50/70">
                            返回设置
                        </button>
                    </div>
                </div>
            </TerminalFrame>
        );
    }

    if (phase === 'qq') {
        return (
            <TerminalFrame eyebrow="IDENTITY INPUT">
                <button type="button" onClick={() => { setError(''); setPhase('intro'); }} className="mb-5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-100/45">
                    <ArrowLeft size={13} weight="bold" /> 返回
                </button>
                <h2 className="text-2xl font-black tracking-tight text-white">登记入群 QQ</h2>
                <p className="mt-2 text-[12px] leading-5 text-emerald-50/50">
                    检测通过后只提交这个 QQ。请使用同一账号加入新群，管理员会与登记名单核对。
                </p>
                <label className="mt-6 block">
                    <span className="font-mono text-[9px] font-bold tracking-[0.2em] text-emerald-300/55">QQ NUMBER</span>
                    <input
                        value={qq}
                        onChange={event => { setQQ(event.target.value.replace(/\D/g, '').slice(0, 12)); setError(''); }}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="输入你的 QQ 号"
                        className="mt-2 h-14 w-full rounded-2xl border border-emerald-300/20 bg-black/30 px-4 font-mono text-lg font-bold tracking-[0.08em] text-white outline-none transition-colors placeholder:text-emerald-50/20 focus:border-emerald-300/60"
                    />
                </label>
                <div className="mt-4 border-l-2 border-emerald-300/35 pl-3 text-[11px] leading-5 text-emerald-50/42">
                    只读取本机统计，不上传聊天、角色设定或记忆正文。未通过时 QQ 不会提交。
                </div>
                {error && <p className="mt-3 text-[11px] font-bold text-rose-300">{error}</p>}
                <PrimaryButton className="mt-6" onClick={() => void handleEvaluate()} disabled={!normalizedQQ}>
                    执行一次性检测 <ArrowRight size={16} weight="bold" />
                </PrimaryButton>
            </TerminalFrame>
        );
    }

    if (phase === 'scanning' || phase === 'submitting') {
        const submitting = phase === 'submitting';
        return (
            <TerminalFrame eyebrow={submitting ? 'LOCAL PASS · REGISTERING' : 'LOCAL AUDIT IN PROGRESS'}>
                <div className="relative overflow-hidden py-2">
                    <div className="absolute left-0 right-0 top-0 h-16 bg-gradient-to-b from-transparent via-emerald-300/10 to-transparent" style={{ animation: 'recruitScan 1.7s linear infinite' }} />
                    <div className="font-mono text-[10px] tracking-[0.18em] text-emerald-300/55">
                        {submitting ? 'WRITING QUALIFIED IDENTITY' : 'READING LOCAL SNAPSHOT'}
                    </div>
                    <div className="mt-5 space-y-3.5">
                        {SCAN_LINES.map((line, index) => {
                            const done = submitting || index < scanIndex;
                            const active = !submitting && index === scanIndex;
                            return (
                                <div key={line} className={`flex items-center gap-3 font-mono text-[11px] transition-opacity ${index <= scanIndex || submitting ? 'opacity-100' : 'opacity-25'}`}>
                                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${done ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-200' : active ? 'border-emerald-300/55 text-emerald-300' : 'border-white/10 text-transparent'}`}>
                                        {done ? <Check size={11} weight="bold" /> : active ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" /> : null}
                                    </span>
                                    <span className={done || active ? 'text-emerald-50/75' : 'text-emerald-50/35'}>{line}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-7 h-px overflow-hidden bg-emerald-300/10">
                        <div className="h-full bg-emerald-300/70 transition-all duration-500" style={{ width: submitting ? '100%' : `${25 + scanIndex * 23}%` }} />
                    </div>
                    <p className="mt-3 font-mono text-[9px] tracking-wider text-emerald-100/30">
                        {submitting ? '本地检测已通过，正在登记 QQ…' : '请勿关闭窗口；技术错误不会消耗检测机会。'}
                    </p>
                </div>
            </TerminalFrame>
        );
    }

    if (phase === 'technical') {
        return (
            <TerminalFrame eyebrow="READ INTERRUPTED · ATTEMPT NOT USED">
                <WarningCircle size={30} className="text-amber-300" weight="duotone" />
                <h2 className="mt-4 text-2xl font-black text-white">档案读取中断</h2>
                <p className="mt-2 text-[12px] leading-5 text-emerald-50/50">本次没有生成结果，也没有消耗检测机会。</p>
                <p className="mt-4 break-words rounded-xl bg-amber-300/[0.08] px-3 py-2 font-mono text-[10px] text-amber-200/75">{error}</p>
                <PrimaryButton className="mt-6" onClick={() => setPhase('qq')}>重新读取</PrimaryButton>
            </TerminalFrame>
        );
    }

    if (phase === 'failed' || phase === 'not_selected') {
        const isFinalAllocation = phase === 'not_selected';
        return (
            <TerminalFrame eyebrow="RESULT SEALED · ACCESS NOT GRANTED">
                <div className="font-mono text-[10px] tracking-[0.18em] text-rose-300/65">FINAL RESULT / 01</div>
                <h2 className="mt-4 text-[26px] font-black leading-tight text-white">未获取本次进群名额</h2>
                <p className="mt-3 text-[12px] leading-6 text-emerald-50/50">
                    {isFinalAllocation
                        ? '谢谢你愿意留下来。本次小群名额状态已经确认，目前未获取本次新 QQ 小群名额。这不是对你或使用方式的评价。'
                        : '谢谢你愿意留下来。按照截止时间前的本机存档，本次结果暂未满足新 QQ 小群的入口条件。这不是对你或使用方式的评价，QQ 也没有上传。'}
                </p>
                <div className="mt-5 border-l-2 border-emerald-300/35 pl-3 text-[11px] leading-5 text-emerald-50/48">
                    Discord 社区仍然完整开放，公告、反馈、交流与之后的社区活动都会继续在那里。欢迎来找我们。
                </div>
                <p className="mt-3 font-mono text-[9px] leading-4 text-emerald-50/28">
                    {isFinalAllocation ? 'QQ 未登记 · 本次名额状态已封存' : 'QQ 未上传 · 本次结果已封存，不再复检'}
                </p>
                {!isFinalAllocation && <DebugResult result={evaluation} />}
                <a
                    href={DISCORD_COMMUNITY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5865F2] px-4 text-sm font-black text-white transition-transform active:scale-[0.98]"
                >
                    前往 Discord 社区 <ArrowRight size={16} weight="bold" />
                </a>
                <button type="button" onClick={onClose} className="mt-2 min-h-10 w-full text-xs font-bold text-emerald-50/35">返回设置</button>
            </TerminalFrame>
        );
    }

    if (phase === 'pending') {
        return (
            <TerminalFrame eyebrow="LOCAL PASS · REMOTE WRITE PENDING">
                <WarningCircle size={30} className="text-amber-300" weight="duotone" />
                <h2 className="mt-4 text-2xl font-black text-white">本地检测已通过</h2>
                <p className="mt-2 text-[12px] leading-5 text-emerald-50/50">QQ 尚未登记成功。资格已经保留，重试只会提交 QQ，不会重新评分。</p>
                {error && <p className="mt-4 break-words rounded-xl bg-amber-300/[0.08] px-3 py-2 font-mono text-[10px] text-amber-200/75">{error}</p>}
                <DebugResult result={evaluation} />
                <div className="mt-6 space-y-2">
                    <PrimaryButton onClick={retryRegistration}>重新登记 QQ</PrimaryButton>
                    <button type="button" onClick={onClose} className="min-h-10 w-full text-xs font-bold text-emerald-50/35">稍后重试</button>
                </div>
            </TerminalFrame>
        );
    }

    return (
        <TerminalFrame eyebrow="ACCESS GRANTED · IDENTITY REGISTERED">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-300 text-[#052018] shadow-[0_0_30px_rgba(110,231,183,.25)]">
                <Check size={24} weight="bold" />
            </div>
            <h2 className="mt-5 text-[27px] font-black leading-tight text-white">资格检测通过</h2>
            <p className="mt-2 text-[12px] leading-5 text-emerald-50/50">
                QQ {maskQQ(normalizedQQ)} 已登记。请务必使用同一账号加入新群。
            </p>

            <div className="mt-6 divide-y divide-emerald-300/10 border-y border-emerald-300/10">
                <div className="flex items-center justify-between gap-4 py-4">
                    <div>
                        <div className="font-mono text-[9px] tracking-[0.18em] text-emerald-300/45">GROUP NUMBER</div>
                        <div className="mt-1 font-mono text-lg font-black tracking-wider text-white select-text">{group}</div>
                    </div>
                    <button type="button" onClick={() => void copyValue('group', group)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08] text-emerald-100/65 active:scale-95" aria-label="复制群号">
                        {copied === 'group' ? <Check size={16} weight="bold" /> : <Copy size={16} weight="bold" />}
                    </button>
                </div>
                <div className="flex items-center justify-between gap-4 py-4">
                    <div>
                        <div className="font-mono text-[9px] tracking-[0.18em] text-emerald-300/45">ACCESS PASSWORD</div>
                        <div className="mt-1 font-mono text-lg font-black tracking-wider text-white select-text">{password}</div>
                    </div>
                    <button type="button" onClick={() => void copyValue('password', password)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08] text-emerald-100/65 active:scale-95" aria-label="复制密码">
                        {copied === 'password' ? <Check size={16} weight="bold" /> : <Copy size={16} weight="bold" />}
                    </button>
                </div>
            </div>

            <p className="mt-4 text-[10px] leading-5 text-emerald-50/35">
                请勿转发群号和密码。管理员将对照登记名单，未登记的 QQ 会被移出。
            </p>
            <DebugResult result={evaluation} />
            <PrimaryButton className="mt-6" onClick={onClose}>我已记下</PrimaryButton>
        </TerminalFrame>
    );
};

export const LOYAL_RECRUITMENT_CUTOFF_LABEL = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(LOYAL_RECRUITMENT_CUTOFF_ISO));
