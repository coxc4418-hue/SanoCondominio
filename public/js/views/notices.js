// SanoCondominio — Comunicados a los propietarios (portal + WhatsApp)
import { store } from '../store.js';
import { esc, emptyState, toast, openModal, todayKey, fmtDate, confirmDialog } from '../utils.js';
import { icon } from '../icons.js';
import { unitAvatar, buildingOptions } from '../unit.js';
import { NOTICE_KINDS } from '../condo.js';
import { saveNotice, deleteNotice } from '../ops.js';
import { waUnit, printDoc } from '../shared.js';

const TEMPLATES = [
  { kind: 'mantenimiento', title: 'Corte de agua programado', body: 'Les informamos que el día [fecha], de [hora] a [hora], se suspenderá el servicio de agua por mantenimiento del tanque. Les pedimos tomar previsiones.' },
  { kind: 'asamblea', title: 'Convocatoria a asamblea de propietarios', body: 'Se convoca a todos los propietarios a la asamblea ordinaria el día [fecha] a las [hora] en [lugar]. Orden del día:\n1. Rendición de cuentas.\n2. Aprobación del presupuesto.\n3. Puntos varios.\nTambién puedes votar desde tu portal.' },
  { kind: 'cobranza', title: 'Recibos del mes disponibles', body: 'Ya están disponibles los recibos de condominio del mes. Puedes verlos con la relación de gastos y reportar tu pago desde tu portal. ¡Gracias por pagar a tiempo!' },
  { kind: 'aviso', title: 'Fumigación de áreas comunes', body: 'El día [fecha] se realizará la fumigación de pasillos, sótano y áreas comunes. Por favor mantengan a sus mascotas dentro de sus apartamentos.' },
  { kind: 'urgente', title: 'Ascensor fuera de servicio', body: 'El ascensor se encuentra fuera de servicio por una falla. El técnico ya fue notificado. Les mantendremos informados.' }
];

export function mount(el, { params }) {
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Comunicados</h1><p class="view-sub">Publícalos en el portal de cada propietario y envíalos por WhatsApp en segundos.</p></div>
      <div class="view-actions"><button class="btn btn-primary" id="n-new">${icon('plus')} Nuevo comunicado</button></div></div>
    <div id="n-list"></div>`;
  const $ = (s) => el.querySelector(s);
  function draw() {
    const list = store.notices.filter((n) => store.inScope(n));
    $('#n-list').innerHTML = list.length ? `<div class="grid-cards">${list.map((n) => { const k = NOTICE_KINDS[n.kind] || NOTICE_KINDS.aviso; const expired = n.until && n.until < todayKey(); return `<div class="card notice-card ${expired ? 'is-void' : ''}">
        <div class="between"><span class="badge badge-${k.tone}">${icon(k.icon)} ${k.label}</span>${n.pinned ? `<span class="t-sub">${icon('pin')} Fijado</span>` : ''}</div>
        <h3 class="notice-title">${esc(n.title)}</h3>
        <p class="notice-body">${esc(n.body).replace(/\n/g, '<br>')}</p>
        <div class="t-sub">${fmtDate(n.date)} · ${n.buildingId ? esc(store.bldName(n.buildingId)) : 'Todos los edificios'}${n.until ? ` · visible hasta ${fmtDate(n.until)}` : ''}</div>
        <div class="row mt" style="gap:6px"><button class="btn btn-whatsapp btn-sm" data-wa="${n.id}">${icon('whatsapp')} Enviar</button><button class="btn btn-ghost btn-sm" data-pr="${n.id}">${icon('print')}</button><button class="btn btn-ghost btn-sm" data-ed="${n.id}">${icon('edit')}</button><button class="btn btn-ghost btn-sm" data-del="${n.id}">${icon('trash')}</button></div></div>`; }).join('')}</div>`
      : `<div class="card">${emptyState('megaphone', 'Sin comunicados', 'Avisos de mantenimiento, cortes de agua, convocatorias a asamblea… Aparecen en el portal de cada propietario.')}</div>`;
    el.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => form(store.notices.find((n) => n.id === b.dataset.ed)));
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirmDialog({ title: 'Borrar comunicado', message: 'Se quitará también del portal.', confirmText: 'Borrar', danger: true })) { await deleteNotice(store.notices.find((n) => n.id === b.dataset.del)); toast('Comunicado borrado'); } });
    el.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => { const n = store.notices.find((x) => x.id === b.dataset.pr); printDoc(n.title, `<p style="font-size:14px;line-height:1.7;margin-top:20px">${esc(n.body).replace(/\n/g, '<br>')}</p><p class="muted">${fmtDate(n.date)} · La administración</p>`); });
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => sendModal(store.notices.find((n) => n.id === b.dataset.wa)));
  }
  function sendModal(n) {
    const list = store.liveUnits.filter((u) => (!n.buildingId || u.buildingId === n.buildingId) && (u.ownerPhone || u.residentPhone));
    const m = openModal({
      title: 'Enviar comunicado', size: 'md', sub: 'Envíalo a un grupo de WhatsApp del edificio o a cada propietario con su enlace al portal.',
      body: `<button class="btn btn-whatsapp btn-block" data-group>${icon('users')} Enviar a un grupo de WhatsApp</button>
        <div class="section-title mt">O a cada propietario</div>
        ${list.length ? `<div class="list" style="max-height:45vh;overflow:auto">${list.map((u) => `<div class="list-item">${unitAvatar(u)}<div class="grow"><b>${esc(u.code)}</b><div class="t-sub">${esc(u.ownerName || '')}</div></div>${u.occupancy === 'inquilino' && u.residentPhone ? `<button class="btn btn-secondary btn-sm" data-r="${u.id}">Inquilino</button>` : ''}<button class="btn btn-whatsapp btn-sm" data-s="${u.id}">${icon('whatsapp')}</button></div>`).join('')}</div>` : emptyState('phone', 'Sin teléfonos cargados')}`
    });
    m.el.querySelector('[data-group]').onclick = () => waUnit('comunicado', { unit: {}, notice: n });
    const mark = (b) => { b.classList.replace('btn-whatsapp', 'btn-secondary'); b.innerHTML = icon('check'); };
    m.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { waUnit('comunicado', { unit: store.unit(b.dataset.s), notice: n }); mark(b); });
    m.el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { waUnit('comunicado', { unit: store.unit(b.dataset.r), notice: n }, 'resident'); b.disabled = true; });
  }
  function form(n = null) {
    let kind = n?.kind || 'aviso';
    const m = openModal({
      title: n ? 'Editar comunicado' : 'Nuevo comunicado', size: 'lg',
      body: `<form class="stack" data-f>
        ${n ? '' : `<div class="field"><label>Plantillas rápidas</label><div class="chips chips-wrap">${TEMPLATES.map((t, i) => `<button type="button" class="chip" data-tp="${i}">${esc(t.title)}</button>`).join('')}</div></div>`}
        <div class="field"><label>Tipo</label><div class="chips chips-wrap" data-kinds>${Object.entries(NOTICE_KINDS).map(([k, v]) => `<button type="button" class="chip ${kind === k ? 'on' : ''}" data-k="${k}">${icon(v.icon)} ${v.label}</button>`).join('')}</div></div>
        <div class="field"><label>Título</label><input class="input" name="title" value="${esc(n?.title || '')}" autofocus></div>
        <div class="field"><label>Mensaje</label><textarea class="input textarea" name="body" rows="6">${esc(n?.body || '')}</textarea></div>
        <div class="form-grid-3">
          <div class="field"><label>Para</label><select class="input select" name="b">${buildingOptions(n ? n.buildingId : store.building, { all: true })}</select></div>
          <div class="field"><label>Fecha</label><input class="input" type="date" name="date" value="${n?.date || todayKey()}"></div>
          <div class="field"><label>Visible hasta (opcional)</label><input class="input" type="date" name="until" value="${n?.until || ''}"></div>
        </div>
        <label class="check"><input type="checkbox" name="pinned" ${n?.pinned ? 'checked' : ''}> <span>Fijar arriba en el portal</span></label>
        <div class="error-msg" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('megaphone')} Publicar</button>`
    });
    const F = m.el.querySelector('[data-f]').elements;
    const setK = (k) => { kind = k; m.el.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x.dataset.k === k)); };
    m.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => setK(b.dataset.k));
    m.el.querySelectorAll('[data-tp]').forEach((b) => b.onclick = () => { const t = TEMPLATES[b.dataset.tp]; F.title.value = t.title; F.body.value = t.body; setK(t.kind); });
    const go = async (e) => {
      e?.preventDefault();
      try {
        const saved = await saveNotice({ title: F.title.value, body: F.body.value, kind, buildingId: F.b.value, date: F.date.value, until: F.until.value, pinned: F.pinned.checked }, n?.id || null);
        m.close(); toast('Comunicado publicado en el portal');
        if (!n) sendModal(saved);
      } catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; }
    };
    m.el.querySelector('[data-f]').onsubmit = go; m.el.querySelector('[data-ok]').onclick = go;
  }
  $('#n-new').onclick = () => form();
  draw();
  if (params?.new) setTimeout(() => form(), 50);
  const off = store.on('*', (e) => { if (['notices', 'building', 'buildings'].includes(e)) draw(); });
  return () => off();
}
