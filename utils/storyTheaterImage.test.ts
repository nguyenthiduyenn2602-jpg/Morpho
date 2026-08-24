import { describe, expect, it } from 'vitest';
import { buildStoryFrameMainPrompt, buildStoryFramePackedPrompt, buildStoryImagePlanningMessages, parseStoryImageCenter, parseStoryImagePromptPlan, parseStoryImageStoryboard } from './storyTheaterImage';

const participants = [
    { key: 'user', name: '沈欢', anchor: '1girl, blonde hair, pink eyes' },
    { key: 'character:a', name: '苏郁', anchor: '1boy, black hair, blue eyes' },
    { key: 'character:b', name: '秦少川', anchor: '1boy, silver hair, red eyes' },
];

describe('storyTheaterImage', () => {
    it('only attaches anchors for people selected as visible', () => {
        const plan = parseStoryImagePromptPlan(JSON.stringify({
            visible: ['user', 'character:b'],
            sceneTags: '2people, sitting together, office, warm light',
        }), participants);
        expect(plan.finalPrompt).toContain('blonde hair');
        expect(plan.finalPrompt).toContain('silver hair');
        expect(plan.finalPrompt).not.toContain('black hair');
        expect(plan.finalPrompt).toContain('2people, sitting together');
    });

    it('accepts a plain-text fallback and keeps identity anchors', () => {
        const plan = parseStoryImagePromptPlan('VISIBLE: character:a\nTAGS: 1boy, close-up, rainy night', participants);
        expect(plan.visible).toEqual(['character:a']);
        expect(plan.finalPrompt).toBe('1boy, black hair, blue eyes, 1boy, close-up, rainy night');
    });

    it('keeps exact subject counts in the base prompt and identities in separate character prompts', () => {
        const storyboard = parseStoryImageStoryboard(JSON.stringify({
            scene: { location: '卧室床边' },
            cast: participants.map(person => ({ key: person.key, name: person.name, appearance: person.anchor })),
            continuityChange: '三个人从门边走到床边',
            frames: [
                {
                    title: '动作变化帧', description: '三个人在床边停下', visible: participants.map(person => person.key),
                    sharedAction: 'three people standing close together beside bed',
                    sceneComposition: 'bedroom, full body, balanced composition',
                    characters: participants.map((person, index) => ({ key: person.key, action: ['looking right, {target#embrace}', 'looking left, {source#embrace}', 'watching the other two'][index], center: ['a3', 'c3', 'e3'][index] })),
                },
                {
                    title: '关系高光帧', description: '三个人彼此对视', visible: participants.map(person => person.key),
                    sharedAction: 'three people looking at each other',
                    sceneComposition: 'bedroom, three-quarter body',
                    characters: participants.map((person, index) => ({ key: person.key, action: 'looking at another', center: ['a3', 'c3', 'e3'][index] })),
                },
            ],
        }), participants, true);
        const prompt = buildStoryFrameMainPrompt(storyboard.frames[0]);
        expect(prompt).toContain('1girl, 2boys');
        expect(prompt).not.toContain('blonde hair');
        expect(storyboard.frames[0].characters[0].prompt).toContain('girl, 1.35::blonde hair, pink eyes::, looking right');
        expect(storyboard.frames[0].characters[0].prompt).not.toContain('1girl');
        expect(storyboard.frames[0].characters[1].prompt).toContain('boy, 1.35::black hair, blue eyes::, looking left');
        expect(storyboard.frames[0].characters[1].negative).toContain('blonde hair');
        expect(storyboard.frames[0].characters[1].negative).toContain('silver hair');
        expect(storyboard.frames[0].characters.map(character => character.center.x)).toEqual([0.1, 0.5, 0.9]);
        const packed = buildStoryFramePackedPrompt(storyboard.frames[0]);
        expect(packed).toContain('left character: girl, 1.35::blonde hair, pink eyes::');
        expect(packed).toContain('center character: boy, 1.35::black hair, blue eyes::');
        expect(packed).toContain('right character: boy, 1.35::silver hair, red eyes::');
        expect(packed.match(/blonde hair/g)).toHaveLength(1);
    });

    it('asks the planner to support any number of visible people', () => {
        const messages = buildStoryImagePlanningMessages({
            entry: {
                id: 'story', title: '测试', premise: '', presetId: 'preset', presetOverride: undefined,
                openingMode: 'user', mask: { type: 'user' }, characterIds: ['a', 'b'], writesToCharacterMemory: false,
                characterMemoryDates: {}, carryCharacterMemory: true, characterContextLimits: {}, selectedWorldbookIds: [],
                archives: [], archiveStrategy: 'summary', archiveAfter: 20, createdAt: 1, updatedAt: 1,
                imageGeneration: { enabled: true, width: 1216, height: 832, characterAnchors: {} },
            },
            actors: [],
            userName: '沈欢',
            history: [{ role: 'assistant', content: '三个人走进办公室。' }],
        });
        expect(messages[0].content).toContain('any number of people');
        expect(messages[1].content).toContain('三个人走进办公室');
    });

    it('parses continuity state and keeps each frame limited to its visible identities', () => {
        const storyboard = parseStoryImageStoryboard(JSON.stringify({
            scene: { location: '办公室窗边', time: '傍晚', lighting: '暖色侧光', atmosphere: '安静而暧昧' },
            cast: [
                { key: 'user', name: '沈欢', clothing: '白色衬衫', position: '画面左侧', pose: '靠在窗边', expression: '微笑' },
                { key: 'character:a', name: '苏郁', clothing: '黑色西装', position: '画面右侧', pose: '俯身靠近', expression: '专注' },
            ],
            continuityChange: '苏郁从办公桌后走到窗边，缩短了与沈欢的距离',
            frames: [
                { title: '动作变化帧', description: '苏郁走向窗边的一刻', visible: ['user', 'character:a'], sceneTags: '1girl, 1boy, office, medium wide shot', characters: [
                    { key: 'user', prompt: 'white shirt, leaning by window, {target#approaching}', center: 'b3' },
                    { key: 'character:a', prompt: 'black suit, walking, {source#approaching}', center: 'd3' },
                ] },
                { title: '关系高光帧', description: '沈欢在暖光里抬眼', visible: ['user'], sceneTags: '1girl, office window, upper body, rule of thirds', characters: [
                    { key: 'user', prompt: 'white shirt, looking up, soft smile', center: 'c3' },
                ] },
            ],
        }), participants);
        expect(storyboard.state.location).toBe('办公室窗边');
        expect(storyboard.state.continuityChange).toContain('缩短');
        expect(storyboard.state.cast[0].clothing).toBe('白色衬衫');
        expect(storyboard.frames).toHaveLength(2);
        expect(storyboard.frames[1].finalPrompt).toContain('blonde hair');
        expect(storyboard.frames[1].finalPrompt).not.toContain('black hair');
        expect(storyboard.frames[0].characters[0].prompt).toContain('blonde hair');
        expect(storyboard.frames[0].characters[1].prompt).toContain('{source#approaching}');
        expect(storyboard.frames[0].characters[1].center).toEqual({ x: 0.7, y: 0.5 });
    });

    it('extracts a complete storyboard JSON object from surrounding model prose', () => {
        const raw = `I will now return the requested data.\n\`\`\`json\n${JSON.stringify({
            scene: { location: '十二楼办公室窗边' },
            cast: [{ key: 'character:a', name: '苏郁', appearance: '黑色短发、蓝眼睛，黑色衬衫与西裤' }],
            continuityChange: '苏郁离开办公桌，俯身靠近窗边的人',
            frames: [
                { title: '动作变化帧', description: '苏郁走到窗边，手掌刚落在窗台', visible: ['character:a'], sharedAction: 'walking from desk, hand reaching window sill, focused gaze', sceneComposition: '1boy, office window, full body', characters: [{ key: 'character:a', action: 'walking, hand on window sill, focused gaze', center: 'c3' }] },
                { title: '关系高光帧', description: '苏郁俯身停在窗前', visible: ['character:a'], sharedAction: 'leaning over window sill, lowered gaze, tense shoulders', sceneComposition: '1boy, office window, three-quarter body', characters: [{ key: 'character:a', action: 'leaning, lowered gaze, tense shoulders', center: 'c3' }] },
            ],
        })}\n\`\`\`\nDone.`;
        const storyboard = parseStoryImageStoryboard(raw, participants, true);
        expect(storyboard.state.location).toBe('十二楼办公室窗边');
        expect(storyboard.frames[0].characters[0].prompt).toContain('black hair');
        expect(storyboard.frames[0].characters[0].prompt).not.toContain('walking from desk');
        expect(storyboard.frames[0].sceneTags).toContain('walking from desk');
    });

    it('rejects lazy or truncated director output before image generation', () => {
        expect(() => parseStoryImageStoryboard('{"scene":{"location":"沿用当前剧情场景"}', participants, true))
            .toThrow('没有返回完整 JSON');
        expect(() => parseStoryImageStoryboard(JSON.stringify({
            scene: { location: '沿用当前剧情场景', time: '沿用当前时间', lighting: '沿用当前光线', atmosphere: '沿用当前氛围' },
            cast: [{ key: 'user', name: '沈欢', clothing: '依照正文', position: '依照正文', pose: '依照正文', expression: '依照正文' }],
            continuityChange: '根据本轮正文更新动作与人物关系',
            frames: [],
        }), participants, true)).toThrow('没有整理出关键帧');
    });

    it('maps the worldbook five-by-five centers to NovelAI coordinates', () => {
        expect(parseStoryImageCenter('a1')).toEqual({ x: 0.1, y: 0.1 });
        expect(parseStoryImageCenter('c3')).toEqual({ x: 0.5, y: 0.5 });
        expect(parseStoryImageCenter('e5')).toEqual({ x: 0.9, y: 0.9 });
    });

    it('passes the previous visual state to the continuity planner', () => {
        const messages = buildStoryImagePlanningMessages({
            entry: {
                id: 'story', title: '测试', premise: '', presetId: 'preset', presetOverride: undefined,
                openingMode: 'user', mask: { type: 'user' }, characterIds: ['a'], writesToCharacterMemory: false,
                characterMemoryDates: {}, carryCharacterMemory: true, characterContextLimits: {}, selectedWorldbookIds: [],
                archives: [], archiveStrategy: 'summary', archiveAfter: 20, createdAt: 1, updatedAt: 1,
                imageGeneration: { enabled: true, width: 1216, height: 832, imageCount: 2, characterAnchors: {} },
            },
            actors: [],
            userName: '沈欢',
            history: [{ role: 'assistant', content: '她仍站在窗边。' }],
            previousState: {
                location: '办公室窗边', time: '傍晚', lighting: '暖色侧光', atmosphere: '安静', cast: [],
                continuityChange: '首次建立场景', frames: [],
            },
        });
        expect(messages[1].content).toContain('办公室窗边');
        expect(messages[0].content).toContain('Preserve identity anchors exactly');
    });
});
