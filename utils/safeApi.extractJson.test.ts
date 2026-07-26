import { describe, it, expect } from 'vitest';
import { extractJson } from './safeApi';

/**
 * 回归测试：自习室（StudyApp）生成题目时，Claude 高频返回未转义特殊字符的 JSON，
 * 裸 JSON.parse 会在 line 12 附近抛 "Expected ',' or '}' after property value"。
 * generateQuiz / createCourse 改用 extractJson 的多层容错来吃掉这类畸形输出。
 */
describe('extractJson – Claude quiz JSON recovery', () => {
    it('recovers unescaped inner quotes inside a string value', () => {
        const bad = `{
  "questions": [
    {
      "type": "choice",
      "stem": "First",
      "options": ["A. x", "B. y", "C. z", "D. w"],
      "answer": "A",
      "explanation": "ok"
    },
    {
      "type": "fill_blank",
      "stem": "The term "React" refers to a ___",
      "answer": "library",
      "explanation": "because"
    }
  ]
}`;
        const j = extractJson(bad);
        expect(j).not.toBeNull();
        expect(Array.isArray(j.questions)).toBe(true);
        expect(j.questions.length).toBe(2);
    });

    it('recovers a diary reply with unescaped inner quotes (交换日记 REPLY)', () => {
        // Mirrors JournalApp's char reply shape { text, paperStyle, stickers }.
        // Claude leaves the inner 「"还不够好"」 quotes unescaped → naked JSON.parse dies and
        // the old catch dumped the whole raw object into the diary body.
        const bad = `{
  "text": "普通的一天，我今天想了想那句 "还不够好"，其实挺释怀的。",
  "paperStyle": "plain",
  "stickers": []
}`;
        const j = extractJson(bad);
        expect(j).not.toBeNull();
        expect(typeof j.text).toBe('string');
        expect(j.text).toContain('还不够好');
    });

    it('strips code fences and drops trailing commas', () => {
        const bad = '```json\n{ "questions": [ { "type": "true_false", "answer": "true", }, ], }\n```';
        const j = extractJson(bad);
        expect(j).not.toBeNull();
        expect(Array.isArray(j.questions)).toBe(true);
    });

    it('degrades safely on truncated output (hit max_tokens mid-array)', () => {
        // extractJson cannot rebuild the { questions: [...] } wrapper from a mid-nested-array
        // cutoff, so the StudyApp guard (!Array.isArray(json.questions)) rejects the result and
        // shows a friendly "请重试" toast instead of the old uncaught JSON.parse crash.
        const bad = '{ "questions": [ { "type": "choice", "stem": "Q1", "answer": "A", "explanation": "ok" }, { "type": "choice", "stem": "Q2", "answer';
        const j = extractJson(bad);
        const usable = j != null && Array.isArray(j.questions);
        expect(usable).toBe(false);
    });

    it('returns null on hopeless garbage (caller then throws a friendly error)', () => {
        expect(extractJson('this is not json at all')).toBeNull();
    });
});
