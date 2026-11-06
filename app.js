/* Axeom Today: the owner's screen. Suggests, never acts: every "Yes" opens a draft the owner sends himself. */
(function () {
  'use strict';
  const E = window.AxeomEngine;
  const PACK = ['leads.csv', 'bookings.csv', 'invoices.csv', 'payments.csv', 'production_board.csv', 'messages.txt', 'team.csv', 'costs.csv'];
  const LS_FILES = 'axeom.files.v1', LS_DEC = 'axeom.decisions.v1', LS_JEV = 'axeom.jev.v1', LS_NEW = 'axeom.newkeys.v1';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const fdate = t => t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  let files = {}, jev = {}, R = null, tab = 'today', clientId = null, filter = '';
  let decisions = store.get(LS_DEC, {});
  let newKeys = new Set(store.get(LS_NEW, []));

  // ---------- data ----------
  async function loadPack() {
    const out = {};
    await Promise.all(PACK.map(async f => { try { const r = await fetch('data/' + f, { cache: 'no-cache' }); if (r.ok) out[f] = await r.text(); } catch (e) { } }));
    return out;
  }
  async function loadJevPack() { try { const r = await fetch('data/jev_labels.json', { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch (e) { } return {}; }

  function rebuild() {
    R = E.build(files, { jevLabels: jev });
    const t = new Date(R.today);
    $('#asof').textContent = 'Data as of ' + t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const openActs = live();
    $('#badge-money').textContent = openActs.filter(a => a.kind === 'money').length || '';
    $('#badge-edits').textContent = openActs.filter(a => a.kind === 'edit').length || '';
    $('#badge-leads').textContent = openActs.filter(a => a.kind === 'lead').length || '';
  }
  const SNOOZE = 7 * 86400000;
  function live() {
    const now = Date.now();
    return R.actions.filter(a => { const d = decisions[a.key]; if (!d) return true; if (d.d === 'done') return false; if (d.d === 'no') return now - d.at > SNOOZE; return true; });
  }
  function decide(key, d) { decisions[key] = { d, at: Date.now() }; store.set(LS_DEC, decisions); newKeys.delete(key); store.set(LS_NEW, [...newKeys]); rebuild(); render(); }
  function undo(key) { delete decisions[key]; store.set(LS_DEC, decisions); rebuild(); render(); }

  // ---------- render helpers ----------
  const KIND = { churn: ['churn', 'Client at risk'], money: ['money', 'Money'], edit: ['edit', 'Edit'], lead: ['lead', 'Lead'], fix: ['fix', 'Billing fix'] };
  function pill(a) { const k = KIND[a.kind] || ['grey', a.kind]; return `<span class="pill ${k[0]}">${k[1]}</span>` + (newKeys.has(a.key) ? '<span class="pill grey">NEW</span>' : ''); }
  function actionCard(a, big) {
    const det = (a.detail || []).filter(Boolean).slice(0, big ? 4 : 2);
    if (big) return `<div class="first"><span class="tag">Do this first</span>${pill(a)}<p class="title">${esc(a.title)}</p><ul>${det.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="row"><button class="btn yes" data-yes="${esc(a.key)}">${esc(a.yes || 'Yes')}</button><button class="btn no" data-no="${esc(a.key)}">Not now</button></div></div>`;
    return `<div class="card">${pill(a)}<div class="title">${esc(a.title)}</div>${det.length ? `<ul>${det.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<div class="row"><button class="btn yes small" data-yes="${esc(a.key)}">${esc(a.yes || 'Yes')}</button><button class="btn no small" data-no="${esc(a.key)}">No</button>${a.client ? `<button class="btn small" data-client="${esc(a.client.id)}">Client</button>` : ''}</div></div>`;
  }
  function doneLine() {
    const done = R.actions.filter(a => decisions[a.key] && decisions[a.key].d === 'done');
    const snoozed = R.actions.filter(a => decisions[a.key] && decisions[a.key].d === 'no');
    if (!done.length && !snoozed.length) return '';
    return `<div class="done-line">${done.length} done, ${snoozed.length} snoozed. <button class="more" id="showDone">Show</button></div>`;
  }

  // ---------- views ----------
  function viewToday() {
    const acts = live();
    const s = R.summary;
    let h = '';
    if (!acts.length) h += `<div class="empty"><h1>All clear.</h1><p>Nothing needs you right now.</p></div>`;
    else {
      h += actionCard(acts[0], true);
      const next = acts.slice(1, 5);
      if (next.length) h += `<h2>Then</h2>` + next.map(a => actionCard(a)).join('');
      if (acts.length > 5) h += `<button class="more" id="showAll">See all ${acts.length} suggestions</button>`;
    }
    h += `<h2>The numbers</h2><div class="stats">
      <button class="stat" data-tab="money"><b>${money(s.overdueTotal)}</b><span>overdue (${s.overdueCount} invoices)</span></button>
      <button class="stat" data-tab="money"><b>${money(s.neverBilledTotal)}</b><span>work never billed</span></button>
      <button class="stat" data-tab="edits"><b>${R.requests.filter(r => !r.onBoard && r.chased).length}</b><span>clients chasing a fix</span></button>
    </div>`;
    h += doneLine();
    h += `<p class="small" style="margin-top:28px">Nothing is sent automatically. "Yes" opens a draft you send yourself. Data: ${R.clients.length} clients, ${R.invoices.length} invoices, ${R.messages.length} messages. <button class="more" id="reset">Reset to the original files</button></p>`;
    return h;
  }
  function viewAll() {
    const acts = live();
    const groups = [['churn', 'Clients at risk'], ['money', 'Money'], ['edit', 'Edits clients are waiting for'], ['lead', 'Leads and opportunities'], ['fix', 'Billing tool corrections']];
    let h = `<button class="back" data-tab="today">‹ Today</button><h1>All suggestions</h1><p class="sub">${acts.length} open, most important first.</p>`;
    groups.forEach(([k, label]) => { const g = acts.filter(a => a.kind === k); if (g.length) h += `<h2>${label} (${g.length})</h2>` + g.map(a => actionCard(a)).join(''); });
    const decided = R.actions.filter(a => decisions[a.key]);
    if (decided.length) h += `<h2>Done or snoozed</h2>` + decided.map(a => `<div class="card"><div class="meta">${decisions[a.key].d === 'done' ? 'Done' : 'Snoozed 7 days'}</div><div class="title">${esc(a.title)}</div><div class="row"><button class="btn small" data-undo="${esc(a.key)}">Undo</button></div></div>`).join('');
    return h;
  }
  function viewMoney() {
    const s = R.summary; const acts = live();
    const over = R.invoices.filter(i => i.overdue).sort((a, b) => b.daysLate - a.daysLate);
    const nb = R.findings.filter(f => f.kind === 'never_billed');
    const owe = R.findings.filter(f => f.kind === 'we_owe');
    const wrong = R.findings.filter(f => f.kind === 'tool_wrong');
    const due = R.invoices.filter(i => i.balance > 0 && !i.overdue && i.toolStatus !== 'void' && !i.cancelledBooking).sort((a, b) => a.due - b.due);
    const key = k => acts.find(a => a.key === k);
    let h = `<h1>Money</h1><p class="sub">From the bank (payments.csv), not the billing tool's labels.</p>`;
    h += `<div class="stats"><div class="stat"><b>${money(s.overdueTotal)}</b><span>owed to us, late</span></div><div class="stat"><b>${money(s.neverBilledTotal)}</b><span>never billed</span></div><div class="stat"><b>${money(s.weOweTotal)}</b><span>we owe clients</span></div></div>`;
    h += `<h2>Late (${over.length})</h2><div class="tablewrap"><table><tr><th>Who</th><th class="r">Owed</th><th class="r">Late</th><th></th></tr>` + over.map(i => { const a = key('overdue:' + i.id); return `<tr><td><button class="more" data-client="${esc((i.client || i.payer).id)}">${esc((i.payer || i.client).display)}</button><div class="small">${i.id}${i.toolStatus === 'paid' ? ' · tool wrongly says paid' : ''}${i.trueStatus === 'partial' ? ' · part paid' : ''}</div></td><td class="r">${money(i.balance)}</td><td class="r">${i.daysLate}d</td><td class="r">${a ? `<button class="btn small yes" data-yes="${esc(a.key)}">Remind</button>` : '<span class="pill ok">handled</span>'}</td></tr>`; }).join('') + `</table></div>`;
    if (nb.length) h += `<h2>Work never billed (${nb.length})</h2>` + nb.map(f => { const a = key('bill:' + f.booking.id); return a ? actionCard(a) : `<div class="card"><div class="title">${esc(f.client ? f.client.display : f.booking.name)} · ${f.booking.id} · ${money(f.amount)}</div><div class="meta">Handled</div></div>`; }).join('');
    if (owe.length) h += `<h2>We owe (${owe.length})</h2>` + owe.map(f => { const a = key('owe:' + (f.pay ? f.pay.id : f.inv.id)); return a ? actionCard(a) : ''; }).join('');
    if (wrong.length) h += `<h2>Billing tool is wrong (${wrong.length})</h2><div class="tablewrap"><table><tr><th>Invoice</th><th>Tool says</th><th>Truth</th></tr>` + wrong.map(f => `<tr><td>${f.invoice}<div class="small">${esc(f.inv.client ? f.inv.client.display : '')}</div></td><td>${esc(f.tool)}</td><td>${esc(f.truth)}<div class="small">${esc(f.how)}</div></td></tr>`).join('') + `</table></div>`;
    if (due.length) h += `<h2>Open, not due yet (${due.length})</h2><div class="tablewrap"><table>` + due.map(i => `<tr><td>${esc((i.payer || i.client || {}).display || i.name)}<div class="small">${i.id}</div></td><td class="r">${money(i.balance)}</td><td class="r">due ${fdate(i.due)}</td></tr>`).join('') + `</table></div>`;
    return h;
  }
  function viewEdits() {
    const lost = R.requests.filter(r => !r.onBoard);
    const acts = live().filter(a => a.kind === 'edit');
    const cause = (pred) => { const all = R.requests.filter(pred); return `${all.filter(r => !r.onBoard).length} of ${all.length}`; };
    const editors = [...new Set(R.videos.map(v => v.editor))];
    const noNotes = editors.filter(e => { const vs = R.videos.filter(v => v.editor === e); return vs.length >= 10 && vs.every(v => !v.notes); });
    let h = `<h1>Edits</h1><p class="sub">${lost.length} of ${R.requests.length} change requests from clients never reached the board.</p>`;
    h += `<div class="card"><div class="title">Why requests get lost</div><ul>`;
    noNotes.forEach(e => h += `<li>Videos edited by <b>${esc(e)}</b>: ${cause(r => r.video && r.video.editor === e)} lost. None of ${esc(e)}'s ${R.videos.filter(v => v.editor === e).length} cards has a note.</li>`);
    h += `<li>Voice notes: ${cause(r => /voice/.test(r.channel))} lost. Instagram DMs: ${cause(r => /instagram/.test(r.channel))} lost.</li>`;
    h += `<li>"The one we shot last week" (no video named): ${cause(r => r.ref === 'vague')} lost.</li>`;
    h += `<li>Clients had to chase ${R.messages.filter(m => m.intent === 'followup').length} times ("second time I ask", "did anyone see my message").</li></ul></div>`;
    h += `<h2>Waiting on a fix (${acts.length})</h2>` + (acts.length ? acts.map(a => actionCard(a)).join('') : '<div class="empty">None open.</div>');
    return h;
  }
  function viewLeads() {
    const acts = live().filter(a => a.kind === 'lead');
    const f = R.leads.filter(l => !l.junk && l.replyDays != null && !/new|talking/i.test(l.status));
    const fast = f.filter(l => l.replyDays <= 1), slow = f.filter(l => l.replyDays >= 4);
    const rate = a => a.length ? Math.round(100 * a.filter(l => /won/i.test(l.status)).length / a.length) + '%' : '-';
    let h = `<h1>Leads</h1><p class="sub">Leads answered within a day were won ${rate(fast)} of the time. Leads answered after 4+ days: ${rate(slow)}.</p>`;
    h += acts.length ? acts.map(a => actionCard(a)).join('') : '<div class="empty">Every lead has a reply.</div>';
    const talking = R.leads.filter(l => /talking/i.test(l.status));
    if (talking.length) h += `<h2>In conversation (${talking.length})</h2>` + talking.map(l => `<div class="card"><div class="title">${esc(l.name)}${l.business ? ' · ' + esc(l.business) : ''}</div><div class="meta">${esc(l.source)} · since ${fdate(l.created_t)}</div></div>`).join('');
    return h;
  }
  function riskDot(c) { if (c.paused) return 'x'; if (c.risk >= 40) return 'r'; if (c.owed > 0 || c.risk >= 20) return 'a'; return 'g'; }
  function viewClients() {
    const q = filter.trim().toLowerCase();
    const list = R.clients.filter(c => !q || [c.name, ...c.aliases, ...c.emails, ...c.people].join(' ').toLowerCase().includes(q)).sort((a, b) => (b.risk - a.risk) || a.name.localeCompare(b.name));
    let h = `<h1>Clients</h1><p class="sub">${R.clients.length} clients. Every spelling, email and phone is linked. Red = may leave, amber = owes money or is chasing a fix.</p>`;
    h += `<input class="search" id="search" type="search" placeholder="Search any name, email or spelling" value="${esc(filter)}">`;
    h += list.map(c => `<button class="client-row" data-client="${esc(c.id)}"><div><div class="n">${esc(c.name)}${c.paused ? ' <span class="pill grey">paused</span>' : ''}</div><div class="a">${esc(c.aliases.slice(0, 3).join(' · '))}</div></div><span class="dot ${riskDot(c)}"></span></button>`).join('');
    if (R.payersNotClients.length) h += `<h2>Pays for others</h2>` + R.payersNotClients.map(p => `<div class="card"><div class="title">${esc(p.name)}</div><div class="meta">Pays for ${esc(p.paysFor.join(', '))}</div></div>`).join('');
    return h;
  }
  function viewClient(id) {
    const c = R.clients.find(x => x.id === id); if (!c) return viewClients();
    const e = c.ent; const acts = live().filter(a => a.client && a.client.id === id);
    let h = `<button class="back" data-tab="clients">‹ Clients</button><h1>${esc(c.name)}</h1>`;
    h += `<p class="kv">Also written as: ${esc(c.aliases.join(', ') || '-')}</p>`;
    h += `<p class="kv"><b>Contacts</b> ${esc(c.people.join(', '))} · ${c.emails.map(m => `<a href="mailto:${esc(m)}">${esc(m)}</a>`).join(', ')} · ${c.phones.map(p => `<a href="tel:+1${p}">${p.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}</a>`).join(', ')}</p>`;
    h += `<p class="kv"><b>Came from</b> ${esc(c.source || '?')}${c.paidBy.length ? ` · <b>Paid by</b> ${esc(c.paidBy.join(', '))}` : ''} · <b>Billed</b> ${money(c.billed)} · <b>Collected</b> ${money(c.collected)}${c.nextShoot ? ` · <b>Next shoot</b> ${fdate(c.nextShoot)}` : ''}</p>`;
    if (c.riskWhy && c.risk >= 20) h += `<div class="card"><span class="pill churn">Risk</span><ul>${c.riskWhy.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    if (acts.length) h += `<h2>Needs you (${acts.length})</h2>` + acts.map(a => actionCard(a)).join('');
    const invs = R.invoices.filter(i => i.client === e || i.payer === e).sort((a, b) => b.issued - a.issued);
    if (invs.length) h += `<h2>Invoices</h2><div class="tablewrap"><table><tr><th>Invoice</th><th class="r">Amount</th><th>Status</th></tr>` + invs.map(i => `<tr><td>${i.id}<div class="small">${fdate(i.issued)} · ${esc(i.bookings.map(b => b.id).join(', ') || i.memo || '')}</div></td><td class="r">${money(i.amount)}</td><td>${i.toolStatus === 'void' ? '<span class="pill grey">void</span>' : i.trueStatus === 'paid' ? '<span class="pill ok">paid</span>' : i.overdue ? `<span class="pill money">${i.daysLate}d late</span>` : `<span class="pill grey">${i.trueStatus}</span>`}${i.toolStatus !== i.trueStatus && i.toolStatus !== 'void' ? `<div class="small">tool says ${esc(i.toolStatus)}</div>` : ''}</td></tr>`).join('') + `</table></div>`;
    const reqs = R.requests.filter(r => r.ent === e).sort((a, b) => b.at - a.at);
    if (reqs.length) h += `<h2>Change requests (${reqs.filter(r => !r.onBoard).length} lost of ${reqs.length})</h2>` + reqs.slice(0, 12).map(r => `<div class="msg ${r.onBoard ? 'req' : 'lost'}"><div class="w">${fdate(r.at)} · ${esc(r.channel)} · ${r.video ? esc(r.video.id + ' ' + r.video.title + ' (' + r.video.editor + ')') : '?'} · ${r.onBoard ? 'on board' : '<b>not on board</b>'}</div>${esc(r.text)}</div>`).join('');
    const msgs = e.messages.slice().sort((a, b) => b.at - a.at);
    if (msgs.length) h += `<h2>All messages (${msgs.length})</h2>` + msgs.slice(0, 30).map(m => `<div class="msg ${m.intent === 'churn_risk' ? 'churn' : m.intent === 'spam' ? 'spam' : ''}"><div class="w">${fdate(m.at)} · ${esc(m.channel)} ${m.dir === 'to' ? '(sent)' : ''} · ${esc(m.intent.replace('_', ' '))}${m.labelSource === 'jev' ? ' · Jev' : ''}</div>${esc(m.text)}</div>`).join('');
    const bks = e.bookings.slice().sort((a, b) => b.date - a.date);
    h += `<h2>Bookings (${bks.length})</h2><div class="tablewrap"><table>` + bks.map(b => `<tr><td>${b.id}<div class="small">${esc(b.service)}</div></td><td>${fdate(b.date)}</td><td>${esc(b.status)}</td><td class="r">${R.invoices.find(i => i.bookings.includes(b)) ? R.invoices.find(i => i.bookings.includes(b)).id : (b.price > 0 && b.status === 'completed' ? '<span class="pill money">not billed</span>' : '')}</td></tr>`).join('') + `</table></div>`;
    return h;
  }

  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (tab === 'client' ? 'clients' : tab === 'all' ? 'today' : tab)));
    const v = $('#view');
    v.innerHTML = tab === 'today' ? viewToday() : tab === 'all' ? viewAll() : tab === 'money' ? viewMoney() : tab === 'edits' ? viewEdits() : tab === 'leads' ? viewLeads() : tab === 'client' ? viewClient(clientId) : viewClients();
    const s = $('#search'); if (s) { s.oninput = () => { filter = s.value; const pos = s.selectionStart; render(); const n = $('#search'); n.focus(); n.setSelectionRange(pos, pos); }; }
  }
  function go(t, id) { tab = t; if (id) clientId = id; render(); window.scrollTo(0, 0); }

  // ---------- the Yes sheet: drafts only ----------
  function openSheet(a) {
    const ct = a.contact || {};
    const phone = (ct.phone || '').replace(/\D/g, '');
    let h = `${pill(a)}<h3>${esc(a.title)}</h3>`;
    if (a.kind === 'edit') {
      h += `<p class="note">Copy this onto the video's card on the production board${a.video && a.video.editor === 'Nico' ? ', and give the video to Ali or Rita, or walk Nico through it' : ''}. Then reply to the client so they know it's being fixed.</p>`;
    } else if (a.kind === 'fix') {
      h += `<p class="note">${esc((a.detail || [])[0] || '')}</p><p class="note">Change it in the billing tool, then tap Done.</p>`;
    } else {
      h += `<p class="note">Here is a draft. Edit it and send it yourself. Nothing is sent from here.</p>`;
    }
    if (a.draft) h += `<textarea id="draft">${esc(a.draft)}</textarea>`;
    h += `<div class="row">`;
    if (phone && (a.kind === 'churn' || a.kind === 'money' || a.kind === 'lead')) h += `<a class="btn" href="tel:+1${phone}">Call</a><a class="btn" id="wa" href="#" target="_blank" rel="noopener">WhatsApp</a>`;
    if (ct.email) h += `<a class="btn" id="mail" href="#">Email</a>`;
    if (a.draft) h += `<button class="btn" id="copy">Copy</button>`;
    h += `</div><div class="row"><button class="btn yes" data-done="${esc(a.key)}">Done</button><button class="btn no" id="closeSheet">Close</button></div>`;
    $('#sheet').innerHTML = h; $('#sheet').hidden = false; $('#sheetBg').hidden = false;
    const text = () => ($('#draft') || {}).value || '';
    const wa = $('#wa'); if (wa) wa.onclick = () => { wa.href = `https://wa.me/1${phone}?text=${encodeURIComponent(text())}`; };
    const mail = $('#mail'); if (mail) mail.onclick = () => { mail.href = `mailto:${ct.email}?subject=${encodeURIComponent(a.kind === 'money' ? 'Invoice reminder' : 'Axeom')}&body=${encodeURIComponent(text())}`; };
    const cp = $('#copy'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(text()); toast('Copied.'); } catch (e) { $('#draft').select(); document.execCommand('copy'); toast('Copied.'); } };
    $('#closeSheet').onclick = closeSheet;
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheetBg').hidden = true; }
  let toastT = null;
  function toast(msg, ms) { const t = $('#toast'); t.innerHTML = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms || 2500); }

  // ---------- Add new files ----------
  async function addFiles(list) {
    const before = R ? new Set(R.actions.map(a => a.key)) : new Set();
    const beforeSum = R ? R.summary : null;
    const report = []; const unknown = []; const newMsgs = [];
    for (const f of list) {
      const text = await f.text();
      const kind = E.detectKind(f.name, text);
      if (!kind) { unknown.push(f.name); continue; }
      const m = E.mergeFile(kind, files[kind], text);
      if (kind === 'messages.txt' && files[kind]) { const old = new Set(files[kind].split(/\r?\n/).map(l => l.trim())); text.split(/\r?\n/).forEach(l => { if (l.trim() && !old.has(l.trim())) newMsgs.push(l.trim()); }); }
      files[kind] = m.text;
      report.push(`${esc(kind)}: ${m.added == null ? 'loaded' : `${m.added} new${m.updated ? ', ' + m.updated + ' changed' : ''}`}`);
    }
    if (!store.set(LS_FILES, files)) report.push('(could not save in this browser; changes last until you close the page)');
    if (newMsgs.length) await classifyWithJev(newMsgs);
    rebuild();
    const added = R.actions.filter(a => !before.has(a.key)).map(a => a.key);
    added.forEach(k => newKeys.add(k)); store.set(LS_NEW, [...newKeys]);
    let msg = report.length ? 'Updated ' + report.join(' · ') + '.' : '';
    if (unknown.length) msg += ` Could not recognise: ${esc(unknown.join(', '))}. Expected the same columns as the pack files.`;
    if (beforeSum) msg += ` ${added.length} new suggestion${added.length === 1 ? '' : 's'}. Overdue ${money(beforeSum.overdueTotal)} → ${money(R.summary.overdueTotal)}.`;
    go('today'); toast(msg, 7000);
  }
  // Optional: if the site runs with the /api/classify function (Vercel + TYPESAFE_API_KEY), Jev labels new messages.
  async function classifyWithJev(lines) {
    try {
      const res = await fetch('api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) });
      if (!res.ok) return;
      const out = await res.json();
      if (out && out.labels) { Object.assign(jev, out.labels); const cache = store.get(LS_JEV, {}); Object.assign(cache, out.labels); store.set(LS_JEV, cache); }
    } catch (e) { /* no function deployed: the built-in rules label the messages */ }
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('button, a'); if (!t) return;
    if (t.dataset.tab) { go(t.dataset.tab); return; }
    if (t.dataset.client) { go('client', t.dataset.client); return; }
    if (t.dataset.yes) { const a = R.actions.find(x => x.key === t.dataset.yes); if (a) openSheet(a); return; }
    if (t.dataset.no) { decide(t.dataset.no, 'no'); toast('Snoozed for 7 days. <u data-undo-toast="' + esc(t.dataset.no) + '">Undo</u>', 4000); return; }
    if (t.dataset.done) { closeSheet(); decide(t.dataset.done, 'done'); toast('Marked done.'); return; }
    if (t.dataset.undo) { undo(t.dataset.undo); return; }
    if (t.id === 'showAll' || t.id === 'showDone') { go('all'); return; }
    if (t.id === 'reset') { if (confirm('Go back to the original pack files? Uploaded files and your Yes/No choices will be cleared.')) { localStorage.removeItem(LS_FILES); localStorage.removeItem(LS_DEC); localStorage.removeItem(LS_NEW); location.reload(); } return; }
  });
  $('#toast').addEventListener('click', e => { const u = e.target.closest('[data-undo-toast]'); if (u) { undo(u.dataset.undoToast); $('#toast').hidden = true; } });
  $('#sheetBg').onclick = closeSheet;
  $('#uploadBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = e => { const l = [...e.target.files]; e.target.value = ''; if (l.length) addFiles(l); };
  // drag and drop on desktop
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); const l = [...(e.dataTransfer.files || [])]; if (l.length) addFiles(l); });

  // ---------- start ----------
  (async function start() {
    const saved = store.get(LS_FILES, null);
    files = saved && Object.keys(saved).length ? saved : await loadPack();
    jev = Object.assign({}, await loadJevPack(), store.get(LS_JEV, {}));
    try { rebuild(); render(); }
    catch (err) { console.error(err); $('#view').innerHTML = `<div class="empty"><h1>Something in the files broke the reader.</h1><p>${esc(err.message)}</p><button class="btn" id="reset">Reset to the original files</button></div>`; }
  })();
})();
