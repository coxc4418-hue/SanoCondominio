// SanoCondominio — Solicitudes e incidencias (desde el portal o la oficina)
import { store } from '../store.js';
import { esc, emptyState, toast, openModal, fmtDateTime, waLink } from '../utils.js';
import { icon } from '../icons.js';
import { unitAvatar, openUnit, requestModal } from '../unit.js';
import { REQUEST_CATS, REQUEST_STATUS, badge } from '../condo.js';
import { setInbox } from '../ops.js';
import { unitMessage } from '../shared.js';

export function mount(el) {
  let filter = 'abiertas';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Solicitudes</h1><p class="view-sub">Averías, reclamos y sugerencias de los vecinos. Las del portal llegan solas; respóndelas y el propietario ve el estado.</p></div>
      <div class="view-actions"><button class="btn btn-primary" id="r-new">${icon('plus')} Nueva solicitud</button></div></div>
    <div class="chips" id="r-chips"></div>
    <div class="kboard mt" id="r-board"></div>`;
  const $ = (s) => el.querySelector(s);
  function draw() {
    const all = store.inboxOf('solicitud');
    const F = { abiertas: ['nueva', 'en_proceso'], resueltas: ['resuelta', 'descartada'], todas: null };
    $('#r-chips').innerHTML = [['abiertas', 'Abiertas'], ['resueltas', 'Cerradas'], ['todas', 'Todas']].map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l} <span class="count">${all.filter((x) => !F[k] || F[k].includes(x.status)).length}</span></button>`).join('');
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(); });
    const cols = filter === 'abiertas' ? ['nueva', 'en_proceso'] : filter === 'resueltas' ? ['resuelta', 'descartada'] : ['nueva', 'en_proceso', 'resuelta', 'descartada'];
    $('#r-board').innerHTML = all.length ? cols.map((st) => { const items = all.filter((x) => x.status === st); return `<div class="kcol"><div class="kcol-head">${badge(REQUEST_STATUS, st)} <span class="t-sub">${items.length}</span></div><div class="kcol-list">${items.map((x) => { const c = REQUEST_CATS[x.category] || REQUEST_CATS.otro; const u = store.unit(x.unitId); return `<div class="card req-card" data-r="${x.id}"><div class="row" style="gap:8px">${u ? unitAvatar(u) : ''}<div class="grow" style="min-width:0"><b>${esc(x.unitCode)}</b> <span class="t-sub">${esc(x.name || '')}</span><div class="t-sub">${icon(c.icon)} ${c.label}</div></div></div><p class="small" style="margin:8px 0 4px">${esc(x.text)}</p>${x.reply ? `<div class="t-sub">↳ ${esc(x.reply)}</div>` : ''}<div class="t-sub">${fmtDateTime(x.createdAt)}</div></div>`; }).join('') || '<div class="t-sub center pd-3">—</div>'}</div></div>`; }).join('')
      : `<div class="card" style="grid-column:1/-1">${emptyState('inbox', 'Sin solicitudes', 'Los propietarios pueden enviarlas desde su portal; también puedes registrarlas tú.')}</div>`;
    el.querySelectorAll('[data-r]').forEach((c) => c.onclick = () => detail(store.inbox.find((x) => x.id === c.dataset.r)));
  }
  function detail(x) {
    const u = store.unit(x.unitId);
    const c = REQUEST_CATS[x.category] || REQUEST_CATS.otro;
    const m = openModal({
      title: `${c.label} · ${esc(x.unitCode)}`, size: 'md', sub: `${esc(x.name || '')}${x.phone ? ' · ' + esc(x.phone) : ''} · ${fmtDateTime(x.createdAt)}`,
      body: `<div class="stack"><div class="box">${esc(x.text)}</div>
        <div class="field"><label>Estado</label><div class="seg seg-block">${Object.entries(REQUEST_STATUS).map(([k, s]) => `<button type="button" data-st="${k}" class="${x.status === k ? 'on' : ''}">${s.label}</button>`).join('')}</div></div>
        <div class="field"><label>Respuesta para el propietario (la ve en su portal)</label><textarea class="input textarea" data-reply rows="3" placeholder="Ej.: El técnico pasa el jueves en la mañana.">${esc(x.reply || '')}</textarea></div></div>`,
      footer: `${u ? `<button class="btn btn-ghost" data-u>${icon('building')} Unidad</button>` : ''}${x.phone || u?.ownerPhone ? `<button class="btn btn-whatsapp" data-wa>${icon('whatsapp')}</button>` : ''}<button class="btn btn-secondary" data-close>Cerrar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    let st = x.status;
    m.el.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => { st = b.dataset.st; m.el.querySelectorAll('[data-st]').forEach((y) => y.classList.toggle('on', y === b)); });
    m.el.querySelector('[data-u]')?.addEventListener('click', () => { m.close(); openUnit(u.id, { tab: 'solicitudes' }); });
    m.el.querySelector('[data-wa]')?.addEventListener('click', () => { const reply = m.el.querySelector('[data-reply]').value; const text = unitMessage('solicitud', { unit: u || { ownerName: x.name }, extra: `${c.label.toLowerCase()} — ${reply || REQUEST_STATUS[st].label}` }); window.open(waLink(x.phone || u.ownerPhone, text), '_blank', 'noopener'); });
    m.el.querySelector('[data-ok]').onclick = async () => { await setInbox(x, { status: st, reply: m.el.querySelector('[data-reply]').value.trim().slice(0, 300) }); m.close(); toast('Solicitud actualizada'); };
  }
  $('#r-new').onclick = () => requestModal();
  draw();
  const off = store.on('*', (e) => { if (['inbox', 'building', 'units'].includes(e)) draw(); });
  return () => off();
}
