import { afterEach, describe, expect, it, vi } from 'vitest';
import { runXhsDetail, type XhsCaches } from './agenticTools';
import { XhsMcpClient } from './xhsMcpClient';

describe('runXhsDetail', () => {
    afterEach(() => vi.restoreAllMocks());

    it('exposes Lite interactions/comments to the role and enriches the share card with one request', async () => {
        const getDetail = vi.spyOn(XhsMcpClient, 'getNoteDetail').mockResolvedValue({
            success: true,
            data: {
                data: {
                    note: {
                        note_id: 'note-1',
                        title: '完整标题',
                        desc: '完整正文',
                        user: { user_id: 'author-1', nickname: '楼主' },
                        interact_info: {
                            liked_count: '1.2万',
                            collected_count: '345',
                            comment_count: '2',
                            share_count: '8',
                        },
                    },
                    comments: {
                        list: [{
                            comment_id: 'comment-1',
                            content: '一级评论',
                            user: { user_id: 'user-1', nickname: '甲' },
                            sub_comments: [{
                                comment_id: 'comment-2',
                                content: '回复内容',
                                user_info: { user_id: 'user-2', nickname: '乙' },
                            }],
                        }],
                    },
                },
            },
        });
        const caches: XhsCaches = {
            xsecTokenCache: new Map([['note-1', 'token-1']]),
            noteTitleCache: new Map([['note-1', '搜索标题']]),
            commentUserIdCache: new Map(),
            commentAuthorNameCache: new Map(),
            commentParentIdCache: new Map(),
        };
        const lastXhsNotesRef = {
            current: [{
                noteId: 'note-1',
                title: '搜索标题',
                desc: '搜索摘要',
                likes: 1,
                author: '楼主',
                authorId: 'author-1',
                xsecToken: 'token-1',
            }],
        };

        const result = await runXhsDetail(
            { noteId: 'note-1' },
            {
                char: { xhsEnabled: true } as any,
                userProfile: {} as any,
                realtimeConfig: {
                    xhsMcpConfig: { enabled: true, serverUrl: 'https://example.test/xhs' },
                } as any,
                xhsCaches: caches,
                lastXhsNotesRef,
            },
        );

        expect(getDetail).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ ok: true, failed: false });
        expect(result.ok && result.detailText).toContain('12000赞 345收藏 2评论 8分享');
        expect(result.ok && result.detailText).toContain('甲: 一级评论');
        expect(result.ok && result.detailText).toContain('乙: 回复内容');
        expect(caches.commentUserIdCache.get('comment-1')).toBe('user-1');
        expect(caches.commentUserIdCache.get('comment-2')).toBe('user-2');
        expect(caches.commentParentIdCache.get('comment-2')).toBe('comment-1');
        expect(lastXhsNotesRef.current[0]).toMatchObject({
            noteId: 'note-1',
            title: '完整标题',
            desc: '完整正文',
            likes: 12_000,
            commentCount: 2,
            comments: [
                { author: '甲', content: '一级评论' },
                { author: '乙', content: '回复内容' },
            ],
        });
    });
});
