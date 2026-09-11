import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Briefcase, Camera, Check, GearSix, Image, PaperPlaneTilt, Plus, ShirtFolded, Trash, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { ActiveMsgClient } from '../utils/activeMsgClient';
import roomHome from '../assets/faraway/room-home.png';
import roomAway from '../assets/faraway/room-away.png';
import pegboard from '../assets/faraway/pegboard.jpg';
import {
    createFarawayJourney, deliverTravelCard, FARAWAY_STATE_EVENT, finishJourneyIfDue,
    loadFarawayState, saveFarawayState, shelfFor, type FarawayShelf, type FarawayState,
} from '../utils/farawayTravel';

type Panel = 'settings' | 'wardrobe' | 'bag' | 'diary' | 'photos' | 'message' | null;

const FarawayApp: React.FC = () => {
    const { closeApp, characters, userProfile, apiConfig, realtimeConfig, groups, updateCharacter, addToast } = useOS();
    const [state, setState] = useState<FarawayState>(() => finishJourneyIfDue(loadFarawayState()));
    const [panel, setPanel] = useState<Panel>(null);
    const [busy, setBusy] = useState(false);
    const [urlDraft, setUrlDraft] = useState('');
    const [itemDraft, setItemDraft] = useState('');
    const [photoPage, setPhotoPage] = useState(0);
    const [flipped, setFlipped] = useState<Record<string, boolean>>({});
    const selectedId = state.selectedCharId || characters[0]?.id || '';
    const selected = characters.find(char => char.id === selectedId);
    const activeJourney = state.journey?.status === 'away' ? state.journey : undefined;
    const displayChar = characters.find(char => char.id === activeJourney?.charId) || selected;
    const shelf = shelfFor(state, selectedId);

    const persist = (next: FarawayState) => { setState(next); saveFarawayState(next); };
    useEffect(() => {
        if (!state.selectedCharId && characters[0]) persist({ ...state, selectedCharId: characters[0].id });
    }, [characters.length]);
    useEffect(() => {
        const sync = () => setState(finishJourneyIfDue(loadFarawayState()));
        window.addEventListener(FARAWAY_STATE_EVENT, sync);
        return () => window.removeEventListener(FARAWAY_STATE_EVENT, sync);
    }, []);

    const patchShelf = (patch: Partial<FarawayShelf>) => persist({ ...state, shelves: { ...state.shelves, [selectedId]: { ...shelf, ...patch } } });

    const tryCloudMidMessage = async (journey: NonNullable<FarawayState['journey']>) => {
        const char = characters.find(item => item.id === journey.charId);
        if (!char?.activeMsg2Config?.enabled) return journey;
        const mid = journey.events.find(event => event.kind === 'mid');
        if (!mid) return journey;
        try {
            const result = await ActiveMsgClient.scheduleCharacterTask({
                char, config: char.activeMsg2Config,
                task: {
                    mode: 'prompted', firstSendTime: new Date(mid.dueAt).toISOString(), recurrenceType: 'none', expirePolicy: 'force',
                    promptHint: `你正在${journey.destination}${journey.purposeType === 'business' ? '出差' : '外出'}。结合你的人设和你与用户的关系，自然发一两句旅途消息。地点是${journey.destination}，本次目的：${journey.purpose}。不要写成景点导游词，不要解释系统设定。`,
                }, userProfile, groups, realtimeConfig, apiConfig,
            });
            const record: any = {
                taskUuid: result.uuid, clientTaskId: result.clientTaskId, mode: 'prompted', firstSendTime: result.firstSendAt,
                nextSendAt: result.nextSendAt, recurrenceType: 'none', promptHint: `来自${journey.destination}的旅途消息`, expirePolicy: 'force',
                anchorLastUserMsgAt: result.anchorMs, source: 'user', status: 'scheduled', createdAt: Date.now(),
            };
            updateCharacter(char.id, previous => ({ activeMsg2Config: { ...(previous.activeMsg2Config || { enabled: true }), tasks: [...(previous.activeMsg2Config?.tasks || []), record] } }));
            return { ...journey, events: journey.events.map(event => event.id === mid.id ? { ...event, cloudScheduled: true } : event) };
        } catch (error) {
            console.warn('[Faraway] 主动消息排程失败，保留本地补偿', error);
            return journey;
        }
    };

    const startJourney = async () => {
        if (!selected || busy) return;
        setBusy(true);
        try {
            let journey = await createFarawayJourney(selected, userProfile, apiConfig, shelf);
            const departure = journey.events.find(event => event.kind === 'departure')!;
            await deliverTravelCard(journey, departure);
            journey = { ...journey, events: journey.events.map(event => event.id === departure.id ? { ...event, deliveredAt: Date.now() } : event) };
            journey = await tryCloudMidMessage(journey);
            persist({ ...state, selectedCharId: selected.id, journey });
            setPanel(null);
            addToast(`${selected.name}已经出发了`, 'success');
        } catch (error: any) { addToast(error?.message || '旅行规划失败', 'error'); }
        finally { setBusy(false); }
    };

    const photos = useMemo(() => {
        if (activeJourney?.charId === selectedId) return [...activeJourney.photos, ...shelf.photos];
        return shelf.photos;
    }, [activeJourney, selectedId, shelf.photos]);
    const pagePhotos = photos.slice(photoPage * 4, photoPage * 4 + 4);

    const RoomButton = ({ label, icon, className, onClick }: { label: string; icon: React.ReactNode; className: string; onClick: () => void }) => (
        <button aria-label={label} onClick={onClick} className={`absolute z-10 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-[#171311]/82 text-white shadow-xl backdrop-blur-md active:scale-95 ${className}`}>{icon}</button>
    );

    return (
        <div className="relative h-full w-full overflow-hidden bg-[#171310] text-white" style={{ paddingTop: 'var(--chrome-top, var(--safe-top))' }}>
            <img src={activeJourney ? roomAway : roomHome} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/45" />
            <button onClick={closeApp} className="absolute left-5 top-[calc(var(--chrome-top,0px)+18px)] z-20 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/35 backdrop-blur"><ArrowLeft size={22} /></button>
            <button onClick={() => setPanel('settings')} className="absolute right-5 top-[calc(var(--chrome-top,0px)+18px)] z-20 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/35 backdrop-blur"><GearSix size={21} /></button>
            <div className="absolute left-6 top-[calc(var(--chrome-top,0px)+74px)] z-10">
                <div className="text-[10px] tracking-[.34em] text-white/65">MORPHO · ELSEWHERE</div>
                <div className="mt-1 font-serif text-3xl font-semibold">走了没</div>
                {displayChar && <div className="mt-4 inline-flex items-center gap-3 rounded-2xl border border-white/15 bg-black/45 px-3 py-2 backdrop-blur"><img src={displayChar.avatar} className="h-9 w-9 rounded-full object-cover" /><div><b className="text-sm">{displayChar.name}</b><div className="text-[10px] text-white/65">{activeJourney ? `外出中 · ${activeJourney.destination}` : '房间安静着'}</div></div></div>}
            </div>

            <RoomButton label="照片与明信片" icon={<Camera size={17} />} className="right-[17%] top-[29%]" onClick={() => setPanel('photos')} />
            {!activeJourney && <>
                <RoomButton label="见闻记录" icon={<BookOpen size={17} />} className="left-[42%] top-[43%]" onClick={() => setPanel('diary')} />
                <RoomButton label="行装衣橱" icon={<ShirtFolded size={18} />} className="right-[5%] top-[50%]" onClick={() => setPanel('wardrobe')} />
                <RoomButton label="随身物品" icon={<Briefcase size={18} />} className="right-[5%] top-[58%]" onClick={() => setPanel('bag')} />
            </>}
            {activeJourney && <RoomButton label="出发消息" icon={<PaperPlaneTilt size={18} />} className="left-[42%] top-[43%]" onClick={() => setPanel('message')} />}
            <div className="absolute bottom-[calc(var(--safe-bottom,0px)+20px)] left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 text-xs text-white/80 backdrop-blur">{activeJourney ? '房间空着，信会从远方送来' : '点一点房间里的物件'}</div>

            {panel && <div className="absolute inset-0 z-30 flex items-end bg-black/40 backdrop-blur-[2px]" onClick={() => setPanel(null)}>
                <div className="max-h-[82%] w-full overflow-y-auto rounded-t-[30px] bg-[#f4efe7] px-5 pb-[calc(var(--safe-bottom,0px)+22px)] pt-4 text-[#28231f]" onClick={event => event.stopPropagation()}>
                    <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#c9bbae]" />
                    <button onClick={() => setPanel(null)} className="absolute right-5 mt-0 grid h-9 w-9 place-items-center rounded-full bg-white"><X size={18} /></button>
                    {panel === 'settings' && <section>
                        <div className="text-[10px] tracking-[.28em] text-[#8a6f5b]">JOURNEY SETTINGS</div><h2 className="mt-1 text-2xl font-bold">让谁出去走走</h2>
                        <p className="mt-2 text-xs leading-relaxed text-[#7b716a]">角色会按人设选择国内目的地：近郊短行 1–2 天，跨省远行 3–5 天；有工作设定且符合年龄的角色，也可能临时出差。</p>
                        <div className="mt-5 space-y-2">{characters.map(char => <button key={char.id} onClick={() => persist({ ...state, selectedCharId: char.id })} className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${selectedId === char.id ? 'border-[#9a705b] bg-[#eaded3]' : 'border-[#ded2c7] bg-white/70'}`}><img src={char.avatar} className="h-11 w-11 rounded-full object-cover" /><span className="flex-1 font-bold">{char.name}</span>{selectedId === char.id && <Check />}</button>)}</div>
                        <button disabled={!selected || busy || !!activeJourney} onClick={startJourney} className="mt-5 w-full rounded-2xl bg-[#211c19] py-4 font-bold text-white disabled:opacity-40">{busy ? '正在整理行程…' : activeJourney ? `${activeJourney.charName}还在外出中` : '开始一次外出'}</button>
                    </section>}
                    {panel === 'wardrobe' && <section><h2 className="text-2xl font-bold">行装衣橱</h2><p className="mt-1 text-xs text-[#8a7d72]">保存图片 URL，之后会作为角色出门穿着的参考。</p><div className="mt-4 flex gap-2"><input value={urlDraft} onChange={e => setUrlDraft(e.target.value)} placeholder="https://…" className="min-w-0 flex-1 rounded-xl border border-[#d9ccc0] bg-white px-3 py-3 text-sm"/><button onClick={() => { const url = urlDraft.trim(); if (url) { patchShelf({ wardrobeUrls: [url, ...shelf.wardrobeUrls].slice(0, 12) }); setUrlDraft(''); } }} className="rounded-xl bg-[#28211d] px-4 text-white"><Plus /></button></div><div className="mt-4 grid grid-cols-2 gap-3">{shelf.wardrobeUrls.map(url => <div key={url} className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-[#ddd]"><img src={url} className="h-full w-full object-cover"/><button onClick={() => patchShelf({ wardrobeUrls: shelf.wardrobeUrls.filter(item => item !== url) })} className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white"><Trash size={14}/></button></div>)}</div></section>}
                    {panel === 'bag' && <section><h2 className="text-2xl font-bold">每次都会带上</h2><div className="mt-4 flex gap-2"><input value={itemDraft} onChange={e => setItemDraft(e.target.value)} placeholder="写一件随身物品" className="min-w-0 flex-1 rounded-xl border border-[#d9ccc0] bg-white px-3 py-3 text-sm"/><button onClick={() => { const item = itemDraft.trim(); if (item) { patchShelf({ carryItems: [...new Set([...shelf.carryItems, item])] }); setItemDraft(''); } }} className="rounded-xl bg-[#28211d] px-4 text-white"><Plus /></button></div><div className="mt-5 flex flex-wrap gap-2">{shelf.carryItems.map(item => <button key={item} onClick={() => patchShelf({ carryItems: shelf.carryItems.filter(value => value !== item) })} className="rounded-full border border-[#cfbeb0] bg-white px-4 py-2 text-sm">{item} ×</button>)}</div></section>}
                    {panel === 'diary' && <section><div className="text-[10px] tracking-[.28em] text-[#8a6f5b]">TRAVEL NOTES</div><h2 className="mt-1 text-2xl font-bold">见闻记录</h2><div className="mt-5 space-y-5">{shelf.diaries.length ? shelf.diaries.map(note => <article key={note.id} className="rounded-2xl border border-[#d8cabd] bg-[#fffdf9] p-5 shadow-sm"><time className="text-[10px] tracking-widest text-[#9c806b]">{note.date}</time><h3 className="mt-2 font-serif text-xl font-bold">{note.title}</h3><p className="mt-3 whitespace-pre-wrap font-serif text-sm leading-7 text-[#514840]">{note.body}</p></article>) : <p className="py-16 text-center text-sm text-[#9c9188]">等一次旅行回来，这里就会多一页。</p>}</div></section>}
                    {panel === 'photos' && <section><div className="flex items-end justify-between"><div><div className="text-[10px] tracking-[.28em] text-[#8a6f5b]">PHOTO WALL</div><h2 className="mt-1 text-2xl font-bold">照片与明信片</h2></div><span className="text-[10px] text-[#887b70]">轻触翻面 · 左滑翻页</span></div><div className="relative mt-5 min-h-[520px] overflow-hidden rounded-[24px] bg-[#181716] bg-cover p-5" style={{ backgroundImage: `url(${pegboard})` }} onTouchEnd={event => { const x = event.changedTouches[0]?.clientX || 0; const start = Number((event.currentTarget as any).dataset.startX || x); if (start - x > 45) setPhotoPage(value => Math.min(Math.max(0, Math.ceil(photos.length / 4) - 1), value + 1)); if (x - start > 45) setPhotoPage(value => Math.max(0, value - 1)); }} onTouchStart={event => { (event.currentTarget as any).dataset.startX = String(event.touches[0]?.clientX || 0); }}>{pagePhotos.length ? <div className="grid grid-cols-2 gap-4">{pagePhotos.map((photo, index) => <button key={photo.id} onClick={() => setFlipped(prev => ({ ...prev, [photo.id]: !prev[photo.id] }))} className="relative min-h-48 bg-[#eee7da] p-3 text-left shadow-xl" style={{ transform: `rotate(${index % 2 ? 2 : -2}deg)` }}><span className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full bg-[#24201d] shadow"/><p className="font-serif text-sm leading-6 text-[#3b332d]">{flipped[photo.id] ? photo.back : photo.front}</p><span className="absolute bottom-2 right-3 text-[9px] text-[#907b6b]">{flipped[photo.id] ? '背面' : '正面'}</span></button>)}</div> : <p className="pt-48 text-center text-sm text-white/60">照片墙还空着</p>}<div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1">{Array.from({ length: Math.max(1, Math.ceil(photos.length / 4)) }).map((_, i) => <span key={i} className={`h-1.5 rounded-full ${i === photoPage ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`}/>)}</div></div></section>}
                    {panel === 'message' && activeJourney && <section><div className="text-[10px] tracking-[.28em] text-[#8a6f5b]">DEPARTURE NOTE</div><h2 className="mt-1 text-2xl font-bold">{activeJourney.destination}</h2><div className="mt-5 rounded-2xl border border-[#d8cabd] bg-white/75 p-5"><div className="text-xs text-[#8e7969]">这次去做什么</div><p className="mt-1 font-bold">{activeJourney.purpose}</p><div className="mt-5 text-xs text-[#8e7969]">带了什么</div><div className="mt-2 flex flex-wrap gap-2">{activeJourney.packItems.map(item => <span key={item} className="rounded-full bg-[#eee4db] px-3 py-1.5 text-xs">{item}</span>)}</div><p className="mt-5 border-t border-dashed border-[#d8cabd] pt-4 font-serif text-sm leading-6">{activeJourney.summary}</p></div></section>}
                </div>
            </div>}
        </div>
    );
};

export default FarawayApp;
