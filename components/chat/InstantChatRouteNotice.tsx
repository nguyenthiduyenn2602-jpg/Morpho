/**
 * 「这一轮没上云，在本地生成」的提示条（输入框正上方那一条）。
 *
 * 为什么要有：即时对话的开关写着「已开启」，消息却在本地生成——这中间的落差过去只留在
 * console 和观察窗里，用户查不到。他能看到的只有本地直连失败时那条读不懂的网络报错，
 * 于是以为是自己网络坏了。线上真实故障里，有人就这么卡了四个小时。
 *
 * 只报两档，都是「用户想上云、实际没上」的情形：
 *   worker-outdated     问到了，那台 Worker 确实跑不动 → 指路去更新
 *   worker-unreachable  这一刻够不着云端 → 别叫人去更新，多半是网络，会自己好
 *
 * 用户自己关掉的（disabled / char-disabled）、点单流程那种本该留在本地的，一律不出声——
 * 那些是正常行为，报了就成骚扰。
 */
import React, { useEffect, useState } from 'react';
import { AMSG_INSTANT_CHAT_ROUTE_EVENT, type InstantChatRouteDetail } from '../../utils/amsgInstantChat';

const NOTICES: Record<string, { title: string; hint: string }> = {
    'worker-outdated': {
        title: '这一轮在本地生成',
        hint: '云端那台 Worker 跑不动这条路，去设置里更新一下',
    },
    'worker-unreachable': {
        title: '这一轮在本地生成',
        hint: '一时连不上云端，网络恢复后会自己回去',
    },
};

const InstantChatRouteNotice: React.FC<{ charId: string }> = ({ charId }) => {
    const [reason, setReason] = useState<string | null>(null);

    useEffect(() => {
        // 换会话先清干净：上一个角色那轮的结论跟这个角色没关系。
        setReason(null);
        const onRoute = (event: Event) => {
            const detail = (event as CustomEvent<InstantChatRouteDetail>).detail;
            if (!detail || detail.charId !== charId) return;
            // reason 为 null（这一轮走成了云端）或不在名单里的原因，都当「没什么好说的」收起来。
            setReason(detail.reason && NOTICES[detail.reason] ? detail.reason : null);
        };
        window.addEventListener(AMSG_INSTANT_CHAT_ROUTE_EVENT, onRoute);
        return () => window.removeEventListener(AMSG_INSTANT_CHAT_ROUTE_EVENT, onRoute);
    }, [charId]);

    const notice = reason ? NOTICES[reason] : null;
    if (!notice) return null;

    return (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-200/70 text-[11px] text-amber-800">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span className="font-bold shrink-0">{notice.title}</span>
            <span className="opacity-70 truncate">· {notice.hint}</span>
        </div>
    );
};

export default InstantChatRouteNotice;
