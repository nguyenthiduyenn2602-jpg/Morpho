// 捏人器「内置素材包」导出（管理员用）。
//
// 背景：捏人器本体 character_creator.html 里的内置部件历来是 base64 内联在 PARTS 数组，
// 整个 HTML 因此被撑到 ~1.6MB（95% 是 base64），每个用户首次都要下这一坨；再往里加 PSD
// 素材只会更大。省法：内置部件改成引用二进制 PNG 文件（src 写成相对路径），HTML 只留一份
// 路径清单。PNG 比 base64 小 ~25% 且浏览器逐张缓存。
//
// 这个模块把「一批部件（PSD 解析结果 / 已存自定义部件）」打成一个可提交的素材包 ZIP：
//   parts/manifest.json       —— 清单（src/shadowSrc 已写成 parts/<id>.png 相对路径）
//   parts/<id>.png            —— 部件图（二进制）
//   parts/<id>_shadow.png     —— 投影层（旧数据可能有，新导入不再产出）
//   README.txt                —— 怎么落地成内置素材的说明
// 管理员把整个 parts/ 丢进 public/like520/ 即可——character_creator.html 启动时会 fetch
// parts/manifest.json 自动合并进 PARTS，无需手改 HTML。

export interface BuiltinPackItem {
    categoryKey: string | null;
    name: string;
    /** 部件图：data:image/... base64 会被抽成 PNG 文件；http(s) URL 原样写进清单不落文件。 */
    src: string;
    /** 投影层，同 src 规则。 */
    shadowSrc?: string;
    tintable?: boolean;
}

export interface BuiltinPackManifestEntry {
    categoryKey: string;
    id: string;
    name: string;
    src: string;
    tintable: boolean;
    shadowSrc?: string;
}

export interface BuiltinPackFile {
    /** zip 内路径，如 parts/fronthair_liuhai.png */
    path: string;
    /** 仅 base64 负载（不含 data: 前缀），供 JSZip { base64:true } 写入 */
    base64: string;
}

export interface BuiltinPackPlan {
    manifest: BuiltinPackManifestEntry[];
    files: BuiltinPackFile[];
    /** 没类目被跳过的部件数 */
    skipped: number;
}

/** data:URL → 仅 base64 负载；非 base64 data URL 返回 null。 */
const dataUrlPayload = (v: string): string | null => {
    if (!v.startsWith('data:')) return null;
    const comma = v.indexOf(',');
    if (comma < 0) return null;
    if (!/;base64/i.test(v.slice(0, comma))) return null;
    return v.slice(comma + 1);
};

/** 文件名安全化：保留字母数字 / 中文 / 连字符，其余折成下划线；空则回落 'part'。 */
export const safePartSlug = (s: string): string =>
    (s || '').replace(/[^\w一-龥-]+/g, '_').replace(/^_+|_+$/g, '') || 'part';

/**
 * 纯函数：把一批部件规划成「清单 + 待写文件」。不碰 zip / DOM，便于单测。
 *  · 每个部件生成稳定唯一 id（categoryKey_名字，重名自动 _2/_3…）；
 *  · data: 图 → 落成 parts/<id>.png，清单 src 写相对路径；
 *  · http(s) 图 → 不落文件，清单 src 原样保留该 URL；
 *  · 没类目的部件跳过并计入 skipped。
 */
export function planBuiltinPartsPack(items: BuiltinPackItem[]): BuiltinPackPlan {
    const manifest: BuiltinPackManifestEntry[] = [];
    const files: BuiltinPackFile[] = [];
    const usedIds = new Set<string>();
    let skipped = 0;

    for (const it of items) {
        if (!it.categoryKey) { skipped++; continue; }
        const base = `${it.categoryKey}_${safePartSlug(it.name)}`;
        let id = base;
        let n = 2;
        while (usedIds.has(id)) id = `${base}_${n++}`;
        usedIds.add(id);

        const entry: BuiltinPackManifestEntry = {
            categoryKey: it.categoryKey,
            id,
            name: it.name || id,
            tintable: !!it.tintable,
            src: '',
        };

        const srcPayload = dataUrlPayload(it.src || '');
        if (srcPayload) {
            const path = `parts/${id}.png`;
            files.push({ path, base64: srcPayload });
            entry.src = path;
        } else {
            entry.src = it.src || ''; // http(s) URL 原样保留
        }

        if (it.shadowSrc) {
            const shadowPayload = dataUrlPayload(it.shadowSrc);
            if (shadowPayload) {
                const path = `parts/${id}_shadow.png`;
                files.push({ path, base64: shadowPayload });
                entry.shadowSrc = path;
            } else {
                entry.shadowSrc = it.shadowSrc;
            }
        }

        manifest.push(entry);
    }

    return { manifest, files, skipped };
}

const README = `捏人器内置素材包
================

这个 ZIP 是「PSD → 内置素材」的产物，用来把部件作为内置素材随包发给所有用户
（而不是每台设备各存一份 base64，也不把 base64 塞进 character_creator.html 撑大体积）。

内容：
  parts/manifest.json   部件清单（src 已写成 parts/<id>.png 相对路径）
  parts/*.png           部件图（二进制 PNG，比 base64 省 ~25%，浏览器逐张缓存）

怎么落地成内置素材（无需改任何代码！）：
  1. 解压这个 ZIP。
  2. 把里面的整个 parts/ 文件夹，放进仓库的  public/like520/  目录下
     （最终是  public/like520/parts/manifest.json  +  public/like520/parts/*.png）。
     —— 若 public/like520/parts/ 已存在，用新的整个覆盖它（清单是全量的）。
  3. 提交。character_creator.html 启动时会自动 fetch parts/manifest.json 加载，
     不用手改它的 PARTS 数组。

说明：
  · 清单是「你当前所有自定义部件」的全量快照，所以每次发布用新包整体覆盖即可，
    不用手动往里加条目。
  · 每个部件 id 由「类目_名字」生成，改名字会变 id；保持名字稳定，dedup 才稳。
`;

/**
 * 把一批部件打成内置素材包 ZIP（Blob）。浏览器环境用（动态载入 JSZip）。
 * @returns { blob, plan } —— blob 供下载，plan.skipped 供提示。
 */
export async function buildBuiltinPartsPackZip(items: BuiltinPackItem[]): Promise<{ blob: Blob; plan: BuiltinPackPlan }> {
    const plan = planBuiltinPartsPack(items);
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const f of plan.files) {
        zip.file(f.path, f.base64, { base64: true });
    }
    zip.file('parts/manifest.json', JSON.stringify(plan.manifest, null, 2));
    zip.file('README.txt', README);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    return { blob, plan };
}
