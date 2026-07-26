import { describe, it, expect } from 'vitest';
import { DatePrompts, DATE_STYLE_PRESETS, extractObservation, stripObservation, hasObservation, resolveObserveFields, OBSERVE_OPEN, OBSERVE_CLOSE } from './datePrompts';
import type { CharacterProfile, UserProfile, Message } from '../types';

const makeChar = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'char-1',
    name: '小白',
    avatar: '',
    description: '',
    systemPrompt: '你是小白，一个温柔的角色。',
    memories: [],
    ...overrides,
} as CharacterProfile);

const user: UserProfile = { name: '阿明', bio: '' } as UserProfile;

let msgId = 1;
const makeMsg = (overrides: Partial<Message> = {}): Message => ({
    id: msgId++,
    charId: 'char-1',
    role: 'user',
    type: 'text',
    content: '你好',
    timestamp: Date.now(),
    ...overrides,
});

const sysOf = (messages: Array<{ role: string; content: any }>): string => {
    const sys = messages.find(m => m.role === 'system');
    return typeof sys?.content === 'string' ? sys.content : '';
};

describe('DatePrompts.buildSessionPayload', () => {
    const baseInput = (char: CharacterProfile) => ({
        char,
        userProfile: user,
        allMsgs: [makeMsg({ role: 'assistant', content: '[normal] 开场白' }), makeMsg({ content: '我来了' })],
        emojis: [],
        userText: '我来了',
        variant: 'send' as const,
    });

    it('默认注入电影感风格块，不注入人称块', async () => {
        const { messages } = await DatePrompts.buildSessionPayload(baseInput(makeChar()));
        const sys = sysOf(messages);
        expect(sys).toContain('风格：电影感');
        expect(sys).toContain('Visual Novel Mode');
        expect(sys).not.toContain('叙事人称');
    });

    it('按 dateStyleConfig.style 切换风格块', async () => {
        for (const preset of DATE_STYLE_PRESETS) {
            const char = makeChar({ dateStyleConfig: { style: preset.id } });
            const { messages } = await DatePrompts.buildSessionPayload(baseInput(char));
            expect(sysOf(messages)).toContain(`风格：${preset.label}`);
        }
    });

    it('pov=third-name 注入双名字人称规则', async () => {
        const char = makeChar({ dateStyleConfig: { pov: 'third-name' } });
        const { messages } = await DatePrompts.buildSessionPayload(baseInput(char));
        const sys = sysOf(messages);
        expect(sys).toContain('叙事人称');
        expect(sys).toContain('小白看向阿明');
    });

    it('pov=third-you / first-you 注入对应示例', async () => {
        const thirdYou = await DatePrompts.buildSessionPayload(baseInput(makeChar({ dateStyleConfig: { pov: 'third-you' } })));
        expect(sysOf(thirdYou.messages)).toContain('小白看向你');
        const firstYou = await DatePrompts.buildSessionPayload(baseInput(makeChar({ dateStyleConfig: { pov: 'first-you' } })));
        expect(sysOf(firstYou.messages)).toContain('我看向你');
    });

    it('extra 自定义补充原样进入提示词', async () => {
        const char = makeChar({ dateStyleConfig: { extra: '不要写心理活动，多写对话。' } });
        const { messages } = await DatePrompts.buildSessionPayload(baseInput(char));
        const sys = sysOf(messages);
        expect(sys).toContain('额外要求');
        expect(sys).toContain('不要写心理活动，多写对话。');
    });

    it('细节深挖默认开启：方法块进 system，聚焦线索进末尾 note；关闭后两者都消失', async () => {
        const on = await DatePrompts.buildSessionPayload(baseInput(makeChar()));
        expect(sysOf(on.messages)).toContain('深挖，别填充');
        expect(on.messages[on.messages.length - 1].content).toContain('本轮线索');

        const off = await DatePrompts.buildSessionPayload(baseInput(makeChar({ dateStyleConfig: { digDeeper: false } })));
        expect(sysOf(off.messages)).not.toContain('深挖，别填充');
        expect(off.messages[off.messages.length - 1].content).not.toContain('本轮线索');
        // ContextBuilder 的全 App 通用精简版（表达底线）不受 digDeeper 开关影响，常驻
        expect(sysOf(off.messages)).toContain('表达底线');
    });

    it('消息结构为 [system, ...history, user]，末尾带 System Note；reroll 的 note 不同', async () => {
        const send = await DatePrompts.buildSessionPayload(baseInput(makeChar()));
        expect(send.messages[0].role).toBe('system');
        const lastSend = send.messages[send.messages.length - 1];
        expect(lastSend.role).toBe('user');
        expect(lastSend.content).toContain('我来了');
        expect(lastSend.content).toContain('System Note');
        expect(lastSend.content).not.toContain('Reroll');

        const reroll = await DatePrompts.buildSessionPayload({ ...baseInput(makeChar()), variant: 'reroll' });
        const lastReroll = reroll.messages[reroll.messages.length - 1];
        expect(lastReroll.content).toContain('Reroll');
    });
});

describe('OBSERVE 观测协议', () => {
    const block = `${OBSERVE_OPEN}
时间｜傍晚六点过，天刚擦黑
地点｜便利店门口的塑料凳上
状态｜有点疲惫，但见到你眼神亮了一下
细节｜指尖无意识地敲着关东煮的纸杯
${OBSERVE_CLOSE}`;

    it('开关打开时注入观测块提示词，关闭时不注入', async () => {
        const on = await DatePrompts.buildSessionPayload({
            char: makeChar({ dateObserve: { enabled: true } }),
            userProfile: user, allMsgs: [makeMsg({ role: 'assistant', content: '[normal] 开场' }), makeMsg({ content: 'hi' })],
            emojis: [], userText: 'hi', variant: 'send',
        });
        expect(sysOf(on.messages)).toContain('观测协议');
        expect(sysOf(on.messages)).toContain(OBSERVE_OPEN);

        const off = await DatePrompts.buildSessionPayload({
            char: makeChar(),
            userProfile: user, allMsgs: [makeMsg({ role: 'assistant', content: '[normal] 开场' }), makeMsg({ content: 'hi' })],
            emojis: [], userText: 'hi', variant: 'send',
        });
        expect(sysOf(off.messages)).not.toContain('观测协议');
    });

    it('自定义维度：hint 注入提示词，label 只改 HUD（线格式仍用固定中文 key）', async () => {
        const { messages } = await DatePrompts.buildSessionPayload({
            char: makeChar({ dateObserve: {
                enabled: true,
                fields: { state: { label: '心情指数', hint: '用一个温度词概括此刻心情' } },
            } }),
            userProfile: user, allMsgs: [makeMsg({ role: 'assistant', content: '[normal] 开场' }), makeMsg({ content: 'hi' })],
            emojis: [], userText: 'hi', variant: 'send',
        });
        const sys = sysOf(messages);
        expect(sys).toContain('用一个温度词概括此刻心情'); // 自定义 hint 进了提示词
        expect(sys).toContain('状态｜');                    // 线格式字段名仍是固定的「状态」
        expect(sys).not.toContain('心情指数｜');            // 自定义 label 不进线格式（避免解析失配）
    });

    it('禁用某维度后，提示词里不再出现该字段', async () => {
        const { messages } = await DatePrompts.buildSessionPayload({
            char: makeChar({ dateObserve: { enabled: true, fields: { detail: { enabled: false } } } }),
            userProfile: user, allMsgs: [makeMsg({ role: 'assistant', content: '[normal] 开场' }), makeMsg({ content: 'hi' })],
            emojis: [], userText: 'hi', variant: 'send',
        });
        const sys = sysOf(messages);
        expect(sys).toContain('观测协议');
        expect(sys).toContain('时间｜');
        expect(sys).not.toContain('细节｜');
    });

    it('四个维度全部禁用时不注入观测块', async () => {
        const { messages } = await DatePrompts.buildSessionPayload({
            char: makeChar({ dateObserve: { enabled: true, fields: {
                time: { enabled: false }, place: { enabled: false }, state: { enabled: false }, detail: { enabled: false },
            } } }),
            userProfile: user, allMsgs: [makeMsg({ role: 'assistant', content: '[normal] 开场' }), makeMsg({ content: 'hi' })],
            emojis: [], userText: 'hi', variant: 'send',
        });
        expect(sysOf(messages)).not.toContain('观测协议');
    });

    it('resolveObserveFields 合并默认+自定义并过滤禁用', () => {
        const char = makeChar({ name: '阿狸', dateObserve: { enabled: true, fields: {
            place: { label: '坐标' }, detail: { enabled: false },
        } } });
        const fields = resolveObserveFields(char.dateObserve, char.name);
        expect(fields.map(f => f.key)).toEqual(['time', 'place', 'state']); // detail 被过滤
        expect(fields.find(f => f.key === 'place')!.display).toBe('坐标');   // 自定义展示标签
        expect(fields.find(f => f.key === 'place')!.label).toBe('地点');     // 线格式字段名不变
        expect(fields.find(f => f.key === 'place')!.hint).toContain('阿狸'); // {name} 已替换
    });

    it('追加自定义维度：hint 进提示词、label 进线格式与硬性要求', async () => {
        const { messages } = await DatePrompts.buildSessionPayload({
            char: makeChar({ dateObserve: {
                enabled: true,
                custom: [{ id: 'c1', label: '穿着', hint: '今天穿了什么、整不整齐', enabled: true }],
            } }),
            userProfile: user, allMsgs: [makeMsg({ role: 'assistant', content: '[normal] 开场' }), makeMsg({ content: 'hi' })],
            emojis: [], userText: 'hi', variant: 'send',
        });
        const sys = sysOf(messages);
        expect(sys).toContain('穿着｜');
        expect(sys).toContain('今天穿了什么、整不整齐');
        expect(sys).toContain('「穿着」'); // 出现在「标签必须原样用」清单里
    });

    it('extractObservation 解析自定义维度到 extra（需传 custom）', () => {
        const fields = [{ id: 'c1', label: '穿着', enabled: true }];
        const full = `${OBSERVE_OPEN}\n时间｜黄昏\n地点｜天台\n穿着｜松垮的灰色卫衣\n${OBSERVE_CLOSE}\n[normal] 嗨。`;
        const { observation, rest } = extractObservation(full, { custom: fields });
        expect(observation!.time).toBe('黄昏');
        expect(observation!.extra?.c1).toBe('松垮的灰色卫衣');
        expect(rest).toBe('[normal] 嗨。');
        // 不传 custom 时，自定义行不会被解析成字段（留在 rest 或被忽略）
        const noCustom = extractObservation(full);
        expect(noCustom.observation!.extra?.c1).toBeUndefined();
    });

    it('回退层也能吃自定义维度（凑够 2 个维度）', () => {
        const fields = [{ id: 'c1', label: '天气', enabled: true }];
        const t = `天气｜下着小雨\n状态｜缩着脖子\n[normal] 快进来。`;
        const { observation, rest } = extractObservation(t, { lenient: true, custom: fields });
        expect(observation!.extra?.c1).toBe('下着小雨');
        expect(observation!.state).toBe('缩着脖子');
        expect(rest).toBe('[normal] 快进来。');
    });

    it('禁用 / 空标签的自定义维度不参与注入与解析', async () => {
        const char = makeChar({ dateObserve: { enabled: true, custom: [
            { id: 'c1', label: '穿着', enabled: false },
            { id: 'c2', label: '', enabled: true },
        ] } });
        const { messages } = await DatePrompts.buildSessionPayload({
            char, userProfile: user, allMsgs: [makeMsg({ role: 'assistant', content: '[normal] 开场' }), makeMsg({ content: 'hi' })],
            emojis: [], userText: 'hi', variant: 'send',
        });
        expect(sysOf(messages)).not.toContain('穿着｜');
        expect(resolveObserveFields(char.dateObserve, char.name).filter(f => f.isCustom)).toHaveLength(0);
    });

    it('extractObservation 解析四字段并剥出正文', () => {
        const full = `${block}\n[normal] 抬眼看你。\n[happy] "你来啦。"`;
        const { observation, rest } = extractObservation(full);
        expect(observation).not.toBeNull();
        expect(observation!.time).toContain('傍晚六点');
        expect(observation!.place).toContain('便利店');
        expect(observation!.state).toContain('疲惫');
        expect(observation!.detail).toContain('纸杯');
        expect(rest).toContain('[normal] 抬眼看你。');
        expect(rest).not.toContain(OBSERVE_OPEN);
        expect(rest).not.toContain('时间｜');
    });

    it('解析对半角竖线/英文 key/冒号容错', () => {
        const alt = `${OBSERVE_OPEN}\nTIME: dusk\nplace | a rooftop\n状态：calm\nDETAIL：a slow breath\n${OBSERVE_CLOSE}`;
        const { observation } = extractObservation(alt);
        expect(observation!.time).toBe('dusk');
        expect(observation!.place).toBe('a rooftop');
        expect(observation!.state).toBe('calm');
        expect(observation!.detail).toBe('a slow breath');
    });

    it('没有观测块时原样返回，observation 为 null', () => {
        const plain = '[normal] 普通的一行。\n[happy] "嗨。"';
        const { observation, rest } = extractObservation(plain);
        expect(observation).toBeNull();
        expect(rest).toBe(plain);
        expect(hasObservation(observation)).toBe(false);
    });

    it('stripObservation 去块保正文；hasObservation 判定有效性', () => {
        expect(stripObservation(`${block}\n[normal] 正文`)).toBe('[normal] 正文');
        expect(hasObservation({ time: '黄昏' })).toBe(true);
        expect(hasObservation({})).toBe(false);
        expect(hasObservation(null)).toBe(false);
    });

    // ── 鲁棒性：模型掉格式时的各种降级路径 ──
    describe('掉格式容错', () => {
        it('换括号风格【】/<>/[] 仍能严格提取', () => {
            for (const [open, close] of [['【OBSERVE】', '【/OBSERVE】'], ['<观测>', '</观测>'], ['[OBSERVE]', '[/OBSERVE]']]) {
                const t = `${open}\n时间｜清晨\n地点｜阳台\n状态｜没睡醒\n细节｜揉眼睛\n${close}\n[normal] 早。`;
                const { observation, rest } = extractObservation(t, { lenient: true });
                expect(observation, `${open} 应被识别`).not.toBeNull();
                expect(observation!.place).toBe('阳台');
                expect(rest).toBe('[normal] 早。');
            }
        });

        it('丢了闭合定界符：靠回退层从开头连续字段行还原', () => {
            const t = `${OBSERVE_OPEN}\n时间｜午后\n地点｜旧书店\n状态｜慵懒\n细节｜指尖划过书脊\n[normal] 你也来了。\n[happy] "找什么书？"`;
            const { observation, rest } = extractObservation(t, { lenient: true });
            expect(observation).not.toBeNull();
            expect(observation!.time).toBe('午后');
            expect(observation!.detail).toBe('指尖划过书脊');
            expect(rest.startsWith('[normal] 你也来了。')).toBe(true);
            expect(rest).not.toContain('时间｜');
            expect(rest).not.toContain(OBSERVE_OPEN);
        });

        it('完全没定界符 + markdown 加粗 / 列表符 / 半角冒号：回退层照样吃', () => {
            const t = `**时间**：黄昏\n- 地点: 天台\n状态｜风很大\n细节｜头发被吹乱\n\n[normal] 抓住栏杆。`;
            const { observation, rest } = extractObservation(t, { lenient: true });
            expect(observation).not.toBeNull();
            expect(observation!.time).toBe('黄昏');
            expect(observation!.place).toBe('天台');
            expect(observation!.state).toBe('风很大');
            expect(rest).toBe('[normal] 抓住栏杆。');
        });

        it('回退层未开启（lenient=false）时不强行解析，避免误伤', () => {
            const t = `时间｜午后\n地点｜旧书店\n[normal] 正文。`;
            const { observation, rest } = extractObservation(t);
            expect(observation).toBeNull();
            expect(rest).toBe(t);
        });

        it('只有 1 个字段不触发回退（防止正文里偶发的"状态：…"被误吞）', () => {
            const t = `状态：他看起来在想事情\n[normal] 走神了。`;
            const { observation, rest } = extractObservation(t, { lenient: true });
            expect(observation).toBeNull();
            expect(rest).toBe(t);
        });

        it('正文中部出现 field 样式的旁白不被回退层吞掉（只扫开头连续段）', () => {
            const t = `[normal] 她开口。\n时间｜其实没人知道现在几点\n地点｜也无所谓`;
            const { observation, rest } = extractObservation(t, { lenient: true });
            expect(observation).toBeNull();
            expect(rest).toBe(t);
        });
    });
});

describe('DatePrompts.buildPeekPayload', () => {
    it('描写风格短语跟随风格预设；extra 追加进指令', () => {
        const char = makeChar({ dateStyleConfig: { style: 'plain', extra: '环境描写多一点。' } });
        const { messages } = DatePrompts.buildPeekPayload({
            char, userProfile: user, allMsgs: [makeMsg()], emojis: [],
        });
        const userMsg = messages[messages.length - 1].content as string;
        expect(userMsg).toContain('简洁白描');
        expect(userMsg).toContain('环境描写多一点。');
        // peek 刻意保持第三人称旁观，不注入 pov 人称块
        expect(userMsg).toContain('第三人称');
    });

    it('历史里的卡片消息被压成摘要，原始 HTML/JSON 不进 prompt', () => {
        const rawHtml = '<div style="color:red">巨大的原始HTML</div>';
        const msgs = [
            makeMsg({ type: 'html_card' as any, role: 'assistant', content: `[HTML卡片] ${rawHtml}`, metadata: { htmlTextPreview: '一张卡片' } }),
            makeMsg({ content: '看到了' }),
        ];
        const { messages } = DatePrompts.buildPeekPayload({
            char: makeChar(), userProfile: user, allMsgs: msgs, emojis: [],
        });
        const userMsg = messages[messages.length - 1].content as string;
        expect(userMsg).not.toContain(rawHtml);
        expect(userMsg).toContain('一张卡片');
    });
});
