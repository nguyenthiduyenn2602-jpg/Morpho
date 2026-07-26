import React from 'react';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { usePersonaSim, personaSimStore } from '../../utils/personaSimStore';
import { Sparkle, CaretRight } from '@phosphor-icons/react';

// 全局「人格模拟」生成指示条 —— 挂在 PhoneShell，随处可见，点击深链回到演出。
const PersonaSimIndicator: React.FC = () => {
    const sim = usePersonaSim();
    const { openApp } = useOS();

    if (sim.status !== 'loading' && sim.status !== 'ready') return null;

    const onTap = () => {
        personaSimStore.requestOpen();
        openApp(AppID.CheckPhone);
    };

    const ready = sim.status === 'ready';
    return (
        <div className="absolute top-12 left-0 w-full flex justify-center px-4 z-[65] pointer-events-none">
            <button onClick={onTap}
                className={`pointer-events-auto flex items-center gap-2.5 rounded-full active:scale-95 transition shadow-[0_8px_30px_rgba(0,0,0,0.5)] border ${ready ? 'animate-notif-pop px-5 py-3' : 'animate-fade-in px-4 py-2.5'}`}
                style={ready
                    ? { background: 'linear-gradient(120deg, rgba(184,155,255,0.97), rgba(140,110,224,0.94))', borderColor: 'rgba(184,155,255,0.5)' }
                    : { background: 'rgba(28,24,48,0.94)', borderColor: 'rgba(184,155,255,0.3)' }}>
                {ready
                    ? <Sparkle size={16} weight="fill" className="text-white" />
                    : <span className="w-3.5 h-3.5 border-2 border-[#b89bff]/40 border-t-[#b89bff] rounded-full animate-spin" />}
                <span className={`text-[12px] font-semibold ${ready ? 'text-white' : 'text-white/85'}`}>
                    {ready ? '演出已就绪 · 进入' : `演出生成中${sim.charName ? ' · ' + sim.charName : ''}`}
                </span>
                {ready && <CaretRight size={13} weight="bold" className="text-white/90" />}
            </button>
        </div>
    );
};

export default PersonaSimIndicator;
