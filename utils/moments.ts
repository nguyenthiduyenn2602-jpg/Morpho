import type {
    APIConfig,
    CharacterProfile,
    MomentsMemoryState,
    MomentsRoleDigest,
    MomentsSettings,
    SocialComment,
    SocialPost,
    UserProfile,
} from '../types';
import { DB } from './db';
import { ContextBuilder } from './context';
import { extractContent, safeResponseJson } from './safeApi';
import { resolveRefToDataUrl } from './blobRef';

const SETTINGS_ASSET_ID = 'morpho_moments_settings_v1';
const MEMORY_ASSET_ID = 'morpho_moments_memory_v1';
const RECENT_RAW_PER_ROLE = 12;
const MAX_COMPACTED_IDS = 240;

export const DEFAULT_MOMENTS_PRESET = `你正在维护一个仿微信朋友圈的私人生活流。
内容必须像角色随手发出的真实动态：自然、口语、短而具体，可以是段子、社交动态、好物分享、工作小记或生活碎片。
年轻角色可以抽象整活，年长角色可以写工作与生活观察，但不要把所有人写成同一种语气。
近期聊天只是生活素材之一，不要每条都复述聊天；不要突然写无缘无故的忧郁小作文。
评论要像熟人随手留下的短句，有长有短，可以只回一个表情或半句话，不要排队写整齐的小作文。`;

export const DEFAULT_MOMENTS_SETTINGS: MomentsSettings = {
    version: 1,
    coverPositionY: 50,
    invitedCharIds: [],
    generationPreset: DEFAULT_MOMENTS_PRESET,
    autoPublishEnabled: true,
    activityLevel: 'normal',
    minIntervalHours: 8,
    lastAutoRunAt: 0,
    nextAutoAt: 0,
    unreadPostIds: [],
};

const emptyMemory = (): MomentsMemoryState => ({ version: 1, roles: {} });

const parseAsset = <T,>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback;
    try { return { ...fallback, ...JSON.parse(raw) }; } catch { return fallback; }
};

export async function loadMomentsSettings(): Promise<MomentsSettings> {
    return parseAsset(await DB.getAsset(SETTINGS_ASSET_ID), DEFAULT_MOMENTS_SETTINGS);
}

export async function saveMomentsSettings(settings: MomentsSettings): Promise<void> {
    await DB.saveAsset(SETTINGS_ASSET_ID, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('moments-settings-updated', { detail: settings }));
}

export async function loadMomentsMemory(): Promise<MomentsMemoryState> {
    return parseAsset(await DB.getAsset(MEMORY_ASSET_ID), emptyMemory());
}

export async function saveMomentsMemory(memory: MomentsMemoryState): Promise<void> {
    await DB.saveAsset(MEMORY_ASSET_ID, JSON.stringify(memory));
}

export async function loadMomentPosts(): Promise<SocialPost[]> {
    const all = await DB.getSocialPosts();
    return all.filter(post => post.platform === 'moments').sort((a, b) => b.timestamp - a.timestamp);
}

export const momentFingerprint = (text: string): string => text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 160);

const shingles = (value: string): Set<string> => {
    const normalized = momentFingerprint(value);
    const out = new Set<string>();
    for (let i = 0; i < normalized.length - 1; i++) out.add(normalized.slice(i, i + 2));
    if (!out.size && normalized) out.add(normalized);
    return out;
};

export function momentSimilarity(a: string, b: string): number {
    const aa = shingles(a), bb = shingles(b);
    if (!aa.size || !bb.size) return 0;
    let intersection = 0;
    aa.forEach(v => { if (bb.has(v)) intersection += 1; });
    // Dice 对“删掉几个语气词、换一个量词”的中文改写更敏感，适合拦截换皮重发。
    return (intersection * 2) / Math.max(1, aa.size + bb.size);
}

const shortTopic = (post: SocialPost): string => {
    const location = post.location?.visible && post.location.label ? ` @${post.location.label}` : '';
    return `${new Date(post.timestamp).toLocaleDateString('zh-CN')} ${post.content.replace(/\s+/g, ' ').slice(0, 54)}${location}`;
};

/**
 * 朋友圈历史不会删除；这里只有 AI 上下文的“滚动压缩”。每个角色最近 12 条保留原文，
 * 更早内容沉入摘要、主题和指纹账本，从而让上下文大小恒定且能持续去重。
 */
export async function compactMomentsHistory(posts?: SocialPost[]): Promise<MomentsMemoryState> {
    const all = posts || await loadMomentPosts();
    const memory = await loadMomentsMemory();
    const byRole = new Map<string, SocialPost[]>();
    all.filter(p => p.authorType === 'character' && p.authorCharId).forEach(post => {
        const arr = byRole.get(post.authorCharId!) || [];
        arr.push(post);
        byRole.set(post.authorCharId!, arr);
    });

    byRole.forEach((rolePosts, charId) => {
        rolePosts.sort((a, b) => b.timestamp - a.timestamp);
        const older = rolePosts.slice(RECENT_RAW_PER_ROLE);
        const prev: MomentsRoleDigest = memory.roles[charId] || {
            charId, summary: '', recentTopics: [], recentFingerprints: [], compactedPostIds: [], updatedAt: 0,
        };
        const already = new Set(prev.compactedPostIds);
        const fresh = older.filter(p => !already.has(p.id));
        const summaryLines = [...(prev.summary ? prev.summary.split('\n') : []), ...fresh.map(shortTopic)].slice(-24);
        const recentAll = rolePosts.slice(0, 28);
        memory.roles[charId] = {
            charId,
            summary: summaryLines.join('\n').slice(-2200),
            recentTopics: recentAll.map(shortTopic).slice(0, 18),
            recentFingerprints: recentAll.map(p => momentFingerprint(p.content)).filter(Boolean).slice(0, 32),
            compactedPostIds: [...prev.compactedPostIds, ...fresh.map(p => p.id)].slice(-MAX_COMPACTED_IDS),
            updatedAt: Date.now(),
        };
    });
    await saveMomentsMemory(memory);
    return memory;
}

const cleanMessage = (content: string): string => content
    .replace(/\[\[[\s\S]*?\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);

async function recentChatFor(charId: string, limit = 10): Promise<string> {
    const rows = await DB.getRecentMessagesByCharId(charId, limit, true);
    return rows
        .filter(m => m.type === 'text' && m.role !== 'system')
        .map(m => `${m.role === 'user' ? '用户' : '角色'}：${cleanMessage(m.content)}`)
        .filter(line => line.length > 4)
        .join('\n');
}

const jsonObjectFromText = (raw: string): any => {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { return JSON.parse(cleaned); } catch { /* continue */ }
    const start = cleaned.indexOf('{');
    if (start < 0) throw new Error('模型没有返回朋友圈 JSON');
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') quoted = false;
            continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
        }
    }
    throw new Error('朋友圈 JSON 不完整');
};

export const buildMomentsUserContent = (prompt: string, imageUrls: string[]): string | Array<Record<string, any>> => {
    const validImages = imageUrls.filter(url => /^data:image\//i.test(url) || /^https?:\/\//i.test(url));
    if (!validImages.length) return prompt;
    return [
        { type: 'text', text: prompt },
        ...validImages.map(url => ({ type: 'image_url', image_url: { url } })),
    ];
};

async function callMomentsDirector(api: APIConfig, prompt: string, images: string[] = []): Promise<any> {
    if (!api.baseUrl || !api.apiKey || !api.model) throw new Error('请先在设置里配置全局 API');
    const resolvedImages = images.length
        ? (await Promise.all(images.map(resolveRefToDataUrl))).filter(Boolean)
        : [];
    const response = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
        body: JSON.stringify({
            model: api.model,
            messages: [
                { role: 'system', content: '你是朋友圈生活流导演。严格只输出一个合法 JSON 对象，不要 markdown，不要解释。' },
                { role: 'user', content: buildMomentsUserContent(prompt, resolvedImages) },
            ],
            temperature: 0.92,
            max_tokens: 5000,
            stream: false,
        }),
    });
    if (!response.ok) throw new Error(`朋友圈生成失败（HTTP ${response.status}）`);
    const data = await safeResponseJson(response);
    const content = extractContent(data);
    if (!content) throw new Error('模型没有返回朋友圈正文');
    return jsonObjectFromText(content);
}

const pickAuthor = (chars: CharacterProfile[], posts: SocialPost[], forced?: string): CharacterProfile => {
    if (forced) return chars.find(c => c.id === forced) || chars[0];
    const recentAuthors = posts.slice(0, Math.min(chars.length, 3)).map(p => p.authorCharId);
    const pool = chars.filter(c => !recentAuthors.includes(c.id));
    const candidates = pool.length ? pool : chars;
    return candidates[Math.floor(Math.random() * candidates.length)];
};

const makeComment = (
    raw: any,
    allowed: Map<string, CharacterProfile>,
    createdAt: number,
    index: number,
    priorIds: Set<string>,
): SocialComment | null => {
    const charId = String(raw?.authorId || raw?.authorCharId || '');
    const char = allowed.get(charId);
    const content = String(raw?.content || '').trim().slice(0, 180);
    if (!char || !content) return null;
    const id = `mc_${createdAt}_${index}_${Math.random().toString(36).slice(2, 6)}`;
    const requestedReply = String(raw?.replyToCommentId || '');
    const replyToCommentId = requestedReply && priorIds.has(requestedReply) ? requestedReply : undefined;
    return {
        id,
        authorName: char.name,
        authorAvatar: char.avatar,
        content,
        likes: Math.max(0, Math.min(9, Number(raw?.likes) || 0)),
        isCharacter: true,
        authorType: 'character',
        authorCharId: char.id,
        replyToCommentId,
        replyToName: replyToCommentId ? String(raw?.replyToName || '') || undefined : undefined,
        timestamp: createdAt + (index + 1) * 1000,
    };
};

const normalizeComments = (raw: any[], chars: CharacterProfile[], authorId: string, createdAt: number): SocialComment[] => {
    const allowed = new Map(chars.map(c => [c.id, c]));
    const out: SocialComment[] = [];
    const priorIds = new Set<string>();
    const rawToStored = new Map<string, string>();
    let nestedReplyUsed = false;
    let authorReplyCount = 0;
    for (const item of Array.isArray(raw) ? raw : []) {
        const rawReplyId = String(item?.replyToCommentId || '');
        const requestedReply = !!rawReplyId;
        if (requestedReply && nestedReplyUsed) item.replyToCommentId = undefined;
        else if (requestedReply) item.replyToCommentId = rawToStored.get(rawReplyId) || rawReplyId;
        if (String(item?.authorId || '') === authorId && requestedReply && authorReplyCount >= 2) continue;
        const comment = makeComment(item, allowed, createdAt, out.length, priorIds);
        if (!comment) continue;
        if (comment.replyToCommentId) {
            nestedReplyUsed = true;
            if (comment.authorCharId === authorId) authorReplyCount += 1;
        }
        out.push(comment);
        priorIds.add(comment.id);
        const rawId = String(item?.id || '');
        if (rawId) rawToStored.set(rawId, comment.id);
        if (out.length >= Math.min(14, chars.length + 3)) break;
    }
    return out;
};

const participantBriefs = async (chars: CharacterProfile[], user: UserProfile): Promise<string> => {
    const rows = await Promise.all(chars.map(async char => {
        const recent = await recentChatFor(char.id, 5);
        const identity = ContextBuilder.buildCoreContext(char, user, false).slice(0, 2600);
        return `\n[角色ID=${char.id}｜${char.name}]\n${identity}\n近期私聊：\n${recent || '（暂无）'}`;
    }));
    return rows.join('\n');
};

const identityList = (chars: CharacterProfile[]): string => chars.map(c => `${c.id}=${c.name}`).join('；');

export interface GenerateRoleMomentOptions {
    characters: CharacterProfile[];
    userProfile: UserProfile;
    apiConfig: APIConfig;
    settings: MomentsSettings;
    createdAt?: number;
    forceAuthorId?: string;
}

export interface MomentGenerationResult { post: SocialPost; author: CharacterProfile; }

export async function generateRoleMoment(options: GenerateRoleMomentOptions): Promise<MomentGenerationResult> {
    const invited = options.characters.filter(c => options.settings.invitedCharIds.includes(c.id));
    if (!invited.length) throw new Error('请先在朋友圈设置里邀请角色');
    const posts = await loadMomentPosts();
    const author = pickAuthor(invited, posts, options.forceAuthorId);
    const createdAt = options.createdAt || Date.now();
    const memory = await compactMomentsHistory(posts);
    const recentMoments = posts.slice(0, 24).map(p => `${p.authorName}：${p.content}${p.location?.label ? ` @${p.location.label}` : ''}`).join('\n');
    const digest = memory.roles[author.id];
    const briefs = await participantBriefs(invited, options.userProfile);
    const prompt = `${options.settings.generationPreset || DEFAULT_MOMENTS_PRESET}

现在由 ${author.name}（ID=${author.id}）发布一条朋友圈。角色不发图片。
每条角色朋友圈必须填写一个自然的位置 location：可以是具体地点，也可以是“家里”“回家的地铁上”这类生活化位置；须符合角色与时间，禁止无缘无故跨城。
其他受邀角色可随机点赞、评论；发布者可以回复 0—2 条。评论最多二层，只允许出现一次“别人回复别人”的插话，禁止继续套娃。
参与者：${identityList(invited)}
当前时间：${new Date(createdAt).toLocaleString('zh-CN')}

${author.name} 的较早朋友圈压缩记忆：
${digest?.summary || '（暂无）'}

近期朋友圈（严禁复述、换词重发或沿用同一个梗）：
${recentMoments || '（暂无）'}

角色资料与近期私聊：${briefs}

输出结构：
{"content":"朋友圈正文","location":"地点","likedBy":["角色ID"],"comments":[{"id":"c1","authorId":"角色ID","content":"评论"},{"id":"c2","authorId":"角色ID","content":"回复","replyToCommentId":"c1","replyToName":"被回复者名字"}]}
只可使用上面给出的角色 ID。正文建议 8—100 字；评论口语化、长短不齐。`;

    const result = await callMomentsDirector(options.apiConfig, prompt);
    const content = String(result?.content || '').trim().slice(0, 300);
    if (!content) throw new Error('模型没有返回可发布的朋友圈正文');
    const duplicates = posts.filter(p => p.authorCharId === author.id).slice(0, 18);
    if (duplicates.some(p => momentSimilarity(p.content, content) > 0.68)) {
        throw new Error('模型生成了近期重复内容，本次已跳过，未扣第二次调用');
    }
    const charMap = new Map(invited.map(c => [c.id, c]));
    const likedIds = [...new Set((Array.isArray(result?.likedBy) ? result.likedBy : []).map(String))]
        .filter(id => id !== author.id && charMap.has(id));
    const likedBy = likedIds.map(id => ({ id: `char:${id}`, name: charMap.get(id)!.name, charId: id, type: 'character' as const }));
    const comments = normalizeComments(result?.comments, invited, author.id, createdAt);
    const post: SocialPost = {
        id: `moment_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
        platform: 'moments',
        authorName: author.name,
        authorAvatar: author.avatar,
        authorType: 'character',
        authorCharId: author.id,
        title: '', content, images: [], tags: [], bgStyle: '',
        likes: likedBy.length, likedBy, isCollected: false, isLiked: false,
        comments,
        timestamp: createdAt,
        updatedAt: createdAt,
        location: { label: String(result?.location || '此刻').trim().slice(0, 40) || '此刻', visible: true },
    };
    await DB.saveSocialPost(post);
    await syncMomentToPrivateChat(post, [author]);
    await compactMomentsHistory([post, ...posts]);
    window.dispatchEvent(new CustomEvent('moments-updated', { detail: { postId: post.id } }));
    return { post, author };
}

export interface CreateUserMomentOptions {
    content: string;
    images: string[];
    location?: string;
    characters: CharacterProfile[];
    userProfile: UserProfile;
    apiConfig: APIConfig;
    settings: MomentsSettings;
}

export async function createUserMoment(options: CreateUserMomentOptions): Promise<SocialPost> {
    const invited = options.characters.filter(c => options.settings.invitedCharIds.includes(c.id));
    if (!invited.length) throw new Error('请先在朋友圈设置里邀请角色');
    const createdAt = Date.now();
    const briefs = await participantBriefs(invited, options.userProfile);
    const prompt = `${options.settings.generationPreset || DEFAULT_MOMENTS_PRESET}

用户刚发布朋友圈：
${options.content || '（只发了图片）'}
图片数量：${options.images.length}
位置：${options.location || '未显示'}

所有受邀角色都会点赞；请让每个角色都留下一条符合本人性格的评论，但不要排队写整齐的小作文。允许其中最多一位角色回复另一位角色的评论，最多二层，不再继续回复。
参与者：${identityList(invited)}
${briefs}

只输出：{"comments":[{"id":"c1","authorId":"角色ID","content":"评论"},{"id":"c2","authorId":"角色ID","content":"回复","replyToCommentId":"c1","replyToName":"名字"}]}`;
    const result = await callMomentsDirector(options.apiConfig, prompt, options.images);
    const comments = normalizeComments(result?.comments, invited, '', createdAt);
    const commentingIds = new Set(comments.map(comment => comment.authorCharId).filter(Boolean));
    if (invited.some(char => !commentingIds.has(char.id))) {
        throw new Error('模型漏掉了部分角色的评论，本次没有发布，请重试');
    }
    // 模型漏掉某位时不伪造角色台词；点赞仍保持用户约定的“全员到场”。
    const likedBy = invited.map(char => ({ id: `char:${char.id}`, name: char.name, charId: char.id, type: 'character' as const }));
    const post: SocialPost = {
        id: `moment_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
        platform: 'moments',
        authorName: options.settings.displayNameOverride?.trim() || options.userProfile.name || '我',
        authorAvatar: options.userProfile.avatar,
        authorType: 'user',
        title: '', content: options.content.trim().slice(0, 1200), images: options.images.slice(0, 9), tags: [], bgStyle: '',
        likes: likedBy.length, likedBy, isCollected: false, isLiked: false,
        comments,
        timestamp: createdAt,
        updatedAt: createdAt,
        location: { label: (options.location || '').trim().slice(0, 40), visible: !!options.location?.trim() },
    };
    await DB.saveSocialPost(post);
    await syncMomentToPrivateChat(post, invited);
    await compactMomentsHistory([post, ...(await loadMomentPosts())]);
    window.dispatchEvent(new CustomEvent('moments-updated', { detail: { postId: post.id } }));
    return post;
}

export async function syncMomentToPrivateChat(post: SocialPost, targets: CharacterProfile[]): Promise<SocialPost> {
    const ids: Record<string, number> = { ...(post.syncedMessageIds || {}) };
    for (const char of targets) {
        if (ids[char.id]) continue;
        const role = post.authorType === 'user' ? 'user' : 'assistant';
        const id = await DB.saveMessage({
            charId: char.id,
            role,
            type: 'social_card',
            content: `${post.authorName}发了一条朋友圈：${post.content}`,
            timestamp: post.timestamp,
            metadata: { post: { ...post, syncedMessageIds: undefined }, momentId: post.id, source: 'moments' },
        });
        ids[char.id] = id;
        window.dispatchEvent(new CustomEvent('active-msg-progress', { detail: { charId: char.id } }));
    }
    const updated = { ...post, syncedMessageIds: ids, updatedAt: Date.now() };
    await DB.saveSocialPost(updated);
    return updated;
}

export async function updateMomentAndSyncedCards(post: SocialPost): Promise<void> {
    const updated = { ...post, likes: post.likedBy?.length || 0, updatedAt: Date.now() };
    await DB.saveSocialPost(updated);
    for (const [charId, messageId] of Object.entries(updated.syncedMessageIds || {})) {
        await DB.updateMessageMetadata(messageId, prev => ({
            ...(prev || {}),
            post: { ...updated, syncedMessageIds: undefined },
            momentId: updated.id,
            source: 'moments',
        })).catch(() => undefined);
        window.dispatchEvent(new CustomEvent('active-msg-progress', { detail: { charId } }));
    }
    window.dispatchEvent(new CustomEvent('moments-updated', { detail: { postId: post.id } }));
}

export async function deleteMoment(post: SocialPost): Promise<void> {
    await DB.deleteSocialPost(post.id);
    await Promise.all(Object.values(post.syncedMessageIds || {}).map(id => DB.deleteMessage(id).catch(() => undefined)));
    window.dispatchEvent(new CustomEvent('moments-updated', { detail: { postId: post.id, deleted: true } }));
}

export function computeNextMomentAt(settings: MomentsSettings, from = Date.now()): number {
    const base = Math.max(1, settings.minIntervalHours) * 60 * 60 * 1000;
    const multiplier = settings.activityLevel === 'quiet' ? 1.55 : settings.activityLevel === 'lively' ? 0.68 : 1;
    const jitter = 0.82 + Math.random() * 0.5;
    return from + base * multiplier * jitter;
}

export function backfillCount(settings: MomentsSettings, now = Date.now()): number {
    if (!settings.lastAutoRunAt) return 0;
    const elapsedHours = (now - settings.lastAutoRunAt) / 3_600_000;
    const interval = Math.max(2, settings.minIntervalHours);
    if (elapsedHours < interval) return 0;
    if (elapsedHours < 24) return 1;
    if (elapsedHours < 72) return Math.min(3, Math.max(1, Math.floor(elapsedHours / interval)));
    return Math.min(5, Math.max(2, Math.floor(elapsedHours / 24)));
}

export const momentsAssetIds = { settings: SETTINGS_ASSET_ID, memory: MEMORY_ASSET_ID } as const;
