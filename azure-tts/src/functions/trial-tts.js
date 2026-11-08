import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';
import { createHash, timingSafeEqual } from 'node:crypto';

// Public endpoint is inert unless enabled and strong invite tokens are configured.
// It NEVER accepts or exposes an Azure Speech or Functions key from the browser.
const voices = Object.freeze({
  ja: { locale: 'ja-JP', name: 'ja-JP-NanamiNeural' },
  vi: { locale: 'vi-VN', name: 'vi-VN-HoaiMyNeural' },
  my: { locale: 'my-MM', name: 'my-MM-NilarNeural' },
  id: { locale: 'id-ID', name: 'id-ID-GadisNeural' },
  tl: { locale: 'fil-PH', name: 'fil-PH-BlessicaNeural' },
  en: { locale: 'en-US', name: 'en-US-JennyNeural' }
});

const DAILY_REQUEST_LIMIT = 20;
const DAILY_CHARACTER_LIMIT = 5000;
const MIN_GAP_MS = 8000;
const MAX_TEXT_LENGTH = 400;
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const reply = (status, message, extra = {}) => ({
  status, jsonBody: { error: message, ...extra },
  headers: { 'Cache-Control': 'no-store' }
});
function xml(value) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}
function validInvite(request) {
  const incoming = request.headers.get('x-trial-code') || '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(incoming)) return null;
  const digest = hash(incoming);
  const configured = (process.env.TRIAL_TTS_TOKEN_HASHES || '').split(',').map(v => v.trim().toLowerCase()).filter(v => /^[a-f0-9]{64}$/.test(v));
  const candidate = Buffer.from(digest, 'hex');
  const found = configured.some(v => timingSafeEqual(candidate, Buffer.from(v, 'hex')));
  return found ? digest : null;
}
let tablePromise;
async function getTable() {
  if (!tablePromise) {
    tablePromise = (async () => {
      const connection = process.env.AzureWebJobsStorage;
      if (!connection) throw new Error('Storage not configured');
      const table = TableClient.fromConnectionString(connection, 'CareTtsUsage');
      await table.createTable();
      return table;
    })().catch(err => { tablePromise = null; throw err; });
  }
  return tablePromise;
}
async function reserveQuota(digest, length) {
  const table = await getTable();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10).replaceAll('-', '');
  // One separate entity per invite and UTC day; conditional write prevents parallel requests bypassing limits.
  const key = { partitionKey: digest, rowKey: today };
  for (let attempt = 0; attempt < 5; attempt++) {
    let previous;
    try {
      previous = await table.getEntity(key.partitionKey, key.rowKey);
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }
    if (previous) {
      if (Number(previous.calls) >= DAILY_REQUEST_LIMIT || Number(previous.characters) + length > DAILY_CHARACTER_LIMIT) return { denied: true, code: 429, reason: 'Daily trial allowance reached' };
      if (now - Number(previous.lastAt) < MIN_GAP_MS) return { denied: true, code: 429, reason: 'Please wait before trying again' };
    }
    const next = { ...key, calls: (Number(previous?.calls) || 0) + 1, characters: (Number(previous?.characters) || 0) + length, lastAt: now };
    try {
      if (previous) await table.updateEntity(next, 'Replace', { etag: previous.etag });
      else await table.createEntity(next);
      return { denied: false };
    } catch (err) {
      if (![409, 412].includes(err.statusCode)) throw err;
    }
  }
  return { denied: true, code: 429, reason: 'Please try again shortly' };
}

app.http('trial-tts', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'trial-tts',
  handler: async (request, context) => {
    if (process.env.TRIAL_TTS_ENABLED !== 'true') return reply(503, 'Trial audio is not enabled');
    const origin = request.headers.get('origin');
    if (origin && origin !== 'https://acankado.github.io') return reply(403, 'Origin not allowed');
    const digest = validInvite(request);
    if (!digest) return reply(401, 'Valid trial code required');
    let payload;
    try { payload = await request.json(); } catch { return reply(400, 'Invalid JSON'); }
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    const voice = Object.hasOwn(voices, payload?.language) ? voices[payload.language] : null;
    if (!voice || !text || text.length > MAX_TEXT_LENGTH) return reply(400, 'Invalid text or language (max 400 characters)');
    const region = process.env.SPEECH_REGION;
    const key = process.env.SPEECH_KEY;
    if (!region || !key || !/^[\x20-\x7e]+$/.test(key)) return reply(503, 'Speech configuration unavailable');
    try {
      const quota = await reserveQuota(digest, text.length);
      if (quota.denied) return reply(quota.code, quota.reason);
    } catch (err) {
      context.error('Trial quota storage unavailable', err?.name);
      return reply(503, 'Trial quota service unavailable');
    }
    const rate = payload?.slow === true ? '-20%' : '0%';
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.locale}"><voice name="${voice.name}"><prosody rate="${rate}">${xml(text)}</prosody></voice></speak>`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml; charset=utf-8',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'ACAN-Care-Translator-Trial'
        },
        body: Buffer.from(ssml, 'utf8'),
        signal: controller.signal
      });
      if (!response.ok) {
        context.error('Trial Speech synthesis status', response.status);
        return reply(502, 'Audio generation failed');
      }
      const audio = Buffer.from(await response.arrayBuffer());
      return { status: 200, body: audio, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } };
    } catch (err) {
      context.error('Trial Speech request exception', err?.name);
      return reply(502, 'Audio service temporarily unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
});
