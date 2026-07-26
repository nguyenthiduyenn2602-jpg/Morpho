/**
 * 浏览器自动翻译导致 React 崩溃自愈 —— "Failed to execute 'insertBefore'/'removeChild' on 'Node'"
 *
 * 触发场景 (Chrome / Edge / 三星浏览器 等开启「网页自动翻译」时高发):
 *  - 翻译引擎会把页面里的文本节点 (Text node) 拆开、替换、外面再包一层 <font> 之类的容器,
 *    直接改动了 React 托管的真实 DOM 结构;
 *  - 之后 React 走 reconcile 想 removeChild / insertBefore 某个节点时, 该节点的 parentNode
 *    已经被翻译器换掉了, 浏览器抛 NotFoundError: "The node before which the new node is to be
 *    inserted is not a child of this node." —— 整个 App 白屏崩溃。
 *  - 用户侧表现: 关掉翻译就好了, 但开着翻译就一进来 / 一切换页面就报错。
 *
 * 业界通行解法 (facebook/react#11538): 给 Node.prototype.insertBefore / removeChild 打个护栏 ——
 * 当参照节点 / 待删节点的 parentNode 已经不是 this 时 (说明被翻译器搬走了), 不再硬调原生方法抛错,
 * 而是降级处理 (尽量在节点真正的 parent 上补做一次, 否则静默返回)。React 下一轮渲染会自我修正,
 * 既不崩溃, 也不影响翻译功能本身。
 *
 * 注意: 只在浏览器环境装一次, 幂等。必须在 React 挂载前执行 (见 index.tsx 首行 import)。
 */

let installed = false;

export const installTranslateCrashGuard = (): void => {
    if (installed) return;
    if (typeof Node !== 'function' || !Node.prototype) return;
    installed = true;

    const originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(this: Node, newNode: T, referenceNode: Node | null): T {
        // 参照节点存在、但它的爹已经不是 this —— 翻译器把 DOM 搬过家了, 硬插会抛 NotFoundError。
        if (referenceNode && referenceNode.parentNode !== this) {
            // 尽量在参照节点真正的 parent 上完成插入, 让视觉结果尽量正确;
            if (referenceNode.parentNode) {
                return originalInsertBefore.call(referenceNode.parentNode, newNode, referenceNode) as T;
            }
            // 参照节点已彻底脱离文档树, 退化成 append 到 this, 总比崩溃强。
            return this.appendChild(newNode) as T;
        }
        return originalInsertBefore.call(this, newNode, referenceNode) as T;
    } as typeof Node.prototype.insertBefore;

    const originalRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
        // 待删节点的爹已经不是 this —— 同样是翻译器搬家所致, 硬删会抛 NotFoundError。
        if (child.parentNode !== this) {
            // 节点若还挂在别处, 就从它真正的 parent 上删掉; 否则视为已脱离, 直接返回。
            if (child.parentNode) {
                return originalRemoveChild.call(child.parentNode, child) as T;
            }
            return child;
        }
        return originalRemoveChild.call(this, child) as T;
    } as typeof Node.prototype.removeChild;
};
