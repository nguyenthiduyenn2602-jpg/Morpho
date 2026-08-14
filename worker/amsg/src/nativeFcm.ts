/** Capacitor 原生 FCM 通道；普通 Web Push endpoint 完整委托给既有发送器。 */

export interface NativeFcmEnv {
  FCM_PROJECT_ID?: string;
  FCM_SERVICE_ACCOUNT_EMAIL?: string;
  FCM_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}

interface PushTransport {
  sendNotification(subscription: any, payload: string): Promise<any>;
}

let accessTokenCache: { key: string; token: string; expiresAt: number } | null = null;
const utf8 = new TextEncoder();

const bytesToB64u = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const textToB64u = (value: string): string => bytesToB64u(utf8.encode(value));

const pemToPkcs8 = (raw: string): ArrayBuffer => {
  const base64 = raw.replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!base64) throw new Error('FCM_SERVICE_ACCOUNT_PRIVATE_KEY 不是有效的 PKCS#8 PEM');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
};

const requireFcmConfig = (env: NativeFcmEnv) => {
  const projectId = env.FCM_PROJECT_ID?.trim();
  const clientEmail = env.FCM_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FCM 配置不完整：需要 FCM_PROJECT_ID / FCM_SERVICE_ACCOUNT_EMAIL / FCM_SERVICE_ACCOUNT_PRIVATE_KEY');
  }
  return { projectId, clientEmail, privateKey };
};

const fetchFcmAccessToken = async (env: NativeFcmEnv): Promise<string> => {
  const config = requireFcmConfig(env);
  const cacheKey = `${config.projectId}:${config.clientEmail}`;
  if (accessTokenCache?.key === cacheKey && accessTokenCache.expiresAt > Date.now() + 60_000) {
    return accessTokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${textToB64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${textToB64u(JSON.stringify({
    iss: config.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToPkcs8(config.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8.encode(unsigned));
  const assertion = `${unsigned}.${bytesToB64u(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion,
    }),
  });
  const body = await response.json().catch(() => ({})) as {
    access_token?: string; expires_in?: number; error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(`FCM OAuth 失败 (${response.status})：${body.error_description || '没有 access_token'}`);
  }
  accessTokenCache = {
    key: cacheKey,
    token: body.access_token,
    expiresAt: Date.now() + Math.max(300, Number(body.expires_in) || 3600) * 1000,
  };
  return body.access_token;
};

export const fcmTokenFromEndpoint = (endpoint: unknown): string | null => {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('fcm:')) return null;
  return endpoint.slice(4).trim() || null;
};

/** notification 承载正文、data 承载其余 AMSG2 结构，避免正文重复两份顶穿 4KB。 */
export const buildFcmMessage = (token: string, rawPayload: string) => {
  const payload = JSON.parse(rawPayload) as Record<string, any>;
  const actualBody = String(payload.message ?? payload.body ?? '');
  const portable = { ...payload };
  delete portable.message;
  delete portable.body;
  delete portable.notification;

  const result = {
    message: {
      token,
      notification: {
        title: String(payload.contactName ?? payload.metadata?.charName ?? '主动消息'),
        body: String(payload.notification?.body ?? actualBody).trim() || '有一条新消息',
      },
      data: {
        amsgPayload: JSON.stringify(portable),
        amsgHasBody: actualBody ? '1' : '0',
      },
      android: {
        priority: 'high',
        notification: {
          channel_id: 'amsg2',
          tag: typeof payload.messageId === 'string' ? payload.messageId : undefined,
          sound: 'default',
        },
      },
    },
  };
  const bytes = utf8.encode(JSON.stringify(result)).byteLength;
  if (bytes > 4000) throw new Error(`FCM_PAYLOAD_TOO_LARGE: ${bytes} bytes（安全上限 4000）`);
  return result;
};

const sendFcmNotification = async (env: NativeFcmEnv, token: string, payload: string) => {
  const config = requireFcmConfig(env);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await fetchFcmAccessToken(env)}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(buildFcmMessage(token, payload)),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`FCM_SEND_FAILED (${response.status}): ${detail.slice(0, 500)}`);
  }
};

export const createHybridPushTransport = (
  env: NativeFcmEnv,
  webPush: PushTransport,
): PushTransport => ({
  async sendNotification(subscription: any, payload: string) {
    const token = fcmTokenFromEndpoint(subscription?.endpoint);
    if (token) return sendFcmNotification(env, token, payload);
    return webPush.sendNotification(subscription, payload);
  },
});

export const isFcmConfigured = (env: NativeFcmEnv): boolean => Boolean(
  env.FCM_PROJECT_ID?.trim()
  && env.FCM_SERVICE_ACCOUNT_EMAIL?.trim()
  && env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY?.trim(),
);

