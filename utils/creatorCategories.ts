// 捏人器类目清单——与 character_creator.html 里 PARTS 的 key 一一对应。
// dev 面板（CharCreatorDevApp）与用户面板（CreatorPartsUploader / 手办柜）共用，避免各写一份漂移。
export interface CreatorCategory {
    key: string;
    label: string;
    /** 可多选类目（面纹 / 配饰），仅影响提示，不影响导入 */
    multi?: boolean;
}

export const CC_CATEGORIES: CreatorCategory[] = [
    { key: 'skin', label: '肤色' },
    { key: 'eyes', label: '眼睛' },
    { key: 'mouth', label: '嘴' },
    { key: 'fronthair', label: '前发' },
    { key: 'earhair', label: '耳发' },
    { key: 'back1', label: '后发1' },
    { key: 'back2', label: '后发2' },
    { key: 'outfit', label: '衣服' },
    { key: 'outer', label: '外套' },
    { key: 'facemark', label: '面纹', multi: true },
    { key: 'decor', label: '配饰', multi: true },
];

export const labelOfCategory = (key: string): string =>
    CC_CATEGORIES.find(c => c.key === key)?.label || key;
