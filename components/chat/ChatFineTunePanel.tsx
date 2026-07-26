import React from 'react';
import { ChatFineTuneFields } from '../../types';

/**
 * 聊天细节微调控件组（7 个字段：头像显隐/贴边/对齐/垂直微调、字号、行距、气泡缩进）。
 * 两处复用，交互保持一致（挡位按钮 + 滑杆）：
 *  - 外观 App「聊天细节微调」区块（全局，value = osTheme）
 *  - 聊天内「聊天装扮」弹窗（角色覆盖，value = 合并后的生效值，onChange 写进 char.chatFineTune）
 * 只渲染控件本身，区块外壳 / 开关 / 说明文案由调用方决定。
 */
type Props = {
    value: ChatFineTuneFields;
    onChange: (patch: Partial<ChatFineTuneFields>) => void;
};

const OptionButton: React.FC<{ active: boolean; label: string; desc?: string; onClick: () => void }> = ({ active, label, desc, onClick }) => (
    <button onClick={onClick}
        className={`px-3 py-2 text-[11px] font-bold rounded-xl border transition-all active:scale-95 ${active ? 'bg-primary/10 text-primary border-primary/30 ring-1 ring-primary/20' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
        <div>{label}</div>
        {desc && <div className="text-[9px] font-normal mt-0.5 opacity-70">{desc}</div>}
    </button>
);

export const ChatFineTunePanel: React.FC<Props> = ({ value, onChange }) => {
    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-[11px] font-bold text-slate-500 mb-2">头像显示</h3>
                <div className="flex gap-2 flex-wrap">
                    {([['both', '全部显示'], ['hide_ai', '隐藏角色侧'], ['hide_user', '隐藏我的'], ['hide_both', '全部隐藏']] as const).map(([v, label]) => (
                        <OptionButton key={v} active={(value.chatAvatarVisibility || 'both') === v} label={label} onClick={() => onChange({ chatAvatarVisibility: v })} />
                    ))}
                </div>
                {(value.chatAvatarVisibility || 'both') !== 'both' && (
                    <label className="flex items-center gap-2 mt-2 text-[11px] text-slate-500">
                        <input type="checkbox" checked={!!value.chatSnapToEdge} onChange={(e) => onChange({ chatSnapToEdge: e.target.checked })} className="accent-current" />
                        隐藏的一侧气泡贴边（收回头像空位）
                    </label>
                )}
            </div>
            <div>
                <h3 className="text-[11px] font-bold text-slate-500 mb-2">头像对齐气泡</h3>
                <div className="flex gap-2 flex-wrap">
                    {([['bottom', '底部（默认）'], ['top', '顶部'], ['center', '垂直居中']] as const).map(([v, label]) => (
                        <OptionButton key={v} active={(value.chatAvatarAlign || 'bottom') === v} label={label} onClick={() => onChange({ chatAvatarAlign: v })} />
                    ))}
                </div>
                <div className="flex items-center gap-3 mt-2">
                    <span className="text-[11px] text-slate-500 shrink-0">垂直微调</span>
                    <input type="range" min={-16} max={16} step={2} value={value.chatAvatarOffsetY || 0}
                        onChange={(e) => onChange({ chatAvatarOffsetY: Number(e.target.value) })} className="flex-1 accent-current" />
                    <span className="text-[11px] font-mono text-slate-500 w-10 text-right">{value.chatAvatarOffsetY || 0}px</span>
                </div>
            </div>
            <div>
                <h3 className="text-[11px] font-bold text-slate-500 mb-2">气泡正文字号</h3>
                <div className="flex gap-2 flex-wrap">
                    <OptionButton active={!value.chatBubbleFontSize} label="默认" onClick={() => onChange({ chatBubbleFontSize: 0 })} />
                    {[12, 13, 14, 15, 16].map(v => (
                        <OptionButton key={v} active={value.chatBubbleFontSize === v} label={`${v}px`} onClick={() => onChange({ chatBubbleFontSize: v })} />
                    ))}
                </div>
            </div>
            <div>
                <h3 className="text-[11px] font-bold text-slate-500 mb-2">气泡正文行距</h3>
                <div className="flex gap-2 flex-wrap">
                    <OptionButton active={!value.chatBubbleLineHeight} label="默认" onClick={() => onChange({ chatBubbleLineHeight: 0 })} />
                    {[1.2, 1.35, 1.5, 1.7].map(v => (
                        <OptionButton key={v} active={value.chatBubbleLineHeight === v} label={String(v)} onClick={() => onChange({ chatBubbleLineHeight: v })} />
                    ))}
                </div>
            </div>
            <div>
                <h3 className="text-[11px] font-bold text-slate-500 mb-2">气泡与头像间距</h3>
                <div className="flex gap-2 flex-wrap">
                    <OptionButton active={!value.chatBubbleIndent} label="默认 (48px)" onClick={() => onChange({ chatBubbleIndent: 0 })} />
                    {[28, 60, 72].map(v => (
                        <OptionButton key={v} active={value.chatBubbleIndent === v} label={`${v}px`} onClick={() => onChange({ chatBubbleIndent: v })} />
                    ))}
                </div>
            </div>
            <div>
                <h3 className="text-[11px] font-bold text-slate-500 mb-2">HTML / 心象 / 音乐卡片位置</h3>
                <div className="flex gap-2 flex-wrap">
                    <OptionButton active={(value.chatModuleAlign || 'center') === 'center'} label="水平居中（默认）" desc="卡片类内容居中显示" onClick={() => onChange({ chatModuleAlign: 'center' })} />
                    <OptionButton active={value.chatModuleAlign === 'anchor'} label="贴气泡列" desc="跟气泡同侧，旧版观感" onClick={() => onChange({ chatModuleAlign: 'anchor' })} />
                </div>
                <p className="mt-1.5 text-[10px] text-slate-400">角色发的 HTML 卡片、心象（思考链）卡片和音乐（一起听）卡片的横向位置。预览里看不到卡片，进聊天看效果。</p>
            </div>
        </div>
    );
};

export default ChatFineTunePanel;
