import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoryNode } from './memoryPalace/types';
import { MemoryLinkDB, MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { deleteStoryVectorMemory, listStoryVectorMemories, updateStoryVectorMemory } from './storyTheaterVectorMemory';
import { storyTheaterThreadId } from './storyTheater';

const nodeAId = 'story_vector_scope_a';
const nodeBId = 'story_vector_scope_b';
const linkId = 'story_vector_scope_link';

function makeNode(id: string, entryId: string, content: string): MemoryNode {
    return {
        id,
        charId: storyTheaterThreadId(entryId),
        content,
        room: 'living_room',
        tags: ['剧情'],
        importance: 5,
        mood: 'neutral',
        embedded: true,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
    };
}

beforeEach(async () => {
    await Promise.all([
        MemoryLinkDB.delete(linkId),
        MemoryVectorDB.delete(nodeAId),
        MemoryVectorDB.delete(nodeBId),
        MemoryNodeDB.delete(nodeAId),
        MemoryNodeDB.delete(nodeBId),
    ]);
});

describe('剧情向量管理分区隔离', () => {
    it('列表只读取当前剧情的 story-theater 分区', async () => {
        await MemoryNodeDB.save(makeNode(nodeAId, 'entry-a', 'A 的记忆'));
        await MemoryNodeDB.save(makeNode(nodeBId, 'entry-b', 'B 的记忆'));

        const rows = await listStoryVectorMemories('entry-a');
        expect(rows.map(row => row.id)).toEqual([nodeAId]);
    });

    it('拒绝跨剧情编辑与删除', async () => {
        await MemoryNodeDB.save(makeNode(nodeBId, 'entry-b', 'B 的记忆'));

        await expect(updateStoryVectorMemory('entry-a', nodeBId, '越界修改')).rejects.toThrow('跨剧情分区');
        await expect(deleteStoryVectorMemory('entry-a', nodeBId)).rejects.toThrow('跨剧情分区');
        expect((await MemoryNodeDB.getById(nodeBId))?.content).toBe('B 的记忆');
    });

    it('删除当前剧情节点时同步清理本地向量与关联边，不影响其它剧情', async () => {
        await MemoryNodeDB.save(makeNode(nodeAId, 'entry-a', 'A 的记忆'));
        await MemoryNodeDB.save(makeNode(nodeBId, 'entry-b', 'B 的记忆'));
        await MemoryVectorDB.save({ memoryId: nodeAId, charId: storyTheaterThreadId('entry-a'), vector: [0.1, 0.2], dimensions: 2, model: 'test' });
        await MemoryVectorDB.save({ memoryId: nodeBId, charId: storyTheaterThreadId('entry-b'), vector: [0.3, 0.4], dimensions: 2, model: 'test' });
        await MemoryLinkDB.save({ id: linkId, sourceId: nodeAId, targetId: nodeBId, type: 'temporal', strength: 0.5 });

        await deleteStoryVectorMemory('entry-a', nodeAId);

        expect(await MemoryNodeDB.getById(nodeAId)).toBeUndefined();
        expect(await MemoryVectorDB.getByMemoryId(nodeAId)).toBeUndefined();
        expect(await MemoryLinkDB.getByNodeId(nodeAId)).toEqual([]);
        expect(await MemoryNodeDB.getById(nodeBId)).toBeTruthy();
        expect(await MemoryVectorDB.getByMemoryId(nodeBId)).toBeTruthy();
    });
});
