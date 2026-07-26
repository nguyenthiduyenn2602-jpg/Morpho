import { describe, it, expect } from 'vitest';
import { parseDirectorActions, parseSummaryYaml, parseGroupTopicBox } from './parse';

describe('parseDirectorActions', () => {
    it('标准 JSON 数组直接解析', () => {
        const raw = '[{"charId": "c1", "content": "早啊"}, {"charId": "c2", "content": "困死了"}]';
        expect(parseDirectorActions(raw)).toEqual([
            { charId: 'c1', content: '早啊' },
            { charId: 'c2', content: '困死了' },
        ]);
    });

    it('带 markdown 围栏也能解析', () => {
        const raw = '```json\n[{"charId": "c1", "content": "哈哈哈"}]\n```';
        expect(parseDirectorActions(raw)).toEqual([{ charId: 'c1', content: '哈哈哈' }]);
    });

    it('第二层：没裹数组的单对象也能救回来', () => {
        const raw = '{"charId": "c1", "content": "就我一个人说话吗"}';
        expect(parseDirectorActions(raw)).toEqual([{ charId: 'c1', content: '就我一个人说话吗' }]);
    });

    it('第二层：数组整体损坏时逐个抠对象，坏的跳过好的保留', () => {
        const raw = '好的，以下是本轮群聊：[{"charId": "c1", "content": "第一条"}, {"charId": "c2", "content": "第二条"},]（生成完毕）';
        // 尾逗号让整体 JSON.parse 失败，但两个对象都应被逐个救回
        expect(parseDirectorActions(raw)).toEqual([
            { charId: 'c1', content: '第一条' },
            { charId: 'c2', content: '第二条' },
        ]);
    });

    it('content 为数字 / charId 为数字时强转 string，空 content 丢弃', () => {
        const raw = '[{"charId": 42, "content": 123}, {"charId": "c2", "content": "  "}]';
        expect(parseDirectorActions(raw)).toEqual([{ charId: '42', content: '123' }]);
    });

    it('完全无法解析时返回空数组而不是抛错', () => {
        expect(parseDirectorActions('今天大家聊得很开心。')).toEqual([]);
        expect(parseDirectorActions('')).toEqual([]);
    });
});

describe('parseSummaryYaml', () => {
    it('标准 YAML 带双引号', () => {
        expect(parseSummaryYaml('summary: "群里讨论了猫的照片。"')).toBe('群里讨论了猫的照片。');
    });

    it('带围栏的 YAML', () => {
        expect(parseSummaryYaml('```yaml\nsummary: "大家一起吐槽天气。"\n```')).toBe('大家一起吐槽天气。');
    });

    it('多行内容（引号闭合配对，不会在中途截断）', () => {
        const raw = 'summary: "第一行。\n第二行。"';
        expect(parseSummaryYaml(raw)).toBe('第一行。\n第二行。');
    });

    it('无引号裸值取到文末', () => {
        expect(parseSummaryYaml('summary: 群成员分享了新歌。')).toBe('群成员分享了新歌。');
    });

    it('第二层：完全没有 summary 前缀时整段当正文', () => {
        expect(parseSummaryYaml('大家围观了一只猫，气氛轻松。')).toBe('大家围观了一只猫，气氛轻松。');
    });

    it('中文引号包裹时剥掉', () => {
        expect(parseSummaryYaml('summary: “今天聊了旅行计划。”')).toBe('今天聊了旅行计划。');
    });

    it('空输入返回空串', () => {
        expect(parseSummaryYaml('')).toBe('');
    });
});

describe('parseGroupTopicBox', () => {
    it('第一层：标准 JSON', () => {
        expect(parseGroupTopicBox('{"title":"猫猫围观","summary":"群里围观了一只猫。"}'))
            .toEqual({ title: '猫猫围观', summary: '群里围观了一只猫。' });
    });

    it('第一层：带 ```json 围栏 + 前后废话', () => {
        const raw = '好的：\n```json\n{"title":"旅行计划","summary":"大家聊了去哪玩。"}\n```\n以上。';
        expect(parseGroupTopicBox(raw)).toEqual({ title: '旅行计划', summary: '大家聊了去哪玩。' });
    });

    it('第一层：剥推理模型 <think> 块', () => {
        const raw = '<think>我先想想标题</think>{"title":"深夜emo","summary":"半夜大家都睡不着。"}';
        expect(parseGroupTopicBox(raw)).toEqual({ title: '深夜emo', summary: '半夜大家都睡不着。' });
    });

    it('第二层：summary 里有裸换行（严格 JSON.parse 会挂）也能抠出字段', () => {
        // 这正是线上"总结格式无法解析"的主因：字符串值里带真实换行
        const raw = '{"title":"复盘","summary":"第一段发生了A。\n第二段发生了B。"}';
        const parsed = parseGroupTopicBox(raw);
        expect(parsed?.title).toBe('复盘');
        expect(parsed?.summary).toContain('第一段发生了A。');
        expect(parsed?.summary).toContain('第二段发生了B。');
    });

    it('第二层：缺 title 时给默认标题', () => {
        const raw = '{"summary":"只有总结没标题。"}';
        expect(parseGroupTopicBox(raw)).toEqual({ title: '一段群聊回忆', summary: '只有总结没标题。' });
    });

    it('第三层：完全没结构但有实质文本，整段兜底当总结', () => {
        const raw = '群里今天聊了很多，气氛不错，大家分享了各自的近况。';
        expect(parseGroupTopicBox(raw)).toEqual({ title: '一段群聊回忆', summary: raw });
    });

    it('空 / 无实质内容返回 null', () => {
        expect(parseGroupTopicBox('')).toBeNull();
        expect(parseGroupTopicBox('```json\n```')).toBeNull();
        expect(parseGroupTopicBox('{}')).toBeNull();
    });
});
