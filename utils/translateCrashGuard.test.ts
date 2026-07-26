import { describe, it, expect, afterAll, vi } from 'vitest';
import { installTranslateCrashGuard } from './translateCrashGuard';

// 锁住「浏览器自动翻译改 DOM → React reconcile 抛 NotFoundError 白屏」的护栏行为。
// 测试环境是 node, 没有真实 Node, 这里搭一个最小 DOM 模型:
// 原生 insertBefore/removeChild 在「参照/待删节点不是自己孩子」时抛错 (复刻浏览器行为),
// 护栏装上后应降级到节点真正的 parent 上完成操作, 而非抛错。

class FakeNode {
    parentNode: FakeNode | null = null;
    childNodes: FakeNode[] = [];

    insertBefore(newNode: FakeNode, ref: FakeNode | null): FakeNode {
        if (ref && ref.parentNode !== this) {
            throw new Error("NotFoundError: reference node is not a child of this node");
        }
        const idx = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
        this.childNodes.splice(idx, 0, newNode);
        newNode.parentNode = this;
        return newNode;
    }

    removeChild(child: FakeNode): FakeNode {
        if (child.parentNode !== this) {
            throw new Error("NotFoundError: node is not a child of this node");
        }
        this.childNodes.splice(this.childNodes.indexOf(child), 1);
        child.parentNode = null;
        return child;
    }

    appendChild(node: FakeNode): FakeNode {
        this.childNodes.push(node);
        node.parentNode = this;
        return node;
    }
}

// 用 FakeNode 冒充全局 Node, 再装护栏 (护栏改的就是 Node.prototype)。
vi.stubGlobal('Node', FakeNode);
installTranslateCrashGuard();

afterAll(() => {
    vi.unstubAllGlobals();
});

describe('installTranslateCrashGuard - insertBefore', () => {
    it('参照节点正常 (是 this 的孩子) 时, 行为不变', () => {
        const parent = new FakeNode();
        const a = new FakeNode();
        const b = new FakeNode();
        parent.appendChild(b);
        parent.insertBefore(a, b);
        expect(parent.childNodes).toEqual([a, b]);
    });

    it('参照节点被「翻译器」搬到别的 parent 后, 不再抛错, 而是插到它真正的 parent', () => {
        const reactParent = new FakeNode();
        const translatorWrapper = new FakeNode();
        const ref = new FakeNode();
        // 翻译器把 ref 从 reactParent 搬进了 translatorWrapper
        translatorWrapper.appendChild(ref);

        const newNode = new FakeNode();
        // React 以为 ref 还在 reactParent 下 → 原生会抛 NotFoundError
        expect(() => reactParent.insertBefore(newNode, ref)).not.toThrow();
        // 降级: 插到 ref 真正的 parent (translatorWrapper)
        expect(translatorWrapper.childNodes).toEqual([newNode, ref]);
    });

    it('参照节点已彻底脱离文档树时, 退化为 append 到 this, 不抛错', () => {
        const parent = new FakeNode();
        const orphanRef = new FakeNode(); // parentNode 为 null
        const newNode = new FakeNode();
        expect(() => parent.insertBefore(newNode, orphanRef)).not.toThrow();
        expect(parent.childNodes).toEqual([newNode]);
    });
});

describe('installTranslateCrashGuard - removeChild', () => {
    it('待删节点是 this 的孩子时, 行为不变', () => {
        const parent = new FakeNode();
        const child = new FakeNode();
        parent.appendChild(child);
        parent.removeChild(child);
        expect(parent.childNodes).toEqual([]);
    });

    it('待删节点被「翻译器」搬走后, 从它真正的 parent 删除, 不抛错', () => {
        const reactParent = new FakeNode();
        const translatorWrapper = new FakeNode();
        const child = new FakeNode();
        translatorWrapper.appendChild(child);

        expect(() => reactParent.removeChild(child)).not.toThrow();
        expect(translatorWrapper.childNodes).toEqual([]);
        expect(child.parentNode).toBeNull();
    });

    it('待删节点已脱离文档树时, 静默返回, 不抛错', () => {
        const reactParent = new FakeNode();
        const orphan = new FakeNode();
        expect(() => reactParent.removeChild(orphan)).not.toThrow();
    });
});
