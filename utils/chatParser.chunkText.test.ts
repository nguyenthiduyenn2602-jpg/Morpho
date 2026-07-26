import { describe, it, expect } from 'vitest';
import { ChatParser } from './chatParser';

// 锁住「多段 <语音> 不被 chunkText 按换行切碎」的修复。
// 背景: 外语语音字幕对齐模式 (chatPrompts voiceActingGuide, commit c2ba85e) 要求模型
//   把 <语音> 内容按空行分成好几段。chunkText 主切点是换行, 修复前会把一个多段语音块
//   拆到好几个气泡里 —— <语音> 开标签落一条、</语音> 闭标签落另一条, MessageItem 的
//   hasVoiceTag (要求开闭成对) 全部匹配失败, 于是原始 <语音 emotion="…"> 标签当纯文字
//   漏给用户看, 语音条和翻译也都不渲染 (用户报的「语音掉格式」)。
describe('chunkText: <语音> 原子块保护', () => {
  it('多段语音 (含空行) → 整块单 chunk, 开闭标签不散落', () => {
    const input = '<语音 emotion="calm">第一段。\n\n第二段。\n\n第三段。</语音>';
    const chunks = ChatParser.chunkText(input);
    expect(chunks).toEqual([
      '<语音 emotion="calm">第一段。\n\n第二段。\n\n第三段。</语音>',
    ]);
  });

  it('前置文字 + 多段语音 → 文字成一条, 语音整块成一条', () => {
    const input = '你听我说\n<语音 emotion="sad">ねえ、聞いて。\n\n大丈夫だから。</语音>';
    const chunks = ChatParser.chunkText(input);
    expect(chunks).toEqual([
      '你听我说',
      '<语音 emotion="sad">ねえ、聞いて。\n\n大丈夫だから。</语音>',
    ]);
  });

  it('语音块后还有正文 → 语音整块 + 正文各自成条', () => {
    const input = '<语音>Wait...\nare you serious?</语音>\n真的假的';
    const chunks = ChatParser.chunkText(input);
    expect(chunks).toEqual([
      '<语音>Wait...\nare you serious?</语音>',
      '真的假的',
    ]);
  });

  it('繁体 <語音> 同样受保护', () => {
    const input = '<語音 emotion="happy">今日はいい天気。\n\n散歩しよう。</語音>';
    const chunks = ChatParser.chunkText(input);
    expect(chunks).toEqual([
      '<語音 emotion="happy">今日はいい天気。\n\n散歩しよう。</語音>',
    ]);
  });

  it('无语音标签时行为不回归 (仍按换行 + CJK 空格分气泡)', () => {
    expect(ChatParser.chunkText('第一句\n第二句')).toEqual(['第一句', '第二句']);
    expect(ChatParser.chunkText('你好 世界')).toEqual(['你好', '世界']);
  });
});
