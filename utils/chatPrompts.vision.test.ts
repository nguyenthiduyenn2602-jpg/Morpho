import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';
const char = { id: 'c', name: 'Test' } as any;
const user = { name: 'User' } as any;
const message = { id: 1, role: 'user', type: 'image', content: 'data:image/png;base64,AAAA', timestamp: 1700000000000, metadata: { visionDescription: 'A purple circle on white paper' } } as any;
describe('independent vision history integration', () => {
    it('passes recognized text to the main model without original image data', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory([message], 10, char, user, [], undefined, {useVisionDescriptions:true});
        expect(apiMessages[0].content).toContain('A purple circle');
        expect(typeof apiMessages[0].content).toBe('string');
        expect(JSON.stringify(apiMessages)).not.toContain('base64');
        expect(message.content).toContain('base64');
    });
    it('retains native vision when independent vision is disabled', () => {
        const {apiMessages} = ChatPrompts.buildMessageHistory([message], 10, char, user, []);
        expect(JSON.stringify(apiMessages)).toContain('image_url');
    });
    it('does not pretend to see an image without a description', () => {
        const {apiMessages} = ChatPrompts.buildMessageHistory([{...message,metadata:{}}], 10, char, user, [], undefined, {useVisionDescriptions:true});
        expect(apiMessages[0].content).toContain('没有可用的识图结果');
        expect(JSON.stringify(apiMessages)).not.toContain('base64');
    });
});
