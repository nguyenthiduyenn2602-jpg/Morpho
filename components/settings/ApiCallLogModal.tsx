import React, { useEffect, useState, useCallback } from 'react';
import Modal from '../os/Modal';
import { DB } from '../../utils/db';
import { isSameCoreModel, isFixedPromptBlockLabel } from '../../utils/apiCallLog';
import type { ApiCallLogEntry, PromptBlockStat } from '../../utils/apiCallLog';

interface ApiCallLogModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/** 把时间戳格式化成「今天 14:03:21 / 昨天 09:12 / 06-04 22:08」这种好扫的形态。 */
function formatTime(ts: number): { day: string; time: string } {
    const d = new Date(ts);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    let day: string;
    if (sameDay(d, now)) day = '今天';
    else if (sameDay(d, yesterday)) day = '昨天';
    else day = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { day, time };
}

const ApiCallLogModal: React.FC<ApiCallLogModalProps> = ({ isOpen, onClose }) => {
    const [entries, setEntries] = useState<ApiCallLogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await DB.getApiCallLog();
            // DB 里已按新→旧 unshift，这里再兜底排一次序
            data.sort((a: ApiCallLogEntry, b: ApiCallLogEntry) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
            setEntries(data);
        } catch {
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) load();
    }, [isOpen, load]);

    const handleClear = useCallback(async () => {
        if (!window.confirm('确定清空所有 API 调用记录吗？此操作不可撤销。')) return;
        await DB.clearApiCallLog();
        setEntries([]);
    }, []);

    return (
        <Modal
            isOpen={isOpen}
            title="API 调用记录"
            onClose={onClose}
            footer={
                <div className="flex gap-2 w-full">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl active:scale-95 transition-transform"
                    >
                        关闭
                    </button>
                    <button
                        onClick={handleClear}
                        disabled={entries.length === 0}
                        className="px-5 py-3 bg-rose-50 text-rose-500 font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-40"
                    >
                        清空
                    </button>
                </div>
            }
        >
            <div className="flex items-start justify-between gap-2 mb-3 px-1">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                    只保留最近 <span className="font-semibold text-slate-500">5 天</span>的调用，超期自动丢弃。记录在你本地浏览器，不上传。
                </p>
                <button
                    onClick={() => setShowHelp(v => !v)}
                    className={`shrink-0 w-5 h-5 rounded-full text-[11px] font-bold leading-none flex items-center justify-center transition-colors ${
                        showHelp ? 'bg-primary text-white' : 'bg-slate-200 text-slate-500'
                    }`}
                    aria-label="字段说明"
                >
                    ?
                </button>
            </div>

            {showHelp && (
                <div className="mb-3 rounded-2xl bg-amber-50/70 border border-amber-200/60 px-4 py-3 text-[11px] text-slate-600 leading-relaxed space-y-2">
                    <p className="font-bold text-amber-700">「实际后端」是什么——仅供参考，不是测谎仪</p>
                    <p>
                        它是<span className="font-semibold">对面在回复里自己报的模型名字</span>。注意：这个名字是对面自己填的，可以是真的，也可以是假的。
                    </p>
                    <p className="font-semibold">三种情况：</p>
                    <p>
                        <span className="font-semibold text-amber-600">🟡 琥珀色 + ⚠️</span>：报的名字和你要的对不上。
                        <span className="font-semibold">有可能</span>被换了便宜模型，但也可能只是站子标签没写整齐——别只凭这一行去定罪。
                    </p>
                    <p>
                        <span className="font-semibold">⚪ 灰色</span>：名字基本一致，只是格式不同（比如少了 [渠道]、(按次)、gcli- 这类标签前缀）。正常。
                    </p>
                    <p>
                        <span className="font-semibold">🫥 没有这一行</span>：最常见的情况。要么对面把你请求的名字<span className="font-semibold">原样抄了回来</span>（等于什么都没说），要么干脆没报。
                        <span className="font-semibold">不代表有问题，也不代表没问题——就是从这条线索看不出来。</span>
                    </p>
                    <p>
                        想判断有没有被偷偷换模型，要几个信号<span className="font-semibold">一起看</span>：token 数是否突然对不上（比如平时 4 万这次 1.5 万）、速度是否突变、角色是否突然变笨/掉格式。只有一个信号异常时，先观望，多攒几轮再说。
                    </p>
                </div>
            )}

            {entries.length > 0 && (() => {
                const totalTok = entries.reduce((s, e) => s + (e.totalTokens ?? 0), 0);
                const promptTok = entries.reduce((s, e) => s + (e.promptTokens ?? 0), 0);
                const compTok = entries.reduce((s, e) => s + (e.completionTokens ?? 0), 0);
                const fmt = (n: number) => n.toLocaleString('en-US');
                return (
                    <div className="mb-3 rounded-2xl bg-primary/5 border border-primary/15 px-4 py-3 flex items-center justify-around text-center">
                        <div>
                            <div className="text-[10px] text-slate-400">调用次数</div>
                            <div className="text-sm font-bold text-slate-600">{entries.length}</div>
                        </div>
                        <div className="w-px h-7 bg-slate-200" />
                        <div>
                            <div className="text-[10px] text-slate-400">总 Token</div>
                            <div className="text-sm font-bold text-primary">{fmt(totalTok)}</div>
                        </div>
                        <div className="w-px h-7 bg-slate-200" />
                        <div>
                            <div className="text-[10px] text-slate-400">输入 / 输出</div>
                            <div className="text-[11px] font-semibold text-slate-500">{fmt(promptTok)} / {fmt(compTok)}</div>
                        </div>
                    </div>
                );
            })()}

            {loading ? (
                <div className="py-10 text-center text-sm text-slate-400">加载中…</div>
            ) : entries.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">
                    暂无调用记录。<br />
                    <span className="text-[11px]">和角色聊几句、让它刷下小红书，这里就会有数据了。</span>
                </div>
            ) : (
                <div className="space-y-2">
                    {entries.map((e) => {
                        const { day, time } = formatTime(e.timestamp);
                        const hasBreakdown = !!e.promptBreakdown?.length;
                        const expanded = expandedId === e.id;
                        return (
                            <div
                                key={e.id}
                                onClick={hasBreakdown ? () => setExpandedId(expanded ? null : e.id) : undefined}
                                className={`rounded-2xl border p-3 ${
                                    e.ok ? 'bg-white/70 border-slate-200/60' : 'bg-rose-50/60 border-rose-200/60'
                                } ${hasBreakdown ? 'cursor-pointer active:scale-[0.99] transition-transform' : ''}`}
                            >
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-[11px] font-bold text-slate-400 shrink-0">{day}</span>
                                        <span className="text-[11px] font-mono text-slate-500 shrink-0">{time}</span>
                                    </div>
                                    <span
                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                                            e.ok ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                                        }`}
                                    >
                                        {e.ok ? '成功' : `失败${e.status ? ` ${e.status}` : ''}`}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                                    <Field label="API" value={e.presetName} accent />
                                    <Field label="App" value={e.appName} />
                                    <Field label="角色" value={e.charName} />
                                    <Field label="用途" value={e.purpose} />
                                    <div className="col-span-2">
                                        {/* 模型/实际后端两行不截断（break-all 换行）：截断会把「为什么黄了」的
                                            关键差异（后缀 -c、渠道标签）藏进省略号里，用户看着两行一样却标黄一头雾水 */}
                                        <Field label="模型" value={e.model} mono wrap />
                                    </div>
                                    {/* 后端自报身份（response.model）：字符串不同就展示；琥珀判定见
                                        isSameCoreModel——渠道标签/前缀（[渠道]、(按次)、gcli-、models/）算同名
                                        （灰色），尾巴长出变体（X-c / X-lite）才是真被换了后端（琥珀）。 */}
                                    {e.backendModel && e.backendModel !== e.model && (() => {
                                        const swapped = !isSameCoreModel(e.model, e.backendModel);
                                        return (
                                            <div className="col-span-2 flex items-baseline gap-1.5 min-w-0">
                                                <span className={`text-[10px] shrink-0 ${swapped ? 'text-amber-500' : 'text-slate-400'}`}>实际后端</span>
                                                <span className={`break-all font-mono ${swapped ? 'font-semibold text-amber-600' : 'text-slate-500'}`}>
                                                    {e.backendModel}{swapped ? ' ⚠️' : ''}
                                                </span>
                                            </div>
                                        );
                                    })()}
                                    {e.durationMs != null && (
                                        <Field label="耗时" value={e.durationMs >= 1000 ? `${(e.durationMs / 1000).toFixed(1)}s` : `${e.durationMs}ms`} />
                                    )}
                                    {(e.totalTokens != null || e.promptTokens != null || e.completionTokens != null) && (
                                        <div className="col-span-2 flex items-baseline gap-1.5 min-w-0">
                                            <span className="text-[10px] text-slate-400 shrink-0">Token</span>
                                            <span className="text-slate-600 truncate">
                                                {(e.totalTokens ?? 0).toLocaleString('en-US')}
                                                <span className="text-slate-400">
                                                    {' '}（入 {(e.promptTokens ?? 0).toLocaleString('en-US')} · 出 {(e.completionTokens ?? 0).toLocaleString('en-US')}）
                                                </span>
                                            </span>
                                        </div>
                                    )}
                                </div>
                                {hasBreakdown && (
                                    <div className="mt-1.5 text-[10px] text-slate-300 select-none">
                                        {expanded ? '▲ 收起输入构成' : '▼ 点击查看输入构成（哪块占了多少）'}
                                    </div>
                                )}
                                {expanded && e.promptBreakdown && (
                                    <PromptBreakdownView blocks={e.promptBreakdown} promptTokens={e.promptTokens} />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </Modal>
    );
};

/**
 * 输入构成面板：按字数降序列出每块（system 的 ### 段落 / 聚合的聊天历史），
 * 附占比条 + 按字符占比折算的 token 估算（分词器差异下只是量级参考，不是精确值）。
 */
const PromptBreakdownView: React.FC<{ blocks: PromptBlockStat[]; promptTokens?: number }> = ({ blocks, promptTokens }) => {
    const totalChars = blocks.reduce((sum, b) => sum + b.chars, 0) || 1;
    // 写死的固定骨架块（行为规范/表达底线/钢印等）合并成一行——它们不随用户数据
    // 变化、也没有可优化空间，散成一堆小行只会淹没真正有信息量的数据块。
    const fixed = blocks.filter(b => isFixedPromptBlockLabel(b.label));
    const merged: PromptBlockStat[] = fixed.length >= 2
        ? [
            ...blocks.filter(b => !isFixedPromptBlockLabel(b.label)),
            { label: `固定提示词（规则/格式，共 ${fixed.length} 块）`, chars: fixed.reduce((s, b) => s + b.chars, 0) },
        ]
        : blocks;
    const rows = [...merged].sort((a, b) => b.chars - a.chars);
    const fmt = (n: number) => n.toLocaleString('en-US');
    return (
        <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-bold text-slate-400">输入构成 · 共 {fmt(totalChars)} 字符</span>
                {promptTokens != null && (
                    <span className="text-[9px] text-slate-300">token 列为按字符占比折算的估算</span>
                )}
            </div>
            {rows.map((b, i) => {
                const pct = (b.chars / totalChars) * 100;
                const estTok = promptTokens != null ? Math.round(promptTokens * b.chars / totalChars) : null;
                return (
                    <div key={i} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2 min-w-0">
                            <span className="text-[10px] text-slate-500 truncate" title={b.label}>{b.label}</span>
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                {fmt(b.chars)} 字{estTok != null ? ` · ~${fmt(estTok)} tok` : ''} · {pct < 1 ? '<1' : Math.round(pct)}%
                            </span>
                        </div>
                        <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-primary/50" style={{ width: `${Math.max(pct, 1.5)}%` }} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const Field: React.FC<{ label: string; value?: string; accent?: boolean; mono?: boolean; wrap?: boolean }> = ({
    label,
    value,
    accent,
    mono,
    wrap,
}) => (
    <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-[10px] text-slate-400 shrink-0">{label}</span>
        <span
            className={`${wrap ? 'break-all' : 'truncate'} ${mono ? 'font-mono' : ''} ${
                accent ? 'font-semibold text-primary' : 'text-slate-600'
            }`}
            title={value || ''}
        >
            {value && value.trim() ? value : '—'}
        </span>
    </div>
);

export default ApiCallLogModal;
