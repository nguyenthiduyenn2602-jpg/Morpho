# QQ捏人工坊（神经链接 · 手办柜）

统一管理一只角色在三处的 Q 版形象：**小小窝**房间立绘、**彼方**chibi、**特别时光** 520 大头贴。每处可以单独捏（互不影响），也可以挑一处形象「同步到全部」。入口在 神经链接 → 角色详情 → **「手办」tab**（独立分区：迷你三格展示柜预览 `ChibiShelfPanel` + 「进入手办柜」按钮），全屏工坊 UI 走手办展示柜风（三层展台 + 射灯 + 底座）。

## 三处形象的落库位置（工坊不新增渲染路径）

| 槽位 | 消费方 | 图片存放 | 格式 |
|------|--------|----------|------|
| `room` | 小小窝 RoomApp（房间立绘） | `char.sprites['chibi']` | **blobref 令牌**（与上传路径一致，`putImageBlob`） |
| `vr` | 彼方 VRWorldApp | `char.vrState.chibi.img`（scale/offsetY/flip 保留不动） | dataURL |
| `like520` | 特别时光 520 活动 | 已通关：`char.specialMomentRecords['like520_2026'].customData.charChibi`；未通关：`char.chibiStudio.like520.img` 兜底 | dataURL |

> ⚠️ `char.sprites` 是混装袋：`chibi`（blobref 令牌）与见面情绪立绘同居一个对象。任何「从 sprites 里随便挑一张当立绘」的兜底都必须跳过 `chibi` 键和 blobref 值（不能直接当 `<img src>`），统一走 `utils/dateSprites.ts` 的 `pickDateFallbackSprite`——否则会复现「没传见面立绘的角色，捏完 Q 版后见面模式裂图」。

捏人器完整导出 state（选件 + 换色 + 翻转 + 眼型…）按槽位存 `char.chibiStudio.{room,vr,like520}.state`（`types.ts` 的 `ChibiStudioData`），再编辑时整套还原。`chibiStudio` 属运行时本地状态，已加入 `CARD_STRIPPED_FIELDS`（角色卡导出/导入双向剥离）。

## 关键文件

- `components/character/ChibiStudio.tsx` — 工坊本体（展示柜 + 单槽编辑 + 一键同步）。
- `apps/Character.tsx` — 入口按钮 + 全屏覆盖层。**注意**：详情页 `formData` 是整体 auto-save 的副本，工坊直接写库后，关闭回调里必须把最新角色数据 `setFormData` 拉回来，否则后续编辑会用旧副本盖掉工坊成果（新增外部写库的面板都要防这个）。
- `public/like520/character_creator.html` — 捏人器 iframe。`like520_init` 新增 `savedState` 字段：**草稿 > savedState > presets**（presets 只有 `selected`，savedState 连换色/翻转一起还原，见 `applyFullState`）。
- `components/Like520Event.tsx` — `CreatorIframe` 新增 `savedState` prop 透传；`isSullyChar`/`sullyPresets` 改为导出；520 活动 fresh 模式的角色捏人器会带上 `char.chibiStudio.like520.state`（工坊里捏好的造型开场直接穿上）。
- `apps/VRWorldApp.tsx` — 彼方两个 chibi 编辑器也改传 `savedState`（原来 presets 只回填选件，丢换色）。

## 安全区（iOS 顶/底约束）

全屏工坊浮层遵循项目单一来源（`index.html :root`）约定，见 `ChibiStudio.tsx` 顶部常量：

- 顶栏 `STUDIO_TOP = var(--chrome-top)`——安全区 + SullyOS 状态栏；状态栏隐藏（iOS 全屏 PWA 默认）时自动塌回 `--safe-top`。**不能只用 `--safe-top`**，否则状态栏显示时顶栏会怼进时钟/电量条。
- 底部 `--safe-bottom`（带 JS 探测兜底，iOS 全屏 PWA 原生 `env(safe-area-inset-bottom)` 偶发返回 0，别直接用它）+ 手势余量。展示柜滚动区 `STUDIO_BOTTOM`、同步弹层 `STUDIO_SHEET_BOTTOM`。

迷你预览 `ChibiShelfPanel` 渲染在角色详情 tab 内（非全屏浮层），安全区由神经链接（自理名单，见 `utils/safeAreaApps.ts`）统一处理，组件本身不再单独让位。

## 随「设置 → 导出」往返

`chibiStudio` 是 `CharacterProfile` 上的普通字段，随 `characters` store 走**整合导出（full）/ 纯文字（text_only）**。导出/导入的图片抽取（`extractImagesInPlace`）与还原（`restoreAssetsInPlace`）都是**全字段递归、无白名单**，所以：

- `chibiStudio.like520.img`（兜底大头贴 dataURL）、`vrState.chibi.img`、`specialMomentRecords…charChibi.dataUrl` 三处 dataURL 会被抽进 zip `assets/*`、导入时原样还原；
- `sprites.chibi`（blobref 令牌）由 `resolveBlobRefsDeep` 先解回 dataURL 再抽取；
- `chibiStudio.*.state`（选件 JSON，无图）随文字走，`text_only` 模式下图片被剥、但 state 仍在（可再编辑），与全局图片剥离行为一致。

**媒体与美化素材（media_only）**模式的角色只导出一份手挑的视觉子集（avatar/sprites/roomItems/backgrounds…），不含 `chibiStudio`/`vrState`/`specialMomentRecords`——与这些运行时字段既有的处理一致，官方也提示「别只导媒体包」。回归测试见 `utils/backupExport.test.ts`「角色的 chibiStudio / vrState.chibi / 520 记录里的图都会被递归抽取」。

角色**卡**分享（单角色导出）则会剥掉 `chibiStudio`（已在 `CARD_STRIPPED_FIELDS`），与 `vrState`/`specialMomentRecords` 同属运行时本地状态，不随卡外传。

## 草稿与 savedState 的关系

捏人器 iframe 用 `localStorage` 存未确认草稿（key 按 `draftKey` 隔离；工坊用 `studio_${charId}_${slot}`）。草稿优先于 savedState——用户上次捏一半退出，再进来先恢复 WIP；确认导出后草稿内容与已存 state 一致，行为无感。
