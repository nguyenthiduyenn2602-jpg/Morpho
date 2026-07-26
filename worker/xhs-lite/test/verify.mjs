/**
 * Verifies the XHS signing EMBEDDED in worker/index.js (the deployed worker,
 * https://sullymeow.ccwu.cc) is byte-identical to the Python xhshow reference
 * (test/vectors.json), using the same deterministic RNG.
 *
 *   PYTHONPATH=/tmp/xhshow/src python3 oracle.py > vectors.json
 *   node verify.mjs
 */
import { readFileSync } from 'fs';
import { __xhsLiteTest } from '../../index.js';

const { RNG, signXs, signXyw, signXsCommon, generateB1, xRapParam, _internals } = __xhsLiteTest;

// deterministic: mirror oracle.py (random.randint(a,b) -> a)
RNG.randint = (a) => a;

const A1 = '198abcdef0123456789deadbeef0011223344556677';
const FIXED_TS = 1764896636.081;

const fp = {};
for (let i = 1; i < 90; i++) fp['x' + i] = '0';
Object.assign(fp, {
  x33: '0', x34: '1', x35: '2', x36: '3', x37: 'a|b|c', x38: 'd|e',
  x39: 0, x42: '3.4.4', x43: 'deadbeefcafebabe', x44: '1764896636081',
  x45: '__SEC__', x46: 'false', x48: '', x49: '{list:[],type:}',
  x50: '', x51: '', x52: '', x82: '_0x17a2|_0x1954',
});

const got = {
  xs_get_feed: signXs('GET', '/api/sns/web/v1/feed', A1, { payload: { num: '30', image_formats: 'jpg,webp,avif' }, timestampSec: FIXED_TS }),
  xs_get_noparams: signXs('GET', '/api/sns/web/v2/user/me', A1, { payload: null, timestampSec: FIXED_TS }),
  xs_post_homefeed: signXs('POST', '/api/sns/web/v1/homefeed', A1, { payload: { cursor_score: '', num: 20, refresh_type: 1, note_index: 0, category: 'homefeed_recommend' }, timestampSec: FIXED_TS }),
  xs_post_comment: signXs('POST', '/api/sns/web/v1/comment/post', A1, { payload: { note_id: 'abc123', content: '你好世界 hello', at_users: [] }, timestampSec: FIXED_TS }),
  encode_ascii: _internals.encodeCustomStr('hello world 123'),
  encode_unicode: _internals.encodeCustomStr('{"x5":"你好","x8":"a/b+c="}'),
  crc32_hello: _internals.crc32JsInt('hello world'),
  crc32_unicode: _internals.crc32JsInt('你好abc'),
  b1_fixed_fp: generateB1(fp),
  xscommon_fixed: signXsCommon({ a1: A1, web_session: '040069xyz' }, fp),
};

const xywCommentParams = {
  note_id: 'abc123',
  cursor: '',
  top_comment_id: '',
  image_formats: 'jpg,webp,avif',
  xsec_token: 'token',
};
const expectedXywComments = 'XYW_eyJzaWduU3ZuIjoiNTYiLCJzaWduVHlwZSI6IngyIiwiYXBwSWQiOiJ4aHMtcGMtd2ViIiwic2lnblZlcnNpb24iOiIxIiwicGF5bG9hZCI6IjBmZmJhMjA4MDg1YmY1NTVjYTZmNjAzNjYxZGI1NzBmM2QwY2NmYzY1ZTYyYzJiYzEyNWNlMmYyODMzYzU4Y2ViMjRhY2NmMWVmOGEzNTE4NTMxOWU1OTdhZGQ0ZTExYTIyODdlMjk0NTlmNTU3MzRkYzk4MWVkMmNkMDY3MGY4MTliN2NlZWFkMjM3MGVmYzU2NWVkYzIwZjI5YmJmMWM1Mzg3YzI3M2Y3ZDE3NWMyOGVhMWIyZWU5OTMyNzA1M2RjMjliNTRhNzA2YjFlNzYyMGRiMmUxNDJjY2Q5NmMwNjdmZmFjYzhmOTE4ZjEzNGQ0ZWVjOGU2ZTM2MTY0YjJjYzkxMTU0MzdkZDIxMTRhODEzMjQ2OTQwZTI5ZGI4MzBlN2Y5YjI0YTNhOWNkMDlmNDk1MWY5OGYxZjUxZTliYzJhYjA0NDEyZTMzMzVhYWEyNjdmMDI3ZTY4ZGRjYTFmMzRkZGVhYjUyNjZjNjA0YjEwYTZiYmM5ZWYyMjI0ZTM5M2U0NmU5NDdjMGQ1YTllOTliNzhhZjk3YTg5MzM0In0=';
got.xyw_get_comments = await signXyw(
  'GET',
  '/api/sns/web/v2/comment/page',
  'a'.repeat(52),
  { payload: xywCommentParams, timestampSec: FIXED_TS },
);
got.xrap_block_pair = Array.from(
  _internals.xrapEncryptBlock(Uint8Array.from(Buffer.from('68ea78695e744b016d7a53a43a246167', 'hex'))),
  byte => byte.toString(16).padStart(2, '0'),
).join('');
got.xxh32_empty = _internals.xrapXxh32(new Uint8Array()).toString(16).padStart(8, '0');
got.xxh32_hello = _internals.xrapXxh32(new TextEncoder().encode('hello')).toString(16).padStart(8, '0');
got.xrap_homefeed = await xRapParam(
  '//edith.xiaohongshu.com/api/sns/web/v1/homefeed',
  '{"a":1}',
  {
    aesKey: 'wapilabkmyv4wl46',
    randomString: 'mdzz94',
    innerKey: 'h9w3tl5em3w4t67c',
    timestampMs: 0x0000019EB07ACDB2,
    gzipMtime: 0x6A291532,
    bodyEncryptTime: 69,
    bodyRand32: 0xF95AD1C7,
    mask: 0x65,
  },
);
const xrapPacket = Buffer.from(got.xrap_homefeed, 'base64');
got.xrap_packet_shape = (
  xrapPacket.subarray(0, 4).toString('hex') === '07240106' &&
  xrapPacket.readUInt32BE(4) === 1 &&
  xrapPacket.readUInt32BE(8) === 20 &&
  xrapPacket.subarray(36, 42).toString('ascii') === 'mdzz94'
);
delete got.xrap_homefeed;

const vectors = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url)));
vectors.push({ name: 'xyw_get_comments', value: expectedXywComments });
vectors.push({ name: 'xrap_block_pair', value: 'd827df1c42d55ec61c0aec7d534fd817' });
vectors.push({ name: 'xxh32_empty', value: '02cc5d05' });
vectors.push({ name: 'xxh32_hello', value: 'fb0077f9' });
vectors.push({ name: 'xrap_packet_shape', value: true });
let pass = 0, fail = 0;
for (const { name, value } of vectors) {
  const mine = got[name];
  if (mine === undefined) { console.log(`?? ${name}: no JS counterpart`); continue; }
  const ok = String(mine) === String(value);
  if (ok) { pass++; console.log(`OK  ${name}`); }
  else { fail++; console.log(`XX  ${name}`); console.log(`    py: ${value}`); console.log(`    js: ${mine}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
