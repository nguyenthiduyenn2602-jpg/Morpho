/**
 * 删角色时的云端善后：把 ta 在 worker D1 `client_state` 里的那份数据清掉。
 *
 * 云端存的不是元数据，是**完整的角色系统提示词 + 最近 30 条对话原文**（fire_pack，
 * 实测一个角色 32KB 起步），旁边还有 tool_pack、活跃会话租约、以及 push 装不下时
 * 旁路存的小红书会话。删除确认框跟用户说的是「该操作不可恢复，记忆将被清空」，
 * 用户按下确认那一刻的预期就包含云端那份；留着既对不上这句承诺，也让每删一个角色
 * 就在 D1 里堆一份聊天记录。设置页那个「清除云端状态」是全局按钮、要用户主动去点，
 * 指望不上它替删角色收尾。
 *
 * 这一步是 best-effort：断网、worker 挂了都不该拦着角色删掉（用户想删的是这个角色，
 * 而且今天删不掉明天还是删不掉）。所以异常在这里就地吞掉、用返回值把结果交给调用方，
 * 调用方照常删本地记录，只是多弹一条提示。
 */

import { CharacterProfile } from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { charCredIds, forgetCredIds } from './amsgLlmCredentials';

export type CharCloudStateCleanup =
  /** 没有云端可清（角色不存在，或压根没填 worker 地址）—— 一个请求都没发。 */
  | { status: 'skipped' }
  /** 清完了；keys 是实际被清空的条目（本来就空的角色是空数组）。 */
  | { status: 'cleared'; keys: string[] }
  /** 没清成（断网 / worker 挂了 / 没填 worker 地址）。角色照删，调用方负责提示。 */
  | { status: 'failed'; error: unknown };

/**
 * 判断这个角色云端有没有可能留着东西。
 *
 * 只要角色存在就当「可能有」：往云端写状态的路不止面板那几条——全局即时对话开着时，
 * **从没打开过 2.0 面板的角色**（activeMsg2Config 缺失，只是跟随全局默认开）每轮聊天
 * 也在经 POST /instant-chat 往 client_state 写完整对话和提示词（worker 侧还会写
 * chat_outbox / chat_fail）。按「配没配过」猜写没写过，猜漏一条路聊天原文就永久留在
 * D1 里。清理是幂等操作、成本一次网络请求，宁可多发不可漏，所以这里不做任何按角色的
 * capability 预检；真正的门只有一道——「压根没配 worker 连接」，那一道由调用方
 * （purgeCharCloudState、deleteCharacter 的前置检查）读全局配置来把。
 */
export const charMayHaveCloudState = (char: CharacterProfile | undefined): boolean =>
  Boolean(char);

/**
 * 清掉该角色的云端 client_state。永远不抛错（见文件头：不能阻塞角色删除）。
 *
 * 发请求之前先确认真有个 worker 可发。没填地址时云端一个字节都没写过，
 * 那不是「清理失败」，跳过就好——报成失败会让用户对着一条根本不存在的残留发愁。
 * 这也是唯一的一道门：只要 worker 配置在，就不再按角色猜「写没写过」，清一次是幂等的。
 *
 * 判断放在发请求之前、而不是靠 catch 里认错误文案：错误文案改一次这里就失效了。
 */
export const purgeCharCloudState = async (
  char: CharacterProfile | undefined,
): Promise<CharCloudStateCleanup> => {
  if (!charMayHaveCloudState(char)) return { status: 'skipped' };

  try {
    const globalConfig = await ActiveMsgStore.getGlobalConfig();
    if (!globalConfig.workerUrl?.trim()) return { status: 'skipped' };
  } catch {
    // 连本地配置都读不到，等于无从判断有没有云端；按没有处理，别为它弹错误。
    return { status: 'skipped' };
  }

  // 这个角色名下登记的 API 凭据行也一起清掉：角色都没了，那几行再留着只是白占
  // 云端的行数上限。跟 client_state 各清各的——凭据没清成不该让上下文也留在云端。
  // 失败只 warn：删角色的路上一个附带清理拦不住主线（下次同名 credId 覆盖即可）。
  try {
    await ActiveMsgClient.deleteLlmCredentials({ credIds: charCredIds(char!.id) });
  } catch (error) {
    console.warn('[Amsg2CharCleanup] 删角色时清云端 API 凭据失败（不影响删除）', error);
    // 本地那本指纹底账照划：角色都没了，留着几条死账只会一直占 localStorage，
    // 后台重传也会一遍遍去查一个不存在的角色。
    forgetCredIds(charCredIds(char!.id));
  }

  try {
    const keys = await ActiveMsgClient.clearCharClientState(char!.id);
    return { status: 'cleared', keys };
  } catch (error) {
    return { status: 'failed', error };
  }
};
