/**
 * 鱼声 Fish Audio TTS 代理（Vercel serverless）。
 * 转发到 https://api.fish.audio/v1/tts，把二进制音频原样回传。
 * 鱼声要求每个请求带 `model` 头（s2.1-pro / s2-pro / s1）+ Authorization Bearer。
 */
const FISH_UPSTREAM = 'https://api.fish.audio/v1/tts';
const DEFAULT_MODEL = 's2.1-pro';

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,model');
}

function normalizeApiKey(raw?: string): string {
  if (!raw) return '';
  return raw.trim().replace(/^Bearer\s+/i, '').trim();
}

export default async function handler(req: any, res: any) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const incomingAuth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const envKey = typeof process.env.FISH_API_KEY === 'string' ? process.env.FISH_API_KEY : '';
    const finalApiKey = normalizeApiKey(incomingAuth) || normalizeApiKey(envKey);
    if (!finalApiKey) {
      res.status(400).json({ error: 'Missing API key. Provide Authorization or FISH_API_KEY.' });
      return;
    }

    const headerModel = typeof req.headers['model'] === 'string' ? req.headers['model'].trim() : '';
    const envModel = typeof process.env.FISH_MODEL === 'string' ? process.env.FISH_MODEL.trim() : '';
    const model = headerModel || envModel || DEFAULT_MODEL;

    const requestBody = { ...(req.body || {}) };
    const requestStartedAt = Date.now();

    console.log('[fishaudio:tts] request', {
      model,
      format: requestBody.format,
      reference_id: requestBody.reference_id,
      text_length: typeof requestBody.text === 'string' ? requestBody.text.length : 0,
    });

    const upstream = await fetch(FISH_UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finalApiKey}`,
        model,
      },
      body: JSON.stringify(requestBody),
    });

    const elapsedMs = Date.now() - requestStartedAt;
    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.log('[fishaudio:tts] error', { http_status: upstream.status, duration_ms: elapsedMs, body_preview: errText.slice(0, 200) });
      res.status(upstream.status);
      res.setHeader('Content-Type', contentType.includes('json') ? 'application/json' : 'text/plain');
      res.send(errText);
      return;
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log('[fishaudio:tts] response', { http_status: upstream.status, duration_ms: elapsedMs, bytes: buffer.length });

    res.status(200);
    res.setHeader('Content-Type', contentType);
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Proxy request failed' });
  }
}
