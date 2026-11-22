/**
 * 纯 Node 的 Edge TTS（免费、无需 key、无需本地 Python）。
 *
 * 协议与 edge-tts / msedge-tts 相同：连微软的 readaloud WebSocket，先发
 * speech.config，再发 SSML，收二进制音频帧直到 Path:turn.end。
 *
 * 输出格式固定为 24kHz 48kbps 单声道 mp3，与原来的 tts.py 一致。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import WebSocket from 'ws';

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const WS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
// 微软 2024 年起要求 Sec-MS-GEC 校验：用 Windows 纪元时间切片 + 令牌做 SHA256；
// 版本号必须与 edge-tts 当前用的 Edge 版本一致，否则 403。
const WIN_EPOCH_SECONDS = 11644473600;
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0];
const GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`;

function secMsGec() {
  // ticks 是 100ns 单位；量级约 1.3e17，超过 Number 的 2^53 安全整数，必须用 BigInt。
  let ticks = (BigInt(Date.now()) + 11644473600000n) * 10000n;
  ticks -= ticks % 3000000000n;
  return crypto
    .createHash('sha256')
    .update(`${ticks}${TRUSTED_TOKEN}`)
    .digest('hex')
    .toUpperCase();
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ssmlFor(text, voice, rate, pitch) {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">` +
    `<voice name="${xmlEscape(voice)}">` +
    `<prosody rate="${xmlEscape(rate)}" pitch="${xmlEscape(pitch)}">${xmlEscape(text)}</prosody>` +
    `</voice></speak>`
  );
}

function escapeHeader(value) {
  return String(value).replace(/[\r\n]/g, '');
}

/**
 * 合成一段文字到 mp3。
 * @param {string} text 要念的文字（调用方已做长度截断）
 * @param {string} outFile 输出 mp3 路径
 * @param {{voice?:string, rate?:string, pitch?:string, timeoutMs?:number}} opts
 * @returns {Promise<{ok:boolean,file:string,voice:string,bytes:number,chars:number}>}
 */
export function edgeTts(text, outFile, opts = {}) {
  const voice = String(opts.voice || 'zh-CN-XiaoyiNeural');
  const rate = String(opts.rate || '+0%');
  const pitch = String(opts.pitch || '+0Hz');
  const timeoutMs = Number(opts.timeoutMs || 60000);
  const connectionId = crypto.randomUUID().replace(/-/g, '');
  const requestId = crypto.randomUUID().replace(/-/g, '');
  const url =
    `${WS_BASE}?TrustedClientToken=${TRUSTED_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${GEC_VERSION}` +
    `&ConnectionId=${connectionId}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      if (error) {
        reject(error);
        return;
      }
      const buf = Buffer.concat(chunks);
      if (!buf.length) {
        reject(new Error('Edge TTS 没有返回音频'));
        return;
      }
      fs.writeFileSync(outFile, buf);
      resolve({ ok: true, file: outFile, voice, bytes: buf.length, chars: String(text).length });
    };

    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-WebSocket-Version': '13',
        // 微软要求带一个随机 muid cookie，否则 WS 握手 403
        Cookie: `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`,
      },
      perMessageDeflate: true,
      handshakeTimeout: Math.min(timeoutMs, 20000),
    });
    const timer = setTimeout(() => finish(new Error(`Edge TTS 超时（${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs);

    ws.on('open', () => {
      const config = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
              outputFormat: OUTPUT_FORMAT,
            },
          },
        },
      });
      ws.send(
        `X-Timestamp:${Date.now()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${config}`,
      );
      const ssml = ssmlFor(text, voice, rate, pitch);
      ws.send(
        `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${Date.now()}\r\nPath:ssml\r\n\r\n${ssml}`,
      );
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const textFrame = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        if (/Path:turn\.end/.test(textFrame)) finish();
        return;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 2) return;
      const headerLen = buf.readUInt16BE(0);
      const start = 2 + headerLen;
      if (start < buf.length) chunks.push(buf.subarray(start));
    });

    ws.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    ws.on('close', () => finish(new Error('Edge TTS 连接提前关闭（没有收到 turn.end）')));
  });
}
