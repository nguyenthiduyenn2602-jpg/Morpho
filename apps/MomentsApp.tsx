import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Camera, CaretLeft, Check, ChatCircle, DotsThree, GearSix,
    Heart, ImageSquare, MapPin, Plus, Trash, X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import type { MomentsSettings, SocialComment, SocialPost } from '../types';
import TokenImg from '../components/os/TokenImg';
import { putImageBlob, useBlobRefUrl } from '../utils/blobRef';
import { processImageToBlob } from '../utils/file';
import {
    DEFAULT_MOMENTS_SETTINGS,
    createUserMoment,
    deleteMoment,
    generateRoleMoment,
    loadMomentPosts,
    loadMomentsSettings,
    saveMomentsSettings,
    updateMomentAndSyncedCards,
} from '../utils/moments';

const formatMomentTime = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}分钟前`;
    if (diff < 24 * 3_600_000) return `${Math.floor(diff / 3_600_000)}小时前`;
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const fileToStoredImage = async (file: File): Promise<string> => putImageBlob(file);

// 动态图片只存本机；发布给视觉模型时再从 blobref 解析为 data URL。
// 先把手机原片压到适合识图的尺寸，避免 1—9 张照片把单次请求膨胀到几十 MB。
const fileToStoredMomentImage = async (file: File): Promise<string> => putImageBlob(await processImageToBlob(file, {
    maxWidth: 1280,
    quality: 0.84,
    forceJpeg: true,
}));

const ImageTile: React.FC<{ value: string; className?: string; onRemove?: () => void }> = ({ value, className = '', onRemove }) => (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
        <TokenImg value={value} className="w-full h-full object-cover" alt="朋友圈图片" />
        {onRemove && (
            <button onClick={onRemove} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white grid place-items-center">
                <X size={14} weight="bold" />
            </button>
        )}
    </div>
);

const CommentsBlock: React.FC<{ post: SocialPost }> = ({ post }) => {
    const comments = post.comments || [];
    const liked = post.likedBy || [];
    if (!comments.length && !liked.length) return null;
    const byId = new Map(comments.map(c => [c.id, c]));
    return (
        <div className="mt-2 bg-[#f3f3f5] rounded-sm text-[13px] leading-[1.55] text-slate-800 relative before:absolute before:-top-1.5 before:left-3 before:border-x-[6px] before:border-x-transparent before:border-b-[7px] before:border-b-[#f3f3f5]">
            {!!liked.length && (
                <div className={`px-2.5 py-1.5 flex gap-1.5 items-start ${comments.length ? 'border-b border-white' : ''}`}>
                    <Heart size={14} weight="fill" className="text-[#576b95] shrink-0 mt-0.5" />
                    <span className="text-[#576b95] font-medium">{liked.map(x => x.name).join('，')}</span>
                </div>
            )}
            {!!comments.length && (
                <div className="px-2.5 py-1.5 space-y-0.5">
                    {comments.map(comment => {
                        const parent = comment.replyToCommentId ? byId.get(comment.replyToCommentId) : undefined;
                        return (
                            <div key={comment.id}>
                                <span className="text-[#576b95] font-semibold">{comment.authorName}</span>
                                {parent && <><span> 回复 </span><span className="text-[#576b95] font-semibold">{comment.replyToName || parent.authorName}</span></>}
                                <span>：{comment.content}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

interface PostItemProps {
    post: SocialPost;
    userName: string;
    userAvatar: string;
    onLike: (post: SocialPost) => void;
    onComment: (post: SocialPost) => void;
    onDelete: (post: SocialPost) => void;
}

const PostItem: React.FC<PostItemProps> = ({ post, userName, userAvatar, onLike, onComment, onDelete }) => {
    const [menu, setMenu] = useState(false);
    const isUserLiked = !!post.likedBy?.some(x => x.type === 'user');
    const gridClass = post.images.length === 1 ? 'grid-cols-1 max-w-[220px]' : post.images.length === 2 || post.images.length === 4 ? 'grid-cols-2 max-w-[250px]' : 'grid-cols-3 max-w-[270px]';
    return (
        <article className="flex gap-3 px-4 py-4 border-b border-slate-100 bg-white">
            <TokenImg value={post.authorAvatar || (post.authorType === 'user' ? userAvatar : '')} className="w-10 h-10 rounded-md object-cover shrink-0 bg-slate-100" alt={post.authorName} />
            <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-[#576b95] leading-5">{post.authorName || (post.authorType === 'user' ? userName : '')}</div>
                {!!post.content && <div className="mt-1 text-[15px] leading-[1.55] text-slate-900 whitespace-pre-wrap break-words">{post.content}</div>}
                {!!post.images.length && (
                    <div className={`grid gap-1.5 mt-2 ${gridClass}`}>
                        {post.images.map((img, index) => (
                            <ImageTile key={`${img}-${index}`} value={img} className={post.images.length === 1 ? 'aspect-[4/5] rounded-sm' : 'aspect-square rounded-sm'} />
                        ))}
                    </div>
                )}
                {post.location?.visible && post.location.label && (
                    <div className="mt-2 text-[12px] text-[#576b95] flex items-center gap-1">
                        <MapPin size={12} weight="fill" />{post.location.label}
                    </div>
                )}
                <div className="mt-2 flex items-center justify-between relative">
                    <span className="text-[11px] text-slate-400">{formatMomentTime(post.timestamp)}</span>
                    <button onClick={() => setMenu(v => !v)} className="w-8 h-5 rounded bg-[#f3f3f5] grid place-items-center text-[#576b95]">
                        <DotsThree size={20} weight="bold" />
                    </button>
                    {menu && (
                        <div className="absolute right-9 bottom-0 h-9 rounded bg-[#4c4c4c] text-white flex overflow-hidden shadow-lg z-20">
                            {post.authorType === 'character' && (
                                <button onClick={() => { onLike(post); setMenu(false); }} className="px-3 flex items-center gap-1.5 text-xs active:bg-black/20">
                                    <Heart size={15} weight={isUserLiked ? 'fill' : 'regular'} />{isUserLiked ? '取消' : '赞'}
                                </button>
                            )}
                            {post.authorType === 'character' && (
                                <button onClick={() => { onComment(post); setMenu(false); }} className="px-3 flex items-center gap-1.5 text-xs border-l border-white/10 active:bg-black/20">
                                    <ChatCircle size={15} />评论
                                </button>
                            )}
                            <button onClick={() => { onDelete(post); setMenu(false); }} className="px-3 flex items-center gap-1.5 text-xs border-l border-white/10 active:bg-black/20">
                                <Trash size={14} />删除
                            </button>
                        </div>
                    )}
                </div>
                <CommentsBlock post={post} />
            </div>
        </article>
    );
};

const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
    <div className="absolute inset-0 z-50 bg-black/35 flex items-end">
        <div className="w-full max-h-[91%] bg-white rounded-t-[24px] overflow-hidden flex flex-col shadow-2xl">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
                <button onClick={onClose} className="w-9 h-9 grid place-items-center text-slate-500"><X size={22} /></button>
                <div className="font-bold text-slate-800">{title}</div>
                <div className="w-9" />
            </div>
            {children}
        </div>
    </div>
);

const MomentsApp: React.FC = () => {
    const { closeApp, characters, userProfile, apiConfig, addToast } = useOS();
    const [posts, setPosts] = useState<SocialPost[]>([]);
    const [settings, setSettings] = useState<MomentsSettings>(DEFAULT_MOMENTS_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [composerOpen, setComposerOpen] = useState(false);
    const [commentTarget, setCommentTarget] = useState<SocialPost | null>(null);
    const [commentText, setCommentText] = useState('');
    const [generating, setGenerating] = useState(false);
    const coverUrl = useBlobRefUrl(settings.coverImage);
    const coverInputRef = useRef<HTMLInputElement>(null);

    const reload = useCallback(async () => {
        const [nextPosts, nextSettings] = await Promise.all([loadMomentPosts(), loadMomentsSettings()]);
        if (nextSettings.unreadPostIds.length) {
            nextSettings.unreadPostIds = [];
            await saveMomentsSettings(nextSettings);
        }
        setPosts(nextPosts);
        setSettings(nextSettings);
        setLoading(false);
    }, []);

    useEffect(() => {
        reload().catch(err => { setLoading(false); addToast(`朋友圈加载失败：${err.message}`, 'error'); });
        const handler = () => { loadMomentPosts().then(setPosts).catch(() => undefined); };
        window.addEventListener('moments-updated', handler);
        return () => window.removeEventListener('moments-updated', handler);
    }, [reload]);

    const persistSettings = async (next: MomentsSettings) => {
        setSettings(next);
        await saveMomentsSettings(next);
    };

    const uploadCover = async (file?: File) => {
        if (!file) return;
        const stored = await fileToStoredImage(file);
        await persistSettings({ ...settings, coverImage: stored, coverPositionY: 50 });
    };

    const manualGenerate = async (settingsOverride?: MomentsSettings) => {
        if (generating) return;
        setGenerating(true);
        try {
            const { author } = await generateRoleMoment({ characters, userProfile, apiConfig, settings: settingsOverride || settings });
            const next = await loadMomentPosts();
            setPosts(next);
            addToast(`${author.name}发了朋友圈`, 'success');
        } catch (err: any) {
            addToast(err?.message || '朋友圈生成失败', 'error');
        } finally { setGenerating(false); }
    };

    const toggleLike = async (post: SocialPost) => {
        const likedBy = [...(post.likedBy || [])];
        const index = likedBy.findIndex(x => x.type === 'user');
        if (index >= 0) likedBy.splice(index, 1);
        else likedBy.push({ id: 'user', name: settings.displayNameOverride?.trim() || userProfile.name || '我', type: 'user' });
        const updated = { ...post, likedBy, likes: likedBy.length, isLiked: index < 0 };
        await updateMomentAndSyncedCards(updated);
        setPosts(prev => prev.map(x => x.id === updated.id ? updated : x));
    };

    const submitComment = async () => {
        if (!commentTarget || !commentText.trim()) return;
        const comment: SocialComment = {
            id: `mc_user_${Date.now()}`,
            authorName: settings.displayNameOverride?.trim() || userProfile.name || '我',
            authorAvatar: userProfile.avatar,
            content: commentText.trim().slice(0, 300),
            likes: 0,
            authorType: 'user',
            timestamp: Date.now(),
        };
        const updated = { ...commentTarget, comments: [...(commentTarget.comments || []), comment] };
        await updateMomentAndSyncedCards(updated);
        setPosts(prev => prev.map(x => x.id === updated.id ? updated : x));
        setCommentTarget(null); setCommentText('');
    };

    const removePost = async (post: SocialPost) => {
        if (!window.confirm('删除这条朋友圈？私聊里的同步卡片也会一起删除。')) return;
        await deleteMoment(post);
        setPosts(prev => prev.filter(x => x.id !== post.id));
    };

    const displayName = settings.displayNameOverride?.trim() || userProfile.name || '我';

    return (
        <div className="absolute inset-0 bg-white text-slate-900 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto overscroll-contain pb-10">
                <div className="relative h-[315px] bg-[#d9d9d9] overflow-hidden">
                    {coverUrl ? (
                        <img src={coverUrl} className="w-full h-full object-cover" style={{ objectPosition: `center ${settings.coverPositionY}%` }} alt="朋友圈封面" />
                    ) : (
                        <button onClick={() => coverInputRef.current?.click()} className="absolute inset-0 grid place-items-center text-white/90 bg-gradient-to-b from-slate-300 to-slate-400">
                            <span className="flex flex-col items-center gap-2 text-sm"><ImageSquare size={34} />点击上传朋友圈封面</span>
                        </button>
                    )}
                    <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/35 to-transparent" />
                    <button onClick={closeApp} className="absolute top-[max(14px,env(safe-area-inset-top))] left-3 w-10 h-10 grid place-items-center text-white drop-shadow"><CaretLeft size={30} /></button>
                    <button onClick={() => setSettingsOpen(true)} className="absolute top-[max(14px,env(safe-area-inset-top))] left-14 w-10 h-10 grid place-items-center text-white drop-shadow"><GearSix size={25} /></button>
                    <button onClick={() => setComposerOpen(true)} className="absolute top-[max(14px,env(safe-area-inset-top))] right-3 w-10 h-10 grid place-items-center text-white drop-shadow"><Camera size={28} weight="fill" /></button>
                    <input ref={coverInputRef} className="hidden" type="file" accept="image/*" onChange={e => uploadCover(e.target.files?.[0]).catch(() => addToast('封面保存失败', 'error'))} />
                </div>
                <div className="relative h-[76px] bg-white">
                    <div className="absolute right-[92px] -top-9 text-white font-semibold text-[16px] drop-shadow-[0_1px_2px_rgba(0,0,0,.7)] max-w-[180px] truncate">{displayName}</div>
                    <button onClick={() => setSettingsOpen(true)} className="absolute right-4 -top-[52px] w-[76px] h-[76px] rounded-[8px] overflow-hidden border-[3px] border-white bg-slate-100 shadow-sm">
                        <TokenImg value={userProfile.avatar} className="w-full h-full object-cover" alt="我的头像" />
                    </button>
                </div>

                {loading ? (
                    <div className="py-16 text-center text-sm text-slate-400">正在打开朋友圈…</div>
                ) : posts.length ? posts.map(post => (
                    <PostItem key={post.id} post={post} userName={displayName} userAvatar={userProfile.avatar}
                        onLike={toggleLike} onComment={setCommentTarget} onDelete={removePost} />
                )) : (
                    <div className="px-8 py-14 text-center text-slate-400">
                        <div className="text-4xl mb-3">◌</div>
                        <div className="text-sm">朋友圈还是空的</div>
                        <button onClick={() => manualGenerate()} disabled={generating} className="mt-4 px-4 py-2 rounded-full bg-[#576b95] text-white text-xs disabled:opacity-50">
                            {generating ? '正在等第一条动态…' : '让角色发第一条朋友圈'}
                        </button>
                    </div>
                )}
            </div>

            {settingsOpen && (
                <SettingsPanel settings={settings} characters={characters} generating={generating}
                    onChange={persistSettings} onGenerate={manualGenerate} onClose={() => setSettingsOpen(false)} />
            )}
            {composerOpen && (
                <Composer settings={settings} characters={characters} userProfile={userProfile} apiConfig={apiConfig}
                    onClose={() => setComposerOpen(false)}
                    onPublished={async () => { setComposerOpen(false); setPosts(await loadMomentPosts()); addToast('朋友圈发布成功', 'success'); }} />
            )}
            {commentTarget && (
                <div className="absolute inset-0 z-50 bg-black/30 flex items-end" onClick={() => setCommentTarget(null)}>
                    <div className="w-full bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))] flex gap-2" onClick={e => e.stopPropagation()}>
                        <input autoFocus value={commentText} onChange={e => setCommentText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitComment(); }}
                            className="flex-1 h-10 rounded-md bg-slate-100 px-3 text-sm outline-none" placeholder="评论" />
                        <button onClick={submitComment} className="px-4 rounded-md bg-[#07c160] text-white text-sm disabled:opacity-40" disabled={!commentText.trim()}>发送</button>
                    </div>
                </div>
            )}
        </div>
    );
};

const SettingsPanel: React.FC<{
    settings: MomentsSettings;
    characters: ReturnType<typeof useOS>['characters'];
    generating: boolean;
    onChange: (value: MomentsSettings) => Promise<void>;
    onGenerate: (settings?: MomentsSettings) => Promise<void>;
    onClose: () => void;
}> = ({ settings, characters, generating, onChange, onGenerate, onClose }) => {
    const [draft, setDraft] = useState(settings);
    const coverUrl = useBlobRefUrl(draft.coverImage);
    const save = async () => { await onChange(draft); onClose(); };
    const toggleChar = (id: string) => setDraft(prev => ({ ...prev, invitedCharIds: prev.invitedCharIds.includes(id) ? prev.invitedCharIds.filter(x => x !== id) : [...prev.invitedCharIds, id] }));
    const upload = async (file?: File) => {
        if (!file) return;
        setDraft(prev => ({ ...prev, coverImage: undefined }));
        const stored = await fileToStoredImage(file);
        setDraft(prev => ({ ...prev, coverImage: stored, coverPositionY: 50 }));
    };
    return (
        <ModalShell title="朋友圈设置" onClose={onClose}>
            <div className="overflow-y-auto px-5 py-4 space-y-6 text-sm">
                <section>
                    <div className="font-semibold text-slate-800 mb-2">封面与名字</div>
                    <label className="block h-28 rounded-xl overflow-hidden bg-slate-100 cursor-pointer relative">
                        {coverUrl ? <img src={coverUrl} className="w-full h-full object-cover" style={{ objectPosition: `center ${draft.coverPositionY}%` }} /> : <div className="h-full grid place-items-center text-slate-400">上传朋友圈封面</div>}
                        <input type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
                    </label>
                    {!!draft.coverImage && <label className="block mt-2 text-xs text-slate-500">上下裁剪位置<input type="range" min="0" max="100" value={draft.coverPositionY} onChange={e => setDraft({ ...draft, coverPositionY: Number(e.target.value) })} className="w-full mt-1" /></label>}
                    <input value={draft.displayNameOverride || ''} onChange={e => setDraft({ ...draft, displayNameOverride: e.target.value })}
                        className="mt-3 w-full h-11 rounded-xl bg-slate-100 px-3 outline-none" placeholder="朋友圈名字（留空则跟随个人档案）" />
                </section>
                <section>
                    <div className="font-semibold text-slate-800 mb-1">邀请进朋友圈的角色</div>
                    <div className="text-xs text-slate-400 mb-3">不限制人数；受邀角色才能发动态、点赞和评论。</div>
                    <div className="grid grid-cols-2 gap-2">
                        {characters.map(char => {
                            const checked = draft.invitedCharIds.includes(char.id);
                            return <button key={char.id} onClick={() => toggleChar(char.id)} className={`p-2 rounded-xl border flex items-center gap-2 text-left ${checked ? 'border-[#576b95] bg-[#f2f5fb]' : 'border-slate-100'}`}>
                                <TokenImg value={char.avatar} className="w-8 h-8 rounded-md object-cover bg-slate-100" />
                                <span className="flex-1 truncate">{char.name}</span>
                                <span className={`w-5 h-5 rounded-full grid place-items-center ${checked ? 'bg-[#576b95] text-white' : 'bg-slate-100'}`}>{checked && <Check size={13} weight="bold" />}</span>
                            </button>;
                        })}
                    </div>
                </section>
                <section>
                    <div className="font-semibold text-slate-800 mb-1">朋友圈生成预设</div>
                    <div className="text-xs text-slate-400 mb-2">会注入每次朋友圈导演调用，随时可以肘击文风。</div>
                    <textarea value={draft.generationPreset} onChange={e => setDraft({ ...draft, generationPreset: e.target.value })}
                        className="w-full h-44 rounded-xl bg-slate-100 p-3 outline-none resize-none leading-relaxed" />
                </section>
                <section className="space-y-3">
                    <label className="flex items-center justify-between">
                        <span><b className="block">角色自动发布</b><span className="text-xs text-slate-400">页面存活时调度；重新打开会适量补发</span></span>
                        <input type="checkbox" checked={draft.autoPublishEnabled} onChange={e => setDraft({ ...draft, autoPublishEnabled: e.target.checked })} className="w-5 h-5 accent-[#07c160]" />
                    </label>
                    <label className="flex items-center justify-between gap-3"><span>活跃程度</span>
                        <select value={draft.activityLevel} onChange={e => setDraft({ ...draft, activityLevel: e.target.value as any })} className="bg-slate-100 rounded-lg px-3 py-2">
                            <option value="quiet">安静</option><option value="normal">正常</option><option value="lively">热闹</option>
                        </select>
                    </label>
                    <label className="flex items-center justify-between gap-3"><span>最短间隔</span><span className="flex items-center gap-2"><input type="number" min="1" max="72" value={draft.minIntervalHours} onChange={e => setDraft({ ...draft, minIntervalHours: Math.max(1, Number(e.target.value) || 1) })} className="w-16 bg-slate-100 rounded-lg px-2 py-2 text-center" />小时</span></label>
                    <button disabled={generating || !draft.invitedCharIds.length} onClick={async () => { await onChange(draft); await onGenerate(draft); }} className="w-full h-11 rounded-xl border border-[#576b95] text-[#576b95] disabled:opacity-40">
                        {generating ? '正在生成…' : '现在生成一条（调试）'}
                    </button>
                </section>
            </div>
            <div className="p-4 border-t border-slate-100"><button onClick={save} className="w-full h-12 rounded-xl bg-[#07c160] text-white font-semibold">保存</button></div>
        </ModalShell>
    );
};

const Composer: React.FC<{
    settings: MomentsSettings;
    characters: ReturnType<typeof useOS>['characters'];
    userProfile: ReturnType<typeof useOS>['userProfile'];
    apiConfig: ReturnType<typeof useOS>['apiConfig'];
    onClose: () => void;
    onPublished: () => void;
}> = ({ settings, characters, userProfile, apiConfig, onClose, onPublished }) => {
    const [content, setContent] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [locationEnabled, setLocationEnabled] = useState(false);
    const [location, setLocation] = useState('');
    const [publishing, setPublishing] = useState(false);
    const addImages = async (files: FileList | null) => {
        if (!files) return;
        const slots = Math.max(0, 9 - images.length);
        const stored = await Promise.all(Array.from(files).slice(0, slots).map(fileToStoredMomentImage));
        setImages(prev => [...prev, ...stored].slice(0, 9));
    };
    const publish = async () => {
        if ((!content.trim() && !images.length) || publishing) return;
        setPublishing(true);
        try {
            await createUserMoment({ content, images, location: locationEnabled ? location : undefined, characters, userProfile, apiConfig, settings });
            onPublished();
        } catch (err: any) {
            window.alert(err?.message || '发布失败');
        } finally { setPublishing(false); }
    };
    return (
        <ModalShell title="发表朋友圈" onClose={onClose}>
            <div className="overflow-y-auto p-5 flex-1">
                <textarea autoFocus value={content} onChange={e => setContent(e.target.value)} className="w-full h-36 text-[16px] leading-relaxed outline-none resize-none" placeholder="这一刻的想法…" />
                <div className="grid grid-cols-3 gap-2">
                    {images.map((img, index) => <ImageTile key={`${img}-${index}`} value={img} className="aspect-square rounded-md" onRemove={() => setImages(prev => prev.filter((_, i) => i !== index))} />)}
                    {images.length < 9 && <label className="aspect-square rounded-md bg-slate-100 grid place-items-center text-slate-400 cursor-pointer"><Plus size={30} /><input type="file" accept="image/*" multiple className="hidden" onChange={e => addImages(e.target.files)} /></label>}
                </div>
                <div className="mt-6 border-t border-slate-100">
                    <label className="h-12 flex items-center justify-between border-b border-slate-100"><span className="flex items-center gap-2"><MapPin size={18} />所在位置</span><input type="checkbox" checked={locationEnabled} onChange={e => setLocationEnabled(e.target.checked)} className="w-5 h-5 accent-[#07c160]" /></label>
                    {locationEnabled && <input value={location} onChange={e => setLocation(e.target.value)} className="w-full h-11 mt-2 rounded-xl bg-slate-100 px-3 outline-none" placeholder="填写位置（可留空）" />}
                </div>
                <p className="mt-5 text-xs text-slate-400 leading-relaxed">发布时会调用一次全局 API，让受邀角色一次性完成点赞和一轮评论；生成完成后整条互动同时出现。</p>
            </div>
            <div className="p-4 border-t border-slate-100"><button onClick={publish} disabled={publishing || (!content.trim() && !images.length)} className="w-full h-12 rounded-xl bg-[#07c160] text-white font-semibold disabled:opacity-40">{publishing ? '大家正在赶来评论…' : '发表'}</button></div>
        </ModalShell>
    );
};

export default MomentsApp;
