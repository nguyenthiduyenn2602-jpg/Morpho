import React, { useEffect, useState } from 'react';
import type { Message } from '../../types';
import { confirmMealChat, mealChatReceiptKey, type MealChatMatch } from '../../utils/mealChat';
import { loadMealPlannerState, MEAL_PLANNER_STORAGE_KEY, MEAL_STORAGE_CHANGED, type PantryItem } from '../../utils/mealPlanner';

function MealChoice({ item, disabled, onConfirm }: {
    item: PantryItem;
    disabled: boolean;
    onConfirm: (item: PantryItem, quantity: number) => void;
}) {
    const [quantity, setQuantity] = useState(() => /^(克|毫升|千克|公斤|升|g|kg|ml|l)$/i.test(item.unit)
        ? ''
        : String(Math.min(1, item.quantity)));
    return <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#dce3d7] bg-white p-2.5">
        <div className="min-w-0">
            <div className="font-semibold break-words">{item.name}</div>
            <div className="text-xs text-[#62715d]">剩 {item.quantity}{item.unit}{item.expiresAt ? ` · ${item.expiresAt} 到期` : ''}</div>
        </div>
        <div className="flex items-center gap-2">
            <input type="number" inputMode="decimal" min="0.01" max={item.quantity} step="0.01" value={quantity}
                aria-label={`${item.name}扣除数量（${item.unit}）`}
                onChange={event => setQuantity(event.target.value)}
                className="w-14 rounded-md border border-[#dce3d7] px-1 py-1 text-center" />
            <span className="text-xs">{item.unit}</span>
            <button type="button" className="rounded-lg bg-[#52694f] px-3 py-1 text-white disabled:opacity-40"
                disabled={disabled || Number(quantity) < 0.01 || Number(quantity) > item.quantity}
                onClick={() => onConfirm(item, Number(quantity))}>已吃</button>
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
    return <div className="mb-3 ml-auto mr-4 w-[min(19rem,85%)] space-y-2 text-sm text-[#354832]">
        {matches.map(({ food, itemIds }) => {
            const key = mealChatReceiptKey(message, food);
            const receipt = state.chatConsumption?.[key];
            const choices = state.inventory.filter(item => itemIds.includes(item.id) && item.quantity > 0);
            return <section key={food} className="space-y-2 rounded-2xl border border-[#dce3d7] bg-[#f4f7f0] p-3">
                <div className="font-semibold">吃了没 · {food}</div>
                {receipt && 'skipped' in receipt && <div role="status" className="text-xs text-[#62715d]">这次不记</div>}
                {receipt && 'name' in receipt && <div role="status">已扣除 {receipt.name} {receipt.quantity}{receipt.unit}</div>}
                {!receipt && <>
                    <div className="text-xs text-[#62715d]">
                        {choices.length > 1 ? '选一项确认扣除' : choices.length ? '确认数量后扣库存' : '对应存货已用完或移除'}
                    </div>
                    {choices.map(item => <MealChoice key={item.id} item={item} disabled={busy !== undefined}
                        onConfirm={(candidate, quantity) => void resolve(key, { item: candidate, quantity })} />)}
                    <button type="button" disabled={busy !== undefined} onClick={() => void resolve(key)}
                        className="text-xs text-[#62715d] underline disabled:opacity-40">这次不记</button>
                    {error?.key === key && <div role="alert" className="text-xs text-red-700">{error.text}</div>}
                </>}
            </section>;
        })}
    </div>;
}
