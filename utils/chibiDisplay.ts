import type { CharacterProfile } from '../types';

export interface ChibiDisplay {
    img: string;
    scale: number;
    offsetY: number;
    flip: boolean;
    isFallback: boolean;
}

/** 桌面角色卡使用的立绘：当前见面皮肤 → 小小窝手办 → 头像。 */
export const getChibi = (char: CharacterProfile): ChibiDisplay => {
    const sprites = (char.activeSkinSetId && char.dateSkinSets?.find(s => s.id === char.activeSkinSetId)?.sprites)
        || char.sprites || {};
    const img = sprites.chibi || sprites.happy || sprites.normal || sprites.smile || char.avatar || '';
    return { img, scale: 1, offsetY: 0, flip: false, isFallback: !sprites.chibi };
};
