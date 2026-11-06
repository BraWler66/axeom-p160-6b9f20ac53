// Vercel serverless function: POST { lines: ["[2026-10-07 09:12] WHATSAPP from ...: text", ...] }
// -> { labels: { "<line>": { intent, reqType, confidence } } }
// Labels new messages with Jev (TypeSafe). The key stays on the server (env TYPESAFE_API_KEY).
// If the key is missing or Jev fails, it returns 503 and the page falls back to its built-in rules.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) { res.status(503).json({ error: 'Jev not configured' }); return; }
  const { systemOneBody, toLabel } = await import('./_questions.mjs');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const lines = Array.isArray(body && body.lines) ? body.lines.slice(0, 300) : [];
  const textOf = line => { const m = /^\[[^\]]+\]\s+[A-Z ]+\s+(?:from|to)\s+.+?:\s(.*)$/i.exec(line); let t = m ? m[1] : line; const tr = /Transcript:\s*"?(.*?)"?\s*$/.exec(t); return tr ? tr[1] : t; };
  const labels = {};
  let i = 0;
  async function worker() {
    while (i < lines.length) {
      const line = lines[i++];
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(systemOneBody(textOf(line))) });
        if (r.ok) { const j = await r.json(); labels[line] = toLabel(j.answers); break; }
        if (r.status !== 429 && r.status !== 529) break;
        await new Promise(s => setTimeout(s, 800 * 2 ** attempt));
      }
    }
  }
  try { await Promise.all([worker(), worker(), worker(), worker()]); res.status(200).json({ labels, model: 'jev-latest' }); }
  catch (e) { res.status(502).json({ error: String(e.message || e), labels }); }
};
