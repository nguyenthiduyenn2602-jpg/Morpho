import type { StoryTheaterEntry } from '../types';
import type { RemoteVectorConfig } from './memoryPalace/types';
import { DB } from './db';
import { storyTheaterMemoryRecipientIds, storyTheaterThreadId } from './storyTheater';
import { deleteStoryVectorMemory, listStoryVectorMemories } from './storyTheaterVectorMemory';

export interface DeleteStoryTheaterResult {
    deletedMessageCount: number;
    deletedVectorCount: number;
    remoteVectorDeleteFailures: number;
}

export async function deleteStoryTheaterData(
    entry: StoryTheaterEntry,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<DeleteStoryTheaterResult> {
    const threadId = storyTheaterThreadId(entry.id);
    const recipientIds = storyTheaterMemoryRecipientIds(entry);
    const [centralMessages, recipientMessages, vectorNodes] = await Promise.all([
        DB.getMessagesByCharId(threadId, true),
        Promise.all(recipientIds.map(id => DB.getMessagesByCharId(id, true))),
        listStoryVectorMemories(entry.id),
    ]);

    const messageIds = new Set<number>();
    for (const message of centralMessages) {
        messageIds.add(message.id);
        const mirrorIds = Object.values((message.metadata?.theaterMirrorIds || {}) as Record<string, number>);
        for (const id of mirrorIds) {
            const numericId = Number(id);
            if (Number.isFinite(numericId) && numericId > 0) messageIds.add(numericId);
        }
    }
    for (const message of recipientMessages.flat()) {
        if (message.metadata?.source === 'story_theater_memory' && message.metadata?.theaterId === entry.id) {
            messageIds.add(message.id);
        }
    }

    let remoteVectorDeleteFailures = 0;
    for (const node of vectorNodes) {
        const result = await deleteStoryVectorMemory(entry.id, node.id, remoteVectorConfig);
        if (result.remoteDeleted === false) remoteVectorDeleteFailures += 1;
    }

    if (messageIds.size > 0) await DB.deleteMessages([...messageIds]);
    await DB.deleteStoryTheater(entry.id);
    try { localStorage.removeItem(`mp_lastMsgId_${threadId}`); } catch { /* storage unavailable */ }

    return {
        deletedMessageCount: messageIds.size,
        deletedVectorCount: vectorNodes.length,
        remoteVectorDeleteFailures,
    };
}
