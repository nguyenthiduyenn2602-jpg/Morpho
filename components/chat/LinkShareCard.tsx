import React from 'react';
import { formatStatCount } from '../../utils/videoParser';

export function XhsShareCard({ note, isUser }: { note: any; isUser: boolean }) {
    const openNote = () => {
        const noteId = note.noteId || note.note_id || note.id;
        if (!noteId) return;
        const token = note.xsecToken || note.xsec_token;
        const url = `https://www.xiaohongshu.com/explore/${noteId}${token ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_feed` : ''}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <div onClick={openNote} className="w-64 bg-white rounded-xl overflow-hidden shadow-sm border border-slate-100 cursor-pointer active:opacity-90 transition-opacity">
            {note.coverUrl ? (
                <div className="relative w-full h-36 bg-slate-100 overflow-hidden">
                    <img
                        src={note.coverUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                        onError={(event) => { event.currentTarget.style.display = 'none'; }}
                    />
                    {note.type === 'video' && (
                        <div className="absolute top-2 right-2 bg-black/50 rounded-full px-1.5 py-0.5 flex items-center gap-0.5 text-[9px] text-white font-medium">
                            <span>▶</span><span>视频</span>
                        </div>
                    )}
                </div>
            ) : (
                <div className="h-14 bg-gradient-to-r from-red-400 to-pink-500 flex items-center justify-center">
                    <span className="text-white/80 text-xs font-medium tracking-wide">小红书笔记</span>
                </div>
            )}
            <div className="p-3">
                <div className="font-bold text-sm text-slate-800 line-clamp-2 leading-snug mb-1.5">{note.title || '无标题笔记'}</div>
                {note.desc && <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed mb-2">{note.desc}</p>}
                <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-red-400 to-pink-400 flex items-center justify-center text-[8px] text-white font-bold shrink-0">{(note.author || '?')[0]}</div>
                        <span className="text-[10px] text-slate-500 truncate max-w-[100px]">{note.author || '小红书用户'}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">♡ {note.likes || 0}</span>
                </div>
                <div className="mt-2 pt-1.5 flex items-center gap-1 text-[9px] text-slate-300">
                    <span className="text-red-400 font-bold">小红书</span><span>·</span><span>{note.type === 'video' ? '视频' : '笔记'}{isUser ? '分享' : '推荐'}</span>
                </div>
            </div>
        </div>
    );
}

export function WebpageShareCard({ webpage }: { webpage: any }) {
    const video = webpage.video;
    let host = (webpage.siteName || '').trim();
    try { host = new URL(webpage.finalUrl || webpage.url).hostname.replace(/^www\./, ''); } catch { /* siteName fallback */ }
    const excerpt = (webpage.excerpt || '').trim();
    const stats = video ? [
        video.playCount ? `▶ ${formatStatCount(video.playCount)}` : '',
        video.likeCount ? `♥ ${formatStatCount(video.likeCount)}` : '',
        video.commentCount ? `💬 ${formatStatCount(video.commentCount)}` : '',
    ].filter(Boolean) : [];

    return (
        <div
            onClick={() => { const url = webpage.finalUrl || webpage.url; if (url) window.open(url, '_blank', 'noopener,noreferrer'); }}
            className="w-64 bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-[0_2px_10px_rgba(0,0,0,0.05)] cursor-pointer active:opacity-90 transition-opacity"
        >
            {webpage.image && (
                <div className="relative w-full h-32 bg-slate-100 overflow-hidden">
                    <img src={webpage.image} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { const parent = event.currentTarget.parentElement; if (parent) parent.style.display = 'none'; }} />
                    {video && video.contentType !== 'image' && (
                        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-[2px] flex items-center justify-center text-white">▶</span>
                        </span>
                    )}
                    {video?.contentType === 'image' && !!video.imageCount && (
                        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[9px] font-medium">图集 · {video.imageCount}张</span>
                    )}
                </div>
            )}
            <div className="p-3.5">
                <div className="flex items-center gap-1.5 mb-2 text-[11px] text-slate-400 font-medium truncate">
                    <span className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center shrink-0">↗</span>
                    <span className="truncate">{video?.platformLabel || host || '网页'}</span>
                </div>
                <div className="font-semibold text-[15px] text-slate-800 line-clamp-2 leading-snug">{webpage.title || host || '网页'}</div>
                {video ? (
                    <div className="flex items-center justify-between mt-1.5 gap-2">
                        <span className="text-[10px] text-slate-500 truncate">{video.authorName ? `@${video.authorName}` : ''}</span>
                        {stats.length > 0 && <span className="text-[10px] text-slate-400 shrink-0">{stats.join(' · ')}</span>}
                    </div>
                ) : excerpt ? (
                    <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed mt-1.5">{excerpt}</p>
                ) : (
                    <p className="text-[11px] text-slate-300 mt-1.5">未能提取到正文预览，点开看原网页</p>
                )}
            </div>
        </div>
    );
}
