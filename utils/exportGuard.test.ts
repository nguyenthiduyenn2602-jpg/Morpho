import { describe, it, expect } from 'vitest';
import { scanPlaintextSecrets, assessExport, confirmExportSafety } from './exportGuard';

describe('scanPlaintextSecrets', () => {
  it('揪出嵌套的明文 apiKey', () => {
    const hits = scanPlaintextSecrets({
      name: '角色',
      emotionConfig: { enabled: true, api: { baseUrl: 'https://x', apiKey: 'sk-ABCD1234EFGH5678IJKL', model: 'g' } },
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(h => h.path === 'emotionConfig.api.apiKey')).toBe(true);
    // 打码：不回显完整密钥
    expect(hits.every(h => !h.masked.includes('sk-ABCD1234EFGH5678IJKL'))).toBe(true);
  });

  it('按值也能揪出（字段名无辜但值像密钥）', () => {
    const hits = scanPlaintextSecrets({ note: 'my token is sk-ZZZZ9999YYYY8888XXXX ok' });
    expect(hits.some(h => h.path === 'note')).toBe(true);
  });

  it('不误报正文 / 图片 dataURL / 普通 URL', () => {
    const hits = scanPlaintextSecrets({
      systemPrompt: '这是一段很长很长的系统提示词'.repeat(10),
      avatar: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEEFFFF0000111122223333',
      baseUrl: 'https://api.example.com/v1/chat/completions',
    });
    expect(hits.length).toBe(0);
  });

  it('不把语音模型 ID 误报成明文密钥', () => {
    const hits = scanPlaintextSecrets({
      voiceProfile: {
        voiceId: 'speech-02-turbo-240501',
        fishReferenceId: '35230ec20d9bebb2215a50a5e53cf112',
      },
    });
    expect(hits).toEqual([]);
  });

  it('仍会检出未知字段里的 32 位长密钥状字符串', () => {
    const hits = scanPlaintextSecrets({
      opaqueValue: '35230ec20d9bebb2215a50a5e53cf112',
    });
    expect(hits.some(h => h.path === 'opaqueValue')).toBe(true);
  });

  it('不把 customCss 内嵌的 base64 图片或字体误报成密钥', () => {
    const hits = scanPlaintextSecrets({
      chatThemes: [{
        customCss: `
          .sully-bubble-ai {
            background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC");
          }
          @font-face {
            font-family: "demo";
            src: url(data:font/woff2;base64,d09GMgABAAAAAAG0AAoAAAAAA2AAAAAAAAAAAAAAAAAAAAAAAAAAAAA);
          }
        `,
      }],
    });
    expect(hits).toEqual([]);
  });

  it('CSS 字段仍会检出 sk/Bearer/JWT 等强密钥特征', () => {
    const hits = scanPlaintextSecrets({
      customCss: '.x::after { content: "sk-AAAA1111BBBB2222CCCC"; }',
      chromeCustomCss: '/* Authorization: Bearer abcdefghijklmnop */',
    });
    expect(hits.some(h => h.path === 'customCss')).toBe(true);
    expect(hits.some(h => h.path === 'chromeCustomCss')).toBe(true);
  });

  it('干净对象返回空', () => {
    expect(scanPlaintextSecrets({ name: 'x', worldview: 'w' })).toEqual([]);
  });

  it('循环引用不死循环', () => {
    const a: any = { name: 'x' }; a.self = a;
    expect(() => scanPlaintextSecrets(a)).not.toThrow();
  });
});

describe('assessExport', () => {
  const dirty = { emotionConfig: { api: { apiKey: 'sk-AAAA1111BBBB2222CCCC' } } };

  it('安全内容 → safe + 可分享文案', () => {
    const a = assessExport({ name: 'x' });
    expect(a.level).toBe('safe');
    expect(a.message).toBe('该导出内容安全，可以用于分享');
  });

  it('备份含密钥（预期内）→ contains-secret + 别发给任何人', () => {
    const a = assessExport(dirty, { expectSecrets: true });
    expect(a.level).toBe('contains-secret');
    expect(a.message).toBe('该导出数据包含了明文密钥，请不要发送给任何人');
  });

  it('分享类竟含密钥（不该出现）→ unexpected-secret + 截图发作者', () => {
    const a = assessExport(dirty);
    expect(a.level).toBe('unexpected-secret');
    expect(a.message).toContain('请截图并发送给作者');
    expect(a.message).toContain('emotionConfig.api.apiKey');
  });
});

describe('confirmExportSafety', () => {
  it('safe 直接放行，不打断', async () => {
    const ok = await confirmExportSafety({ name: 'x' });
    expect(ok).toBe(true);
  });

  it('检出密钥时把提示交给 confirmImpl，返回其结果', async () => {
    let seen = '';
    const ok = await confirmExportSafety(
      { api: { apiKey: 'sk-AAAA1111BBBB2222CCCC' } },
      { confirmImpl: (a) => { seen = a.message; return false; } },
    );
    expect(ok).toBe(false);
    expect(seen).toContain('请截图并发送给作者');
  });
});
