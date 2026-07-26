/**
 * 捏人器 PSD 整批导入（开发模式）。
 *
 * 画师在一个 PSD 里按"顶层图层组 = 一个类目，组内每个图层 = 一个部件"组织素材，
 * 直接把整个 PSD 丢进来，免去逐张导出 / 重命名 / 上传的流程。约定：
 *
 * - 画布须与捏人器素材同规格（472×472 正方形；过大会自动缩到 944 以内）。
 *   每个图层按其在画布上的位置导出，锚点天然对齐。
 * - **顶层图层组 = 一个类目**（如"眼睛"文件夹），组名给出类目；
 *   **组内每个图层 = 一个独立部件**（如眼睛组里"杏眼""圆眼""狐狸眼"各一个图层，各成一个部件），
 *   图层名 = 部件显示名，类目继承所在组。
 *   组内若有子图层组，则该子组的图层合并成一个部件（少数需要多图层的部件用得上）。
 * - 顶层散图层（不在组里）= 一个部件，类目从它自己的名字猜。
 * - 组名 / 图层名里的类目别名支持中文或英文 key，如 `前发`、`earhair`、`后发1`。
 *   识别不出类目的，在开发面板里手动选。
 * - 可换色标记：名字带 `#色` / `#tint` 强制可换色，带 `#原色` / `#notint`
 *   强制不可换色；不标记时头发四类 + 眼睛默认可换色，其余默认不可。部件的自阴影/高光
 *   直接画在图层里即可——换色按像素明度重上色，明暗关系会保留。
 *
 * 注意：不再有"正片叠底 = 投影层"那套（简化：一个图层就是一个部件，没有单独的阴影层）。
 */

export interface ParsedPsdPart {
    /** 猜出来的类目 key；识别不出为 null，由用户在面板里指定 */
    categoryKey: string | null;
    name: string;
    tintable: boolean;
    /** 部件本体（透明 PNG data URL，画布尺寸） */
    src: string;
    /** @deprecated 旧「正片叠底=投影层」机制的产物，新导入不再产出；字段保留仅为下游类型兼容。 */
    shadowSrc?: string;
    warnings: string[];
}

export interface PsdImportResult {
    parts: ParsedPsdPart[];
    /** 全局提示（画布尺寸不对之类） */
    warnings: string[];
    docWidth: number;
    docHeight: number;
}

/** 类目别名 → key（与 character_creator.html 的 PARTS key 对应） */
const CATEGORY_ALIASES: [string, string[]][] = [
    ['fronthair', ['fronthair', '前发', '前發', '刘海', '瀏海']],
    ['earhair', ['earhair', '耳发', '耳發', '鬓发', '鬓髮']],
    ['back1', ['back1', '后发1', '後發1', '后发一']],
    ['back2', ['back2', '后发2', '後發2', '后发二']],
    ['skin', ['skin', '肤色', '皮肤', '身体', 'body']],
    ['eyes', ['eyes', '眼睛', '眼']],
    ['mouth', ['mouth', '嘴巴', '嘴']],
    ['outfit', ['outfit', '衣服', '服装']],
    ['outer', ['outer', '外套']],
    ['facemark', ['facemark', '面纹', '脸纹', '腮红']],
    ['decor', ['decor', '配饰', '饰品', '装饰']],
];

// 不带 #色/#原色 标记时，这些类目默认「可换色」：头发四类 + 眼睛。其余默认不可换色。
const DEFAULT_TINTABLE_KEYS = new Set(['fronthair', 'earhair', 'back1', 'back2', 'eyes']);

/** 输出上限：超过就整体缩到 472（数据存 IndexedDB，别塞几千像素的 data URL） */
const MAX_OUT = 944;
const TARGET = 472;

/** 从组名解析 类目 / 显示名 / tintable 标记 */
export function parseLayerName(raw: string, hasCategory = true): { categoryKey: string | null; name: string; tintable: boolean | null } {
    let name = (raw || '').trim();
    let tintable: boolean | null = null;
    // tint 标记（全角井号也认；先匹配否定形，免得 #notint 被 tint 抢走）
    name = name.replace(/[#＃]\s*(原色|notint)/i, () => { tintable = false; return ''; }).trim();
    if (tintable === null) {
        name = name.replace(/[#＃]\s*(色|tint)/i, () => { tintable = true; return ''; }).trim();
    }
    if (!hasCategory) return { categoryKey: null, name, tintable };

    const lower = name.toLowerCase();
    let matched: { key: string; alias: string } | null = null;
    for (const [key, aliases] of CATEGORY_ALIASES) {
        for (const alias of aliases) {
            if (lower.startsWith(alias.toLowerCase()) && (!matched || alias.length > matched.alias.length)) {
                matched = { key, alias };
            }
        }
    }
    if (!matched) return { categoryKey: null, name, tintable };
    const rest = name.slice(matched.alias.length).replace(/^[\s\-_·、:：/｜|]+/, '').trim();
    return { categoryKey: matched.key, name: rest || name, tintable };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

function hasInk(canvas: HTMLCanvasElement): boolean {
    const px = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) return true;
    return false;
}

function exportDataUrl(canvas: HTMLCanvasElement, scale: number): string {
    if (scale >= 1) return canvas.toDataURL('image/png');
    const out = makeCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
}

/** 深度优先展平一个组的叶子图层（ag-psd children 从底到顶） */
function flattenLeaves(node: any, acc: any[] = []): any[] {
    for (const child of node.children || []) {
        if (child.children) flattenLeaves(child, acc);
        else if (!child.hidden) acc.push(child);
    }
    return acc;
}

/** 把一组叶子图层按画布位置正常合成到一张画布（不支持的混合模式按普通处理并告警）。 */
function compositeLeaves(leaves: any[], W: number, H: number, warnings: string[]): HTMLCanvasElement {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d')!;
    for (const layer of leaves) {
        if (!layer.canvas) continue;
        const bm = layer.blendMode;
        if (bm && bm !== 'normal' && bm !== 'pass through') {
            warnings.push(`图层「${layer.name || '?'}」混合模式 ${bm} 不支持，按普通处理`);
        }
        ctx.globalAlpha = typeof layer.opacity === 'number' ? layer.opacity : 1;
        ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
        ctx.globalAlpha = 1;
    }
    return canvas;
}

export async function parseCreatorPsd(buffer: ArrayBuffer): Promise<PsdImportResult> {
    const { readPsd } = await import('ag-psd');
    const psd = readPsd(buffer, { skipThumbnail: true, skipCompositeImageData: true });
    const W = psd.width, H = psd.height;
    const warnings: string[] = [];
    if (W !== H) warnings.push(`画布 ${W}×${H} 不是正方形，会和现有素材（472×472）错位`);
    else if (W !== TARGET) warnings.push(`画布 ${W}×${H}（现有素材是 472×472，按比例缩放对齐，锚点一致即可）`);
    const scale = W > MAX_OUT ? TARGET / W : 1;

    const parts: ParsedPsdPart[] = [];
    // 顶层组 = 类目；组内每个图层（或子组）= 一个部件。顶层散图层 = 一个部件（类目从自己名字猜）。
    for (const top of psd.children || []) {
        if (top.hidden) continue;

        if (top.children) {
            // —— 顶层组 = 类目 ——
            const groupParsed = parseLayerName(top.name || ''); // 取类目 + 可能的组级 tint
            const catKey = groupParsed.categoryKey;
            if (!catKey) {
                warnings.push(`组「${top.name || '?'}」没识别出类目，组内部件需在面板手动选类目`);
            }
            let made = 0;
            for (const child of top.children) {
                if (child.hidden) continue;
                // 子级：图层 = 一个部件；子组 = 合并其图层成一个部件
                const leaves = child.children ? flattenLeaves(child) : (child.canvas ? [child] : []);
                if (!leaves.length) continue;
                const partWarnings: string[] = [];
                const canvas = compositeLeaves(leaves, W, H, partWarnings);
                if (!hasInk(canvas)) continue;
                // 部件名 + tint 来自子级名（类目已由组给出，故 hasCategory=false 只取名字/标记）
                const childParsed = parseLayerName(child.name || '', false);
                const tintable = childParsed.tintable !== null
                    ? childParsed.tintable
                    : (groupParsed.tintable !== null ? groupParsed.tintable : DEFAULT_TINTABLE_KEYS.has(catKey || ''));
                parts.push({
                    categoryKey: catKey,
                    name: childParsed.name || child.name || '',
                    tintable,
                    src: exportDataUrl(canvas, scale),
                    warnings: partWarnings,
                });
                made++;
            }
            if (!made) warnings.push(`组「${top.name || '?'}」里没有可用图层`);
        } else {
            // —— 顶层散图层 = 一个部件（类目从自己名字猜）——
            if (!top.canvas) continue;
            const partWarnings: string[] = [];
            const canvas = compositeLeaves([top], W, H, partWarnings);
            if (!hasInk(canvas)) {
                warnings.push(`「${top.name || '?'}」是空图层，跳过`);
                continue;
            }
            const parsed = parseLayerName(top.name || '');
            parts.push({
                categoryKey: parsed.categoryKey,
                name: parsed.name,
                tintable: parsed.tintable !== null ? parsed.tintable : DEFAULT_TINTABLE_KEYS.has(parsed.categoryKey || ''),
                src: exportDataUrl(canvas, scale),
                warnings: partWarnings,
            });
        }
    }

    if (!parts.length) warnings.push('没解析出任何部件：确认结构是"顶层组=类目，组内每个图层=一个部件"');
    return { parts, warnings, docWidth: W, docHeight: H };
}
