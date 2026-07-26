/**
 * 导出前的「明文密钥」体检 + 二次确认。
 *
 * 角色卡泄漏 API key 的教训后，给所有「导出 / 分享 / 生成分享码」的入口统一加一道闸：
 * 导出前深度扫描 payload，判断里面是否含明文密钥，弹二次确认，让用户在点「确定」前先看清。
 *
 * 三态（与产品文案对应）：
 *  - safe             ：没有明文密钥 → 「该导出内容安全，可以用于分享」
 *  - contains-secret  ：**预期内**含密钥（仅设置-数据备份这类整包备份）→ 「请不要发送给任何人」
 *  - unexpected-secret：**不该含密钥的分享类导出**却扫到了密钥（说明还有漏洞）→ 「请截图并发送给作者」
 *
 * 扫描逻辑刻意和 tools/card-inspector.html 保持一致：
 * 既看字段名（apiKey/secret/token/authorization/bearer/password/anonKey…），
 * 也看字段值（sk-…、Bearer …、JWT、32+ 位长哈希），未知/新增字段也能覆盖。
 */

export interface SecretHit {
  /** 命中字段的点路径，如 emotionConfig.api.apiKey */
  path: string;
  /** 打码后的值，仅露头尾几位，绝不回显完整密钥 */
  masked: string;
  /** 命中原因 */
  reason: string;
}

export type ExportSafetyLevel = 'safe' | 'contains-secret' | 'unexpected-secret';

export interface ExportSafety {
  level: ExportSafetyLevel;
  message: string;
  hits: SecretHit[];
}

const SECRET_KEY_NAME = /(api[_-]?key|secret|token|authorization|auth|bearer|password|passwd|pwd|access[_-]?key|private[_-]?key|anon[_-]?key|credential|apikey)/i;

const STRONG_SECRET_VALUE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bsk-[A-Za-z0-9_\-]{12,}/, label: 'OpenAI 风格密钥 sk-…' },
  { re: /\bBearer\s+[A-Za-z0-9._\-]{12,}/i, label: 'Bearer 令牌' },
  { re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{6,}/, label: 'JWT' },
];

const OPAQUE_SECRET_VALUE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b[A-Za-z0-9]{32,}\b/, label: '疑似长密钥 / 哈希（32+ 位）' },
];

/** 这些字段名即便值很长也别误报（正文 / 描述 / 图片 dataURL 等） */
const VALUE_WHITELIST_KEYS = /^(id|voiceId|fishReferenceId|systemPrompt|description|worldview|content|summary|memoryText|impression|avatar|src|prompt|notes|bio|title|label|text|lyrics)$/i;

/** CSS 常含 base64 图片/字体和内容哈希，不能用通用的“32+ 位字符串”规则判断。 */
const CSS_VALUE_KEY = /css$/i;

function mask(v: unknown): string {
  const s = typeof v === 'string' ? v : String(v);
  if (s.length <= 8) return '•'.repeat(s.length);
  return `${s.slice(0, 4)}••••••${s.slice(-3)} (${s.length}字)`;
}

function stripCssDataUrls(v: string): string {
  // data URL 的 base64 主体经常超过 32 位；先剥掉资源本体，再保留其余 CSS 做强特征扫描。
  return v.replace(/data:[^)"'\s]+/gi, '');
}

function looksLikeSecretValue(v: string, opts: { allowOpaque?: boolean } = {}): string | null {
  if (v.length < 12) return null;
  if (v.startsWith('data:')) return null;
  if (/^https?:\/\//.test(v) && !/[?&](key|token|secret)=/i.test(v)) return null;
  for (const p of STRONG_SECRET_VALUE_PATTERNS) if (p.re.test(v)) return p.label;
  if (opts.allowOpaque !== false) {
    for (const p of OPAQUE_SECRET_VALUE_PATTERNS) if (p.re.test(v)) return p.label;
  }
  return null;
}

/** 深度递归扫描任意对象 / 数组，返回所有疑似明文密钥命中项。 */
export function scanPlaintextSecrets(obj: unknown, path = '', hits: SecretHit[] = [], seen = new WeakSet<object>()): SecretHit[] {
  if (obj === null || typeof obj !== 'object') return hits;
  if (seen.has(obj as object)) return hits; // 防循环引用
  seen.add(obj as object);
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    const isSecretName = SECRET_KEY_NAME.test(k);
    if (isSecretName && v != null && v !== '' && typeof v !== 'object') {
      hits.push({ path: p, masked: mask(v), reason: `字段名疑似凭据（${k}）` });
    } else if (typeof v === 'string' && !VALUE_WHITELIST_KEYS.test(k)) {
      const isCssValue = CSS_VALUE_KEY.test(k);
      const valueToScan = isCssValue ? stripCssDataUrls(v) : v;
      const lbl = looksLikeSecretValue(valueToScan, { allowOpaque: !isCssValue });
      if (lbl) hits.push({ path: p, masked: mask(v), reason: `字段值疑似${lbl}` });
    }
    if (v && typeof v === 'object') scanPlaintextSecrets(v, p, hits, seen);
  }
  return hits;
}

/**
 * 评估一次导出的安全性。
 * @param data 待导出的对象（若你手上是 JSON 字符串，先 JSON.parse 再传进来）
 * @param opts.expectSecrets 该导出路径是否「本就允许含密钥」。仅设置-数据备份这类整包备份传 true。
 */
export function assessExport(data: unknown, opts: { expectSecrets?: boolean } = {}): ExportSafety {
  const hits = scanPlaintextSecrets(data);
  if (hits.length === 0) {
    return { level: 'safe', message: '该导出内容安全，可以用于分享', hits };
  }
  if (opts.expectSecrets) {
    return { level: 'contains-secret', message: '该导出数据包含了明文密钥，请不要发送给任何人', hits };
  }
  const paths = hits.map(h => `· ${h.path}`).join('\n');
  return {
    level: 'unexpected-secret',
    message: `该导出数据包含了明文密钥（不应出现）。请截图并发送给作者。\n\n检出位置：\n${paths}`,
    hits,
  };
}

/**
 * 导出前的二次确认闸门。放在每个导出函数最前面：
 *   if (!(await confirmExportSafety(payload))) return;
 *
 * 返回 true = 用户确认继续；false = 用户取消，调用方应直接 return 中止导出。
 * 默认用 window.confirm（浏览器 / Capacitor webview 均可用、阻塞、零依赖）。
 * 想接入自定义弹窗时，传 opts.confirmImpl 覆盖。
 */
export async function confirmExportSafety(
  data: unknown,
  opts: {
    expectSecrets?: boolean;
    /** 自定义确认实现：收到提示文案，返回用户是否继续。 */
    confirmImpl?: (assessment: ExportSafety) => boolean | Promise<boolean>;
  } = {},
): Promise<boolean> {
  const assessment = assessExport(data, { expectSecrets: opts.expectSecrets });

  if (opts.confirmImpl) return opts.confirmImpl(assessment);

  const c = (typeof window !== 'undefined' && typeof window.confirm === 'function')
    ? window.confirm.bind(window)
    : null;
  if (!c) return true; // 无 confirm 环境（如单测）默认放行，交由调用方另行处理

  // 三态都弹二次确认：安全给出「可分享」的安心提示，检出密钥给出对应警告。
  return c(`${assessment.message}\n\n点「确定」继续导出，「取消」中止。`);
}
