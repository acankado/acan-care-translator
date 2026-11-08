import { app } from '@azure/functions';

const voices = Object.freeze({
  ja: { locale: 'ja-JP', name: 'ja-JP-NanamiNeural' },
  vi: { locale: 'vi-VN', name: 'vi-VN-HoaiMyNeural' },
  my: { locale: 'my-MM', name: 'my-MM-NilarNeural' },
  id: { locale: 'id-ID', name: 'id-ID-GadisNeural' },
  tl: { locale: 'fil-PH', name: 'fil-PH-BlessicaNeural' },
  en: { locale: 'en-US', name: 'en-US-JennyNeural' }
});
function escapeXML(value) {
  return value.replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[x]));
}
app.http('tts', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'tts',
  handler: async (request, context) => {
    // Function-level authorization blocks unauthenticated calls. Never expose the function key in GitHub Pages.
    // End-user access requires a separate authenticated, rate-limited server-side gateway.
    const region = process.env.SPEECH_REGION;
    const key = process.env.SPEECH_KEY;
    if (!region || !key) return { status: 503, jsonBody: { error: 'Speech service is not configured' } };
    let data;
    try { data = await request.json(); } catch { return { status: 400, jsonBody: { error: 'Invalid JSON' } }; }
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    const voice = voices[data?.language];
    if (!text || text.length > 600 || !voice) return { status: 400, jsonBody: { error: 'Invalid text or language (max 600 characters)' } };
    const rate = data?.slow === true ? '-20%' : '0%';
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.locale}"><voice name="${voice.name}"><prosody rate="${rate}">${escapeXML(text)}</prosody></voice></speak>`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml; charset=utf-8',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'ACAN-Care-Translator-PoC'
        },
        // Encode multilingual SSML as UTF-8 bytes; fetch's ByteString handling may reject Unicode strings.
        body: Buffer.from(ssml, 'utf8'),
        signal: controller.signal
      });
      if (!response.ok) {
        context.error('Speech synthesis failed with HTTP status', response.status);
        return { status: 502, jsonBody: { error: 'Speech synthesis failed' } };
      }
      const audio = Buffer.from(await response.arrayBuffer());
      return { status: 200, body: audio, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } };
    } catch (e) {
      context.error('Speech service request failed', e?.message);
      return { status: 502, jsonBody: { error: 'Speech service unavailable' } };
    } finally { clearTimeout(timeout); }
  }
});
