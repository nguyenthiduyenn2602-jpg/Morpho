import React, { useMemo, useState } from 'react';
import { CaretLeft } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';

const BOOK_COLORS = [
    '#cfd8c5',
    '#d7c9bc',
    '#c9d4df',
    '#d8c9d7',
    '#ddd3b8',
    '#c4d8d3',
];

const HandbookApp: React.FC = () => {
    const { closeApp, characters } = useOS();
    const [openCharacterId, setOpenCharacterId] = useState<string | null>(null);

    const notebooks = useMemo(
        () => characters.map((character, index) => ({
            character,
            color: BOOK_COLORS[index % BOOK_COLORS.length],
        })),
        [characters],
    );

    const openNotebook = notebooks.find(item => item.character.id === openCharacterId) ?? null;

    if (openNotebook) {
        return (
            <div className="h-full w-full overflow-hidden bg-[#f3f1ec] text-[#45413b]">
                <header className="flex h-14 items-center gap-3 border-b border-[#dedbd4] px-4">
                    <button
                        type="button"
                        onClick={() => setOpenCharacterId(null)}
                        aria-label="返回手账本列表"
                        className="grid h-9 w-9 place-items-center rounded-full text-[#625d55] active:bg-black/5"
                    >
                        <CaretLeft size={21} weight="bold" />
                    </button>
                    <div className="min-w-0">
                        <h1 className="truncate text-[15px] font-semibold">{openNotebook.character.name}的手账</h1>
                        <p className="text-[11px] text-[#8b857b]">每天的聊天记录会写在这里</p>
                    </div>
                </header>

                <main className="h-[calc(100%-3.5rem)] overflow-y-auto px-5 py-6">
                    <div className="min-h-48 rounded-2xl bg-white/55 p-5">
                        <p className="text-sm text-[#898278]">还没有记录</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-y-auto bg-[#f3f1ec] text-[#45413b]">
            <header className="flex h-14 items-center gap-3 border-b border-[#dedbd4] px-4">
                <button
                    type="button"
                    onClick={closeApp}
                    aria-label="关闭手账本"
                    className="grid h-9 w-9 place-items-center rounded-full text-[#625d55] active:bg-black/5"
                >
                    <CaretLeft size={21} weight="bold" />
                </button>
                <div>
                    <h1 className="text-[16px] font-semibold">手账本</h1>
                    <p className="text-[11px] text-[#8b857b]">每个角色一本</p>
                </div>
            </header>

            <main className="px-5 py-6">
                {notebooks.length > 0 ? (
                    <div className="grid grid-cols-2 gap-5">
                        {notebooks.map(({ character, color }) => (
                            <button
                                key={character.id}
                                type="button"
                                onClick={() => setOpenCharacterId(character.id)}
                                className="aspect-[3/4] min-w-0 rounded-xl p-4 text-left active:scale-[0.98]"
                                style={{ backgroundColor: color }}
                            >
                                <div className="flex h-full flex-col justify-between">
                                    <div className="h-11 w-11 overflow-hidden rounded-full bg-white/45">
                                        {character.avatar ? (
                                            <img src={character.avatar} alt="" className="h-full w-full object-cover" />
                                        ) : null}
                                    </div>
                                    <div>
                                        <div className="truncate text-[15px] font-semibold text-[#45413b]">{character.name}</div>
                                        <div className="mt-1 text-[11px] text-[#6f695f]">日常手账</div>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="py-16 text-center text-sm text-[#8b857b]">
                        神经链接中还没有角色
                    </div>
                )}
            </main>
        </div>
    );
};

export default HandbookApp;
