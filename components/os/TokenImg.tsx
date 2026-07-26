import React from 'react';
import { useBlobRefUrl } from '../../utils/blobRef';

/**
 * 图片改存 Blob 后的通用渲染组件（见 utils/blobRef.ts）。
 * 把「blobref 令牌 / 旧 data: / http(s)」统一解析成可直接用的 url 再喂给 <img>，
 * 令牌解析出的 objectURL 会在卸载 / value 变化时自动回收，不泄漏。
 * 非令牌值原样透传，行为与普通 <img> 一致。
 */
const TokenImg: React.FC<{ value?: string | null } & React.ImgHTMLAttributes<HTMLImageElement>> = ({ value, ...rest }) => {
    const src = useBlobRefUrl(value ?? undefined);
    return <img src={src} {...rest} />;
};

export default TokenImg;
