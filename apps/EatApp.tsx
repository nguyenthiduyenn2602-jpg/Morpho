import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft,
    BowlFood,
    CalendarBlank,
    CaretDown,
    Check,
    CookingPot,
    ForkKnife,
    GearSix,
    Leaf,
    Plus,
    Snowflake,
    ShoppingBag,
    Sparkle,
    Trash,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import TokenImg from '../components/os/TokenImg';
import { DB } from '../utils/db';
import fridgeImageUrl from '../assets/eat/fridge-open.png';
import {
    DEFAULT_MEAL_SETTINGS,
    formatMealPlanForChat,
    generateDailyMealPlan,
    loadMealPlannerState,
    PantryCategory,
    PantryItem,
    saveMealPlannerState,
    type MealPlannerState,
} from '../utils/mealPlanner';

type Tab = 'today' | 'fridge' | 'settings';
type FridgeZone = 'fresh' | 'drinks' | 'frozen';

const CATEGORIES: PantryCategory[] = ['主食', '肉蛋', '蔬菜', '水果', '奶豆', '饮品', '冷冻', '速食', '调味', '其他'];
const CATEGORY_COLORS: Record<PantryCategory, string> = {
    主食: 'bg-amber-100 text-amber-700', 肉蛋: 'bg-rose-100 text-rose-700', 蔬菜: 'bg-emerald-100 text-emerald-700',
    水果: 'bg-orange-100 text-orange-700', 奶豆: 'bg-yellow-100 text-yellow-700', 速食: 'bg-sky-100 text-sky-700',
    饮品: 'bg-cyan-100 text-cyan-700', 冷冻: 'bg-blue-100 text-blue-700',
    调味: 'bg-violet-100 text-violet-700', 其他: 'bg-slate-100 text-slate-600',
};

const ZONE_META: Record<FridgeZone, { label: string; hint: string; categories: PantryCategory[]; defaultCategory: PantryCategory; className: string }> = {
    fresh: { label: '生鲜区', hint: '菜、肉蛋、水果和常温存货', categories: ['主食', '肉蛋', '蔬菜', '水果', '奶豆', '调味', '其他'], defaultCategory: '蔬菜', className: 'left-[7%] top-[7%] w-[65%] h-[52%]' },
    drinks: { label: '饮品区', hint: '牛奶、饮料和瓶装饮品', categories: ['饮品'], defaultCategory: '饮品', className: 'right-[3%] top-[9%] w-[23%] h-[48%]' },
    frozen: { label: '冷冻区', hint: '冻货、速食和冰品', categories: ['冷冻', '速食'], defaultCategory: '冷冻', className: 'left-[7%] top-[62%] w-[65%] h-[31%]' },
};

const zoneForItem = (item: PantryItem): FridgeZone => {
    if (item.category === '饮品') return 'drinks';
    if (item.category === '冷冻' || item.category === '速食') return 'frozen';
    return 'fresh';
};

const localDate = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const newItem = (): Omit<PantryItem, 'id'> => ({ name: '', quantity: 1, unit: '份', category: '其他', expiresAt: '', note: '' });

const EatApp: React.FC = () => {
    const { closeApp, apiConfig, addToast, characters } = useOS();
    const [state, setState] = useState<MealPlannerState>(() => loadMealPlannerState());
    const [tab, setTab] = useState<Tab>('today');
    const [date, setDate] = useState(localDate);
    const [generating, setGenerating] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [draftItem, setDraftItem] = useState(newItem);
    const [expandedMeal, setExpandedMeal] = useState<string>('早餐');
    const [selectedItemId, setSelectedItemId] = useState<string>('');

    useEffect(() => { saveMealPlannerState(state); }, [state]);

    const currentPlan = useMemo(() => state.plans.find(plan => plan.date === date), [state.plans, date]);
    const expiring = useMemo(() => {
        const end = new Date();
        end.setDate(end.getDate() + 3);
        return state.inventory.filter(item => item.expiresAt && new Date(item.expiresAt) <= end).length;
    }, [state.inventory]);

    const handleGenerate = async () => {
        if (generating) return;
        setGenerating(true);
        try {
            const plan = await generateDailyMealPlan(apiConfig, state.inventory, state.settings, date);
            setState(prev => ({ ...prev, plans: [plan, ...prev.plans.filter(item => item.date !== date)].slice(0, 14) }));
            const pushCharacter = characters.find(character => character.id === state.settings.pushCharacterId);
            if (pushCharacter) {
                await DB.saveMessage({
                    charId: pushCharacter.id,
                    role: 'user',
                    type: 'text',
                    content: formatMealPlanForChat(plan),
                    metadata: { source: 'eat', mealPlanId: plan.id, mealPlanDate: plan.date },
                });
                window.dispatchEvent(new CustomEvent('active-msg-progress', { detail: { charId: pushCharacter.id } }));
                addToast(`今天的饭安排好了，也发给了${pushCharacter.name}`, 'success');
            } else {
                addToast('今天的饭安排好了', 'success');
            }
        } catch (error: any) {
            addToast(error?.message || '饮食安排生成失败', 'error');
        } finally {
            setGenerating(false);
        }
    };

    const addInventory = () => {
        const name = draftItem.name.trim();
        if (!name) { addToast('先写食材名字', 'info'); return; }
        const item: PantryItem = {
            ...draftItem,
            id: `food-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name,
            quantity: Math.max(0, Number(draftItem.quantity) || 0),
            unit: draftItem.unit.trim() || '份',
            expiresAt: draftItem.expiresAt || undefined,
            note: draftItem.note?.trim() || undefined,
        };
        setState(prev => ({ ...prev, inventory: [item, ...prev.inventory] }));
        setDraftItem(newItem());
        setShowAdd(false);
    };

    const removeInventory = (id: string) => setState(prev => ({ ...prev, inventory: prev.inventory.filter(item => item.id !== id) }));
    const updateQuantity = (id: string, delta: number) => setState(prev => ({
        ...prev,
        inventory: prev.inventory.map(item => item.id === id ? { ...item, quantity: Math.max(0, Math.round((item.quantity + delta) * 10) / 10) } : item),
    }));
    const openAddForZone = (zone: FridgeZone) => {
        setDraftItem({ ...newItem(), category: ZONE_META[zone].defaultCategory });
        setShowAdd(true);
    };
    const selectedItem = state.inventory.find(item => item.id === selectedItemId);

    return (
        <div className="h-full w-full flex flex-col bg-[#f8f5ed] text-[#344038] animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
            <header className="shrink-0 px-4 pt-2 pb-3 border-b border-[#dfe6d8] bg-[#f8f5ed]/95 backdrop-blur-xl z-20">
                <div className="flex items-center justify-between">
                    <button onClick={closeApp} className="w-10 h-10 rounded-full grid place-items-center bg-white/70 border border-[#e6e1d4] active:scale-90" aria-label="返回">
                        <ArrowLeft size={23} />
                    </button>
                    <div className="text-center">
                        <p className="text-[9px] tracking-[0.32em] text-[#7e927c] font-bold">MORPHO KITCHEN</p>
                        <h1 className="text-xl font-black tracking-tight">吃了吗</h1>
                    </div>
                    <button onClick={() => setShowAdd(true)} className="w-10 h-10 rounded-full grid place-items-center bg-[#71866e] text-white shadow-sm active:scale-90" aria-label="添加存货">
                        <Plus size={22} weight="bold" />
                    </button>
                </div>
                <nav className="mt-3 grid grid-cols-3 p-1 rounded-2xl bg-[#e9eadf] text-xs font-bold">
                    {([['today', '今日', BowlFood], ['fridge', '冰箱', Snowflake], ['settings', '偏好', GearSix]] as const).map(([id, label, Icon]) => (
                        <button key={id} onClick={() => setTab(id)} className={`py-2 rounded-xl flex items-center justify-center gap-1.5 transition ${tab === id ? 'bg-white text-[#52664f] shadow-sm' : 'text-[#82907f]'}`}>
                            <Icon size={15} weight={tab === id ? 'fill' : 'regular'} />{label}
                        </button>
                    ))}
                </nav>
            </header>

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-[calc(var(--safe-bottom)+24px)]">
                {tab === 'today' && (
                    <div className="space-y-4">
                        <section className="rounded-[1.8rem] p-5 text-white overflow-hidden relative shadow-[0_18px_40px_-24px_rgba(67,87,65,.8)]" style={{ background: 'linear-gradient(135deg,#53694f 0%,#7f9679 62%,#a9b79a 100%)' }}>
                            <div className="absolute w-36 h-36 rounded-full bg-white/10 -right-10 -top-12" />
                            <div className="absolute w-24 h-24 rounded-full bg-[#e7b879]/20 right-14 -bottom-14" />
                            <div className="relative">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] tracking-[0.24em] text-white/65 font-bold">TODAY'S TABLE</p>
                                        <h2 className="text-2xl font-black mt-1">{currentPlan?.title || '先看看冰箱里有什么'}</h2>
                                    </div>
                                    <CookingPot size={42} weight="duotone" className="text-[#f4d7a8] shrink-0" />
                                </div>
                                <div className="mt-4 flex items-end justify-between">
                                    <label className="flex items-center gap-2 text-xs bg-black/10 rounded-full px-3 py-2">
                                        <CalendarBlank size={15} />
                                        <input type="date" value={date} onChange={event => setDate(event.target.value)} className="bg-transparent outline-none text-white [color-scheme:dark] max-w-[112px]" />
                                    </label>
                                    <div className="text-right">
                                        <p className="text-2xl font-black">{currentPlan?.totalKcal || '—'}</p>
                                        <p className="text-[10px] text-white/70">全天估算 kcal</p>
                                    </div>
                                </div>
                                <button onClick={handleGenerate} disabled={generating} className="mt-4 w-full py-3 rounded-2xl bg-[#fff9ea] text-[#53694f] font-black text-sm active:scale-[.98] disabled:opacity-60 transition">
                                    {generating ? `正在翻冰箱、安排${state.settings.mealsPerDay}餐……` : currentPlan ? '换一份今日安排' : '按现有存货安排今天'}
                                </button>
                            </div>
                        </section>

                        {!currentPlan && (
                            <section className="rounded-[1.6rem] bg-white border border-[#ebe5d7] p-5 text-center">
                                <Leaf size={34} weight="duotone" className="mx-auto text-[#71866e]" />
                                <p className="mt-2 font-bold">家常一点，省事一点</p>
                                <p className="text-xs text-[#8b9388] mt-1 leading-relaxed">再忙也要记得好好吃饭</p>
                            </section>
                        )}

                        {currentPlan?.stockPriority?.length ? (
                            <section className="rounded-2xl bg-[#fff4dc] border border-[#f0d8aa] px-4 py-3 flex gap-3">
                                <Sparkle size={19} weight="fill" className="text-[#c78b42] shrink-0 mt-0.5" />
                                <div><p className="text-xs font-black text-[#8c622f]">今天优先消耗</p><p className="text-xs text-[#9b7548] mt-1">{currentPlan.stockPriority.join('、')}</p></div>
                            </section>
                        ) : null}

                        {currentPlan?.meals.map(meal => (
                            <section key={meal.type} className="rounded-[1.6rem] bg-white border border-[#e7e2d5] overflow-hidden shadow-[0_10px_30px_-24px_rgba(57,70,55,.6)]">
                                <button onClick={() => setExpandedMeal(expandedMeal === meal.type ? '' : meal.type)} className="w-full p-4 flex items-center gap-3 text-left">
                                    <span className="w-10 h-10 rounded-2xl bg-[#edf1e8] text-[#63765f] grid place-items-center"><ForkKnife size={20} weight="duotone" /></span>
                                    <span className="flex-1"><b className="text-base">{meal.type}</b><small className="block text-[#9aa197] mt-0.5">约 {meal.kcal} kcal · {meal.prepMinutes} 分钟</small></span>
                                    <CaretDown size={18} className={`transition ${expandedMeal === meal.type ? 'rotate-180' : ''}`} />
                                </button>
                                {expandedMeal === meal.type && <div className="px-4 pb-4 space-y-3 border-t border-[#f0ede5] pt-3">
                                    {meal.dishes.map((dish, index) => (
                                        <div key={`${dish.name}-${index}`} className="flex gap-3">
                                            <span className="w-6 h-6 rounded-full bg-[#71866e] text-white text-[10px] font-bold grid place-items-center shrink-0">{index + 1}</span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex justify-between gap-3"><b className="text-sm">{dish.name}</b><span className="text-xs text-[#8b9388] shrink-0">{dish.kcal} kcal</span></div>
                                                <p className="text-xs text-[#8b9388] mt-1">{dish.portion}</p>
                                                {!!dish.stockUsed.length && <p className="text-[10px] text-[#6f856b] mt-1">用现有：{dish.stockUsed.join('、')}</p>}
                                            </div>
                                        </div>
                                    ))}
                                    {meal.tip && <p className="rounded-xl bg-[#f7f5ed] px-3 py-2 text-xs text-[#7d837a] leading-relaxed">{meal.tip}</p>}
                                </div>}
                            </section>
                        ))}

                        {currentPlan?.shoppingList?.length ? <section className="rounded-[1.6rem] bg-white border border-[#e7e2d5] p-4">
                            <div className="flex items-center gap-2 font-black"><ShoppingBag size={20} weight="duotone" className="text-[#b57942]" />顺手补一点</div>
                            <div className="mt-3 flex flex-wrap gap-2">{currentPlan.shoppingList.map(item => <span key={item} className="px-3 py-1.5 rounded-full bg-[#f7eee4] text-[#8f633f] text-xs">{item}</span>)}</div>
                        </section> : null}

                        {currentPlan && <p className="px-2 text-[10px] text-center text-[#9a9d95] leading-relaxed">{currentPlan.note}<br />卡路里按常见食材和份量估算，实际会受用油、品牌和烹饪方式影响。</p>}
                    </div>
                )}

                {tab === 'fridge' && (
                    <div className="space-y-4">
                        <section className="flex items-center justify-between px-1">
                            <div><p className="text-[10px] tracking-[.22em] font-black text-[#819080]">MY FRIDGE</p><h2 className="text-lg font-black mt-0.5">家里还有什么</h2></div>
                            <div className="flex gap-2 text-[10px] font-bold">
                                <span className="rounded-full bg-[#71866e] text-white px-3 py-1.5">{state.inventory.length} 种存货</span>
                                <span className="rounded-full bg-[#f3d29f] text-[#74532d] px-3 py-1.5">{expiring} 种临期</span>
                            </div>
                        </section>

                        <section className="relative w-full aspect-[943/1672] rounded-[2rem] overflow-hidden border border-white/80 shadow-[0_22px_55px_-28px_rgba(65,78,67,.65)] bg-[#dfe5dc]">
                            <img src={fridgeImageUrl} alt="打开的冰箱" className="absolute inset-0 w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-[#344038]/10 pointer-events-none" />
                            {(Object.entries(ZONE_META) as [FridgeZone, typeof ZONE_META[FridgeZone]][]).map(([zone, meta]) => {
                                const items = state.inventory.filter(item => zoneForItem(item) === zone);
                                return <div key={zone} className={`absolute ${meta.className} rounded-2xl border border-white/45 bg-white/[.07] p-2 flex flex-col`}>
                                    <button onClick={() => openAddForZone(zone)} className="self-start max-w-full rounded-full bg-[#f9f7ee]/90 backdrop-blur-md shadow-sm px-2.5 py-1.5 text-left active:scale-95">
                                        <span className="flex items-center gap-1 text-[10px] font-black text-[#536157]"><Plus size={11} weight="bold" />{meta.label}</span>
                                    </button>
                                    <div className={`mt-2 flex flex-wrap content-start gap-1.5 overflow-y-auto ${zone === 'drinks' ? 'flex-col flex-nowrap' : ''}`}>
                                        {items.map(item => <button key={item.id} onClick={() => setSelectedItemId(item.id)} className={`max-w-full rounded-xl border px-2 py-1.5 text-left shadow-sm backdrop-blur-md active:scale-95 transition ${selectedItemId === item.id ? 'bg-[#60735f] border-[#60735f] text-white' : 'bg-[#fffdf5]/88 border-white/75 text-[#415047]'}`}>
                                            <b className="block text-[10px] truncate">{item.name}</b>
                                            <span className={`block text-[9px] truncate ${selectedItemId === item.id ? 'text-white/70' : 'text-[#77817a]'}`}>{item.quantity}{item.unit}</span>
                                        </button>)}
                                    </div>
                                    {!items.length && <button onClick={() => openAddForZone(zone)} className="m-auto rounded-xl bg-[#f9f7ee]/72 backdrop-blur px-2 py-2 text-[9px] leading-relaxed font-bold text-[#77827a]">{meta.hint}</button>}
                                </div>;
                            })}
                            {!state.inventory.length && <div className="absolute left-1/2 -translate-x-1/2 bottom-[3.5%] whitespace-nowrap rounded-full bg-[#344038]/60 text-white/90 backdrop-blur-md px-3 py-2 text-[10px] font-bold">点一个分区，把食材放进去</div>}
                        </section>

                        {selectedItem && <section className="rounded-[1.5rem] bg-white border border-[#e6e2d6] p-4 shadow-[0_12px_35px_-28px_rgba(57,70,55,.7)]">
                            <div className="flex items-start gap-3">
                                <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${CATEGORY_COLORS[selectedItem.category]}`}>{selectedItem.category}</span>
                                <div className="flex-1 min-w-0"><b className="block truncate">{selectedItem.name}</b><p className="text-[10px] text-[#929991] mt-1 truncate">{selectedItem.expiresAt ? `${selectedItem.expiresAt} 到期` : '未记保质期'}{selectedItem.note ? ` · ${selectedItem.note}` : ''}</p></div>
                                <button onClick={() => setSelectedItemId('')} className="text-[#a7aca5]"><X size={17} /></button>
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                                <div className="flex items-center bg-[#f1f2eb] rounded-full overflow-hidden"><button onClick={() => updateQuantity(selectedItem.id, -1)} className="w-10 h-9 text-lg">−</button><span className="text-xs min-w-16 text-center font-black">{selectedItem.quantity}{selectedItem.unit}</span><button onClick={() => updateQuantity(selectedItem.id, 1)} className="w-10 h-9 text-lg">＋</button></div>
                                <button onClick={() => { removeInventory(selectedItem.id); setSelectedItemId(''); }} className="h-9 px-3 rounded-full bg-rose-50 text-rose-500 text-xs font-bold flex items-center gap-1.5"><Trash size={15} />吃完了</button>
                            </div>
                        </section>}
                    </div>
                )}

                {tab === 'settings' && (
                    <div className="space-y-4">
                        <section className="rounded-[1.6rem] bg-white border border-[#e7e2d5] p-5 space-y-5">
                            <div><h2 className="font-black">今天想怎么吃</h2><p className="text-xs text-[#969c93] mt-1">只影响“吃了吗”，不会改全局设置。</p></div>
                            <label className="block"><span className="text-xs font-bold">全天热量目标</span><div className="mt-2 flex items-center gap-3"><input type="range" min="1000" max="3000" step="50" value={state.settings.targetKcal} onChange={event => setState(prev => ({ ...prev, settings: { ...prev.settings, targetKcal: Number(event.target.value) } }))} className="flex-1 accent-[#71866e]" /><b className="w-20 text-right">{state.settings.targetKcal} kcal</b></div></label>
                            <label className="block"><span className="text-xs font-bold">吃饭人数</span><input type="number" min="1" max="12" value={state.settings.diners} onChange={event => setState(prev => ({ ...prev, settings: { ...prev.settings, diners: Math.max(1, Math.min(12, Number(event.target.value) || 1)) } }))} className="mt-2 w-full rounded-xl bg-[#f5f3eb] px-4 py-3 outline-none" /></label>
                            <div><span className="text-xs font-bold">每天安排几顿</span><div className="mt-2 grid grid-cols-3 gap-2">{([1, 2, 3] as const).map(count => <button key={count} onClick={() => setState(prev => ({ ...prev, settings: { ...prev.settings, mealsPerDay: count } }))} className={`py-2.5 rounded-xl text-xs font-black border ${state.settings.mealsPerDay === count ? 'bg-[#71866e] text-white border-[#71866e]' : 'bg-white border-[#dfded5]'}`}>{count} 顿</button>)}</div></div>
                            <div><span className="text-xs font-bold">饮食方向</span><div className="mt-2 grid grid-cols-3 gap-2">{(['正常吃', '清淡点', '控热量'] as const).map(goal => <button key={goal} onClick={() => setState(prev => ({ ...prev, settings: { ...prev.settings, goal } }))} className={`py-2.5 rounded-xl text-xs font-black border ${state.settings.goal === goal ? 'bg-[#71866e] text-white border-[#71866e]' : 'bg-white border-[#dfded5]'}`}>{goal}</button>)}</div></div>
                            <label className="block"><span className="text-xs font-bold">不吃 / 忌口</span><textarea value={state.settings.dislikes} onChange={event => setState(prev => ({ ...prev, settings: { ...prev.settings, dislikes: event.target.value } }))} placeholder="例如：不吃香菜、海鲜过敏……" className="mt-2 w-full h-24 rounded-xl bg-[#f5f3eb] px-4 py-3 text-sm resize-none outline-none" /></label>
                            <label className="block"><span className="text-xs font-bold">厨房和时间</span><textarea value={state.settings.kitchenNote} onChange={event => setState(prev => ({ ...prev, settings: { ...prev.settings, kitchenNote: event.target.value } }))} placeholder="例如：只有电饭煲；晚饭最多做20分钟" className="mt-2 w-full h-24 rounded-xl bg-[#f5f3eb] px-4 py-3 text-sm resize-none outline-none" /></label>
                            <div>
                                <span className="text-xs font-bold">生成后同步给谁</span>
                                <p className="text-[10px] text-[#969c93] mt-1">今日饮食会写进所选角色的私聊，角色下次聊天时也能看见。</p>
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    <button onClick={() => setState(prev => ({ ...prev, settings: { ...prev.settings, pushCharacterId: '' } }))} className={`p-2.5 rounded-xl border text-xs font-black ${!state.settings.pushCharacterId ? 'bg-[#71866e] text-white border-[#71866e]' : 'bg-white border-[#dfded5]'}`}>不同步</button>
                                    {characters.map(character => {
                                        const selected = state.settings.pushCharacterId === character.id;
                                        return <button key={character.id} onClick={() => setState(prev => ({ ...prev, settings: { ...prev.settings, pushCharacterId: character.id } }))} className={`p-2 rounded-xl border flex items-center gap-2 min-w-0 text-left ${selected ? 'bg-[#edf1e8] border-[#71866e] text-[#52664f]' : 'bg-white border-[#dfded5]'}`}>
                                            <TokenImg value={character.avatar} className="w-8 h-8 rounded-full object-cover bg-[#eef0e8] shrink-0" alt={character.name} />
                                            <span className="text-xs font-black truncate">{character.name}</span>
                                            {selected && <Check size={15} weight="bold" className="ml-auto shrink-0" />}
                                        </button>;
                                    })}
                                </div>
                            </div>
                        </section>
                        <button onClick={() => setState(prev => ({ ...prev, settings: { ...DEFAULT_MEAL_SETTINGS } }))} className="w-full py-3 text-xs text-[#8a9188]">恢复默认偏好</button>
                        <p className="text-[10px] text-center text-[#a0a39c] px-5 leading-relaxed">“吃了吗”只做日常饮食记录与热量估算，不替代医生或营养师针对疾病、孕期及进食障碍提供的建议。</p>
                    </div>
                )}
            </main>

            {showAdd && <div className="absolute inset-0 z-50 bg-black/35 flex items-end" onClick={() => setShowAdd(false)}>
                <div className="w-full max-h-[88%] overflow-y-auto rounded-t-[2rem] bg-[#fbf9f3] p-5 pb-[calc(var(--safe-bottom)+22px)]" onClick={event => event.stopPropagation()}>
                    <div className="flex items-center justify-between"><div><p className="text-[9px] tracking-[.28em] text-[#7c9078] font-bold">PUT IT IN THE FRIDGE</p><h2 className="text-xl font-black mt-1">记下现有存货</h2></div><button onClick={() => setShowAdd(false)} className="w-10 h-10 rounded-full bg-white grid place-items-center"><X size={20} /></button></div>
                    <div className="mt-5 space-y-4">
                        <label className="block"><span className="text-xs font-bold">是什么</span><input autoFocus value={draftItem.name} onChange={event => setDraftItem(prev => ({ ...prev, name: event.target.value }))} placeholder="例如：鸡蛋、剩米饭、半颗白菜" className="mt-2 w-full rounded-2xl bg-white border border-[#e6e1d4] px-4 py-3 outline-none" /></label>
                        <div><span className="text-xs font-bold">放在哪一类</span><div className="mt-2 flex flex-wrap gap-2">{CATEGORIES.map(category => <button key={category} onClick={() => setDraftItem(prev => ({ ...prev, category }))} className={`px-3 py-2 rounded-full text-xs font-bold ${draftItem.category === category ? 'bg-[#71866e] text-white' : 'bg-white border border-[#e6e1d4]'}`}>{category}</button>)}</div></div>
                        <div className="grid grid-cols-2 gap-3"><label><span className="text-xs font-bold">有多少</span><input type="number" min="0" step="0.5" value={draftItem.quantity} onChange={event => setDraftItem(prev => ({ ...prev, quantity: Number(event.target.value) }))} className="mt-2 w-full rounded-2xl bg-white border border-[#e6e1d4] px-4 py-3 outline-none" /></label><label><span className="text-xs font-bold">单位</span><input value={draftItem.unit} onChange={event => setDraftItem(prev => ({ ...prev, unit: event.target.value }))} placeholder="个 / 盒 / 克" className="mt-2 w-full rounded-2xl bg-white border border-[#e6e1d4] px-4 py-3 outline-none" /></label></div>
                        <label className="block"><span className="text-xs font-bold">大约什么时候到期（可不填）</span><input type="date" value={draftItem.expiresAt || ''} onChange={event => setDraftItem(prev => ({ ...prev, expiresAt: event.target.value }))} className="mt-2 w-full rounded-2xl bg-white border border-[#e6e1d4] px-4 py-3 outline-none" /></label>
                        <label className="block"><span className="text-xs font-bold">备注（可不填）</span><input value={draftItem.note || ''} onChange={event => setDraftItem(prev => ({ ...prev, note: event.target.value }))} placeholder="例如：已经切开、今晚最好吃掉" className="mt-2 w-full rounded-2xl bg-white border border-[#e6e1d4] px-4 py-3 outline-none" /></label>
                        <button onClick={addInventory} className="w-full py-3.5 rounded-2xl bg-[#52684f] text-white font-black flex items-center justify-center gap-2"><Check size={19} weight="bold" />放进冰箱</button>
                    </div>
                </div>
            </div>}
        </div>
    );
};

export default EatApp;
