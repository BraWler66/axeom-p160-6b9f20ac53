/* Axeom Today. Suggests, never acts: every action opens a draft the owner sends himself.
 * One count rule: a tab's badge = the number of cards in that tab. */
(function () {
  'use strict';
  const E = window.AxeomEngine;
  const PACK = ['leads.csv', 'bookings.csv', 'invoices.csv', 'payments.csv', 'production_board.csv', 'messages.txt', 'team.csv', 'costs.csv'];
  const LS_FILES = 'axeom.files.v1', LS_DEC = 'axeom.decisions.v1', LS_JEV = 'axeom.jev.v1', LS_NEW = 'axeom.newkeys.v1';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const fk = n => n >= 10000 ? '$' + Math.round(n / 1000) + 'k' : n >= 1000 ? '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(n);
  const fdate = t => t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // inline icons (stroke, 24px grid)
  const P = {
    phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
    chat: 'M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5z',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 7l-10 6L2 7',
    copy: 'M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    check: 'M20 6 9 17l-5-5',
    left: 'm15 18-6-6 6-6',
    right: 'm9 18 6-6-6-6',
    lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
    alert: 'm21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3zM12 9v4M12 17h.01',
    receipt: 'M4 2v20l3-2 2.5 2L12 20l2.5 2L17 20l3 2V2l-3 2-2.5-2L12 4 9.5 2 7 4zM8 8h8M8 12h8M8 16h5',
    film: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4',
    plus: 'M12 5v14M5 12h14',
    undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    refund: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 8v8M9.5 10.5c.6-.9 1.6-1.4 2.7-1.3 1.3.1 2.3.9 2.3 1.8 0 2.3-5 1.2-5 3.6 0 .9 1 1.7 2.4 1.8 1.1.1 2.1-.4 2.6-1.3',
    wrench: 'M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3zM16 2l-3 3 3 3 3-3z'
  };
  const ic = n => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;

  let files = {}, jev = {}, R = null, tab = 'today', clientId = null, filter = '';
  let decisions = store.get(LS_DEC, {});
  let newKeys = new Set(store.get(LS_NEW, []));
  const TABS = ['today', 'money', 'edits', 'leads', 'clients'];

  // ---------- loader (a book that flips its pages) ----------
  const STEPS = ['reading 8 files…', 'matching every spelling…', 'checking the bank…', 'finding what needs you…'];
  let loaderT = null;
  function showLoader() {
    const l = $('#loader'); l.hidden = false; l.classList.remove('gone');
    const bar = $('#lbar'); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
    let i = 0; $('#lstep').textContent = STEPS[0]; clearInterval(loaderT);
    loaderT = setInterval(() => { i = (i + 1) % STEPS.length; $('#lstep').textContent = STEPS[i]; }, 480);
    return Date.now();
  }
  async function hideLoader(t0) {
    await new Promise(r => setTimeout(r, Math.max(0, 1100 - (Date.now() - t0))));
    clearInterval(loaderT); const l = $('#loader'); l.classList.add('gone'); setTimeout(() => { l.hidden = true; }, 450);
  }

  // ---------- data ----------
  async function loadPack() {
    const out = {};
    await Promise.all(PACK.map(async f => { try { const r = await fetch('data/' + f, { cache: 'no-cache' }); if (r.ok) out[f] = await r.text(); } catch (e) { } }));
    return out;
  }
  async function loadJevPack() { try { const r = await fetch('data/jev_labels.json', { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch (e) { } return {}; }
  const SNOOZE = 7 * 86400000;
  function live() {
    const now = Date.now();
    return R.actions.filter(a => { const d = decisions[a.key]; if (!d) return true; if (d.d === 'done') return false; if (d.d === 'no') return now - d.at > SNOOZE; return true; });
  }
  const isMoney = a => a.kind === 'money';
  function rebuild() {
    R = E.build(files, { jevLabels: jev });
    $('#asof').textContent = new Date(R.today).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const L = live();
    const set = (id, n) => { const el = $(id); const v = n || ''; if (el.textContent !== String(v)) { el.textContent = v; } };
    set('#badge-money', L.filter(isMoney).length); set('#badge-edits', L.filter(a => a.kind === 'edit').length); set('#badge-leads', L.filter(a => a.kind === 'lead').length);
  }

  // ---------- short copy for every card ----------
  const VERB = { churn: 'Call', overdue: 'Remind', bill: 'Bill', owe: 'Credit', req: 'Fix', lead: 'Reply', opp: 'Reply', fix: 'Fix' };
  const kindOf = a => a.key.slice(0, a.key.indexOf(':'));
  const restOf = a => a.key.slice(a.key.indexOf(':') + 1);
  const label = t => (E.REQ_TYPES.find(x => x.key === t) || { label: 'Change' }).label.toLowerCase();
  function info(a) {
    const k = kindOf(a), id = restOf(a);
    const f = { verb: VERB[k] || 'Open', icon: 'check', who: a.client ? a.client.name : '', sub: '', right: '', late: '', mark: '' };
    if (k === 'churn') { const c = a.client; f.icon = 'alert'; f.sub = `${c.churnMsgs.length} worrying message${c.churnMsgs.length === 1 ? '' : 's'}. Last ${fdate(c.churnMsgs[c.churnMsgs.length - 1].at)}.`; f.right = a.money ? fk(a.money) : ''; }
    else if (k === 'overdue') { const i = R.invoices.find(x => x.id === id); f.icon = 'receipt'; f.who = (i.payer || i.client).display; f.sub = i.id + (i.toolStatus === 'paid' ? ' · <s>tool: paid</s>' : i.trueStatus === 'partial' ? ' · part paid' : ''); f.right = money(i.balance); f.late = i.daysLate + 'd'; }
    else if (k === 'bill') { const b = R.bookings.find(x => x.id === id); f.icon = 'plus'; f.who = a.client ? a.client.name : b.name; f.sub = `${b.id} · ${b.service} · ${fdate(b.date)}`; f.right = money(b.price); }
    else if (k === 'owe') { const p = R.payments.find(x => x.id === id); f.icon = 'refund'; f.who = a.client ? a.client.name : ''; f.sub = p ? `${p.id} · paid twice` : `${id} · overcharged`; f.right = money(a.money); }
    else if (k === 'req') { const r = R.requests.find(x => x.id === id); f.icon = 'film'; f.who = r.ent.display; f.sub = `${r.video ? r.video.title : 'a video'} · ${label(r.reqType)}`; if (r.chased) f.mark = (1 + r.followups.length) + '×'; f.right = f.mark; f.late = ''; }
    else if (k === 'lead') { const l = R.leads.find(x => x.lead_id === id); f.icon = 'chat'; f.who = l.ent && R.clients.some(c => c.ent === l.ent) ? l.ent.display : (l.business || l.name); f.sub = `${l.source} · waiting ${E.fmtDate ? '' : ''}${Math.round((R.today - l.created_t) / 86400000)}d`; }
    else if (k === 'opp') { const m = R.messages.find(x => x.id === id); f.icon = 'chat'; f.who = m.ent ? m.ent.display : m.who; f.sub = clip(m.text, 44); }
    else if (k === 'fix') { const i = R.invoices.find(x => x.id === id.split(':')[0]); f.icon = 'wrench'; f.who = i.client ? i.client.display : i.name; f.sub = `${i.id} · ${a.title.match(/it says "([^"]+)"/) ? 'tool says ' + a.title.match(/it says "([^"]+)"/)[1] : 'wrong in tool'}`; }
    return f;
  }
  const newTag = a => newKeys.has(a.key) ? '<span class="new">NEW</span>' : '';
  function row(a, i) {
    const f = info(a);
    return `<button class="row rise" style="--i:${i}" data-open="${esc(a.key)}"><span class="ico">${ic(f.icon)}</span><span class="mid"><b>${esc(f.who)}</b><small>${newTag(a)}${f.sub}</small></span>${f.right || f.late ? `<span class="rt"><span class="mono">${esc(f.right)}</span>${f.late ? `<span class="mono late">${esc(f.late)}</span>` : ''}</span>` : ''}<span class="verb">${f.verb}</span></button>`;
  }
  const rows = (list, start) => list.length ? `<div class="rows">${list.map((a, i) => row(a, (start || 0) + i)).join('')}</div>` : '';
  const count = (n, fmt) => `<span class="mono" data-count="${Math.round(n)}" data-fmt="${fmt}">${fmt === 'k' ? fk(n) : fmt === 'm' ? money(n) : Math.round(n)}</span>`;

  // ---------- screens ----------
  function viewToday() {
    const L = live(), s = R.summary;
    const hr = new Date().getHours(); const hi = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    let h = `<h1 class="hello rise" style="--i:0">${hi}, <em>Zaid</em></h1>`;
    if (!L.length) return h + `<div class="empty"><span class="serif">All clear</span>Nothing needs you right now.</div>` + foot();
    const a = L[0], f = info(a);
    const heroTitle = (VERB[kindOf(a)] === 'Call' ? 'Call ' : f.verb + ' ') + f.who;
    h += `<div class="hero rise" style="--i:1" data-key="${esc(a.key)}"><div class="tag"><i class="dot-live"></i>FIRST</div><div class="t">${esc(heroTitle)}</div><p class="s">${esc(heroSub(a, f))}</p><div class="acts"><button class="btn solid" data-open="${esc(a.key)}">${ic(kindOf(a) === 'churn' ? 'phone' : 'check')} ${f.verb}</button><button class="btn ghost" data-later="${esc(a.key)}">Later</button></div></div>`;
    const next = L.slice(1, 4);
    if (next.length) h += `<div class="lbl rise" style="--i:2">Next</div>` + rows(next, 3);
    h += `<div class="lbl rise" style="--i:6">Numbers</div><div class="stats">
      <button class="stat rise ${s.overdueCount ? 'hot' : ''}" style="--i:7" data-tab="money">${count(s.overdueTotal, 'k')}<span>late</span></button>
      <button class="stat rise" style="--i:8" data-tab="money">${count(s.neverBilledTotal, 'k')}<span>unbilled</span></button>
      <button class="stat rise" style="--i:9" data-tab="edits">${count(L.filter(x => x.kind === 'edit').length, 'n')}<span>fixes waiting</span></button></div>`;
    return h + foot();
  }
  function heroSub(a, f) {
    const k = kindOf(a);
    if (k === 'churn') return f.sub + (a.detail && a.detail.some(d => /Also owes/.test(d)) ? ' Also owes ' + (a.detail.find(d => /Also owes/.test(d)).match(/\$[\d,]+/) || [''])[0] + '.' : '');
    if (k === 'overdue') return `${f.right} · ${f.late} late`;
    return f.sub.replace(/<[^>]+>/g, '');
  }
  function foot() {
    const decided = R.actions.filter(a => decisions[a.key]);
    let h = '';
    if (decided.length) h += `<details class="rise" style="--i:10"><summary>Done or later (${decided.length}) ${ic('right')}</summary>${decided.map(a => `<div class="row" style="max-height:none"><span class="mid"><b>${esc(info(a).who)}</b><small>${decisions[a.key].d === 'done' ? 'Done' : 'Later, back in 7 days'}</small></span><button class="verb" data-undo="${esc(a.key)}">Undo</button></div>`).join('')}</details>`;
    return h + `<p class="foot">Nothing is sent from here. You decide, you send. <button id="reset">Reset files</button></p>`;
  }
  function viewMoney() {
    const L = live().filter(isMoney), s = R.summary;
    const late = L.filter(a => kindOf(a) === 'overdue'), bill = L.filter(a => kindOf(a) === 'bill'), owe = L.filter(a => kindOf(a) === 'owe');
    const fixes = live().filter(a => a.kind === 'fix');
    let i = 0, h = `<div class="lbl first-lbl rise" style="--i:0">Money · ${L.length} to do</div><div class="big rise" style="--i:1">${count(s.overdueTotal, 'm')}</div><p class="cap rise" style="--i:2">late, across ${s.overdueCount} invoices</p>`;
    h += `<div class="chips rise" style="--i:3"><span class="chip red">${late.length} late</span><span class="chip">${bill.length} unbilled</span><span class="chip">${owe.length} credits</span></div>`;
    const sec = (t, list) => list.length ? `<div class="lbl rise" style="--i:${4 + i++}">${t}</div>` + rows(list, 5 + i * 2) : '';
    h += sec('Late', late) + sec('Never billed', bill) + sec('We owe', owe);
    if (!L.length) h += `<div class="empty"><span class="serif">Nothing to chase</span>Every invoice is settled.</div>`;
    if (fixes.length) h += `<details class="rise" style="--i:12"><summary>Billing tool is wrong on ${fixes.length} records ${ic('right')}</summary>${rows(fixes, 0).replace('class="rows"', 'class="rows" style="border:0"')}</details>`;
    return h;
  }
  function editCauses() {
    const eds = [...new Set(R.videos.map(v => v.editor))];
    const dead = eds.filter(e => { const vs = R.videos.filter(v => v.editor === e); return vs.length >= 10 && vs.every(v => !v.notes); });
    const stat = pred => { const all = R.requests.filter(pred); return { lost: all.filter(r => !r.onBoard).length, n: all.length }; };
    return { dead: dead.map(e => ({ e, cards: R.videos.filter(v => v.editor === e).length, ...stat(r => r.video && r.video.editor === e) })), voice: stat(r => /voice/.test(r.channel)), ig: stat(r => /instagram/.test(r.channel)), vague: stat(r => r.ref === 'vague'), all: stat(() => true), chases: R.messages.filter(m => m.intent === 'followup').length };
  }
  function viewEdits() {
    const L = live().filter(a => a.kind === 'edit'), c = editCauses();
    let h = `<div class="lbl first-lbl rise" style="--i:0">Edits · ${L.length} waiting</div><div class="h2 rise" style="--i:1">${L.length ? `${L.length} fixes the board never got` : 'Every fix is on the board'}</div>`;
    const d = c.dead[0];
    if (d) h += `<button class="warn rise" style="--i:2" data-why="1">${ic('alert')}<span class="t"><b>${esc(d.e)}'s videos: ${d.lost} of ${d.n} lost.</b> No notes reach his cards.</span><u>Why</u></button>`;
    else h += `<button class="more rise" style="--i:2" data-why="1">Why requests get lost ${ic('right')}</button>`;
    h += `<div class="lbl rise" style="--i:3">Waiting</div>` + (L.length ? rows(L, 4) : `<div class="empty"><span class="serif">All clear</span>Nothing is waiting on an editor.</div>`);
    return h;
  }
  function viewLeads() {
    const L = live().filter(a => a.kind === 'lead');
    const have = new Set(R.actions.map(a => kindOf(a) === 'lead' ? restOf(a) : ''));
    const old = R.leads.filter(l => l.neverReplied && !have.has(l.lead_id));
    const f = R.leads.filter(l => !l.junk && l.replyDays != null && !/new|talking/i.test(l.status));
    const rate = a => a.length ? Math.round(100 * a.filter(l => /won/i.test(l.status)).length / a.length) + '%' : '–';
    let h = `<div class="lbl first-lbl rise" style="--i:0">Leads · ${L.length} to answer</div><div class="h2 rise" style="--i:1">Fast replies win</div><p class="cap rise" style="--i:2">Answered in a day: ${rate(f.filter(l => l.replyDays <= 1))} won. After four days: ${rate(f.filter(l => l.replyDays >= 4))}.</p>`;
    h += L.length ? rows(L, 3).replace('<div class="rows">', '<div class="rows" style="margin-top:14px">') : `<div class="empty"><span class="serif">All answered</span>Every lead has a reply.</div>`;
    if (old.length) h += `<details class="rise" style="--i:9"><summary>${old.length} older, likely cold ${ic('right')}</summary>${old.map(l => `<div class="row" style="max-height:none"><span class="mid"><b>${esc(l.business || l.name)}</b><small>${esc(l.source)} · ${fdate(l.created_t)}</small></span></div>`).join('')}</details>`;
    return h;
  }
  const dot = c => c.paused ? '' : c.risk >= 40 ? 'r' : (c.owed > 0 || c.risk >= 20) ? 'a' : 'g';
  function viewClients() {
    const q = filter.trim().toLowerCase();
    const list = R.clients.filter(c => !q || [c.name, ...c.aliases, ...c.emails, ...c.people].join(' ').toLowerCase().includes(q)).sort((a, b) => (b.risk - a.risk) || a.name.localeCompare(b.name));
    let h = `<div class="lbl first-lbl rise" style="--i:0">Clients · ${R.clients.length}</div><input class="search rise" style="--i:1" id="search" type="search" placeholder="Search any name, email or spelling" value="${esc(filter)}" autocomplete="off">`;
    h += `<div class="rows">` + list.map((c, i) => `<button class="row rise" style="--i:${Math.min(i, 12) + 2}" data-client="${esc(c.id)}"><span class="cdot ${dot(c)}"></span><span class="mid"><b>${esc(c.name)}${c.paused ? ' · paused' : ''}</b><small>${esc(c.aliases.slice(0, 3).join(' · '))}</small></span>${ic('right')}</button>`).join('') + `</div>`;
    if (R.payersNotClients.length && !q) h += `<div class="lbl">Pays for others</div>` + R.payersNotClients.map(p => `<div class="row" style="max-height:none"><span class="mid"><b>${esc(p.name)}</b><small>${esc(p.paysFor.join(' · '))}</small></span></div>`).join('');
    return h;
  }
  function viewClient(id) {
    const c = R.clients.find(x => x.id === id); if (!c) return viewClients();
    const e = c.ent, acts = live().filter(a => a.client && a.client.id === id);
    const ph = c.phones[0], em = c.emails[0];
    const ret = e.invoices.filter(i => i.retainer && i.toolStatus !== 'void').reduce((m, i) => Math.max(m, i.amount), 0);
    const flag = c.paused ? 'PAUSED' : c.risk >= 40 ? 'MAY LEAVE' : '';
    let h = `<button class="back" data-tab="clients">${ic('left')} Clients</button>`;
    if (flag) h += `<div class="chead"><i class="dot-live" style="${c.paused ? 'background:var(--muted);animation:none' : ''}"></i><span class="mono lbl" style="margin:0;color:${c.paused ? 'var(--muted)' : 'var(--red)'}">${flag}</span></div>`;
    h += `<div class="h2 rise" style="--i:0;font-size:36px">${esc(c.name)}</div>`;
    h += `<div class="chips rise" style="--i:1">${c.aliases.slice(0, 3).map(a => `<span class="chip">${esc(a)}</span>`).join('')}${c.aliases.length > 3 ? `<span class="chip">+${c.aliases.length - 3}</span>` : ''}</div>`;
    h += `<div class="contacts rise" style="--i:2">${ph ? `<a class="round" href="tel:+1${ph}" aria-label="Call">${ic('phone')}</a><a class="round" href="https://wa.me/1${ph}" target="_blank" rel="noopener" aria-label="WhatsApp">${ic('chat')}</a>` : ''}${em ? `<a class="round" href="mailto:${esc(em)}" aria-label="Email">${ic('mail')}</a>` : ''}</div>`;
    h += `<div class="stats rise" style="--i:3;margin-top:16px"><div class="stat">${ret ? `<span class="mono">${fk(ret)}</span><span>per month</span>` : `<span class="mono">${fk(c.billed)}</span><span>billed</span>`}</div><div class="stat ${c.owed ? 'hot' : ''}"><span class="mono">${fk(c.owed)}</span><span>late</span></div><div class="stat ${c.lost.length ? 'hot' : ''}"><span class="mono">${c.lost.length}</span><span>lost edits</span></div></div>`;
    const msgs = e.messages.filter(m => m.dir === 'from' && m.intent !== 'spam').sort((a, b) => b.at - a.at).slice(0, 3);
    if (msgs.length) h += `<div class="lbl rise" style="--i:4">Latest</div>` + msgs.map(m => `<div class="quote rise ${m.intent === 'churn_risk' ? 'hot' : ''}" style="--i:5"><span class="mono">${fdate(m.at)}</span><span>"${esc(clip(m.text, 110))}"</span></div>`).join('');
    if (acts.length) h += `<div class="lbl">Needs you</div>` + rows(acts, 6);
    const invs = R.invoices.filter(i => i.client === e || i.payer === e).sort((a, b) => b.issued - a.issued);
    h += `<div style="margin-top:20px"></div>`;
    h += `<details><summary>Invoices (${invs.length}) ${ic('right')}</summary><table>${invs.map(i => `<tr><td>${i.id}<br><span style="color:var(--muted)">${fdate(i.issued)}</span></td><td class="r">${money(i.amount)}</td><td>${i.toolStatus === 'void' ? 'void' : i.trueStatus === 'paid' ? 'paid' : i.overdue ? `<span style="color:var(--red)">${i.daysLate}d late</span>` : i.trueStatus}${i.toolStatus !== i.trueStatus && i.toolStatus !== 'void' ? `<br><span style="color:var(--muted)">tool: ${esc(i.toolStatus)}</span>` : ''}</td></tr>`).join('')}</table></details>`;
    const reqs = R.requests.filter(r => r.ent === e).sort((a, b) => b.at - a.at);
    h += `<details><summary>Change requests (${reqs.length}) ${ic('right')}</summary>${reqs.slice(0, 15).map(r => `<div class="msg ${r.onBoard ? '' : 'lost'}"><span class="w">${fdate(r.at)} · ${esc(r.channel)} · ${r.video ? esc(r.video.id + ' ' + r.video.title) : '?'} · ${r.onBoard ? 'on board' : 'not on board'}</span>${esc(r.text)}</div>`).join('')}</details>`;
    const all = e.messages.slice().sort((a, b) => b.at - a.at);
    h += `<details><summary>All messages (${all.length}) ${ic('right')}</summary>${all.slice(0, 30).map(m => `<div class="msg"><span class="w">${fdate(m.at)} · ${esc(m.channel)}${m.dir === 'to' ? ' · sent' : ''} · ${esc(m.intent.replace('_', ' '))}${m.labelSource === 'jev' ? ' · Jev' : ''}</span>${esc(m.text)}</div>`).join('')}</details>`;
    const bks = e.bookings.slice().sort((a, b) => b.date - a.date);
    h += `<details><summary>Bookings (${bks.length}) ${ic('right')}</summary><table>${bks.map(b => { const inv = R.invoices.find(i => i.bookings.includes(b)); return `<tr><td>${b.id}<br><span style="color:var(--muted)">${esc(b.service)}</span></td><td>${fdate(b.date)}<br><span style="color:var(--muted)">${esc(b.status)}</span></td><td class="r">${inv ? inv.id : (b.price > 0 && b.status === 'completed' ? '<span style="color:var(--red)">not billed</span>' : '')}</td></tr>`; }).join('')}</table></details>`;
    return h;
  }

  // ---------- render + nav ----------
  let animT = null;
  function render(animate) {
    const t = tab === 'client' ? 'clients' : tab;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('#pill').style.transform = `translateX(${TABS.indexOf(t) * 100}%)`;
    const v = $('#view');
    v.className = animate === false ? '' : 'anim'; clearTimeout(animT); animT = setTimeout(() => v.classList.remove('anim'), 1300);
    v.innerHTML = tab === 'today' ? viewToday() : tab === 'money' ? viewMoney() : tab === 'edits' ? viewEdits() : tab === 'leads' ? viewLeads() : tab === 'client' ? viewClient(clientId) : viewClients();
    const s = $('#search'); if (s) s.oninput = () => { filter = s.value; const pos = s.selectionStart; render(false); const n = $('#search'); n.focus(); n.setSelectionRange(pos, pos); };
    countUp(v);
  }
  function countUp(root) {
    root.querySelectorAll('[data-count]').forEach(el => {
      const to = +el.dataset.count, fmt = el.dataset.fmt; if (reduced() || !to) return;
      const show = n => el.textContent = fmt === 'k' ? fk(n) : fmt === 'm' ? money(n) : Math.round(n);
      const t0 = performance.now(), dur = 700; show(0);
      (function tick(now) { const p = Math.min(1, (now - t0) / dur); show(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); else show(to); })(t0);
    });
  }
  function go(t, id) { tab = t; if (id) clientId = id; closeSheet(); render(); window.scrollTo({ top: 0 }); }

  function decide(key, d, msg) {
    const els = [...document.querySelectorAll(`[data-open="${CSS.escape(key)}"], .hero[data-key="${CSS.escape(key)}"]`)];
    els.forEach(el => el.classList.add('out'));
    setTimeout(() => { decisions[key] = { d, at: Date.now() }; store.set(LS_DEC, decisions); newKeys.delete(key); store.set(LS_NEW, [...newKeys]); rebuild(); render(false); toast(msg + ` <u data-undo-toast="${esc(key)}">Undo</u>`, 4000); }, els.length && !reduced() ? 260 : 0);
  }
  function undo(key) { delete decisions[key]; store.set(LS_DEC, decisions); rebuild(); render(false); }

  // ---------- sheet: draft only, never sends ----------
  function openSheet(a) {
    const f = info(a), ct = a.contact || {}, phone = (ct.phone || '').replace(/\D/g, ''), k = kindOf(a);
    const why = (a.detail || []).filter(Boolean).slice(0, 4);
    let h = `<div class="lbl" style="margin:0">${f.verb} · ${esc(f.who)}</div><div class="t">${k === 'edit' || k === 'req' ? 'Add it to the board' : k === 'fix' ? 'Fix it in the billing tool' : "Here's what to say"}</div>`;
    if (why.length) h += `<ul>${why.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (a.draft) h += `<textarea id="draft" aria-label="Draft">${esc(a.draft)}</textarea><div class="safe">${ic('lock')} Nothing is sent from here. You send it.</div>`;
    const btns = [];
    if (phone) btns.push(`<a href="tel:+1${phone}">${ic('phone')}Call</a>`, `<a id="wa" href="#" target="_blank" rel="noopener">${ic('chat')}WhatsApp</a>`);
    if (ct.email) btns.push(`<a id="mail" href="#">${ic('mail')}Email</a>`);
    if (a.draft) btns.push(`<button id="copy" type="button">${ic('copy')}Copy</button>`);
    if (btns.length) h += `<div class="four">${btns.join('')}</div>`;
    h += `<div class="end"><button class="btn fill" data-done="${esc(a.key)}">${ic('check')} Done</button><button class="btn line" data-later="${esc(a.key)}">Later</button></div>`;
    showSheet(h);
    const text = () => ($('#draft') || {}).value || '';
    const wa = $('#wa'); if (wa) wa.onclick = () => { wa.href = `https://wa.me/1${phone}?text=${encodeURIComponent(text())}`; };
    const mail = $('#mail'); if (mail) mail.onclick = () => { mail.href = `mailto:${ct.email}?subject=${encodeURIComponent(isMoney(a) ? 'Invoice reminder' : 'Axeom')}&body=${encodeURIComponent(text())}`; };
    const cp = $('#copy'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(text()); } catch (e) { $('#draft').select(); document.execCommand('copy'); } toast('Copied'); };
  }
  function openWhy() {
    const c = editCauses(); const x = (s) => `${s.lost} of ${s.n}`;
    let h = `<div class="lbl" style="margin:0">Edits</div><div class="t">Why requests get lost</div>`;
    h += `<div class="cause"><span class="mono">${x(c.all)}</span><span>change requests never reached the board, since April.</span></div>`;
    c.dead.forEach(d => h += `<div class="cause"><span class="mono">${x(d)}</span><span>on ${esc(d.e)}'s videos. None of his ${d.cards} cards has a note.</span></div>`);
    h += `<div class="cause"><span class="mono">${x(c.voice)}</span><span>voice notes. They are never copied over.</span></div>`;
    h += `<div class="cause"><span class="mono">${x(c.ig)}</span><span>Instagram DMs. Same.</span></div>`;
    h += `<div class="cause"><span class="mono">${x(c.vague)}</span><span>said "the one we shot last week". One shoot makes 2 to 4 videos.</span></div>`;
    h += `<div class="cause"><span class="mono">${c.chases}×</span><span>clients had to chase ("second time I ask").</span></div>`;
    h += `<div class="end"><button class="btn fill" id="closeSheet">Got it</button></div>`;
    showSheet(h);
  }
  function showSheet(h) { $('#sheet').innerHTML = h; $('#sheet').hidden = false; $('#sheetBg').hidden = false; const c = $('#closeSheet'); if (c) c.onclick = closeSheet; }
  function closeSheet() { $('#sheet').hidden = true; $('#sheetBg').hidden = true; }
  let toastT = null;
  function toast(msg, ms) { const t = $('#toast'); t.innerHTML = msg; t.hidden = false; t.style.animation = 'none'; void t.offsetWidth; t.style.animation = ''; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 2200); }

  // ---------- Add new files ----------
  async function addFiles(list) {
    const t0 = showLoader();
    const before = new Set(R.actions.map(a => a.key)), beforeSum = R.summary;
    const report = [], unknown = [], newMsgs = [];
    for (const f of list) {
      const text = await f.text(), kind = E.detectKind(f.name, text);
      if (!kind) { unknown.push(f.name); continue; }
      const m = E.mergeFile(kind, files[kind], text);
      if (kind === 'messages.txt' && files[kind]) { const old = new Set(files[kind].split(/\r?\n/).map(l => l.trim())); text.split(/\r?\n/).forEach(l => { if (l.trim() && !old.has(l.trim())) newMsgs.push(l.trim()); }); }
      files[kind] = m.text;
      report.push(`${kind.replace(/\.(csv|txt)$/, '')} ${m.added == null ? 'loaded' : '+' + m.added + (m.updated ? ' ~' + m.updated : '')}`);
    }
    if (!store.set(LS_FILES, files)) report.push('not saved in this browser');
    if (newMsgs.length) await classifyWithJev(newMsgs);
    rebuild();
    const added = R.actions.filter(a => !before.has(a.key)).map(a => a.key);
    added.forEach(k => newKeys.add(k)); store.set(LS_NEW, [...newKeys]);
    tab = 'today'; render();
    await hideLoader(t0);
    let msg = report.join(' · ');
    if (unknown.length) msg += (msg ? '. ' : '') + `Couldn't read ${esc(unknown.join(', '))}`;
    msg += `. ${added.length} new · late ${money(beforeSum.overdueTotal)} → ${money(R.summary.overdueTotal)}`;
    toast(msg, 7000);
  }
  // Optional: with the /api/classify function deployed (Vercel + TYPESAFE_API_KEY), Jev labels new messages; otherwise the built-in rules do.
  async function classifyWithJev(lines) {
    try {
      const res = await fetch('api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) });
      if (!res.ok) return;
      const out = await res.json();
      if (out && out.labels) { Object.assign(jev, out.labels); const cache = store.get(LS_JEV, {}); Object.assign(cache, out.labels); store.set(LS_JEV, cache); }
    } catch (e) { }
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('button, a'); if (!t) return;
    const d = t.dataset;
    if (d.tab) return go(d.tab);
    if (d.client) return go('client', d.client);
    if (d.open) { const a = R.actions.find(x => x.key === d.open); if (a) openSheet(a); return; }
    if (d.why) return openWhy();
    if (d.later) { closeSheet(); return decide(d.later, 'no', 'Later'); }
    if (d.done) { closeSheet(); return decide(d.done, 'done', 'Done'); }
    if (d.undo) return undo(d.undo);
    if (t.id === 'reset') { if (confirm('Go back to the original pack files? Uploaded files and your choices are cleared.')) { localStorage.removeItem(LS_FILES); localStorage.removeItem(LS_DEC); localStorage.removeItem(LS_NEW); location.reload(); } }
  });
  $('#toast').addEventListener('click', e => { const u = e.target.closest('[data-undo-toast]'); if (u) { undo(u.dataset.undoToast); $('#toast').hidden = true; } });
  $('#sheetBg').onclick = closeSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  $('#uploadBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = e => { const l = [...e.target.files]; e.target.value = ''; if (l.length) addFiles(l); };
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); const l = [...(e.dataTransfer.files || [])]; if (l.length) addFiles(l); });

  // ---------- start ----------
  (async function start() {
    const t0 = Date.now();
    const saved = store.get(LS_FILES, null);
    files = saved && Object.keys(saved).length ? saved : await loadPack();
    jev = Object.assign({}, await loadJevPack(), store.get(LS_JEV, {}));
    try { rebuild(); render(); await hideLoader(t0); }
    catch (err) { console.error(err); clearInterval(loaderT); $('#loader').classList.add('gone'); $('#view').innerHTML = `<div class="empty"><span class="serif">The files broke the reader</span>${esc(err.message)}<br><br><button class="btn line" id="reset">Reset files</button></div>`; }
  })();
})();
