import { describe, expect, it } from 'vitest';
import { buildStoryImagePlanningMessages, parseStoryImagePromptPlan, parseStoryImageStoryboard } from './storyTheaterImage';

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
                { title: '动作变化帧', description: '苏郁走向窗边的一刻', visible: ['user', 'character:a'], sceneTags: '1girl, 1boy, walking closer, office, medium shot' },
                { title: '情绪高光帧', description: '沈欢在暖光里抬眼', visible: ['user'], sceneTags: '1girl, medium close-up, rule of thirds, shallow depth of field' },
            ],
        }), participants);
        expect(storyboard.state.location).toBe('办公室窗边');
        expect(storyboard.state.continuityChange).toContain('缩短');
        expect(storyboard.state.cast[0].clothing).toBe('白色衬衫');
        expect(storyboard.frames).toHaveLength(2);
        expect(storyboard.frames[1].finalPrompt).toContain('blonde hair');
        expect(storyboard.frames[1].finalPrompt).not.toContain('black hair');
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
        expect(messages[0].content).toContain('preserve them exactly');
    });
});
