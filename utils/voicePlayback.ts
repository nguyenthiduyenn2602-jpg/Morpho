/**
 * 聊天语音条：什么时候合成、合成完要不要立刻响。
 *
 * 一句话版本：角色开了「收到就自动播放」，AI 的语音消息才会自己合成并响；
 * 没开就只留一条空语音条，用户点了才合成，合成完直接播。
 */

/**
 * AI 消息到达后要不要顺手把语音合成出来。
 *
 * 只认「收到就自动播放」这一个开关：没开的话合出来也不会响，等于替用户白花一次 TTS 调用
 * （还占着额度和时间）。空语音条照常显示，想听点一下就合成——那条路走的是下面的手动分支，
 * 合完立刻播，体验上只多等一次合成。
 */
export function shouldAutoGenerateVoice(opts: {
  /** 角色的「收到就自动播放」开关，未设置视作关 */
  autoPlayEnabled?: boolean;
}): boolean {
  return !!opts.autoPlayEnabled;
}

/**
 * 语音合成完要不要立刻响。两条规则各有来由，别合并简化：
 *  - AI 自动发来的语音，跟着「收到就自动播放」走（也只有开了这个开关才会自动合成）。
 *  - 用户主动要的语音（长按「转换语音」、点还没合成的空语音条），无论开关怎么设都播——
 *    他点这一下的意思就是「我现在要听」，还要再点一次播放属于白跑一趟。
 */
export function shouldAutoPlayGeneratedVoice(opts: {
  /** 这次合成是 AI 消息到达后自动触发的（false = 用户主动点的） */
  autoTriggered: boolean;
  /** 角色的「收到就自动播放」开关，未设置视作关 */
  autoPlayEnabled?: boolean;
}): boolean {
  if (!opts.autoTriggered) return true;
  return !!opts.autoPlayEnabled;
}
