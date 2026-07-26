/**
 * 模块级 charId → 角色名 注册表 — 与 MusicContext 的播放快照同一模式。
 *
 * 动机：私聊 prompt 的群聊背景注入（chatPrompts.buildSystemPromptParts）需要把
 * 群消息的发言人标成真实角色名，但它位于 utils 层、拿不到 OSContext 的 characters
 * state，而给 buildChatRequestPayload 的所有调用方（useChatAI / 主动消息 /
 * worldHome / 彼方 …）逐一穿参代价太高。OSProvider 在 characters 变化时把
 * 名字表写到这里，utils 层按需读取。
 */

let __charNames: Record<string, string> = {};

export const setCharNameRegistry = (chars: Array<{ id: string; name: string }>): void => {
    const next: Record<string, string> = {};
    for (const c of chars) {
        if (c?.id && c?.name) next[c.id] = c.name;
    }
    __charNames = next;
};

export const getCharNameById = (id: string | undefined | null): string | null =>
    (id && __charNames[id]) || null;
