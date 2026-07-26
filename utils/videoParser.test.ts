import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    isVideoShareUrl,
    formatStatCount,
    parseVideoShareUrl,
    getVideoParseKey,
    setVideoParseKey,
} from './videoParser';

// apizero flat=1 的真实响应结构（B站样例，实测抓回来的字段裁剪版）。
const biliResponse = {
    code: 0,
    msg: '成功',
    data: {
        platform: 'bilibili',
        type: '视频',
        title: '【官方 MV】Never Gonna Give You Up - Rick Astley',
        video_url: 'https://upos-sz.bilivideo.com/xxx.mp4',
        cover_url: 'http://i1.hdslb.com/bfs/archive/cover.jpg',
        audio_url: '',
        imagelist: [],
        source: {
            platform: 'bilibili',
            platform_label: '哔哩哔哩',
            original_url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
            author_name: '索尼音乐中国',
        },
        stats: {
            author_name: '索尼音乐中国',
            author_avatar: 'https://i2.hdslb.com/bfs/face/avatar.jpg',
            like_count: 2777249,
            comment_count: 214525,
            share_count: 460335,
            play_count: 100876560,
            collect_count: 1460068,
            publish_time: '2020-01-01 07:43:23',
        },
        video_list: [],
    },
    request_id: 'test',
};

const mockFetch = (body: any, status = 200) => {
    const fn = vi.fn(async (..._args: any[]) => ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    }));
    vi.stubGlobal('fetch', fn);
    return fn;
};

beforeEach(() => {
    localStorage.removeItem('sully_video_parse_key_v1');
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('isVideoShareUrl', () => {
    it('识别主流视频平台链接（含短链和子域）', () => {
        expect(isVideoShareUrl('https://v.douyin.com/iRNBho6u/')).toBe(true);
        expect(isVideoShareUrl('https://www.douyin.com/video/7231231231231231231')).toBe(true);
        expect(isVideoShareUrl('https://b23.tv/abc123')).toBe(true);
        expect(isVideoShareUrl('https://www.bilibili.com/video/BV1GJ411x7h7')).toBe(true);
        expect(isVideoShareUrl('https://v.kuaishou.com/xyz')).toBe(true);
        expect(isVideoShareUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
        expect(isVideoShareUrl('https://x.com/user/status/123')).toBe(true);
    });

    it('普通网页 / 小红书 / 非法输入不命中', () => {
        expect(isVideoShareUrl('https://example.com/article')).toBe(false);
        expect(isVideoShareUrl('https://www.xiaohongshu.com/explore/abc')).toBe(false); // XHS 走专门卡片路径
        expect(isVideoShareUrl('https://xhslink.com/abc')).toBe(false);
        expect(isVideoShareUrl('http://xhslink.cn/o/abc')).toBe(false);
        expect(isVideoShareUrl('not a url')).toBe(false);
        expect(isVideoShareUrl('')).toBe(false);
        // 域名后缀不能被前缀仿冒
        expect(isVideoShareUrl('https://fakedouyin.com/v/1')).toBe(false);
        expect(isVideoShareUrl('https://douyin.com.evil.com/v/1')).toBe(false);
    });
});

describe('formatStatCount', () => {
    it('万 / 亿缩写，去掉 .0 尾巴', () => {
        expect(formatStatCount(2777249)).toBe('277.7万');
        expect(formatStatCount(100876560)).toBe('1亿');
        expect(formatStatCount(9999)).toBe('9999');
        expect(formatStatCount(10000)).toBe('1万');
    });

    it('0 / 负数 / 非法值返回空串', () => {
        expect(formatStatCount(0)).toBe('');
        expect(formatStatCount(-5)).toBe('');
        expect(formatStatCount(undefined)).toBe('');
        expect(formatStatCount(NaN)).toBe('');
    });
});

describe('parseVideoShareUrl', () => {
    it('flat=1 响应映射成 ExtractedWebpage（含 video 附加字段）', async () => {
        mockFetch(biliResponse);
        const wp = await parseVideoShareUrl('https://b23.tv/abc123');
        expect(wp.title).toBe('【官方 MV】Never Gonna Give You Up - Rick Astley');
        expect(wp.finalUrl).toBe('https://www.bilibili.com/video/BV1GJ411x7h7');
        expect(wp.siteName).toBe('哔哩哔哩');
        expect(wp.image).toBe('http://i1.hdslb.com/bfs/archive/cover.jpg');
        expect(wp.content).toBe('');
        expect(wp.video).toMatchObject({
            platform: 'bilibili',
            platformLabel: '哔哩哔哩',
            contentType: 'video',
            authorName: '索尼音乐中国',
            playCount: 100876560,
            likeCount: 2777249,
            publishTime: '2020-01-01 07:43:23',
        });
    });

    it('图集（type=图片 + imagelist）→ contentType image + 张数 + 首图兜底封面', async () => {
        mockFetch({
            code: 0,
            data: {
                platform: 'douyin', type: '图片', title: '九宫格', video_url: '', cover_url: '',
                imagelist: ['https://p1.example.com/1.jpg', 'https://p1.example.com/2.jpg'],
                source: { platform_label: '抖音', original_url: 'https://www.douyin.com/note/1' },
                stats: {},
            },
        });
        const wp = await parseVideoShareUrl('https://v.douyin.com/xyz/');
        expect(wp.video?.contentType).toBe('image');
        expect(wp.video?.imageCount).toBe(2);
        expect(wp.image).toBe('https://p1.example.com/1.jpg');
    });

    it('业务错误码翻成人话并抛错（4030 配额耗尽）', async () => {
        mockFetch({ code: 4030, msg: 'daily quota exceeded' });
        await expect(parseVideoShareUrl('https://b23.tv/abc')).rejects.toThrow(/配额已耗尽/);
    });

    it('未知错误码回落 API 自带 msg', async () => {
        mockFetch({ code: 9999, msg: '奇怪的新错误' });
        await expect(parseVideoShareUrl('https://b23.tv/abc')).rejects.toThrow('奇怪的新错误');
    });

    it('空壳结果（无标题无视频无图）抛错，让调用方降级通用抓取', async () => {
        mockFetch({ code: 0, data: { platform: 'weibo', title: '', video_url: '', imagelist: [] } });
        await expect(parseVideoShareUrl('https://weibo.com/123')).rejects.toThrow('解析结果为空');
    });

    it('localStorage 里的 key 会带进请求参数', async () => {
        setVideoParseKey('  my-test-key  ');
        expect(getVideoParseKey()).toBe('my-test-key');
        const fn = mockFetch(biliResponse);
        await parseVideoShareUrl('https://b23.tv/abc123');
        const calledUrl = String(fn.mock.calls[0][0]);
        expect(calledUrl).toContain('key=my-test-key');
        expect(calledUrl).toContain('flat=1');
        setVideoParseKey('');
        expect(getVideoParseKey()).toMatch(/^sk_live_/); // 清空后回落内置默认 key
    });
});
