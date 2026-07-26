import type { SocialComment, SocialPost } from '../types';

/**
 * Prepend a generated batch without replacing anything that arrived while the
 * request was in flight. IDs are unique in normal use; the guard also makes a
 * retried response idempotent.
 */
export function prependUniqueSocialPosts(current: SocialPost[], incoming: SocialPost[]): SocialPost[] {
    const existingIds = new Set(current.map(post => post.id));
    const fresh = incoming.filter(post => !existingIds.has(post.id));
    return fresh.length > 0 ? [...fresh, ...current] : current;
}

/** Replace one post using the latest version currently in the feed. */
export function updateSocialPost(
    current: SocialPost[],
    postId: string,
    updater: (post: SocialPost) => SocialPost,
): { feed: SocialPost[]; post?: SocialPost } {
    let updated: SocialPost | undefined;
    const feed = current.map(post => {
        if (post.id !== postId) return post;
        updated = updater(post);
        return updated;
    });
    return { feed: updated ? feed : current, post: updated };
}

/**
 * AI comments can finish after the user has already left a comment. Keep the
 * live comments and append only genuinely new generated entries.
 */
export function mergeSocialComments(current: SocialComment[], incoming: SocialComment[]): SocialComment[] {
    const existingIds = new Set(current.map(comment => comment.id));
    const fresh = incoming.filter(comment => !existingIds.has(comment.id));
    return fresh.length > 0 ? [...current, ...fresh] : current;
}
