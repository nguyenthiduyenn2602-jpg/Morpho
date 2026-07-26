
import { DB } from './db';
import {
    BankTransaction, CharacterProfile, LifeRecord, LifeRecordModule,
    LifeRecordSettings, MedPlan, Message,
} from '../types';
import { addLocalDays, getLocalDateKey } from './localDate';

/**
 * 生活记录（档案 App：生理期 / 药盒 / 记账 / 锻炼）
 *
 * 三条链路都收在这个文件里：
 *  1. 注入（读路径）：buildLifeRecordInjection —— 按角色开关把今日摘要 + 潜意识约束 +
 *     [[LIFE:...]] 指令说明 + 否决反馈拼成 system prompt section（chatPrompts 调用）。
 *  2. 代记（写路径）：executeLifeDirectives —— 解析角色输出里的 [[LIFE:...]] 指令，
 *     去重后落库并插入可交互的 life_card 消息（chatParser 调用，本地 / instant push 共用）。
 *  3. 裁决：resolveLifeRecordCard —— 用户点卡片「确认 / 否决」，否决时回滚（含银行流水）
 *     并给代记角色挂一条一次性反馈（Chat.tsx 调用）。
 *
 * 记账不独立存储：角色代记的支出直接写 BankApp 的 bank_transactions（BankApp 每次打开
 * 会从流水重算 todaySpent，所以这里只动流水即可），另落一条带 bankTxId 的 LifeRecord
 * 支撑卡片确认 / 否决回滚；注入摘要也直接读当日银行流水。
 */

// ─── 开关 ───
// 总开关 opt-in（默认关）；小开关默认开、受总开关统辖（开了总开关不用再逐个点四下）。
export const isLifeRecordOn = (char: CharacterProfile): boolean => char.lifeRecordEnabled === true;

export const isLifeModuleOn = (char: CharacterProfile, module: LifeRecordModule): boolean => {
    if (!isLifeRecordOn(char)) return false;
    switch (module) {
        case 'period': return char.lifeRecordPeriodEnabled !== false;
        case 'med': return char.lifeRecordMedEnabled !== false;
        case 'expense': return char.lifeRecordExpenseEnabled !== false;
        case 'exercise': return char.lifeRecordExerciseEnabled !== false;
    }
};

/** 全局隐藏的模块集合（长按页签隐藏；优先级高于角色小开关，注入与代记一律跳过） */
export const getHiddenLifeModules = (settings: LifeRecordSettings | null | undefined): Set<LifeRecordModule> =>
    new Set(settings?.hiddenModules || []);

// ─── 日期工具（与 BankApp 同口径：toISOString 取日期段） ───
export const lifeToday = (): string => getLocalDateKey();

const parseDate = (s: string): number => new Date(`${s}T00:00:00Z`).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;
/** b - a 的整天数（a、b 均为 YYYY-MM-DD） */
const diffDays = (a: string, b: string): number => Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
const addDays = (s: string, n: number): string => addLocalDays(s, n);
/** 面板日历等 UI 侧复用的日期工具 */
export const lifeDiffDays = diffDays;
export const lifeAddDays = addDays;
const fmtCN = (s: string): string => {
    const [, m, d] = s.split('-');
    return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
};

/** 有效记录 = 未被用户否决的记录（active / confirmed 都算数） */
const effective = (records: LifeRecord[]): LifeRecord[] => records.filter(r => r.reviewStatus !== 'rejected');

// ─── 生理期状态机 ───
export const DEFAULT_CYCLE_LENGTH = 28;
export const DEFAULT_PERIOD_LENGTH = 5;
/** 只有 start 没有 end 时，超过这个天数就不再视为"仍在经期"（忘记记结束的兜底） */
const PERIOD_AUTO_CLOSE_DAYS = 10;

export interface PeriodStatus {
    inPeriod: boolean;
    /** 经期第几天（1-based，仅 inPeriod 时有意义） */
    dayN?: number;
    lastStart?: string;
    lastEnd?: string;
    /** 预测的下次经期开始日（有历史 start 才有） */
    nextPredicted?: string;
    /** 距预测日还有几天（可为负 = 已推迟） */
    daysUntilNext?: number;
    /**
     * 排卵期预测（标准日历法：排卵日 ≈ 下次经期开始日 − 14 天；
     * 排卵期窗口 = 排卵日前 5 天 ~ 排卵日后 1 天）。
     * 仅作为身体周期信息呈现（状态感知用），措辞不做任何生育导向；估算仅供参考。
     */
    ovulationDate?: string;
    ovulationStart?: string;
    ovulationEnd?: string;
}

export const computePeriodStatus = (
    records: LifeRecord[],
    settings: LifeRecordSettings | null,
    today: string = lifeToday(),
): PeriodStatus => {
    const cycle = settings?.cycleLength || DEFAULT_CYCLE_LENGTH;
    const evts = effective(records)
        .filter(r => r.module === 'period' && r.date <= today)
        .sort((a, b) => a.date === b.date ? a.timestamp - b.timestamp : (a.date < b.date ? -1 : 1));
    const lastStartRec = [...evts].reverse().find(r => r.kind === 'start');
    if (!lastStartRec) return { inPeriod: false };
    const lastStart = lastStartRec.date;
    const endAfter = [...evts].reverse().find(r => r.kind === 'end' && r.date >= lastStart
        && !(r.date === lastStart && r.timestamp < lastStartRec.timestamp));
    const sinceStart = diffDays(lastStart, today);
    const inPeriod = !endAfter && sinceStart >= 0 && sinceStart < PERIOD_AUTO_CLOSE_DAYS;
    const nextPredicted = addDays(lastStart, cycle);
    const ovulationDate = addDays(nextPredicted, -14);
    return {
        inPeriod,
        dayN: inPeriod ? sinceStart + 1 : undefined,
        lastStart,
        lastEnd: endAfter?.date,
        nextPredicted,
        daysUntilNext: diffDays(today, nextPredicted),
        ovulationDate,
        ovulationStart: addDays(ovulationDate, -5),
        ovulationEnd: addDays(ovulationDate, 1),
    };
};

/** 经期区间（供日历渲染）：start/end 事件配对；未闭合的区间以"今天或自动收口日"为界 */
export interface PeriodInterval { start: string; end: string; open?: boolean }

export const getPeriodIntervals = (records: LifeRecord[], today: string = lifeToday()): PeriodInterval[] => {
    const evts = effective(records)
        .filter(r => r.module === 'period' && r.date <= today)
        .sort((a, b) => a.date === b.date ? a.timestamp - b.timestamp : (a.date < b.date ? -1 : 1));
    const intervals: PeriodInterval[] = [];
    const minDate = (a: string, b: string) => (a < b ? a : b);
    const maxDate = (a: string, b: string) => (a > b ? a : b);
    let open: string | null = null;
    for (const e of evts) {
        if (e.kind === 'start') {
            if (open) {
                // 上一段没记结束就又开始了：上一段收口在「自动收口日」和「新开始前一天」的较早者
                const cap = minDate(addDays(open, PERIOD_AUTO_CLOSE_DAYS - 1), addDays(e.date, -1));
                intervals.push({ start: open, end: maxDate(open, cap) });
            }
            open = e.date;
        } else if (e.kind === 'end' && open) {
            intervals.push({ start: open, end: maxDate(open, e.date) });
            open = null;
        }
    }
    if (open) {
        const cap = addDays(open, PERIOD_AUTO_CLOSE_DAYS - 1);
        intervals.push({ start: open, end: today < cap ? today : cap, open: true });
    }
    return intervals;
};

/**
 * 该计划今天是否该吃：enabled + （疗程则在 startDate~endDate 内）+ 频率命中
 * （锚点日 = startDate，无则创建当天；按天数差对 intervalDays 取模）。
 */
export const isMedPlanDueToday = (plan: MedPlan, today: string = lifeToday()): boolean => {
    if (!plan.enabled) return false;
    if (plan.planKind === 'course') {
        if (plan.startDate && today < plan.startDate) return false;
        if (plan.endDate && today > plan.endDate) return false;
    }
    const interval = Math.max(1, plan.intervalDays || 1);
    if (interval === 1) return true;
    const anchor = plan.startDate || getLocalDateKey(new Date(plan.createdAt));
    const diff = diffDays(anchor, today);
    return diff >= 0 && diff % interval === 0;
};

/** 频率的展示文案 */
export const medFreqLabel = (plan: MedPlan): string => {
    const n = Math.max(1, plan.intervalDays || 1);
    return n === 1 ? '每天' : n === 2 ? '隔天' : `每${n}天`;
};

// ─── 摘要文案（卡片 & 注入共用） ───
export const summarizeLifeRecord = (module: LifeRecordModule, kind: string, payload: Record<string, any>): string => {
    switch (module) {
        case 'period': return kind === 'start' ? '生理期开始' : '生理期结束';
        case 'med': return `吃药 · ${payload.name || '药'}`;
        case 'expense': return `支出 ${payload.amount}${payload.note ? `（${payload.note}）` : ''}`;
        case 'exercise': return `锻炼 · ${payload.activity || '运动'}${payload.duration ? ` ${payload.duration}` : ''}`;
    }
};

export const LIFE_MODULE_LABELS: Record<LifeRecordModule, string> = {
    period: '生理期', med: '药盒', expense: '记账', exercise: '锻炼',
};

// ═══════════════════════════════════════════════════════════
// 1. 注入（读路径）
// ═══════════════════════════════════════════════════════════

const buildPeriodSummary = (records: LifeRecord[], settings: LifeRecordSettings | null, today: string): string => {
    const st = computePeriodStatus(records, settings, today);
    if (!st.lastStart) return '- 生理期：暂无记录。';
    if (st.inPeriod) return `- 生理期：**第 ${st.dayN} 天**（${fmtCN(st.lastStart)}开始）。`;
    let s = `- 生理期：当前不在经期（上次 ${fmtCN(st.lastStart)}${st.lastEnd ? ` ~ ${fmtCN(st.lastEnd)}` : ''}）`;
    if (st.nextPredicted && st.daysUntilNext !== undefined) {
        s += st.daysUntilNext >= 0
            ? `；预测下次约在 ${fmtCN(st.nextPredicted)}（还有约 ${st.daysUntilNext} 天）`
            : `；按周期预测已推迟约 ${-st.daysUntilNext} 天`;
        // 排卵期只在预测窗口还有意义时给（日历法估算，注明仅供参考）
        if (st.ovulationDate && st.ovulationEnd && st.ovulationEnd >= today) {
            s += `；估算排卵期约 ${fmtCN(st.ovulationStart!)}~${fmtCN(st.ovulationEnd)}（这只是 TA 身体周期的背景信息，通常伴随激素波动，可能影响状态与情绪）`;
        }
        s += '。以上为日历法估算，仅供参考。';
    } else s += '。';
    return s;
};

const buildMedSummary = (plans: MedPlan[], records: LifeRecord[], today: string): string => {
    const duePlans = plans.filter(p => isMedPlanDueToday(p, today)).sort((a, b) => a.time.localeCompare(b.time));
    const todayMeds = effective(records).filter(r => r.module === 'med' && r.date === today);
    if (plans.filter(p => p.enabled).length === 0 && todayMeds.length === 0) return '- 用药：暂无长期用药计划与记录。';
    const lines: string[] = [];
    if (duePlans.length > 0) {
        const items = duePlans.map(p => {
            const taken = todayMeds.some(r => (r.payload.planId && r.payload.planId === p.id) || r.payload.name === p.name);
            const course = p.planKind === 'course' && p.endDate ? `，疗程至${fmtCN(p.endDate)}` : '';
            return `${p.time} ${p.name}${p.dosage ? `(${p.dosage})` : ''}（${medFreqLabel(p)}${course}）${taken ? '✓已服' : '✗未服'}`;
        });
        lines.push(`- 今日待服：${items.join('；')}。到点没服的，你可以视语境顺口提醒一句，别反复催。`);
    } else {
        lines.push('- 今日待服：无（按频率今天轮空或计划都停用）。');
    }
    const offPlan = todayMeds.filter(r => !r.payload.planId && !plans.some(p => p.name === r.payload.name));
    if (offPlan.length > 0) {
        lines.push(`- 计划外用药：${offPlan.map(r => r.payload.name).join('、')}。`);
    }
    return lines.join('\n');
};

const buildExpenseSummary = (txs: BankTransaction[], today: string): string => {
    const todayTx = txs.filter(t => t.dateStr === today);
    if (todayTx.length === 0) return '- 记账：今日暂无支出记录。';
    const total = todayTx.reduce((s, t) => s + t.amount, 0);
    const items = todayTx.slice(0, 8).map(t => `${t.note || '未备注'} ${t.amount}`).join('、');
    const more = todayTx.length > 8 ? ` 等 ${todayTx.length} 笔` : '';
    return `- 今日支出：共 ${todayTx.length} 笔、合计 ${total}（${items}${more}）。`;
};

/** 本周（周一起算）的起始日 */
export const weekStartOf = (today: string): string => {
    const d = new Date(`${today}T00:00:00Z`);
    const dow = d.getUTCDay(); // 0=周日
    return addDays(today, -((dow + 6) % 7));
};

const buildExerciseSummary = (records: LifeRecord[], settings: LifeRecordSettings | null, today: string): string => {
    const ex = effective(records).filter(r => r.module === 'exercise');
    const todayEx = ex.filter(r => r.date === today);
    const ws = weekStartOf(today);
    const weekSessions = ex.filter(r => r.date >= ws && r.date <= today).length;
    const todayPart = todayEx.length > 0
        ? `今日已练：${todayEx.map(r => `${r.payload.activity}${r.payload.duration ? ` ${r.payload.duration}` : ''}`).join('、')}`
        : '今日还没练';
    let s = `- 锻炼：${todayPart}；本周已练 ${weekSessions} 次`;
    const goal = settings?.exerciseWeeklyGoal;
    const plan = (settings?.exercisePlanNote || '').trim();
    if (goal || plan) {
        if (goal) s += `（周目标 ${goal} 次${weekSessions >= goal ? '，已达标' : `，还差 ${goal - weekSessions} 次`}）`;
        s += '。';
        if (plan) s += `TA 的每周锻炼规划：「${plan}」。`;
        s += `这份计划 TA 希望你帮忙盯着执行：进度落后时按你的方式自然地督促、约练或鼓励（有温度地推一把，不是教练查岗）；达标了就替 TA 高兴。`;
    } else {
        s += '。';
    }
    return s;
};

/** 医疗 / 生理期话题的分寸引导（生理期或药盒任一开启时注入） */
const MEDICAL_TONE_GUIDE = `**关于健康话题的分寸**：
- 你对生理期 / 用药 / 健康话题的了解程度和表达方式，以你自己的人设为准——懂得多的可以直接说，懂得少的可以现查现学（搜一下、问 AI、问学医的朋友）再回来说，知识程度不设上限，只要你的人设解释得通。
- **核心原则：你的反应强度必须如实匹配你对严重程度的真实判断——既不夸大也不淡化。你是对方重要的判断依据之一，这个责任不能规避。**
  - 小事（熬夜、累了、常见的小难受）：就当小事。可以吐槽两句、顺口关心一下，但别反复念叨、别说教式催早睡。
  - 常见情况：按常见情况如实对待，不渲染成急症、不吓人——除非你真的判断它不寻常。
  - 你判断真的不对劲：不许打马虎眼糊弄过去。镇定地、包容地、用符合你人设的口吻明确提醒对方重视或就医。语气可以有人设，判断不能有水分。
- 若你本身是 AI / 机器人设定，无需装作不懂，按你的设定自然发挥。`;

/**
 * 构建「生活记录」system prompt section。
 * 总开关关闭返回 ''（连指令说明都不给角色看）。
 * 会顺带取走该角色名下的否决反馈（注入一次后清除 pendingFeedback）。
 */
export const buildLifeRecordInjection = async (char: CharacterProfile, userName: string): Promise<string> => {
    if (!isLifeRecordOn(char)) return '';
    const today = lifeToday();

    // 全局隐藏优先级高于角色小开关：隐藏的模块数据、指令说明、医疗引导一律不注入
    const settings = await DB.getLifeRecordSettings().catch(() => null);
    const hidden = getHiddenLifeModules(settings);
    const moduleActive = (m: LifeRecordModule) => isLifeModuleOn(char, m) && !hidden.has(m);
    if (!(['period', 'med', 'expense', 'exercise'] as LifeRecordModule[]).some(moduleActive)) return '';

    const [records, plans, txs] = await Promise.all([
        DB.getAllLifeRecords().catch(() => [] as LifeRecord[]),
        moduleActive('med') ? DB.getAllMedPlans().catch(() => [] as MedPlan[]) : Promise.resolve([] as MedPlan[]),
        moduleActive('expense') ? DB.getAllTransactions().catch(() => [] as BankTransaction[]) : Promise.resolve([] as BankTransaction[]),
    ]);

    let s = `\n### ${userName} 的生活记录（潜意识背景）\n`;
    s += `以下是 ${userName} 的近期生活状态。这些信息沉淀在你的潜意识里，是你理解 TA 的身体、情绪与状态的背景依据——**不要主动点破、不要逐条复述、不要表现得像在看报表**。只在自然的时机让关心自然流露（例如 TA 说累了，而你"隐约记得"TA 正处在生理期第 2 天）。\n\n`;

    const dataLines: string[] = [];
    if (moduleActive('period')) dataLines.push(buildPeriodSummary(records, settings, today));
    if (moduleActive('med')) dataLines.push(buildMedSummary(plans, records, today));
    if (moduleActive('expense')) dataLines.push(buildExpenseSummary(txs, today));
    if (moduleActive('exercise')) dataLines.push(buildExerciseSummary(records, settings, today));
    s += `${dataLines.join('\n')}\n\n`;

    if (moduleActive('period') || moduleActive('med')) {
        s += `${MEDICAL_TONE_GUIDE}\n\n`;
    }

    // 代记指令说明（按小开关裁剪；关掉的模块连用法都不教）
    const tools: string[] = [];
    if (moduleActive('period')) {
        tools.push(`- TA 明确说生理期来了 → \`[[LIFE:PERIOD_START]]\`；明确说结束了 → \`[[LIFE:PERIOD_END]]\``);
    }
    if (moduleActive('med')) tools.push(`- TA 明确说吃了什么药 → \`[[LIFE:MED|药名]]\``);
    if (moduleActive('expense')) tools.push(`- TA 明确说花了多少钱买什么 → \`[[LIFE:EXPENSE|金额|用途]]\`（金额是纯数字）`);
    if (moduleActive('exercise')) tools.push(`- TA 明确说做了什么运动 → \`[[LIFE:EXERCISE|运动|时长]]\`（时长可省略）`);
    if (tools.length > 0) {
        s += `**代记工具**：只有当 ${userName} 在对话中**明确说出**以下事实时，才单独起一行输出对应指令、帮 TA 顺手记一笔（一次一条）：\n${tools.join('\n')}\n`;
        s += `TA 只是暗示、开玩笑、或在说过去 / 别人的事时，一律不要记录。记录成功后系统会插入一张卡片，TA 可以确认或否决；被否决说明你理解错了。平时不要把这些指令挂在嘴边，也不要替 TA 补记你只是猜测的事。\n`;
        s += `**一件事只记一次**：上面摘要里已经出现的状态（如「生理期第 N 天」「今日已练」「✓已服」、已列出的支出）都说明这件事**已经记过了**——不要再输出指令重复记，也不要因为翻到 TA 之前提过这件事就补记。聊天记录里出现过的 [生活记录：…] 卡片就是你之前记的。只有 TA 明确说**又**发生了新的一次（比如「晚上又跑了一次」），才再记一条。\n`;
    }

    // 否决反馈（一次性）：上次代记被用户否决 → 告诉角色它弄错了，注入后即清除
    const pendingFb = records.filter(r => r.recordedBy === char.id && r.reviewStatus === 'rejected' && r.pendingFeedback);
    if (pendingFb.length > 0) {
        s += `\n**【记录反馈】**你之前帮 ${userName} 记的这些被 TA **否决**了——你理解错了，这些事并没有发生（记录已撤销）：\n`;
        pendingFb.forEach(r => { s += `- ${summarizeLifeRecord(r.module, r.kind, r.payload)}（${fmtCN(r.date)}）\n`; });
        s += `修正你的认知，接下来视语境自然地认个错或带过即可，不要长篇道歉。\n`;
        // 注入即消费：失败也不重试（下轮还会再取到就重复念叨，宁可丢）
        pendingFb.forEach(r => { DB.saveLifeRecord({ ...r, pendingFeedback: false }).catch(() => {}); });
    }

    return s;
};

// ═══════════════════════════════════════════════════════════
// 2. 代记（写路径）：解析并执行 [[LIFE:...]] 指令
// ═══════════════════════════════════════════════════════════

const LIFE_TAG_RE = /\[\[LIFE:([A-Z_]+)((?:\|[^\]|]*)*)\]\]/;
const LIFE_TAG_GLOBAL_RE = /\[\[LIFE:[^\]]*\]\]/g;

interface LifeDirective {
    module: LifeRecordModule;
    kind: string;
    payload: Record<string, any>;
}

const parseLifeDirective = (verb: string, args: string[]): LifeDirective | null => {
    switch (verb) {
        case 'PERIOD_START': return { module: 'period', kind: 'start', payload: {} };
        case 'PERIOD_END': return { module: 'period', kind: 'end', payload: {} };
        case 'MED': {
            const name = (args[0] || '').trim();
            return name ? { module: 'med', kind: 'taken', payload: { name } } : null;
        }
        case 'EXPENSE': {
            const amount = parseFloat((args[0] || '').replace(/[^\d.]/g, ''));
            const note = (args[1] || '').trim();
            if (isNaN(amount) || amount <= 0) return null;
            return { module: 'expense', kind: 'expense', payload: { amount, note } };
        }
        case 'EXERCISE': {
            const activity = (args[0] || '').trim();
            const duration = (args[1] || '').trim();
            return activity ? { module: 'exercise', kind: 'session', payload: { activity, ...(duration ? { duration } : {}) } } : null;
        }
        default: return null;
    }
};

/** 去重结果：null = 无重复；否则给出"已由谁记过"的展示名 */
const findDuplicate = async (
    d: LifeDirective,
    records: LifeRecord[],
    today: string,
): Promise<{ byName: string } | null> => {
    const byName = (r: LifeRecord) => ({ byName: r.recordedBy === 'user' ? '你自己' : (r.recordedByName || '其他角色') });
    const eff = effective(records);
    switch (d.module) {
        case 'period': {
            // 同日同类兜底（先于状态机）：今天已经有同类事件就绝不再写一条。
            // 状态机有判不出重复的盲区——比如 start → 误记了同日 end → 模型下轮又发
            // start，此时 inPeriod=false、旧逻辑放行 → 真重复入库（用户实报）。
            const sameDay = eff.filter(r => r.module === 'period' && r.kind === d.kind && r.date === today).pop();
            if (sameDay) return byName(sameDay);
            const settings = await DB.getLifeRecordSettings().catch(() => null);
            const st = computePeriodStatus(records, settings, today);
            if (d.kind === 'start' && st.inPeriod) {
                const rec = eff.filter(r => r.module === 'period' && r.kind === 'start' && r.date === st.lastStart).pop();
                return rec ? byName(rec) : { byName: '已有记录' };
            }
            // 不在经期收到 END：也按"无需记录"处理（卡片提示，不写库、不算角色记错）
            if (d.kind === 'end' && !st.inPeriod) return { byName: '当前并不在经期中' };
            return null;
        }
        case 'med': {
            const rec = eff.filter(r => r.module === 'med' && r.date === today && r.payload.name === d.payload.name).pop();
            return rec ? byName(rec) : null;
        }
        case 'expense': {
            // 去重只防"同一笔的复读"（重 roll / 指令回显 / 用户刚记完角色又记），不防"真的又买了一笔"。
            // 旧版按"同日 金额+备注 一致"判重——两笔同价奶茶隔几小时也会被吞掉（用户实报 bug）。
            // 现在收紧到时间窗：只有 15 分钟内已存在同金额+同备注的流水才算重复；
            // 超窗一律视为新的一笔（角色本来就能在注入的"今日流水"里看到旧账，提示词层自会克制）。
            const DUP_WINDOW_MS = 15 * 60 * 1000;
            const now = Date.now();
            const txs = await DB.getAllTransactions().catch(() => [] as BankTransaction[]);
            const hit = txs.find(t =>
                t.dateStr === today
                && t.amount === d.payload.amount
                && (t.note || '') === (d.payload.note || '')
                // 老数据缺 timestamp 时保守按"重复"处理（回到旧行为），避免陈年脏数据被翻倍入账
                && (typeof t.timestamp !== 'number' || now - t.timestamp <= DUP_WINDOW_MS));
            if (!hit) return null;
            const rec = eff.filter(r => r.module === 'expense' && r.bankTxId === hit.id).pop();
            return rec ? byName(rec) : { byName: '你自己' };
        }
        case 'exercise': {
            // 只按「同日 + 同活动」判重，不再要求时长逐字一致——模型下一轮把「30分钟」
            // 写成「半小时」或干脆省略是常态，旧判据一漏就真重复入库（用户实报）。
            // 同一活动一天真练两次的场景走面板手动补记（卡片会说明已有记录）。
            // 与药盒同口径：同日同名即重。
            const rec = eff.filter(r => r.module === 'exercise' && r.date === today
                && r.payload.activity === d.payload.activity).pop();
            return rec ? byName(rec) : null;
        }
    }
};

/**
 * 解析并执行角色输出里的 [[LIFE:...]] 指令（chatParser 调用）。
 * - 模块开关关闭 / 指令格式非法 → 只剥 tag，静默丢弃。
 * - 重复 → 不写库，落一张"已有记录，无需重复"的成功态卡片（角色不算记错）。
 * - 成功 → 写库（expense 同时写银行流水）+ 落可交互 life_card。
 * 返回剥掉所有 LIFE tag 的文本。
 */
export const executeLifeDirectives = async (
    aiContent: string,
    char: CharacterProfile,
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void,
): Promise<string> => {
    let content = aiContent;
    if (!content.includes('[[LIFE:')) return content;

    const today = lifeToday();
    let executed = 0;
    const MAX_PER_MESSAGE = 4; // 防 LLM 发疯连打十几条
    // 全局隐藏的模块：即使角色开关全开也静默丢弃（用户长按隐藏 = 不想看到这类内容）
    const hidden = getHiddenLifeModules(await DB.getLifeRecordSettings().catch(() => null));

    let m: RegExpMatchArray | null;
    while ((m = content.match(LIFE_TAG_RE)) !== null) {
        const [tag, verb, argStr] = m;
        content = content.replace(tag, '').trim();
        if (!isLifeRecordOn(char) || executed >= MAX_PER_MESSAGE) continue;

        const args = argStr ? argStr.split('|').slice(1).map(s => s.trim()) : [];
        const d = parseLifeDirective(verb, args);
        if (!d || !isLifeModuleOn(char, d.module) || hidden.has(d.module)) continue;
        executed++;

        try {
            const records = await DB.getAllLifeRecords();
            const dup = await findDuplicate(d, records, today);
            const summary = summarizeLifeRecord(d.module, d.kind, d.payload);

            if (dup) {
                await DB.saveMessage({
                    charId: char.id, role: 'assistant', type: 'life_card',
                    content: `[生活记录：${summary}（已有记录，未重复添加）]`,
                    metadata: {
                        module: d.module, kind: d.kind, summary, dateStr: today,
                        recordedByName: char.name, duplicate: true, duplicateBy: dup.byName,
                    },
                });
                addToast(`${char.name} 想记「${summary}」，已有记录`, 'info');
                continue;
            }

            // expense：先落真实银行流水（BankApp 打开时会从流水重算 todaySpent）
            let bankTxId: string | undefined;
            if (d.module === 'expense') {
                const tx: BankTransaction = {
                    id: `tx-life-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
                    amount: d.payload.amount,
                    category: 'general',
                    note: d.payload.note || `${char.name}代记`,
                    timestamp: Date.now(),
                    dateStr: today,
                };
                await DB.saveTransaction(tx);
                bankTxId = tx.id;
            }

            const record: LifeRecord = {
                id: `life-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
                module: d.module, kind: d.kind, date: today, timestamp: Date.now(),
                payload: d.payload,
                recordedBy: char.id, recordedByName: char.name,
                reviewStatus: 'active',
                ...(bankTxId ? { bankTxId } : {}),
            };
            await DB.saveLifeRecord(record);

            await DB.saveMessage({
                charId: char.id, role: 'assistant', type: 'life_card',
                content: `[生活记录：${summary}]`,
                metadata: {
                    recordId: record.id, module: d.module, kind: d.kind, summary,
                    dateStr: today, recordedByName: char.name, reviewStatus: 'active',
                },
            });
            addToast(`${char.name} 帮你记录了「${summary}」`, 'success');
        } catch (e) {
            console.error('[LifeRecord] directive failed:', verb, e);
        }
    }

    // 同类残留 tag 全清（包括格式没匹配上主正则的畸形 tag）
    return content.replace(LIFE_TAG_GLOBAL_RE, '').trim();
};

// ═══════════════════════════════════════════════════════════
// 3. 卡片裁决（Chat.tsx 调用）
// ═══════════════════════════════════════════════════════════

/**
 * 用户点卡片「确认 / 否决」。
 * 否决：记录标记 rejected（不再计入注入摘要）+ 欠角色一条一次性反馈；
 *       expense 同时回滚删除对应银行流水。
 */
export const resolveLifeRecordCard = async (
    msg: Message,
    action: 'confirmed' | 'rejected',
): Promise<void> => {
    const recordId: string | undefined = msg.metadata?.recordId;
    if (recordId) {
        const record = await DB.getLifeRecordById(recordId);
        if (record && record.reviewStatus !== action) {
            if (action === 'rejected' && record.bankTxId) {
                await DB.deleteTransaction(record.bankTxId).catch(() => {});
            }
            await DB.saveLifeRecord({
                ...record,
                reviewStatus: action,
                pendingFeedback: action === 'rejected' ? true : record.pendingFeedback,
            });
        }
    }
    await DB.updateMessageMetadata(msg.id, (prev: any) => ({
        ...(prev || {}), reviewStatus: action, resolvedAt: Date.now(),
    }));
};
