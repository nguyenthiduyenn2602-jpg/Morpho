import React, { useEffect, useState } from 'react';
import type { Message } from '../../types';
import { confirmMealChat, mealChatConfirmationKey, mealChatStockQuantity, type MealChatMatch } from '../../utils/mealChat';
import { loadMealPlannerState, MEAL_PLANNER_STORAGE_KEY, MEAL_STORAGE_CHANGED, type PantryItem } from '../../utils/mealPlanner';

function MealChoice({ item, portion, fromDish, disabled, onConfirm }: {
    item: PantryItem;
    portion: MealChatMatch['portion'];
    fromDish?: string;
    disabled: boolean;
    onConfirm: (item: PantryItem, quantity: number) => void;
}) {
    const quantity = mealChatStockQuantity(portion, item.unit, fromDish);
    return <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#dce3d7] bg-white p-2.5">
        <div className="min-w-0">
            <div className="font-semibold break-words">{item.name}</div>
            <div className="text-xs text-[#62715d]">
                {quantity === undefined
                    ? (fromDish ? `已匹配库存，可在聊天里补充实际用量（${item.unit}）` : '与库存单位不一致')
                    : `扣除 ${quantity}${item.unit} · 库存 ${item.quantity}${item.unit}`}
            </div>
            {quantity !== undefined && quantity > item.quantity && <div className="text-xs text-red-700">库存不足</div>}
        </div>
        <div className="flex items-center gap-2">
            <button type="button" className="rounded-lg bg-[#52694f] px-3 py-1 text-white disabled:opacity-40"
                disabled={disabled || quantity === undefined || quantity > item.quantity}
                onClick={() => { if (quantity !== undefined) onConfirm(item, quantity); }}>确认已吃</button>
        </div>
    </div>;
}

export default function MealChatCards({ message, matches }: { message: Message; matches: MealChatMatch[] }) {
    const [state, setState] = useState(loadMealPlannerState);
    const [busy, setBusy] = useState<string>();
    const [error, setError] = useState<{ key: string; text: string }>();
    useEffect(() => {
        const refresh = () => setState(loadMealPlannerState());
        const onStorage = (event: StorageEvent) => {
            if (event.key === MEAL_PLANNER_STORAGE_KEY || event.key === null) refresh();
        };
        window.addEventListener(MEAL_STORAGE_CHANGED, refresh);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(MEAL_STORAGE_CHANGED, refresh);
            window.removeEventListener('storage', onStorage);
        };
    }, []);
    const resolve = async (key: string, choice?: { item: PantryItem; quantity: number }) => {
        setBusy(key);
        setError(undefined);
        try {
            await confirmMealChat(key, choice);
        } catch (err) {
            setError({ key, text: err instanceof Error ? err.message : '操作未保存，请重试' });
        } finally {
            setState(loadMealPlannerState());
            setBusy(undefined);
        }
    };
    return <div className="w-full max-w-[19rem] space-y-2 text-sm text-[#354832]">
        {matches.map(match => {
            const { food, itemIds, portion, fromDish, purchase } = match;
            const key = mealChatConfirmationKey(message, match);
            const receipt = state.chatConsumption?.[key];
            const choices = state.inventory.filter(item => itemIds.includes(item.id) && item.quantity > 0);
            return <section key={key} className="space-y-2 rounded-2xl border border-[#dce3d7] bg-[#f4f7f0] p-3">
                <div className="font-semibold">{purchase ? '购物' : '饮食'} · {food}</div>
                {fromDish && <div className="text-xs text-[#62715d]">可能用在{fromDish}里</div>}
                {receipt && 'skipped' in receipt && <div role="status" className="text-xs text-[#62715d]">这次不记</div>}
                {receipt && 'name' in receipt && <div role="status">{receipt.purchase ? '已入库' : '已扣除'} {receipt.name} {receipt.quantity}{receipt.unit}</div>}
                {!receipt && purchase && <div className="text-xs text-[#62715d]">私聊入库已停用</div>}
                {!receipt && !purchase && <>
                    <div className="text-xs text-[#62715d]">
                        {choices.length > 1 ? '选一项确认扣除' : !choices.length ? '对应存货已用完或移除' : null}
                    </div>
                    {choices.map(item => <MealChoice key={item.id} item={item} portion={portion} fromDish={fromDish} disabled={busy !== undefined}
                        onConfirm={(candidate, quantity) => void resolve(key, { item: candidate, quantity })} />)}
                    <button type="button" disabled={busy !== undefined} onClick={() => void resolve(key)}
                        className="text-xs text-[#62715d] underline disabled:opacity-40">这次不记</button>
                    {error?.key === key && <div role="alert" className="text-xs text-red-700">{error.text}</div>}
                </>}
            </section>;
        })}
    </div>;
}
