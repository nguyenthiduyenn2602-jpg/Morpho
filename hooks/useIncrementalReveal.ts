import { useEffect, useRef, useState } from 'react';

/**
 * 大列表增量渲染：先渲染前 step 个，滚动到 sentinel 附近时自动追加。
 * 用于表情包网格这类「几百张 base64 图一次性挂载会卡爆」的场景。
 * resetKey 变化（如切换分组）时回到初始数量。
 */
export function useIncrementalReveal(total: number, step = 48, resetKey?: unknown) {
    const [count, setCount] = useState(step);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setCount(step);
    }, [resetKey, step]);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el || count >= total) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    setCount(current => Math.min(current + step, total));
                }
            },
            { rootMargin: '200px' }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [count, total, step]);

    return {
        count: Math.min(count, total),
        hasMore: count < total,
        sentinelRef,
    };
}
