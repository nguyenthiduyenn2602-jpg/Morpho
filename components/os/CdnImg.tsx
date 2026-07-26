import React, { useMemo, useState, useEffect } from 'react';
import { assetMirrors, mirrorsForUrl } from '../../utils/assetUrl';

/**
 * <img>，但加载失败会自动切到下一个 CDN 镜像，全挂完才真的算失败（见 utils/assetUrl.ts）。
 * 专治 jsDelivr 被墙 / raw.githubusercontent 全球慢导致的「看不到图」。
 *
 * 用法二选一：
 *   · path：仓库相对路径（推荐），如 <CdnImg path="img/MOON.png" />
 *   · src ：完整素材 url（历史写死链接），会尽量反解成镜像链；认不出就退化成普通 <img>
 */
type Props = { path?: string; src?: string } & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'>;

const CdnImg: React.FC<Props> = ({ path, src, onError, ...rest }) => {
    const chain = useMemo(() => {
        if (path) return assetMirrors(path);
        if (src) return mirrorsForUrl(src);
        return [] as string[];
    }, [path, src]);

    const [idx, setIdx] = useState(0);
    useEffect(() => { setIdx(0); }, [chain[0]]); // 换图时从主源重来

    return (
        <img
            src={chain[idx] ?? undefined}
            {...rest}
            onError={(e) => {
                if (idx < chain.length - 1) setIdx(idx + 1); // 还有镜像 → 切下一个
                else onError?.(e);                            // 全挂完 → 交给调用方
            }}
        />
    );
};

export default CdnImg;
