// SanoCondominio — Portal público del propietario: /portal/CODIGO (sin usuario ni contraseña)
import { getPortal } from '../store.js';
import { db, doc, collection, setDoc } from '../firebase.js';
import { esc, num, fmtDate, waLink, applyLocale, usd, setFx, bs, fx, toast, todayKey, parseNum, round2, nowISO, methodLabel, PAY_METHODS, loc } from '../utils.js';
import { icon } from '../icons.js';
import { REQUEST_CATS, NOTICE_KINDS, periodName } from '../condo.js';

const ST = { pagado: ['Pagado', 'success'], parcial: ['Abonado', 'warning'], pendiente: ['Pendiente', 'neutral'], vencido: ['Vencido', 'danger'] };
const RST = { nueva: ['Enviado · por revisar', 'info'], procesada: ['Confirmado', 'success'], rechazada: ['No confirmado', 'danger'], en_proceso: ['En proceso', 'warning'], resuelta: ['Resuelta', 'success'], descartada: ['Cerrada', 'neutral'] };
const BANK_TYPES = { transferencia: 'Transferencia', pagomovil: 'Pago móvil', zelle: 'Zelle', efectivo: 'Efectivo en oficina', otro: 'Otro' };
const b = (map, k) => { const [l, t] = map[k] || [k, 'neutral']; return `<span class="badge badge-${t}">${esc(l)}</span>`; };
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { return null; } };

export async function mount(root) {
  document.title = 'Mi condominio · SanoCondominio';
  const code = (/\/portal\/([A-Z0-9]+)/i.exec(location.pathname)?.[1] || '').toUpperCase();
  root.innerHTML = '<div class="portal-page"><div class="empty"><div class="spinner"></div></div></div>';
  let P = null;
  try { P = code ? await getPortal(code) : null; } catch (e) { console.error(e); }
  if (!P || P.active === false) {
    root.innerHTML = `<div class="portal-page"><div class="card portal-err"><img src="/assets/logo.svg" alt="" width="64"><h1>${P ? 'Portal no disponible' : 'Portal no encontrado'}</h1><p>El código <b>${esc(code || '—')}</b> ${P ? 'está desactivado por la administración.' : 'no existe o fue renovado.'} Pide tu enlace actualizado a la administración de tu condominio.</p>
      <form class="row" style="gap:6px;justify-content:center" id="pc"><input class="input" style="max-width:180px;text-transform:uppercase" name="c" placeholder="Tu código" maxlength="12"><button class="btn btn-primary">Entrar</button></form></div></div>`;
    root.querySelector('#pc').onsubmit = (e) => { e.preventDefault(); const c = e.target.elements.c.value.trim().toUpperCase(); if (c.length >= 4) location.href = '/portal/' + encodeURIComponent(c); };
    return;
  }
  try { applyLocale(P.country || 'VE', P.currency || null); } catch (_) {}
  const rVal = typeof P.rate === 'number' ? P.rate : Number(P.rate?.rate) || 0;
  if (rVal > 0) setFx({ enabled: true, sym: P.fxSym || P.rate?.sym || 'Bs', rate: rVal });
  LS('sc_portal', code);
  document.title = `${P.unit} · ${P.building}`;
  let tab = 'inicio';
  const due = P.balance > 0.009;
  const sent = JSON.parse(LS('sc_votes_' + code) || '{}');
  const both = (n) => `${usd(n)}${fx() ? ` <small class="t-sub">≈ ${bs(n)}</small>` : ''}`;

  const tabs = [['inicio', 'Mi cuenta', 'home'], ['pagar', 'Pagar', 'cash'], ['avisos', 'Avisos', 'megaphone', P.notices.length],
    ...(P.votes.length ? [['votar', 'Votar', 'vote', P.votes.filter((v) => !v.mine && !sent[v.id]).length]] : []),
    ...(P.expenses ? [['gastos', 'Gastos', 'pie']] : []), ...(P.allow.requests ? [['solicitud', 'Solicitudes', 'wrench']] : []), ...(P.allow.bookings && P.areas.length ? [['reservar', 'Reservar', 'calendar']] : [])];

  function shell() {
    root.innerHTML = `<div class="portal-page">
      <header class="portal-hero ${due ? 'due' : 'ok'}">
        <div class="portal-top"><img src="/assets/logo.svg" alt=""><div class="grow"><b>${esc(P.building)}</b><small>${esc(P.admin || 'Administración')}</small></div>${P.adminPhone ? `<a class="btn btn-ghost btn-sm portal-wa" href="${waLink(P.adminPhone, `Hola, soy ${P.owner} de la unidad ${P.unit} (${P.building}).`)}" target="_blank" rel="noopener">${icon('whatsapp')}</a>` : ''}</div>
        <div class="portal-unit"><span>${icon(P.unitType === 'casa' ? 'home' : P.unitType === 'local' ? 'store' : 'building')} Unidad <b>${esc(P.unit)}</b></span><span>${esc(P.owner || '')}</span><span>Alícuota ${num(P.aliquot, 4)}%</span></div>
        <div class="portal-bal"><small>${due ? 'Saldo pendiente' : P.balance < -0.009 ? 'Saldo a favor' : 'Estás al día'}</small><b>${usd(Math.abs(P.balance))}</b>${fx() && Math.abs(P.balance) > 0.009 ? `<span>≈ ${bs(Math.abs(P.balance))} · tasa ${num(fx().rate, 2)}</span>` : ''}${due && P.months ? `<em>${P.months} mes(es) por pagar</em>` : !due ? `<em>${icon('checkCircle')} ¡Gracias por pagar a tiempo!</em>` : ''}</div>
        ${due && P.allow.reports ? `<button class="btn btn-lg portal-pay" data-tab="pagar">${icon('cash')} Reportar mi pago</button>` : ''}
      </header>
      <nav class="portal-tabs">${tabs.map(([k, l, i, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${icon(i)}<span>${l}</span>${n ? `<i>${n}</i>` : ''}</button>`).join('')}</nav>
      <main id="pt-body" class="portal-body"></main>
      <p class="portal-by">Portal privado de tu unidad · Hecho con <b>SanoCondominio</b><br><small>Agrega esta página a tu pantalla de inicio para tenerla a mano.</small></p>
    </div>`;
    root.querySelectorAll('[data-tab]').forEach((x) => x.onclick = () => { tab = x.dataset.tab; shell(); window.scrollTo({ top: tab === 'inicio' ? 0 : root.querySelector('.portal-tabs').offsetTop - 8, behavior: 'smooth' }); });
    ({ inicio, pagar, avisos, votar, gastos, solicitud, reservar })[tab]();
  }
  const body = () => root.querySelector('#pt-body');
  async function send(type, data) {
    const ref = doc(collection(db, 'inbox'));
    await setDoc(ref, { tenantId: P.tenantId, code, unitId: P.unitId, unitCode: P.unit, buildingId: P.buildingId, type, status: 'nueva', createdAt: nowISO(), ...data });
  }

  function inicio() {
    const pinned = P.notices.filter((n) => n.pinned)[0];
    body().innerHTML = `
      ${pinned ? `<div class="card portal-pin"><b>${icon('pin')} ${esc(pinned.title)}</b><p>${esc(pinned.body).replace(/\n/g, '<br>')}</p></div>` : ''}
      <div class="card"><div class="card-title">${icon('file')} Mis recibos</div>
        ${P.charges.length ? `<div class="list mt">${P.charges.map((c) => `<div class="list-item"><div class="grow"><b>${esc(c.n || periodName(c.p))}</b><div class="t-sub">${c.d ? `vence ${fmtDate(c.d)}` : esc(periodName(c.p))}${c.rest > 0.009 && c.rest < c.t ? ` · falta ${usd(c.rest)}` : ''}</div></div><div class="r"><b class="num">${usd(c.t)}</b><div>${b(ST, c.st !== 'pagado' && c.d && c.d < todayKey() ? 'vencido' : c.st)}</div></div></div>`).join('')}</div>` : '<p class="t-sub">Aún no hay recibos emitidos.</p>'}</div>
      ${P.reports.length ? `<div class="card"><div class="card-title">${icon('send')} Pagos que reportaste</div><div class="list mt">${P.reports.map((r) => `<div class="list-item"><div class="grow"><b>${usd(r.amount)}</b><div class="t-sub">${fmtDate(r.date)}${r.reply ? ` · ${esc(r.reply)}` : ''}</div></div>${b(RST, r.status)}</div>`).join('')}</div></div>` : ''}
      <div class="card"><div class="card-title">${icon('cash')} Pagos confirmados</div>
        ${P.payments.length ? `<div class="list mt">${P.payments.map((p) => `<div class="list-item"><span class="kpi-icon tone-success" style="width:34px;height:34px">${icon('check')}</span><div class="grow"><b>${usd(p.amount)}</b><div class="t-sub">${fmtDate(p.date)} · ${esc(methodLabel(p.method))}${p.ref ? ` · ref. ${esc(p.ref)}` : ''}</div></div><span class="t-sub mono">${esc(p.n || '')}</span></div>`).join('')}</div>` : '<p class="t-sub">Sin pagos registrados todavía.</p>'}</div>
      ${P.bookings.length ? `<div class="card"><div class="card-title">${icon('calendar')} Mis reservas</div><div class="list mt">${P.bookings.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.area)}</b><div class="t-sub">${fmtDate(x.date)}${x.from ? ` · ${esc(x.from)} a ${esc(x.to)}` : ''}</div></div><span class="badge badge-success">Confirmada</span></div>`).join('')}</div></div>` : ''}`;
  }

  function banksHTML() {
    return P.banks.length ? `<div class="stack">${P.banks.map((k) => { const txt = [k.bank, k.number, k.phone, k.email, k.holder, k.idDoc].filter(Boolean).join('\n'); return `<div class="box portal-bank"><div class="between"><b>${esc(BANK_TYPES[k.type] || k.type)}${k.bank ? ` · ${esc(k.bank)}` : ''}</b><button class="btn btn-ghost btn-sm" data-copy="${esc(txt)}">${icon('copy')} Copiar</button></div><div class="t-sub" style="white-space:pre-line">${esc([k.number, k.phone, k.email, k.holder, k.idDoc].filter(Boolean).join('\n'))}</div></div>`; }).join('')}</div>`
      : '<p class="t-sub">Consulta las cuentas del condominio con la administración.</p>';
  }
  function pagar() {
    const methods = Object.keys(PAY_METHODS).filter((k) => k !== 'credito' && k !== 'debito').sort((x, y) => (x === 'efectivo') - (y === 'efectivo'));
    body().innerHTML = `<div class="card"><div class="card-title">${icon('card')} Dónde pagar</div><div class="mt">${banksHTML()}</div></div>
      ${P.allow.reports ? `<form class="card stack" id="f-pay"><div class="card-title">${icon('send')} Reportar mi pago</div><p class="small muted" style="margin:0">Después de pagar, avísale a la administración aquí. Lo confirman y se descuenta de tu deuda.</p>
        <div class="field"><label>Monto pagado (${esc(loc().sym)})</label><input class="input input-lg" name="amount" inputmode="decimal" value="${due ? num(P.balance) : ''}" required></div>
        ${fx() ? `<div class="field"><label>¿Pagaste en ${esc(fx().sym)}? Monto en ${esc(fx().sym)} (opcional)</label><input class="input" name="amountBs" inputmode="decimal" placeholder="${due ? num(P.balance * fx().rate) : ''}"><span class="hint">Tasa del día: ${num(fx().rate, 2)}</span></div>` : ''}
        <div class="form-grid"><div class="field"><label>Forma de pago</label><select class="input select" name="method">${methods.map((k) => `<option value="${k}">${esc(methodLabel(k))}</option>`).join('')}</select></div>
          <div class="field"><label>Fecha del pago</label><input class="input" type="date" name="date" value="${todayKey()}" max="${todayKey()}"></div>
          <div class="field"><label>Banco de origen</label><input class="input" name="bank" maxlength="40"></div>
          <div class="field"><label>N° de referencia</label><input class="input" name="reference" inputmode="numeric" maxlength="30" required></div>
          <div class="field"><label>Tu nombre</label><input class="input" name="name" value="${esc(P.owner || '')}" maxlength="60"></div>
          <div class="field"><label>Tu teléfono</label><input class="input" name="phone" inputmode="tel" maxlength="20"></div></div>
        <div class="field"><label>Nota (opcional)</label><input class="input" name="note" maxlength="140" placeholder="Ej.: pago de octubre y noviembre"></div>
        <div class="error-msg" data-err></div><button class="btn btn-primary btn-lg">${icon('send')} Enviar reporte</button></form>` : ''}`;
    body().querySelectorAll('[data-copy]').forEach((x) => x.onclick = () => navigator.clipboard?.writeText(x.dataset.copy).then(() => toast('Datos copiados')));
    const f = body().querySelector('#f-pay');
    if (f) f.onsubmit = async (e) => {
      e.preventDefault(); const F = f.elements; const err = f.querySelector('[data-err]'); err.textContent = '';
      const amount = round2(parseNum(F.amount.value));
      if (!(amount > 0)) { err.textContent = 'Escribe el monto pagado.'; return; }
      if (F.reference.value.trim().length < 3) { err.textContent = 'Escribe el número de referencia.'; return; }
      const btn = f.querySelector('button'); btn.disabled = true;
      try {
        await send('pago', { amount, amountBs: F.amountBs ? round2(parseNum(F.amountBs.value)) || null : null, rate: fx()?.rate || null, method: F.method.value, date: F.date.value || todayKey(), bank: F.bank.value.trim().slice(0, 40), reference: F.reference.value.trim().slice(0, 30), name: F.name.value.trim().slice(0, 60), phone: F.phone.value.trim().slice(0, 20), note: F.note.value.trim().slice(0, 140) });
        body().innerHTML = `<div class="card center portal-done"><span class="kpi-icon tone-success">${icon('checkCircle')}</span><h2>¡Pago reportado!</h2><p class="muted">La administración lo revisará y lo verás aquí como <b>Confirmado</b>. Gracias.</p>${P.adminPhone ? `<a class="btn btn-whatsapp" target="_blank" rel="noopener" href="${waLink(P.adminPhone, `Hola, reporté mi pago de la unidad ${P.unit} (${P.building}): ${usd(amount)}, ref. ${F.reference.value.trim()}.`)}">${icon('whatsapp')} Avisar por WhatsApp</a>` : ''}</div>`;
      } catch (ex) { console.error(ex); err.textContent = 'No se pudo enviar. Revisa tu conexión e intenta de nuevo.'; btn.disabled = false; }
    };
  }

  function avisos() {
    body().innerHTML = P.notices.length ? P.notices.map((n) => { const k = NOTICE_KINDS[n.kind] || NOTICE_KINDS.aviso; return `<div class="card"><div class="between"><span class="badge badge-${k.tone}">${icon(k.icon)} ${k.label}</span><span class="t-sub">${fmtDate(n.date)}</span></div><h3 class="notice-title">${esc(n.title)}</h3><p class="notice-body">${esc(n.body).replace(/\n/g, '<br>')}</p></div>`; }).join('')
      : `<div class="card center"><p class="muted">No hay comunicados por ahora.</p></div>`;
  }

  function votar() {
    body().innerHTML = P.votes.map((v) => { const my = v.mine || sent[v.id]; return `<div class="card stack"><h3 class="notice-title" style="margin:0">${esc(v.title)}</h3>${v.detail ? `<p class="small muted" style="margin:0">${esc(v.detail)}</p>` : ''}${v.until ? `<div class="t-sub">Puedes votar hasta el ${fmtDate(v.until)}</div>` : ''}
      ${my ? `<div class="box">${icon('checkCircle')} Tu voto: <b>${esc(my)}</b>${v.mine ? '' : ' · enviado, se cuenta en minutos'}</div>` : `<div class="stack" style="gap:8px">${v.options.map((o) => `<button class="btn btn-secondary btn-block portal-opt" data-v="${esc(v.id)}" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div><p class="hint" style="margin:0">Un voto por unidad. Tu voto cuenta según tu alícuota.</p>`}</div>`; }).join('');
    body().querySelectorAll('[data-o]').forEach((x) => x.onclick = async () => {
      if (!confirm(`¿Confirmas tu voto: "${x.dataset.o}"?`)) return;
      body().querySelectorAll('[data-o]').forEach((y) => { y.disabled = true; });
      try { await send('voto', { voteId: x.dataset.v, option: x.dataset.o, name: P.owner || '' }); sent[x.dataset.v] = x.dataset.o; LS('sc_votes_' + code, JSON.stringify(sent)); toast('¡Voto enviado!'); shell(); }
      catch (ex) { console.error(ex); toast('No se pudo enviar el voto', 'danger'); body().querySelectorAll('[data-o]').forEach((y) => { y.disabled = false; }); }
    });
  }

  function gastos() {
    const E = P.expenses;
    const max = Math.max(1, ...E.byCat.map((c) => c.amount));
    body().innerHTML = `<div class="card"><div class="card-title">${icon('pie')} Relación de gastos · ${esc(periodName(E.period))}</div>
      <div class="mt">${E.byCat.map((c) => `<div class="hbar"><span class="ellipsis">${esc(c.name)}</span><span class="track"><i style="width:${Math.max(3, c.amount / max * 100)}%"></i></span><b class="num">${usd(c.amount)}</b></div>`).join('')}</div>
      <div class="stack mt" style="gap:4px"><div class="sum-line"><span>Gastos comunes</span><b>${usd(E.common)}</b></div>${E.adminFee ? `<div class="sum-line"><span>Honorarios de administración</span><b>${usd(E.adminFee)}</b></div>` : ''}${E.reserve ? `<div class="sum-line"><span>Fondo de reserva</span><b>${usd(E.reserve)}</b></div>` : ''}<div class="sum-line sum-total"><span>Total a distribuir</span><b>${usd(E.total)}</b></div><div class="sum-line sub"><span>Tu parte (${num(P.aliquot, 4)}%)</span><b>${usd(E.total * P.aliquot / 100)}</b></div></div></div>
      ${P.reserve != null ? `<div class="card"><div class="card-title">${icon('piggy')} Fondo de reserva del edificio</div><div class="kpi-value mt">${both(P.reserve)}</div><p class="t-sub">Ahorro para reparaciones mayores e imprevistos.</p></div>` : ''}`;
  }

  function solicitud() {
    body().innerHTML = `<form class="card stack" id="f-req"><div class="card-title">${icon('wrench')} Nueva solicitud</div>
        <div class="field"><label>Tipo</label><div class="chips chips-wrap">${Object.entries(REQUEST_CATS).map(([k, c], i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-c="${k}">${icon(c.icon)} ${esc(c.label)}</button>`).join('')}</div></div>
        <div class="field"><label>Cuéntanos qué pasa</label><textarea class="input textarea" name="text" rows="4" maxlength="600" placeholder="Ej.: La luz del pasillo del piso 5 no enciende." required></textarea></div>
        <div class="form-grid"><div class="field"><label>Tu nombre</label><input class="input" name="name" value="${esc(P.owner || '')}" maxlength="60"></div><div class="field"><label>Teléfono</label><input class="input" name="phone" inputmode="tel" maxlength="20"></div></div>
        <div class="error-msg" data-err></div><button class="btn btn-primary btn-lg">${icon('send')} Enviar</button></form>
      ${P.requests.length ? `<div class="card"><div class="card-title">${icon('inbox')} Mis solicitudes</div><div class="list mt">${P.requests.map((r) => `<div class="list-item"><div class="grow" style="min-width:0"><b>${esc((REQUEST_CATS[r.category] || REQUEST_CATS.otro).label)}</b><div class="t-sub">${esc(r.text)}</div>${r.reply ? `<div class="small">↳ ${esc(r.reply)}</div>` : ''}<div class="t-sub">${fmtDate(r.date)}</div></div>${b(RST, r.status)}</div>`).join('')}</div></div>` : ''}`;
    let cat = Object.keys(REQUEST_CATS)[0];
    body().querySelectorAll('[data-c]').forEach((x) => x.onclick = () => { cat = x.dataset.c; body().querySelectorAll('[data-c]').forEach((y) => y.classList.toggle('on', y === x)); });
    const f = body().querySelector('#f-req');
    f.onsubmit = async (e) => {
      e.preventDefault(); const F = f.elements; const err = f.querySelector('[data-err]');
      if (F.text.value.trim().length < 4) { err.textContent = 'Describe tu solicitud.'; return; }
      const btn = f.querySelector('button.btn-primary'); btn.disabled = true;
      try { await send('solicitud', { category: cat, text: F.text.value.trim().slice(0, 600), name: F.name.value.trim().slice(0, 60), phone: F.phone.value.trim().slice(0, 20) }); body().innerHTML = `<div class="card center portal-done"><span class="kpi-icon tone-success">${icon('checkCircle')}</span><h2>¡Solicitud enviada!</h2><p class="muted">La administración te responderá aquí mismo.</p></div>`; }
      catch (ex) { console.error(ex); err.textContent = 'No se pudo enviar. Intenta de nuevo.'; btn.disabled = false; }
    };
  }

  function reservar() {
    body().innerHTML = `<form class="card stack" id="f-bk"><div class="card-title">${icon('calendar')} Pedir una reserva</div>
      <div class="field"><label>Área</label><select class="input select" name="area">${P.areas.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}${a.fee ? ` · ${usd(a.fee)}` : ' · gratis'}${a.hours ? ` · ${esc(a.hours)}` : ''}</option>`).join('')}</select></div>
      <div class="form-grid-3"><div class="field"><label>Fecha</label><input class="input" type="date" name="date" min="${todayKey()}" required></div><div class="field"><label>Desde</label><input class="input" type="time" name="from" value="14:00"></div><div class="field"><label>Hasta</label><input class="input" type="time" name="to" value="20:00"></div></div>
      <div class="form-grid"><div class="field"><label>Invitados</label><input class="input" name="guests" inputmode="numeric" maxlength="4"></div><div class="field"><label>Tu teléfono</label><input class="input" name="phone" inputmode="tel" maxlength="20"></div></div>
      <div class="field"><label>Motivo (opcional)</label><input class="input" name="note" maxlength="140" placeholder="Ej.: cumpleaños"></div>
      <p class="hint" style="margin:0">La administración confirma la disponibilidad. Si el área tiene costo, se suma a tu próximo recibo.</p>
      <div class="error-msg" data-err></div><button class="btn btn-primary btn-lg">${icon('send')} Pedir reserva</button></form>`;
    const f = body().querySelector('#f-bk');
    f.onsubmit = async (e) => {
      e.preventDefault(); const F = f.elements; const err = f.querySelector('[data-err]');
      if (!F.date.value || F.date.value < todayKey()) { err.textContent = 'Elige una fecha desde hoy.'; return; }
      const a = P.areas.find((x) => x.id === F.area.value);
      const btn = f.querySelector('button.btn-primary'); btn.disabled = true;
      try { await send('reserva', { areaId: a.id, areaName: a.name, date: F.date.value, from: F.from.value, to: F.to.value, guests: Math.min(9999, parseInt(F.guests.value, 10) || 0), phone: F.phone.value.trim().slice(0, 20), name: P.owner || '', note: F.note.value.trim().slice(0, 140) }); body().innerHTML = `<div class="card center portal-done"><span class="kpi-icon tone-success">${icon('checkCircle')}</span><h2>¡Reserva solicitada!</h2><p class="muted">Cuando la administración la apruebe aparecerá en <b>Mi cuenta</b>.</p></div>`; }
      catch (ex) { console.error(ex); err.textContent = 'No se pudo enviar. Intenta de nuevo.'; btn.disabled = false; }
    };
  }
  shell();
}
