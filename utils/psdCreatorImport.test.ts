import { describe, it, expect } from 'vitest';
import { parseLayerName } from './psdCreatorImport';

describe('parseLayerName', () => {
    it('中文别名 + 空格', () => {
        expect(parseLayerName('前发 云朵刘海')).toEqual({ categoryKey: 'fronthair', name: '云朵刘海', tintable: null });
        expect(parseLayerName('耳发 长鬓发')).toEqual({ categoryKey: 'earhair', name: '长鬓发', tintable: null });
    });

    it('英文 key + 各种分隔符', () => {
        expect(parseLayerName('fronthair-cloud')).toEqual({ categoryKey: 'fronthair', name: 'cloud', tintable: null });
        expect(parseLayerName('后发1_马尾')).toEqual({ categoryKey: 'back1', name: '马尾', tintable: null });
        expect(parseLayerName('配饰·蝴蝶结')).toEqual({ categoryKey: 'decor', name: '蝴蝶结', tintable: null });
    });

    it('后发1/后发2 不被"后发"截断', () => {
        expect(parseLayerName('后发2 双马尾').categoryKey).toBe('back2');
    });

    it('刘海是前发的别名', () => {
        expect(parseLayerName('刘海 齐刘海').categoryKey).toBe('fronthair');
    });

    it('#色 / #原色 标记（含全角井号），并从名字里剥掉', () => {
        expect(parseLayerName('衣服 水手服 #色')).toEqual({ categoryKey: 'outfit', name: '水手服', tintable: true });
        expect(parseLayerName('前发 挑染刘海 ＃原色')).toEqual({ categoryKey: 'fronthair', name: '挑染刘海', tintable: false });
        expect(parseLayerName('outfit sailor #notint').tintable).toBe(false);
        expect(parseLayerName('outfit sailor #tint').tintable).toBe(true);
    });

    it('识别不出类目时整个名字保留、categoryKey 为 null', () => {
        expect(parseLayerName('随便画的一层')).toEqual({ categoryKey: null, name: '随便画的一层', tintable: null });
    });

    it('只有类目没有名字时名字回退为原始串', () => {
        expect(parseLayerName('前发')).toEqual({ categoryKey: 'fronthair', name: '前发', tintable: null });
    });

    it('hasCategory=false 时不认类目、整名保留（组内图层名走这条：类目来自组）', () => {
        expect(parseLayerName('杏眼', false)).toEqual({ categoryKey: null, name: '杏眼', tintable: null });
        // tint 标记仍会被剥出
        expect(parseLayerName('狐狸眼 #色', false)).toEqual({ categoryKey: null, name: '狐狸眼', tintable: true });
    });
});
