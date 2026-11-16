// SanoCondominio — Áreas comunes: reservas y solicitudes del portal
import { store } from '../store.js';
import { esc, usd, emptyState, toast, openModal, fmtDate, todayKey, parseNum, num, fmtDateTime, loc } from '../utils.js';
import { icon } from '../icons.js';
import { pickUnit, unitAvatar } from '../unit.js';
import { saveBooking, setBookingStatus, setInbox } from '../ops.js';
import { waUnit } from '../shared.js';

export function mount(el, { navigate }) {
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Áreas comunes</h1><p class="view-sub">Salón de fiestas, parrillera, piscina, cancha… Sin choques de horario y con el cobro cargado a la unidad.</p></div>
      <div class="view-actions"><button class="btn btn-primary" id="k-new">${icon('plus')} Nueva reserva</button><button class="btn btn-ghost" id="k-areas">${icon('settings')} Áreas</button></div></div>
    <div id="k-req"></div>
    <div class="grid-main">
      <div class="card"><div class="card-title">${icon('calendar')} Próximas reservas</div><div id="k-list" class="mt"></div></div>
      <div class="card"><div class="card-title">${icon('layers')} Áreas disponibles</div><div id="k-areas-l" class="mt"></div></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  function draw() {
    const req = store.bookingRequests;
    $('#k-req').innerHTML = req.length ? `<div class="card mb-lg"><div class="card-title">${icon('bell')} Solicitudes desde el portal</div><div class="list mt">${req.map((x) => { const u = store.unit(x.unitId); return `<div class="list-item">${u ? unitAvatar(u) : ''}<div class="grow" style="min-width:0"><b>${esc(store.area(x.areaId)?.name || x.areaName || 'Área')}</b> · ${fmtDate(x.date)}${x.from ? ` ${esc(x.from)}-${esc(x.to)}` : ''}<div class="t-sub">${esc(x.unitCode)} · ${esc(x.name || '')}${x.guests ? ` · ${x.guests} invitados` : ''}${x.note ? ` · ${esc(x.note)}` : ''} · ${fmtDateTime(x.createdAt)}</div></div><button class="btn btn-success btn-sm" data-ok="${x.id}">${icon('check')} Aprobar</button><button class="btn btn-ghost btn-sm" data-no="${x.id}">${icon('x')}</button></div>`; }).join('')}</div></div>` : '';
    const list = store.upcomingBookings;
    $('#k-list').innerHTML = list.length ? `<div class="list">${list.map((b) => `<div class="list-item ${b.status === 'cancelada' ? 'is-void' : ''}"><div class="date-chip"><b>${b.date.slice(8, 10)}</b><small>${new Date(b.date + 'T12:00').toLocaleDateString('es', { month: 'short' })}</small></div><div class="grow" style="min-width:0"><b>${esc(b.areaName)}</b>${b.from ? ` <span class="t-sub">${esc(b.from)} - ${esc(b.to)}</span>` : ''}<div class="t-sub">${esc(b.unitCode)} · ${esc(b.ownerName || '')}${b.guests ? ` · ${b.guests} invitados` : ''}${b.fee ? ` · ${usd(b.fee)}` : ''}</div></div>${store.unit(b.unitId)?.ownerPhone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${b.id}">${icon('whatsapp')}</button>` : ''}<button class="btn btn-ghost btn-icon btn-sm" data-cx="${b.id}" title="Cancelar">${icon('x')}</button></div>`).join('')}</div>`
      : emptyState('calendar', 'Sin reservas próximas', 'Registra una reserva o aprueba las que piden los propietarios desde su portal.');
    $('#k-areas-l').innerHTML = store.areas.length ? `<div class="list">${store.areas.map((a) => `<div class="list-item"><span class="kpi-icon tone-brand" style="width:34px;height:34px">${icon('calendar')}</span><div class="grow"><b>${esc(a.name)}</b><div class="t-sub">${a.fee ? usd(a.fee) : 'Gratis'}${a.deposit ? ` · depósito ${usd(a.deposit)}` : ''}${a.hours ? ` · ${esc(a.hours)}` : ''}</div></div></div>`).join('')}</div>` : emptyState('layers', 'Sin áreas', 'Agrégalas en Configuración.');
    el.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
      const x = store.inbox.find((y) => y.id === b.dataset.ok);
      try { const bk = await saveBooking({ unitId: x.unitId, areaId: x.areaId, date: x.date, from: x.from, to: x.to, guests: x.guests, note: x.note, inboxId: x.id, charge: true }); toast('Reserva aprobada'); const u = store.unit(x.unitId); if (u?.ownerPhone) waUnit('reserva', { unit: u, booking: bk }); }
      catch (ex) { toast(ex.message, 'warning', 6000); }
    });
    el.querySelectorAll('[data-no]').forEach((b) => b.onclick = async () => { await setInbox(store.inbox.find((y) => y.id === b.dataset.no), { status: 'rechazada', reply: 'El área no está disponible en esa fecha.' }); toast('Solicitud rechazada'); });
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => { const bk = store.bookings.find((x) => x.id === b.dataset.wa); waUnit('reserva', { unit: store.unit(bk.unitId), booking: bk }); });
    el.querySelectorAll('[data-cx]').forEach((b) => b.onclick = async () => { await setBookingStatus(store.bookings.find((x) => x.id === b.dataset.cx), 'cancelada'); toast('Reserva cancelada'); });
  }
  async function form() {
    if (!store.areas.length) { toast('Agrega las áreas comunes en Configuración.', 'warning'); return; }
    const u = await pickUnit({ title: '¿Qué unidad reserva?' });
    if (!u) return;
    const a0 = store.areas[0];
    const m = openModal({
      title: `Reserva · ${esc(u.code)}`, size: 'md',
      body: `<form class="stack" data-f>
        <div class="field"><label>Área</label><select class="input select" name="area">${store.areas.map((a) => `<option value="${a.id}">${esc(a.name)}${a.fee ? ` · ${usd(a.fee)}` : ''}</option>`).join('')}</select></div>
        <div class="form-grid-3"><div class="field"><label>Fecha</label><input class="input" type="date" name="date" min="${todayKey()}" value="${todayKey()}"></div><div class="field"><label>Desde</label><input class="input" type="time" name="from" value="14:00"></div><div class="field"><label>Hasta</label><input class="input" type="time" name="to" value="20:00"></div></div>
        <div class="form-grid"><div class="field"><label>Invitados</label><input class="input" name="guests" inputmode="numeric"></div><div class="field"><label>Costo</label><div class="input-group"><span class="prefix">${esc(loc().sym)}</span><input class="input" name="fee" inputmode="decimal" value="${num(a0.fee || 0)}"></div></div></div>
        <label class="check"><input type="checkbox" name="charge" checked> <span>Cargar el costo a la deuda de la unidad</span></label>
        <div class="field"><label>Nota</label><input class="input" name="note" placeholder="Ej.: cumpleaños, trae su propio sonido"></div>
        <div class="error-msg" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Reservar</button>`
    });
    const F = m.el.querySelector('[data-f]').elements;
    F.area.onchange = () => { F.fee.value = num(store.area(F.area.value)?.fee || 0); };
    const go = async (e) => {
      e?.preventDefault();
      try { const bk = await saveBooking({ unitId: u.id, areaId: F.area.value, date: F.date.value, from: F.from.value, to: F.to.value, guests: F.guests.value, fee: parseNum(F.fee.value), note: F.note.value, charge: F.charge.checked }); m.close(); toast('Reserva registrada'); if (u.ownerPhone) waUnit('reserva', { unit: u, booking: bk }); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; }
    };
    m.el.querySelector('[data-f]').onsubmit = go; m.el.querySelector('[data-ok]').onclick = go;
  }
  $('#k-new').onclick = form;
  $('#k-areas').onclick = () => navigate('ajustes', { tab: 'areas' });
  draw();
  const off = store.on('*', (e) => { if (['bookings', 'inbox', 'settings', 'building', 'units'].includes(e)) draw(); });
  return () => off();
}
