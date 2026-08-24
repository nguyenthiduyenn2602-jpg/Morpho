import { describe, expect, it } from 'vitest';
import { buildStoryImagePlanningMessages, parseStoryImagePromptPlan } from './storyTheaterImage';

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
});
