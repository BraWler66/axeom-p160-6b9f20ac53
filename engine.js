/* Axeom engine: turns the raw pack files into one connected picture.
 * Runs in the browser (window.AxeomEngine) and in Node (module.exports).
 * Input: { "leads.csv": text, "bookings.csv": text, ... , "messages.txt": text }
 * Output: { today, clients, entities, invoices, bookings, payments, videos, messages, findings, actions }
 */
(function (root) {
  'use strict';

  // ---------- small utils ----------
  const DAY = 86400000;
  const FREE_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'me.com', 'proton.me', 'protonmail.com']);
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  function parseCSV(text) {
    text = (text || '').replace(/^﻿/, '');
    const rows = []; let row = []; let f = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = [];
      } else f += c;
    }
    row.push(f); if (row.some(x => x.trim() !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim().toLowerCase());
    return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => o[h] = (r[i] || '').trim()); return o; });
  }

  function money(v) {
    if (v == null) return 0;
    const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }
  function normEmail(e) { return (e || '').trim().toLowerCase(); }
  function normPhone(p) { const d = (p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
  function iso(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }
  function utc(y, m, d) { return Date.UTC(y, m - 1, d); }
  function daysBetween(a, b) { return Math.round((b - a) / DAY); }
  function dn(n) { return n + (n === 1 ? " day" : " days"); }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtDate(t) { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }

  // Slash dates are ambiguous (bookings are MM/DD, the bank is DD/MM). Detect per column.
  function slashOrder(values, fallback) {
    let dmy = false, mdy = false;
    values.forEach(v => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v || ''); if (!m) return; if (+m[1] > 12) dmy = true; if (+m[2] > 12) mdy = true; });
    if (dmy && !mdy) return 'dmy'; if (mdy && !dmy) return 'mdy'; return fallback;
  }
  function parseDate(v, order) {
    v = (v || '').trim(); if (!v) return null;
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(v);
    if (m) return utc(+m[1], +m[2], +m[3]) + (m[4] ? (+m[4] * 3600 + +m[5] * 60) * 1000 : 0);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
    if (m) return order === 'dmy' ? utc(+m[3], +m[2], +m[1]) : utc(+m[3], +m[1], +m[2]);
    const t = Date.parse(v); return isNaN(t) ? null : t;
  }

  function lev(a, b) {
    if (a === b) return 0; const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  const STOP = new Set(['llc', 'pllc', 'inc', 'co', 'company', 'the', 'dr', 'dds', 'md', 'pc', 'ltd', 'tx']);
  const CITY = new Set(['frisco', 'plano', 'dallas', 'dfw', 'garland', 'arlington', 'irving', 'mckinney', 'allen', 'denton', 'fortworth']);
  function nameTokens(s) {
    return (s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/).filter(t => t && !STOP.has(t));
  }
  function collapse(s) { return nameTokens(s).join(''); }
  function nameVariants(s) {
    const out = new Set(); const c = collapse(s); if (c) out.add(c);
    String(s || '').split(/\s+-\s+/).forEach(p => { const toks = nameTokens(p); const k = toks.join(''); if (k && k.length >= 4 && !toks.every(t => CITY.has(t))) out.add(k); });
    return [...out];
  }
  function nameParts(s) { const ps = String(s || '').split(/\s+-\s+/).filter(p => !nameTokens(p).every(t => CITY.has(t))); return ps.length ? ps : [String(s || '')]; }
  function cleanBiz(s) {
    const ps = nameParts(s); let n = ps.length > 1 ? ps[ps.length - 1] : ps[0];
    if (ps.length > 1 && nameTokens(ps[0]).length > nameTokens(n).length) n = ps[0];
    return n.replace(/\s+(LLC|PLLC|Inc\.?|Co\.?)$/i, '').trim();
  }

  // ---------- union find ----------
  function UF() { const p = new Map(); const f = x => { if (!p.has(x)) p.set(x, x); let r = x; while (p.get(r) !== r) r = p.get(r); let y = x; while (p.get(y) !== r) { const n = p.get(y); p.set(y, r); y = n; } return r; }; return { find: f, union: (a, b) => { const ra = f(a), rb = f(b); if (ra !== rb) p.set(rb, ra); } }; }

  // ---------- messages ----------
  const MSG_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s+(EMAIL|WHATSAPP|VOICE NOTE|INSTAGRAM DM|WEBSITE FORM|SMS|TEXT|CALL|PHONE CALL)\s+(from|to)\s+(.+?):\s(.*)$/i;
  function parseMessages(text) {
    const out = [];
    (text || '').split(/\r?\n/).forEach((line, i) => {
      line = line.trim(); if (!line) return;
      const m = MSG_RE.exec(line);
      if (!m) { if (out.length && !/^\[\d{4}-/.test(line)) out[out.length - 1].text += ' ' + line; return; }
      const chan = m[2].toLowerCase().replace('instagram dm', 'instagram').replace('website form', 'website form');
      let who = m[4].trim(); let name = ''; let phone = ''; let email = ''; let handle = '';
      const nm = /\(([^)]+)\)/.exec(who); if (nm) name = nm[1].split(',')[0].trim();
      const em = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(who); if (em) email = normEmail(em[0]);
      const hm = /(^|\s)@([\w.]+)/.exec(who); if (hm && !email) handle = hm[2].toLowerCase();
      const pm = /\+?[\d][\d\s().-]{8,}\d/.exec(who.replace(/\([^)]*\)/g, '')); if (pm) phone = normPhone(pm[0]);
      let body = m[5];
      const tr = /Transcript:\s*"?(.*?)"?\s*$/.exec(body); if (/voice/i.test(chan) && tr) body = tr[1];
      out.push({ id: 'M' + String(out.length + 1).padStart(3, '0'), line: i + 1, at: parseDate(m[1]), channel: chan, dir: m[3].toLowerCase(), raw: line, who, name, phone, email, handle, text: body });
    });
    return out;
  }

  // ---------- message rules (fallback classifier; Jev labels override when present) ----------
  const REQ_TYPES = [
    { key: 'brand_color', re: /brand colou?r\s+(\w+)/i, note: m => 'brand color ' + m[1].toLowerCase(), label: 'Brand colour' },
    { key: 'calmer_music', re: /calmer song|too hype|too intense|something (chill|calmer|softer)|canci[oó]n m[aá]s tranquila/i, note: () => 'calmer music', label: 'Calmer music' },
    { key: 'outside_shot', re: /other shot|one outside/i, note: () => 'outside shot', label: 'Use outside shot' },
    { key: 'blur_face', re: /blur the face|blur (her|his|the client)/i, note: () => 'blur', label: 'Blur a face' },
    { key: 'phone_end', re: /phone number at the end/i, note: () => 'phone number', label: 'Phone number end card' },
    { key: 'cut_start', re: /cut the first \d+ seconds|starts slow/i, note: () => 'cut first', label: 'Cut slow start' },
    { key: 'music_lower', re: /music.*too loud|can'?t hear myself|m[uú]sica.*(fuerte|alta)/i, note: () => 'music lower', label: 'Music too loud' },
    { key: 'remove_prices', re: /talk about prices|prices are changing/i, note: () => 'prices', label: 'Remove prices' },
    { key: 'bigger_captions', re: /captions bigger/i, note: () => 'captions', label: 'Bigger captions' },
    { key: 'name_spelling', re: /spelled wrong|misspel/i, note: () => 'spelling', label: 'Name spelled wrong' },
    { key: 'cut_stumble', re: /stumble/i, note: () => 'stumble', label: 'Cut a stumble' },
    { key: 'add_line', re: /add the line\s+['"‘’]?([^'"‘’]+)['"‘’]?/i, note: m => m[1].toLowerCase().replace(/[^a-z ]/g, '').trim().split(' ')[0], label: 'Add a line' },
    // catch-all: a change request the specific rules don't know. It can't be checked against the board automatically.
    { key: 'other_edit', re: /\b(can you|could you|please|pls|can u)\b.*\b(change|swap|replace|put|add|remove|take out|fix|redo|use|make)\b/i, note: () => null, label: 'Other change' }
  ];
  const RULES = {
    followup: /second time i ask|still not fixed|did anyone see my message|still has the same problem|already told you|still wrong/i,
    changed_mind: /changed our mind|different song and a new intro/i,
    churn: /we'?ll pause|whether we continue|talk about (our |the )?contract|not happy|nothing personal|cancel (our|the) (contract|retainer)|switch(ing)? to another|(moving|move|going) to another (agency|studio|company)|another agency|end (our|the) (contract|retainer)/i,
    opportunity: /would pay|we'?d pay|how much|what would that cost|every month|wants videos too|needs videos|call him|gave her your number|will reach out|she'?ll reach out|package where|short clips/i,
    payment: /cash is tight|pay the|sent half|accounting will handle|already paid|pay once|we'?ll pay|bill us/i,
    standing: /from now on|full name|new office number|new email|please bill us|is now /i,
    spam: /crypto|followers|verify here|will be suspended|invoice\.zip|partnership offer|10x guaranteed|pay immediately/i,
    approval: /approved!?|post it/i,
    praise: /best content team|love it|great session|turned out great|use this as a review|loved our reels|mention the videos|sales went up/i,
    logistics: /running \d+ min late|parking|bring anything|see you tomorrow|move to \d|move it\?|cancel today/i
  };

  function classifyRule(text) {
    const out = { intent: 'other', reqType: null, reqNote: null };
    if (RULES.spam.test(text)) { out.intent = 'spam'; return out; }
    if (RULES.followup.test(text)) out.intent = 'followup';
    else if (RULES.changed_mind.test(text)) out.intent = 'changed_mind';
    for (const t of REQ_TYPES) {
      const m = t.re.exec(text); if (!m) continue;
      if (t.key === 'other_edit' && (RULES.standing.test(text) || RULES.churn.test(text) || RULES.payment.test(text) || RULES.logistics.test(text))) break;
      out.reqType = t.key; out.reqNote = t.note(m); if (out.intent === 'other') out.intent = 'edit_request'; break;
    }
    if (out.intent !== 'other') return out;
    if (RULES.churn.test(text)) out.intent = 'churn_risk';
    else if (RULES.opportunity.test(text)) out.intent = 'opportunity';
    else if (RULES.payment.test(text)) out.intent = 'payment';
    else if (RULES.standing.test(text)) out.intent = 'standing_instruction';
    else if (RULES.approval.test(text)) out.intent = 'approval';
    else if (RULES.praise.test(text)) out.intent = 'praise';
    else if (RULES.logistics.test(text)) out.intent = 'logistics';
    return out;
  }

  // ---------- main ----------
  function build(files, opts) {
    opts = opts || {};
    const get = k => files[k] || '';
    const leads = parseCSV(get('leads.csv'));
    const bookingsRaw = parseCSV(get('bookings.csv'));
    const invoicesRaw = parseCSV(get('invoices.csv'));
    const paymentsRaw = parseCSV(get('payments.csv'));
    const boardRaw = parseCSV(get('production_board.csv'));
    const team = parseCSV(get('team.csv'));
    const costsRaw = parseCSV(get('costs.csv'));
    const messages = parseMessages(get('messages.txt'));
    const jevLabels = opts.jevLabels || {};

    const bOrder = slashOrder(bookingsRaw.map(r => r.date), 'mdy');
    const pOrder = slashOrder(paymentsRaw.map(r => r.date), 'dmy');

    // ---- known emails, typo repair ----
    const emailCount = new Map();
    const countEmail = e => { e = normEmail(e); if (e) emailCount.set(e, (emailCount.get(e) || 0) + 1); };
    leads.forEach(r => countEmail(r.email)); bookingsRaw.forEach(r => countEmail(r.email)); invoicesRaw.forEach(r => countEmail(r.email)); paymentsRaw.forEach(r => countEmail(r.payer_email));
    messages.forEach(m => countEmail(m.email));
    const emailFix = new Map();
    const fixes = [];
    [...emailCount.keys()].forEach(e => {
      if (emailCount.get(e) > 2) return;
      let best = null;
      emailCount.forEach((n, k) => { if (k !== e && n >= 3 && k.split('@')[0] === e.split('@')[0] && lev(k, e) <= 2) best = k; });
      if (best) { emailFix.set(e, best); fixes.push({ from: e, to: best }); }
    });
    const E = e => { e = normEmail(e); return emailFix.get(e) || e; };

    // ---- union-find over emails / phones / company domains ----
    const uf = UF();
    const link = (a, b) => { if (a && b) uf.union(a, b); };
    const emailNode = e => e ? 'e:' + e : null;
    const phoneNode = p => p ? 'p:' + p : null;
    const domainNode = e => { const d = (e || '').split('@')[1]; return d && !FREE_DOMAINS.has(d) ? 'd:' + d : null; };
    const touch = n => { if (n) uf.find(n); return n; };
    leads.forEach(r => { const e = emailNode(E(r.email)), p = phoneNode(normPhone(r.phone)); touch(e); touch(p); link(e, p); link(e, domainNode(E(r.email))); });
    bookingsRaw.forEach(r => { const e = emailNode(E(r.email)); touch(e); link(e, domainNode(E(r.email))); });
    invoicesRaw.forEach(r => { const e = emailNode(E(r.email)); touch(e); link(e, domainNode(E(r.email))); });
    paymentsRaw.forEach(r => { const e = emailNode(E(r.payer_email)); touch(e); link(e, domainNode(E(r.payer_email))); });
    // "new email is X" style announcements link old and new addresses
    messages.forEach(m => {
      const e = emailNode(E(m.email)); if (e) { touch(e); link(e, domainNode(E(m.email))); }
      const nm = /new email is\s+([\w.+-]+@[\w-]+(\.[\w-]+)+)/i.exec(m.text); if (nm && e) link(e, emailNode(E(nm[1])));
      const np = /new (office )?(number|phone) is\s+([\d\s().+-]{10,})/i.exec(m.text); if (np && e) link(e, phoneNode(normPhone(np[3])));
    });

    // ---- entities ----
    const ents = new Map();
    const entOf = node => { if (!node) return null; const r = uf.find(node); if (!ents.has(r)) ents.set(r, { id: r, emails: new Set(), phones: new Set(), names: new Map(), people: new Set(), businesses: new Set(), leads: [], bookings: [], invoices: [], payments: [], videos: [], messages: [], handles: new Set() }); return ents.get(r); };
    const addName = (ent, n, w) => { n = (n || '').trim(); if (!n || !ent) return; ent.names.set(n, (ent.names.get(n) || 0) + (w || 1)); };

    leads.forEach(r => {
      r.created_t = parseDate(r.created); r.first_reply_t = parseDate(r.first_reply);
      const ent = entOf(emailNode(E(r.email)) || phoneNode(normPhone(r.phone)));
      r.ent = ent; if (!ent) return;
      ent.leads.push(r); if (r.email) ent.emails.add(E(r.email)); if (normPhone(r.phone)) ent.phones.add(normPhone(r.phone));
      if (r.business) { ent.businesses.add(r.business); addName(ent, r.business, 3); }
      if (r.name) { ent.people.add(r.name); addName(ent, r.name, 1); }
    });

    // spam-ish lead detection
    const isJunkLead = r => /test|crypto|followers|seo|deals|promo/i.test(r.name + ' ' + r.email) && !r.business || /^test@|@test\./i.test(r.email) || /fastfollowers|coin-x|rank1seo/i.test(r.email);

    // alias index: collapsed name -> entity (built from records carrying an email)
    const alias = new Map();
    const addAlias = (n, ent, strong) => { nameVariants(n).forEach(k => { if (!alias.has(k)) alias.set(k, new Set()); alias.get(k).add(ent); }); };
    const bookings = bookingsRaw.map(r => ({ id: r.booking_id, date: parseDate(r.date, bOrder), name: r.client_name, email: E(r.email), rawEmail: normEmail(r.email), service: r.service, status: (r.status || '').toLowerCase(), price: money(r.price) }));
    const invoices = invoicesRaw.map(r => ({ id: r.invoice_no, name: r.bill_to, email: E(r.email), issued: parseDate(r.issued), due: parseDate(r.due), amount: money(r.amount), toolStatus: (r.status || '').toLowerCase(), memo: r.memo || '' }));
    const payments = paymentsRaw.map(r => ({ id: r.payment_id, date: parseDate(r.date, pOrder), name: r.payer, email: E(r.payer_email), amount: money(r.amount), method: r.method, ref: r.reference || '' }));

    [...bookings, ...invoices, ...payments].forEach(r => { r.ent = r.email ? entOf(emailNode(r.email)) : null; if (r.ent) { addName(r.ent, r.name, 1); r.ent.emails.add(r.email); } });
    ents.forEach(ent => ent.names.forEach((_, n) => addAlias(n, ent)));

    // distinctive business tokens (appear in exactly one entity's business names, never as a person name)
    const personTok = new Set(); leads.forEach(r => nameTokens(r.name).forEach(t => personTok.add(t)));
    const GENERIC = new Set(['med', 'spa', 'medspa', 'dental', 'law', 'firm', 'office', 'builders', 'roofing', 'auto', 'coffee', 'roasters', 'realty', 'insurance', 'fitness', 'therapy', 'physical', 'pt', 'podcast', 'family', 'and', 'care', 'home', 'salon', 'bakery', 'plumbing', 'hvac', 'tax', 'services', 'yoga', 'studio', 'pediatrics', 'peds', 'chiropractic', 'chiro', 'wealth', 'partners', 'team', 'media', 'church', 'agency', 'barbers', 'barbershop', 'gym', 'athletics', 'boutique', 'bridal', 'lab', 'dfw', 'frisco', 'plano', 'dallas', 'mktg', 'rg', 'wp']);
    const tokEnt = new Map();
    ents.forEach(ent => ent.businesses.forEach(b => nameTokens(b).forEach(t => { if (GENERIC.has(t) || personTok.has(t) || t.length < 4) return; if (!tokEnt.has(t)) tokEnt.set(t, new Set()); tokEnt.get(t).add(ent); })));

    // identity names come from leads only (who the business says it is), never from billing names
    const idAlias = new Map();
    ents.forEach(ent => [...ent.businesses, ...ent.people].forEach(n => nameVariants(n).forEach(k => { if (!idAlias.has(k)) idAlias.set(k, new Set()); idAlias.get(k).add(ent); })));
    // which entities does one name part point at?
    function partHits(p) {
      const hits = new Set();
      (idAlias.get(collapse(p)) || []).forEach(e => hits.add(e));
      if (!hits.size) nameTokens(p).forEach(t => (tokEnt.get(t) || []).forEach(e => hits.add(e)));
      return hits;
    }
    // Resolve a free-text name to an entity. `own` = entity of the record's email (if any).
    // Returns { ent, own: bool } where own=true means the name agrees with the email's entity.
    const tokHits = p => { const h = new Set(); nameTokens(p).forEach(t => (tokEnt.get(t) || []).forEach(e => h.add(e))); return h; };
    function resolveName(n, own, preferClients) {
      const multi = nameParts(n).length > 1;
      const full = multi ? new Set(idAlias.get(collapse(n)) || []) : partHits(n);
      if (own && full.has(own)) return { ent: own, own: true };
      const pick = set => { let s = [...set]; if (preferClients && s.length > 1) { const c = s.filter(e => e.bookings.length); if (c.length) s = c; } return s.length === 1 ? s[0] : null; };
      if (full.size && pick(full)) return { ent: pick(full), own: false };
      const parts = nameParts(n);
      if (parts.length > 1) {
        const cands = new Set();
        parts.forEach(p => { const h = partHits(p); if (own && (h.has(own) || tokHits(p).has(own))) return; const e = pick(h); if (e) cands.add(e); });
        if (cands.size === 1) return { ent: [...cands][0], own: false };
      }
      // billing/booking names already seen with an email
      const ah = new Set(); nameVariants(n).forEach(k => (alias.get(k) || []).forEach(e => ah.add(e)));
      if (own && ah.has(own)) return { ent: own, own: true };
      if (pick(ah)) return { ent: pick(ah), own: false };
      const c = collapse(n);
      if (c.length >= 6) {
        let best = null, bd = 99;
        alias.forEach((set, k) => { if (set.size !== 1) return; const d = lev(c, k); if (d < bd) { bd = d; best = [...set][0]; } });
        if (bd <= 2) return { ent: best, own: best === own };
      }
      return { ent: null, own: false };
    }
    const matchName = (n, preferClients) => resolveName(n, null, preferClients).ent;

    // ---- agency / payer-on-behalf detection on bookings ----
    // A booking whose name clearly belongs to another business than its email is booked/paid by an agent.
    bookings.forEach(b => {
      b.client = b.ent; b.agent = null;
      if (!b.ent) { b.client = matchName(b.name); return; }
      const r = resolveName(b.name, b.ent);
      if (r.ent && !r.own && r.ent.leads.some(l => !isJunkLead(l))) { b.agent = b.ent; b.client = r.ent; }
    });
    // names a record carries under an agent's email belong to the real client, not the agent
    ents.forEach(ent => ent.names.clear());
    leads.forEach(r => { if (r.ent) { if (r.business) addName(r.ent, r.business, 3); if (r.name) addName(r.ent, r.name, 1); } });
    bookings.forEach(b => { if (b.client) { b.client.bookings.push(b); addName(b.client, b.name, 1); } });
    invoices.forEach(i => { if (i.ent) addName(i.ent, i.name, 1); });
    payments.forEach(p => { if (p.ent) addName(p.ent, p.name, 1); });
    alias.clear(); ents.forEach(ent => ent.names.forEach((_, n) => addAlias(n, ent)));

    // payments without email: resolve by name
    payments.forEach(p => { if (!p.ent) { p.ent = matchName(p.name); p.nameMatched = !!p.ent; } if (p.ent) p.ent.payments.push(p); });
    invoices.forEach(i => { if (!i.ent) i.ent = matchName(i.name); if (i.ent) i.ent.invoices.push(i); });

    // ---- billing match: invoice <-> booking ----
    const svcKey = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const memoDate = (memo, year) => { const m = /(\d{1,2})\/(\d{1,2})(?!\/)/.exec(memo); return m ? utc(year, +m[1], +m[2]) : null; };
    const isRetainerInv = i => /retainer/i.test(i.memo) || /retainer/i.test(i.name);
    const retMonth = i => { const m = MONTHS.findIndex(x => new RegExp(x, 'i').test(i.memo)); return m >= 0 ? m : new Date(i.issued).getUTCMonth(); };
    const byId = new Map(bookings.map(b => [b.id, b]));
    invoices.forEach(i => { i.bookings = []; i.retainer = isRetainerInv(i); });
    const billedTo = new Map(); // booking id -> invoice
    const takeBooking = (i, b, how) => { i.bookings.push(b); i.matchHow = how; billedTo.set(b.id, i); };
    // pass 1: explicit booking id in memo
    invoices.forEach(i => { const m = /\bB\d{3,}\b/.exec(i.memo); if (m && byId.has(m[0]) && !billedTo.has(m[0])) takeBooking(i, byId.get(m[0]), 'memo id'); });
    // pass 2: memo with service + date
    invoices.forEach(i => {
      if (i.bookings.length || i.retainer) return;
      const yr = new Date(i.issued).getUTCFullYear(); const d = memoDate(i.memo, yr); if (!d) return;
      const cand = bookings.filter(b => !billedTo.has(b.id) && b.date === d && (b.email === i.email || (b.client && b.client === i.ent) || (b.agent && b.agent === i.ent)));
      const svc = cand.filter(b => svcKey(i.memo).includes(svcKey(b.service)));
      const pick = svc[0] || cand[0]; if (pick) takeBooking(i, pick, 'memo date');
    });
    // pass 3: same billing email, same amount, issued near the booking date (closest)
    invoices.slice().sort((a, b) => a.issued - b.issued).forEach(i => {
      if (i.bookings.length || i.retainer || i.toolStatus === 'void') return;
      const cand = bookings.filter(b => !billedTo.has(b.id) && b.price > 0 && (b.email === i.email || (b.agent && b.agent === i.ent) || (b.client && b.client === i.ent && !b.agent)) && Math.abs(b.price - i.amount) < 0.01 && i.issued - b.date <= 21 * DAY && b.date - i.issued <= 14 * DAY);
      cand.sort((x, y) => Math.abs(x.date - i.issued) - Math.abs(y.date - i.issued));
      if (cand[0]) takeBooking(i, cand[0], 'amount+date');
    });
    // pass 4: same billing email, any amount (price mismatch), near date
    invoices.slice().sort((a, b) => a.issued - b.issued).forEach(i => {
      if (i.bookings.length || i.retainer || i.toolStatus === 'void') return;
      const cand = bookings.filter(b => !billedTo.has(b.id) && b.price > 0 && (b.email === i.email || (b.agent && b.agent === i.ent)) && i.issued - b.date <= 10 * DAY && b.date - i.issued <= 7 * DAY);
      cand.sort((x, y) => Math.abs(x.date - i.issued) - Math.abs(y.date - i.issued));
      if (cand[0]) takeBooking(i, cand[0], 'date only');
    });
    // void duplicates: a void invoice that copies a live one is fine
    invoices.forEach(i => { if (i.toolStatus === 'void') { const twin = invoices.find(j => j !== i && j.toolStatus !== 'void' && j.email === i.email && j.amount === i.amount && j.memo === i.memo); i.voidTwin = twin ? twin.id : null; } });
    // the client an invoice is for
    invoices.forEach(i => { i.client = (i.bookings[0] && i.bookings[0].client) || i.ent; i.payer = i.ent; });

    // ---- payment allocation ----
    invoices.forEach(i => { i.paid = 0; i.allocs = []; });
    payments.forEach(p => { p.allocs = []; p.left = p.amount; });
    const live = invoices.filter(i => i.toolStatus !== 'void');
    const alloc = (p, i, amt, how) => { amt = Math.min(amt, p.left); if (amt <= 0) return; i.paid += amt; p.left -= amt; i.allocs.push({ p, amt, how }); p.allocs.push({ i, amt, how }); };
    const openAmt = i => Math.round((i.amount - i.paid) * 100) / 100;
    const sameParty = (p, i) => (p.email && p.email === i.email) || (p.ent && (p.ent === i.ent || p.ent === i.payer));
    // pass 1: explicit invoice references
    payments.forEach(p => {
      const refs = (p.ref.match(/INV-\d+/gi) || []).map(x => x.toUpperCase());
      refs.forEach(r => {
        const i = live.find(x => x.id === r); if (!i) return;
        if (openAmt(i) <= 0) { p.duplicateOf = i.id; return; }
        alloc(p, i, Math.min(openAmt(i), p.left), 'reference');
      });
    });
    // pass 2: month words in the reference ("Bluecat Jul invoices", "july sessions")
    payments.forEach(p => {
      if (p.left <= 0 || /INV-/i.test(p.ref)) return;
      const mi = MONTHS.findIndex(m => new RegExp('\\b' + m.slice(0, 3), 'i').test(p.ref)); if (mi < 0) return;
      const yr = new Date(p.date).getUTCFullYear();
      const cand = live.filter(i => sameParty(p, i) && openAmt(i) > 0 && new Date(i.issued).getUTCMonth() === mi && new Date(i.issued).getUTCFullYear() === yr);
      const sum = cand.reduce((s, i) => s + openAmt(i), 0);
      if (Math.abs(sum - p.left) < 0.01) cand.forEach(i => alloc(p, i, openAmt(i), 'month note'));
    });
    // pass 3: same party, exact amount, issued on/before the payment. If the billing tool already marks one
    // of the candidates as paid, trust that; otherwise apply to the oldest open invoice (normal accounting).
    payments.slice().sort((a, b) => a.date - b.date).forEach(p => {
      if (p.left <= 0 || p.duplicateOf) return;
      const cand = live.filter(i => sameParty(p, i) && Math.abs(openAmt(i) - p.left) < 0.01 && i.issued <= p.date + 2 * DAY);
      cand.sort((a, b) => ((b.toolStatus === 'paid') - (a.toolStatus === 'paid')) || (a.issued - b.issued));
      if (cand[0]) alloc(p, cand[0], p.left, 'amount');
    });
    // pass 4: partial payments -> oldest open invoice of the same party
    payments.slice().sort((a, b) => a.date - b.date).forEach(p => {
      if (p.left <= 0 || p.duplicateOf) return;
      const cand = live.filter(i => sameParty(p, i) && openAmt(i) > p.left && i.issued <= p.date + 2 * DAY).sort((a, b) => a.issued - b.issued);
      if (cand[0]) alloc(p, cand[0], p.left, 'partial');
    });

    // ---- today ----
    let today = opts.today ? parseDate(opts.today) : 0;
    if (!today) {
      const pts = [...payments.map(p => p.date), ...messages.map(m => m.at), ...invoices.map(i => i.issued), ...leads.map(l => l.created_t)].filter(Boolean);
      today = Math.max(...pts); today = today - (today % DAY);
    }

    // ---- invoice truth ----
    const findings = [];
    invoices.forEach(i => {
      const bal = openAmt(i);
      i.balance = i.toolStatus === 'void' ? 0 : Math.max(0, bal);
      i.trueStatus = i.toolStatus === 'void' ? 'void' : i.paid <= 0 ? 'unpaid' : bal > 0.009 ? 'partial' : 'paid';
      const cancelled = i.bookings.find(b => b.status === 'cancelled');
      i.cancelledBooking = cancelled ? cancelled.id : null;
      i.daysLate = i.balance > 0 && i.due < today && !cancelled ? daysBetween(i.due, today) : 0;
      i.overdue = i.daysLate > 0;
      const b = i.bookings[0];
      i.expected = b ? b.price : null;
    });
    // retainer amount sanity: compare with the client's usual retainer amount
    const retByEnt = new Map();
    invoices.filter(i => i.retainer && i.toolStatus !== 'void').forEach(i => { const k = i.ent; if (!retByEnt.has(k)) retByEnt.set(k, []); retByEnt.get(k).push(i); });
    retByEnt.forEach(list => {
      const cnt = new Map(); list.forEach(i => cnt.set(i.amount, (cnt.get(i.amount) || 0) + 1));
      const usual = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
      list.forEach(i => { if (i.amount !== usual && list.length >= 3) { i.expected = usual; } });
    });

    // tool vs truth
    invoices.forEach(i => {
      if (i.toolStatus === 'void') return;
      const toolPaid = i.toolStatus === 'paid';
      if (i.cancelledBooking) findings.push({ kind: 'tool_wrong', invoice: i.id, tool: `${i.toolStatus}, ${fmtMoney(i.amount)} for ${i.cancelledBooking}`, truth: `${i.cancelledBooking} was cancelled. Void it or move it to the rescheduled shoot.`, how: `bookings.csv marks ${i.cancelledBooking} as cancelled` + (i.paid ? '' : '; no bank payment matches this invoice'), inv: i });
      else if (toolPaid && i.trueStatus !== 'paid') findings.push({ kind: 'tool_wrong', invoice: i.id, tool: 'paid', truth: i.trueStatus === 'unpaid' ? `unpaid: no money in the bank for it (${fmtMoney(i.balance)} owed)` : `partial: ${fmtMoney(i.balance)} still owed`, how: `No payment in payments.csv matches ${i.id} after allocating every ${i.ent ? displayNameOf(i.ent) : i.name} payment`, inv: i });
      else if (!toolPaid && i.trueStatus === 'paid') findings.push({ kind: 'tool_wrong', invoice: i.id, tool: i.toolStatus, truth: 'paid', how: i.allocs.map(a => `${a.p.id} ${fmtDate(a.p.date)} ${fmtMoney(a.amt)} (${a.how === 'reference' ? 'references ' + i.id : a.how === 'month note' ? '"' + a.p.ref + '"' : 'matched by amount'})`).join('; '), inv: i });
      else if (i.toolStatus === 'partial' && i.trueStatus === 'unpaid') findings.push({ kind: 'tool_wrong', invoice: i.id, tool: 'partial', truth: 'unpaid', how: 'no payment matches', inv: i });
      if (i.expected != null && Math.abs(i.expected - i.amount) > 0.009) {
        findings.push({ kind: 'tool_wrong', invoice: i.id, tool: `amount ${fmtMoney(i.amount)}`, truth: `should be ${fmtMoney(i.expected)} (${i.amount > i.expected ? 'overcharged ' : 'under-billed '}${fmtMoney(Math.abs(i.amount - i.expected))})`, how: i.retainer ? `every other ${displayNameOf(i.ent)} retainer invoice is ${fmtMoney(i.expected)}; no discount found in messages` : `booking ${i.bookings[0].id} price is ${fmtMoney(i.expected)}`, inv: i, delta: i.amount - i.expected });
      }
    });
    // duplicate payments / unapplied money = we owe
    payments.forEach(p => {
      if (p.left > 0.009) {
        findings.push({ kind: 'we_owe', client: p.ent, amount: p.left, why: p.duplicateOf ? `${p.id} (${fmtDate(p.date)}) paid ${p.duplicateOf} a second time; it was already paid` : `${p.id} (${fmtDate(p.date)}, ${fmtMoney(p.amount)}) doesn't match any open invoice`, pay: p });
      }
    });
    invoices.forEach(i => { if (i.expected != null && i.amount > i.expected && i.paid >= i.amount - 0.009) findings.push({ kind: 'we_owe', client: i.client, amount: i.amount - i.expected, why: `${i.id} charged ${fmtMoney(i.amount)} but the booking was ${fmtMoney(i.expected)}, and they paid in full`, inv: i }); });
    // never billed
    bookings.forEach(b => { if (b.status === 'completed' && b.price > 0 && !billedTo.has(b.id) && b.date <= today) findings.push({ kind: 'never_billed', client: b.client, booking: b, amount: b.price }); });

    // ---- production board ----
    const videos = boardRaw.map((r, idx) => ({ id: r.video_id, idx, name: r.client, title: r.title, titleKey: (r.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(), editor: r.editor, stage: r.stage, notes: r.notes_on_board || '', revisions: +r.revisions || 0, hours: parseFloat(r.editor_hours) || 0, approved: parseDate(r.client_approved_on), bookingId: r.shoot_booking }));
    videos.forEach(v => {
      const b = v.bookingId && byId.get(v.bookingId);
      v.booking = b || null; v.client = b ? b.client : matchName(v.name, true);
      v.shot = b ? b.date : null;
    });
    // estimate missing shoot dates from the board order (the board is chronological)
    videos.forEach((v, k) => { if (v.shot) return; for (let j = k - 1; j >= 0; j--) if (videos[j].shot) { v.shot = videos[j].shot; v.shotEstimated = true; break; } });
    videos.forEach(v => { if (v.client) v.client.videos.push(v); });
    const teamByName = new Map(team.map(t => [t.name, t]));
    const rateOf = n => { const t = teamByName.get(n); return t ? money((t.pay || '').split('/')[0]) : 0; };

    // ---- messages: resolve sender ----
    const byEmail = e => { const n = emailNode(E(e)); return n && ents.has(uf.find(n)) ? ents.get(uf.find(n)) : null; };
    const byPhone = p => { const n = phoneNode(p); return n && ents.has(uf.find(n)) ? ents.get(uf.find(n)) : null; };
    const handleIndex = [];
    ents.forEach(ent => {
      const keys = new Set();
      ent.names.forEach((_, n) => nameVariants(n).forEach(k => { if (k.length >= 6) keys.add(k); }));
      ent.emails.forEach(e => { const d = e.split('@')[1]; if (d && !FREE_DOMAINS.has(d)) { const stem = d.split('.')[0]; if (stem.length >= 6) keys.add(stem); } });
      keys.forEach(k => handleIndex.push([k, ent]));
    });
    const byHandle = h => {
      const c = h.replace(/[^a-z0-9]/g, ''); let best = null, bl = 0;
      handleIndex.forEach(([k, ent]) => { if ((c.includes(k) || k.includes(c)) && k.length > bl && Math.min(k.length, c.length) >= 6) { best = ent; bl = k.length; } });
      return best;
    };
    messages.forEach(m => {
      m.ent = (m.email && byEmail(m.email)) || (m.phone && byPhone(m.phone)) || (m.handle && byHandle(m.handle)) || null;
      if (m.ent) m.ent.messages.push(m);
      const rule = classifyRule(m.text);
      const jl = jevLabels[m.raw] || jevLabels[m.id];
      m.rule = rule;
      m.intent = jl && jl.intent ? jl.intent : rule.intent;
      m.reqType = jl && jl.reqType !== undefined ? jl.reqType : rule.reqType;
      const t = REQ_TYPES.find(x => x.key === m.reqType);
      const FALLBACK_NOTE = { brand_color: 'brand color', add_line: null };
      m.reqNote = rule.reqType === m.reqType ? rule.reqNote : (t ? (t.re.exec(m.text) ? t.note(t.re.exec(m.text)) : (m.reqType in FALLBACK_NOTE ? FALLBACK_NOTE[m.reqType] : t.note([]))) : null);
      m.labelSource = jl ? 'jev' : 'rules';
      if (m.dir === 'to') { m.intent = 'outgoing'; m.reqType = null; }
      if (!m.ent && m.dir === 'from' && m.intent !== 'spam' && !/\(|@/.test(m.who) === false && /bit\.ly|\.zip|acct-dept|support\.team/i.test(m.raw)) m.intent = 'spam';
      if (!m.ent && m.dir === 'from' && /bit\.ly|\.zip/i.test(m.raw)) m.intent = 'spam';
    });

    // ---- clients ----
    const clientEnts = [...ents.values()].filter(e => e.bookings.some(b => b.status === 'completed') || e.videos.length);
    // Display name: the business name from the most recent lead (it tracks renames such as Prime Gym -> Prime Athletics).
    // If the lead only gives a person's name or an "Agency - Client" label, use the longest business-looking name we have.
    function displayNameOf(ent) {
      if (!ent) return '';
      const withBiz = ent.leads.filter(l => l.business).sort((a, b) => a.created_t - b.created_t);
      let raw = withBiz.length ? withBiz[withBiz.length - 1].business : '';
      const others = [...ent.names.keys()].filter(x => !/ - /.test(x) && !ent.people.has(x) && x !== x.toUpperCase());
      const longestContaining = key => others.filter(x => collapse(x).includes(key)).sort((a, b) => b.length - a.length)[0];
      if (raw && ent.people.has(raw)) raw = others.filter(x => nameTokens(x).length >= 2).sort((a, b) => b.length - a.length)[0] || raw;
      if (raw && / - /.test(raw)) {
        const ps = nameParts(raw);
        if (ps.length > 1) { const agentPart = ps.find(p => [...tokHits(p)].some(e => e !== ent)); const keep = ps.find(p => p !== agentPart) || ps[ps.length - 1]; raw = longestContaining(collapse(keep)) || keep; }
        else raw = ps[0];
      }
      if (!raw) raw = [...ent.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return cleanBiz(raw);
    }
    ents.forEach(ent => { ent.display = (ent.names.size || ent.leads.length) ? displayNameOf(ent) : ([...ent.emails][0] || ent.id); });
    const clients = clientEnts.map(ent => {
      const lastShoot = ent.bookings.filter(b => b.status === 'completed').reduce((m, b) => Math.max(m, b.date), 0);
      const nextShoot = ent.bookings.filter(b => b.status === 'upcoming').reduce((m, b) => m ? Math.min(m, b.date) : b.date, 0);
      const wonLead = ent.leads.filter(l => /won/i.test(l.status)).sort((a, b) => a.created_t - b.created_t)[0];
      return { ent, id: ent.id, name: ent.display, aliases: [...ent.names.keys()].filter(n => n !== ent.display), emails: [...ent.emails], phones: [...ent.phones], people: [...ent.people], lastShoot, nextShoot, source: wonLead ? wonLead.source : (ent.leads[0] ? ent.leads[0].source : ''), paidBy: [...new Set(ent.bookings.filter(b => b.agent).map(b => b.agent.display))] };
    }).sort((a, b) => a.name.localeCompare(b.name));
    clients.forEach(c => { c.ent.client = c; });
    const payersNotClients = [...ents.values()].filter(e => !clientEnts.includes(e) && (e.payments.length || e.invoices.length)).map(e => ({ ent: e, name: e.display, paysFor: [...new Set(bookings.filter(b => b.agent === e && b.client).map(b => b.client.display))] }));

    // ---- edit requests -> board ----
    const shootsOf = ent => ent.bookings.filter(b => b.status === 'completed' && b.service && !/podcast/i.test(b.service)).sort((a, b) => a.date - b.date);
    const requests = [];
    messages.forEach(m => {
      if (m.dir !== 'from' || !m.ent || !['edit_request', 'followup', 'changed_mind'].includes(m.intent)) return;
      const vids = m.ent.videos;
      let lc = m.text.toLowerCase().replace(/add the line\s+['"‘’][^'"‘’]+['"‘’]/, '');
      // which title?
      const titleHits = [...new Set(vids.map(v => v.titleKey))].filter(t => t && lc.replace(/[^a-z0-9 ]/g, '').includes(t)).sort((a, b) => b.length - a.length);
      let cands = []; let ref = '';
      if (titleHits.length) {
        ref = 'title';
        const sameTitle = vids.filter(v => v.titleKey === titleHits[0] && (!v.shot || v.shot <= m.at));
        sameTitle.sort((a, b) => b.idx - a.idx); cands = sameTitle.slice(0, 1); m.sameTitleCount = vids.filter(v => v.titleKey === titleHits[0]).length;
      } else if (/the one we shot|last week|the video from|latest video/i.test(lc)) {
        ref = 'vague';
        const shoot = shootsOf(m.ent).filter(b => b.date <= m.at).pop();
        if (shoot) cands = vids.filter(v => v.booking === shoot || (!v.booking && v.shot === shoot.date));
        m.vagueShoot = shoot ? shoot.id : null;
      }
      m.ref = ref; m.cands = cands;
      if (m.intent === 'edit_request') requests.push(m);
    });
    // follow-ups point back at the request they chase
    messages.forEach(m => {
      if (m.intent !== 'followup' || !m.ent) return;
      const prior = requests.filter(r => r.ent === m.ent && r.at < m.at && m.at - r.at < 60 * DAY);
      let target = null;
      if (m.cands.length) target = prior.filter(r => r.ref === 'title' && r.cands[0] === m.cands[0]).pop() || prior.filter(r => r.cands.some(v => v === m.cands[0])).pop() || prior.filter(r => r.ref === 'title' && r.cands[0] && r.cands[0].titleKey === m.cands[0].titleKey).pop();
      if (!target && m.cands.length) target = prior.filter(r => r.ref === 'vague').filter(r => r.cands.some(v => v.titleKey === m.cands[0].titleKey)).pop();
      if (!target && !m.cands.length) target = prior.pop();
      if (target) {
        target.followups = (target.followups || []).concat(m); m.chases = target;
        if (target.ref === 'vague' && m.cands.length) { const v = target.cands.find(x => x.titleKey === m.cands[0].titleKey); if (v) target.resolvedBy = v; }
      }
      if (m.cands.length) m.chasedVideo = m.cands[0];
    });
    const squash = x => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const noteHas = (v, r) => v && r.reqNote && squash(v.notes).includes(squash(r.reqNote));
    const claimed = new Set();
    requests.forEach(r => { const n = r.cands.find(c => noteHas(c, r)); if (n) claimed.add(n.id + '|' + r.reqType); });
    requests.forEach(r => {
      let v = r.resolvedBy || (r.cands.length === 1 ? r.cands[0] : null);
      const noted = r.cands.find(c => noteHas(c, r));
      if (noted) { r.video = noted; r.onBoard = true; }
      else {
        r.onBoard = false;
        if (!v && r.cands.length) v = r.cands[0];
        r.video = v || null;
        // landed on another video of the same client?
        const elsewhere = r.ref === 'vague' ? r.ent.videos.find(x => noteHas(x, r) && !r.cands.includes(x) && !claimed.has(x.id + '|' + r.reqType) && Math.abs((x.shot || 0) - r.at) < 45 * DAY) : null;
        r.wrongVideo = elsewhere || null;
      }
      const why = [];
      if (!r.onBoard) {
        if (/voice/.test(r.channel)) why.push('Came as a voice note. Voice notes never get copied to the board.');
        if (/instagram/.test(r.channel)) why.push('Came as an Instagram DM. DMs never get copied to the board.');
        if (/[áéíóúñ¿¡]|(está|muy|por favor|gracias)/i.test(r.text)) why.push('Written in Spanish.');
        if (r.video && r.video.editor === 'Nico') why.push('The video was assigned to Nico (joined Aug 1). None of Nico\'s cards has ever had a client note.');
        if (r.ref === 'vague') why.push(`Vague reference ("the one we shot last week"). That shoot (${r.vagueShoot || '?'}) made ${r.cands.length} videos, so nobody knew which one.`);
        if (r.ref === 'title' && r.sameTitleCount > 2) why.push(`This client has ${r.sameTitleCount} videos with this title, so the note can go on the wrong one.`);
        if (r.wrongVideo) why.push(`The note was put on ${r.wrongVideo.id} (${r.wrongVideo.title}) instead.`);
        if (!r.cands.length) why.push('No matching video found on the board.');
        if (!why.length) why.push(`Came by ${r.channel}; never written on the board.`);
      }
      if (!r.reqNote) { r.unverifiable = true; why.length = 0; why.push("A kind of change the rules don't know, so it can't be checked against the board automatically. Check it by hand."); }
      r.why = why;
      r.chased = !!(r.followups && r.followups.length);
      r.open = !r.onBoard;
    });

    // ---- leads ----
    leads.forEach(l => {
      l.junk = isJunkLead(l);
      l.existingClient = l.ent && clientEnts.includes(l.ent) && l.ent.leads.indexOf(l) > 0 ? l.ent : (l.ent && clientEnts.includes(l.ent) && !/won/i.test(l.status) ? l.ent : null);
      l.replyDays = l.first_reply_t ? daysBetween(l.created_t - (l.created_t % DAY), l.first_reply_t) : null;
      l.neverReplied = !l.first_reply_t && !l.junk;
    });

    // ---- economics per client ----
    const costRows = costsRaw; const studioRate = money(((costRows.find(r => /studio/i.test(r.item)) || {}).cost || '40').split('/')[0]) || 40;
    const studioHours = s => { s = (s || '').toLowerCase(); const m = /(\d+)\s*hr/.exec(s); if (m) return +m[1]; if (/content day/.test(s)) return 6; if (/reels/.test(s)) return 3; if (/retainer/.test(s)) return 4; return 0; };
    clients.forEach(c => {
      const e = c.ent;
      const invs = invoices.filter(i => i.client === e && i.toolStatus !== 'void');
      c.billed = invs.reduce((s, i) => s + i.amount, 0);
      c.collected = invs.reduce((s, i) => s + i.paid, 0);
      c.studioCost = e.bookings.filter(b => b.status === 'completed').reduce((s, b) => s + studioHours(b.service) * studioRate, 0);
      c.editCost = e.videos.reduce((s, v) => s + v.hours * rateOf(v.editor), 0);
      c.profit = c.collected - c.studioCost - c.editCost;
      c.profitBilled = c.billed - c.studioCost - c.editCost;
      c.revisions = e.videos.reduce((s, v) => s + v.revisions, 0);
      c.openInvoices = invoices.filter(i => i.client === e && i.balance > 0 && i.toolStatus !== 'void');
      c.owed = c.openInvoices.filter(i => i.overdue).reduce((s, i) => s + i.balance, 0);
      c.requests = requests.filter(r => r.ent === e);
      c.lost = c.requests.filter(r => !r.onBoard);
      c.churnMsgs = e.messages.filter(m => m.intent === 'churn_risk');
      c.followups = e.messages.filter(m => m.intent === 'followup');
      const lastMsg = e.messages.filter(m => m.dir === 'from').reduce((mx, m) => Math.max(mx, m.at), 0);
      c.lastContact = lastMsg;
      c.paused = c.churnMsgs.some(m => /pause/i.test(m.text)) && !e.bookings.some(b => b.date > c.churnMsgs[0].at + 20 * DAY);
    });

    // ---- churn risk score ----
    clients.forEach(c => {
      if (c.paused) { c.risk = 0; c.riskWhy = ['Already paused (told us ' + fmtDate(c.churnMsgs[0].at) + ')']; return; }
      const recent = t => today - t < 45 * DAY;
      let s = 0; const why = [];
      const ch = c.churnMsgs.filter(m => recent(m.at)); if (ch.length) { s += 40 * ch.length; ch.forEach(m => why.push(`${fmtDate(m.at)}: "${m.text}"`)); }
      const fu = c.followups.filter(m => recent(m.at)); if (fu.length) { s += 8 * fu.length; why.push(`${fu.length} "still not fixed" follow-ups in the last 45 days`); }
      const lost = c.lost.filter(r => recent(r.at)); if (lost.length) { s += 5 * lost.length; why.push(`${lost.length} change requests never reached the board in the last 45 days`); }
      if (c.owed > 0) { s += 10; why.push(`${fmtMoney(c.owed)} overdue`); }
      const stand = c.ent.messages.filter(m => m.intent === 'standing_instruction' && recent(m.at)); if (stand.length && fu.length) { s += 5; }
      const unhappy = c.ent.messages.filter(m => /not happy|frustrated/i.test(m.text) && recent(m.at)); if (unhappy.length) { s += 10 * unhappy.length; unhappy.forEach(m => why.push(`${fmtDate(m.at)}: "${m.text}"`)); }
      c.risk = s; c.riskWhy = why;
    });

    // ---- channel economics ----
    const channels = {};
    leads.filter(l => !l.junk).forEach(l => { const ch = l.source || 'Unknown'; channels[ch] = channels[ch] || { channel: ch, leads: 0, won: 0, clients: new Set(), collected: 0, billed: 0, profit: 0, profitBilled: 0, replyDays: [] }; channels[ch].leads++; if (/won/i.test(l.status)) channels[ch].won++; if (l.replyDays != null) channels[ch].replyDays.push(l.replyDays); });
    clients.forEach(c => { const ch = channels[c.source]; if (!ch) return; ch.clients.add(c); ch.collected += c.collected; ch.billed += c.billed; ch.profit += c.profit; ch.profitBilled += c.profitBilled; });
    Object.values(channels).forEach(ch => { ch.clientCount = ch.clients.size; ch.profitPerClient = ch.clientCount ? ch.profitBilled / ch.clientCount : 0; ch.winRate = ch.leads ? ch.won / ch.leads : 0; ch.clientNames = [...ch.clients].map(c => c.name); delete ch.clients; });

    // ---- suggested actions (never executed automatically) ----
    const actions = [];
    const contactOf = ent => { const l = ent.leads.find(x => /won/i.test(x.status)) || ent.leads[0]; return { person: l ? l.name.split(' ')[0] : '', email: [...ent.emails][0] || '', phone: [...ent.phones][0] || '' }; };
    // 1. clients about to leave
    clients.filter(c => c.risk >= 40).sort((a, b) => b.risk - a.risk).forEach(c => {
      const ct = contactOf(c.ent);
      const unanswered = c.churnMsgs.filter(m => !c.ent.messages.some(o => o.dir === 'to' && o.at > m.at));
      actions.push({ key: 'churn:' + c.id, kind: 'churn', prio: 1000 + c.risk, title: `${c.name} may leave. Call them today?`, detail: c.riskWhy.slice(0, 3), money: c.ent.invoices.filter(i => i.retainer).length ? Math.max(...c.ent.invoices.filter(i => i.retainer).map(i => i.amount)) : 0, moneyLabel: '/ month at risk', client: c, yes: 'Call now', contact: ct, draft: `Hi ${ct.person}, this is Zaid from Axeom. I saw your messages and I'm sorry we kept missing your notes. Can we talk today? I want to fix this properly.`, unanswered: unanswered.length });
    });
    const churnEnts = new Set(actions.filter(a => a.kind === 'churn').map(a => a.client.ent));
    actions.filter(a => a.kind === 'churn').forEach(a => {
      const od = invoices.filter(i => i.overdue && (i.payer === a.client.ent || i.client === a.client.ent));
      if (od.length) a.detail.push('Also owes ' + fmtMoney(od.reduce((s, i) => s + i.balance, 0)) + ' (' + od.map(i => i.id).join(', ') + '). Raise it on the call, not by a cold reminder.');
    });
    // 2. overdue invoices
    invoices.filter(i => i.overdue).sort((a, b) => b.balance * (1 + b.daysLate / 30) - a.balance * (1 + a.daysLate / 30)).forEach(i => {
      const ent = i.payer || i.client; const ct = ent ? contactOf(ent) : {};
      const toolSaysPaid = i.toolStatus === 'paid';
      actions.push({ key: 'overdue:' + i.id, kind: 'money', prio: (churnEnts.has(ent) ? 150 : 500) + Math.min(i.balance / 10, 300) + i.daysLate, title: `${ent ? ent.display : i.name} owes ${fmtMoney(i.balance)} (${i.id}, ${dn(i.daysLate)} late). Send a reminder?`, detail: [toolSaysPaid ? 'Billing tool says PAID, but no money reached the bank.' : i.trueStatus === 'partial' ? `Paid ${fmtMoney(i.paid)} of ${fmtMoney(i.amount)}.` : 'Billing tool and bank agree: unpaid.', `Due ${fmtDate(i.due)}.`].concat(ent && ent.messages.filter(m => m.intent === 'payment' && m.at > i.issued).map(m => `They said on ${fmtDate(m.at)}: "${m.text}"`) || []), money: i.balance, client: i.client && i.client.client, yes: 'Draft reminder', contact: ct, draft: `Hi ${ct.person || ''}, a quick reminder that invoice ${i.id} for ${fmtMoney(i.balance)} was due on ${fmtDate(i.due)}. Could you take a look? Thank you! - Zaid, Axeom` });
    });
    // 3. lost edit requests the client is chasing
    const chasedLost = requests.filter(r => !r.onBoard && r.chased);
    const latestChase = r => r.followups.reduce((mx, f) => Math.max(mx, f.at), 0);
    chasedLost.filter(r => today - latestChase(r) < 45 * DAY).sort((a, b) => latestChase(b) - latestChase(a)).forEach(r => {
      const v = r.video;
      actions.push({ key: 'req:' + r.id, kind: 'edit', prio: 600 + r.followups.length * 50 - Math.min(90, (today - latestChase(r)) / DAY), title: `${r.ent.display}: "${v ? v.title : 'video'}" still needs "${REQ_TYPES.find(t => t.key === r.reqType).label.toLowerCase()}". Put it on the board?`, detail: [`Asked ${fmtDate(r.at)} by ${r.channel}: "${r.text}"`, `Chased ${r.followups.length}x, last on ${fmtDate(latestChase(r))}.`].concat(r.why.slice(0, 2)), client: r.ent.client, video: v, yes: 'Add to board', draft: `${v ? v.id + ' ' + v.title : ''}: ${r.text}` });
    });
    // 4. money we owe
    findings.filter(f => f.kind === 'we_owe').forEach(f => actions.push({ key: 'owe:' + (f.pay ? f.pay.id : f.inv.id), kind: 'money', prio: 400 + f.amount / 10, title: `We owe ${f.client ? f.client.display : ''} ${fmtMoney(f.amount)}. Refund or credit it?`, detail: [f.why], money: f.amount, client: f.client && f.client.client, yes: 'Draft note', contact: f.client ? contactOf(f.client) : {}, draft: `Hi, we noticed ${f.why.toLowerCase()}. We'll credit ${fmtMoney(f.amount)} on your next invoice unless you'd prefer a refund. - Zaid, Axeom` }));
    // 5. never billed
    findings.filter(f => f.kind === 'never_billed').forEach(f => actions.push({ key: 'bill:' + f.booking.id, kind: 'money', prio: 450 + f.amount / 10, title: `${f.client ? f.client.display : f.booking.name}: ${f.booking.service} on ${fmtDate(f.booking.date)} was never billed (${fmtMoney(f.amount)}). Create the invoice?`, detail: [`Booking ${f.booking.id} is completed. No invoice mentions it, and no invoice with that amount was issued near that date.`], money: f.amount, client: f.client && f.client.client, yes: 'Create invoice', draft: `Invoice ${f.client ? f.client.display : ''}: ${f.booking.service} ${fmtDate(f.booking.date)} (${f.booking.id}) - ${fmtMoney(f.amount)}` }));
    // 6. leads and opportunities with no reply
    leads.filter(l => l.neverReplied && today - l.created_t < 60 * DAY && !churnEnts.has(l.ent)).forEach(l => {
      const existing = l.ent && clientEnts.includes(l.ent);
      const ct = { person: l.name.split(' ')[0], email: l.email, phone: normPhone(l.phone) };
      actions.push({ key: 'lead:' + l.lead_id, kind: 'lead', prio: (existing ? 350 : 250) - daysBetween(l.created_t, today), title: existing ? `${l.ent.display} (existing client) filled the form ${dn(daysBetween(l.created_t, today))} ago. No reply yet. Reply now?` : `New lead ${l.name}${l.business ? ' (' + l.business + ')' : ''}, ${l.source}, waiting ${dn(daysBetween(l.created_t, today))}, no reply. Reply now?`, detail: [l.ent && l.ent.messages.filter(m => m.channel === 'website form' && Math.abs(m.at - l.created_t) < 2 * DAY).map(m => `"${m.text}"`)[0] || `Lead ${l.lead_id} from ${l.source}.`], client: existing ? l.ent.client : null, yes: 'Draft reply', contact: ct, draft: `Hi ${ct.person}, thanks for reaching out to Axeom! When is a good time for a quick call this week?` });
    });
    messages.filter(m => m.intent === 'opportunity' && m.dir === 'from' && today - m.at < 75 * DAY && !messages.some(o => o.dir === 'to' && o.at > m.at && o.ent === m.ent)).forEach(m => {
      if (leads.some(l => l.neverReplied && l.email && normEmail(l.email) === m.email)) return; // already covered as a lead
      const ct = m.ent ? contactOf(m.ent) : { person: m.name };
      actions.push({ key: 'opp:' + m.id, kind: 'lead', prio: 300 - daysBetween(m.at, today), title: `Opportunity from ${m.ent ? m.ent.display : m.who}, ${dn(daysBetween(m.at, today))} ago, no reply. Follow up?`, detail: [`${fmtDate(m.at)} ${m.channel}: "${m.text}"`], client: m.ent && m.ent.client, yes: 'Draft reply', contact: ct, draft: `Hi ${ct.person}, sorry for the slow reply! Yes, we can do that. Can I send you options this week?` });
    });
    // 7. billing-tool corrections
    findings.filter(f => f.kind === 'tool_wrong' && !f.inv.overdue).forEach(f => actions.push({ key: 'fix:' + f.invoice + ':' + f.tool, kind: 'fix', prio: 100, title: `Fix ${f.invoice} in the billing tool: it says "${f.tool}", the truth is "${f.truth}"?`, detail: [f.how], client: f.inv.client && f.inv.client.client, yes: 'Mark fixed' }));
    // 8. lost requests nobody chased yet (recent)
    requests.filter(r => !r.onBoard && !r.chased && today - r.at < 30 * DAY).forEach(r => actions.push({ key: 'req:' + r.id, kind: 'edit', prio: 200, title: `${r.ent.display} asked for "${REQ_TYPES.find(t => t.key === r.reqType).label.toLowerCase()}" on ${r.video ? '"' + r.video.title + '"' : 'a recent video'}. Not on the board. Add it?`, detail: [`${fmtDate(r.at)} ${r.channel}: "${r.text}"`].concat(r.why.slice(0, 1)), client: r.ent.client, video: r.video, yes: 'Add to board', draft: `${r.video ? r.video.id + ' ' + r.video.title : ''}: ${r.text}` }));
    actions.sort((a, b) => b.prio - a.prio);

    // ---- summary numbers ----
    const overdue = invoices.filter(i => i.overdue);
    const summary = {
      today, clients: clients.length,
      activeClients: clients.filter(c => !c.paused).length,
      overdueTotal: overdue.reduce((s, i) => s + i.balance, 0), overdueCount: overdue.length,
      neverBilledTotal: findings.filter(f => f.kind === 'never_billed').reduce((s, f) => s + f.amount, 0),
      weOweTotal: findings.filter(f => f.kind === 'we_owe').reduce((s, f) => s + f.amount, 0),
      lostRequests: requests.filter(r => !r.onBoard && !r.unverifiable).length, requests: requests.filter(r => !r.unverifiable).length,
      atRisk: clients.filter(c => c.risk >= 40).length,
      leadsNoReply: leads.filter(l => l.neverReplied).length
    };

    return { today, files: Object.keys(files), leads, bookings, invoices, payments, videos, messages, team, clients, payersNotClients, ents, requests, findings, actions, channels, summary, emailFixes: fixes, REQ_TYPES, fmtMoney, fmtDate, studioHours, rateOf };
  }

  // Which pack file is this? Decide by header, not by filename.
  function detectKind(name, text) {
    const first = (text || '').replace(/^﻿/, '').split(/\r?\n/)[0].toLowerCase();
    if (/^\[\d{4}-\d{2}-\d{2}/.test(first)) return 'messages.txt';
    if (/lead_id/.test(first)) return 'leads.csv';
    if (/booking_id/.test(first)) return 'bookings.csv';
    if (/invoice_no/.test(first)) return 'invoices.csv';
    if (/payment_id/.test(first)) return 'payments.csv';
    if (/video_id/.test(first)) return 'production_board.csv';
    if (/^name,role/.test(first) || /\brole\b/.test(first)) return 'team.csv';
    if (/^item,cost/.test(first)) return 'costs.csv';
    const n = (name || '').toLowerCase();
    for (const k of ['leads', 'bookings', 'invoices', 'payments', 'production_board', 'team', 'costs']) if (n.includes(k)) return k + '.csv';
    if (n.includes('message')) return 'messages.txt';
    return null;
  }
  const ID_COL = { 'leads.csv': 'lead_id', 'bookings.csv': 'booking_id', 'invoices.csv': 'invoice_no', 'payments.csv': 'payment_id', 'production_board.csv': 'video_id', 'team.csv': 'name', 'costs.csv': 'item' };
  // Merge a new file into the current one: rows with the same id are replaced, new ids are added.
  function mergeFile(kind, oldText, newText) {
    if (!oldText) return { text: newText, added: null, updated: null };
    if (kind === 'messages.txt') {
      const oldLines = oldText.split(/\r?\n/).filter(Boolean); const seen = new Set(oldLines.map(l => l.trim()));
      const add = newText.split(/\r?\n/).filter(l => l.trim() && !seen.has(l.trim()));
      const all = oldLines.concat(add);
      all.sort((a, b) => (a.slice(0, 18) < b.slice(0, 18) ? -1 : a.slice(0, 18) > b.slice(0, 18) ? 1 : 0));
      return { text: all.join('\n') + '\n', added: add.length, updated: 0 };
    }
    const splitHead = t => { const lines = t.replace(/^﻿/, '').split(/\r?\n/); return { head: lines[0], rows: lines.slice(1).filter(l => l.trim()) }; };
    const o = splitHead(oldText), n = splitHead(newText);
    const col = ID_COL[kind]; const oh = o.head.toLowerCase().split(','), nh = n.head.toLowerCase().split(',');
    const oi = oh.indexOf(col), ni = nh.indexOf(col);
    const idOf = (line, idx) => { const r = parseCSV('x\n' + line.replace(/^/, '')); return null; };
    const firstField = (line, idx) => { const parsed = parseCSV(n.head + '\n' + line)[0]; return parsed ? parsed[col] : null; };
    const firstFieldOld = line => { const parsed = parseCSV(o.head + '\n' + line)[0]; return parsed ? parsed[col] : null; };
    // reorder new rows to the old header if columns differ
    let newRows = n.rows;
    if (oh.join(',') !== nh.join(',')) {
      newRows = parseCSV(newText).map(r => oh.map(h => { const v = r[h] == null ? '' : r[h]; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','));
    }
    const map = new Map(); const order = [];
    o.rows.forEach(l => { const id = firstFieldOld(l) || l; if (!map.has(id)) order.push(id); map.set(id, l); });
    let added = 0, updated = 0;
    newRows.forEach(l => { const id = firstFieldOld(l) || l; if (map.has(id)) { if (map.get(id) !== l) updated++; } else { order.push(id); added++; } map.set(id, l); });
    return { text: [o.head].concat(order.map(id => map.get(id))).join('\n') + '\n', added, updated };
  }

  const api = { build, parseCSV, parseMessages, classifyRule, detectKind, mergeFile, REQ_TYPES, fmtMoney, fmtDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AxeomEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
