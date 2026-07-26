// 备份导出链路的纯函数小工具。这里刻意不碰 DOM / Capacitor / JSZip，
// 把两块容易出错的逻辑——「原地抽取素材」和「手机端 3 字节对齐分片」——
// 拆出来，好在 node 测试环境里单测钉住。

/**
 * 遍历对象树，把所有 `data:image/...` 字符串原地替换成 `resolveImage` 的返回值
 * （通常是 `assets/*` 路径；无法抽取时原样返回）。直接改传进来的 `root`，所以
 * 调用方必须传独立副本：IDB getRawStoreData 拿到的是结构化克隆副本（安全），
 * 而 theme / customIcons / appearancePresets 这类引用了运行态 React state 的，
 * 必须先深拷贝再传进来。
 *
 * 共享子图（同一对象被多处引用）只处理一次；遇到真正的循环引用直接抛错，
 * 让问题在这里就带着清楚的提示暴露，而不是拖到后面 JSON.stringify 时报一句
 * 看不懂的 "circular structure"。
 */
export function extractImagesInPlace(
    root: unknown,
    resolveImage: (dataUrl: string) => string,
): void {
    if (root === null || typeof root !== 'object') return;

    // onPath：当前正在遍历的这条路径上的祖先节点（用来判循环）。
    // done：已经处理完的节点（共享子图第二次碰到就跳过）。
    const onPath = new WeakSet<object>();
    const done = new WeakSet<object>();
    const stack: object[] = [root as object];

    // 处理一个属性/元素：data:image 字符串原地换成路径，对象/数组入栈续遍历，
    // 碰到还在当前路径上的节点（回边）即循环引用，抛错。定义一次，不在循环里反复重建。
    const visit = (container: any, key: string | number, v: unknown) => {
        if (typeof v === 'string') {
            if (v.startsWith('data:image/')) container[key] = resolveImage(v);
        } else if (v !== null && typeof v === 'object') {
            if (onPath.has(v as object)) throw new Error('备份数据存在循环引用，无法导出');
            if (!done.has(v as object)) stack.push(v as object);
        }
    };

    while (stack.length) {
        // peek 而不是 pop：第一次见到这个节点时入栈它的孩子并留着自己当「出栈标记」，
        // 等孩子都处理完再次轮到它时，把它移出 onPath、记为 done。
        const node = stack[stack.length - 1];
        if (done.has(node)) { stack.pop(); continue; }
        if (onPath.has(node)) {
            stack.pop();
            onPath.delete(node);
            done.add(node);
            continue;
        }
        onPath.add(node);

        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) visit(node, i, node[i]);
        } else {
            const obj = node as Record<string, unknown>;
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) visit(obj, key, obj[key]);
            }
        }
    }
}

/**
 * 给会被原地改的导出数据做一份独立深拷贝。专门用在那些直接引用了运行态
 * React state 的值（theme / customIcons / appearancePresets）上，避免原地抽取
 * 素材时把正在用的系统主题等改坏。
 */
export function deepCloneForExport<T>(value: T): T {
    try {
        if (typeof structuredClone === 'function') return structuredClone(value);
    } catch {
        // 个别老 WebView 没有 structuredClone 或克隆失败，落到 JSON 兜底。
    }
    return JSON.parse(JSON.stringify(value));
}

/**
 * 手机端分片导出用的原始分片大小：3MiB，且能被 3 整除。
 *
 * 为什么必须是 3 的倍数：base64 每 3 字节编码成 4 个字符，正好填满不带 `=` 补位。
 * 只要每个非末尾分片的字节数是 3 的倍数，各分片各自 base64 后直接首尾相接，
 * 解码回来就是原始字节；否则中间会插进 `=` 补位，拼起来再解码就对不上了。
 */
export const EXPORT_CHUNK_SIZE = 3 * 1024 * 1024;

/** 把总字节长度切成一串连续的 [start, end) 区间，每段长 `chunkSize`（末段可短）。 */
export function sliceRanges(total: number, chunkSize: number): Array<[number, number]> {
    if (chunkSize <= 0) throw new Error('chunkSize must be positive');
    const ranges: Array<[number, number]> = [];
    for (let start = 0; start < total; start += chunkSize) {
        ranges.push([start, Math.min(start + chunkSize, total)]);
    }
    return ranges;
}
