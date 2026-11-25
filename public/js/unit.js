// SanoCondominio — Unidades: selector, formulario, ficha, registrar pago y portal
import { store } from './store.js';
import { esc, usd, bs, num, fmtDate, toast, openModal, setBusy, parseNum, normalize, round2, todayKey, PAY_METHODS, methodLabel, loc, fx, emptyState, confirmDialog, promptDialog, fmtDateTime } from './utils.js';
import { icon } from './icons.js';
import { UNIT_TYPES, OCCUPANCY, unitBalance, ledgerStatus, openCharges, monthsOwed, debtTone, debtLabel, periodName, badge, PAY_STATUS, REQUEST_CATS, REQUEST_STATUS, isSolvent } from './condo.js';
import { saveUnit, registerPayment, addUnitCharge, setUnitActive, renewPortalCode, voidPayment, setOpeningBalance, createRequest, publishUnitPortal } from './ops.js';
import { waUnit, PORTAL_URL, qrDataURL, printStatement, printSolvency, printPayment, receiptHTML, printReceipts } from './shared.js';
import { isVE } from './bcv.js';

export const unitIcon = (u) => UNIT_TYPES[u?.type]?.icon || 'building';
export function unitAvatar(u, size = '') {
  const t = debtTone(u);
  return `<span class="u-av ${size} tone-${t}">${esc(String(u?.code || '?').slice(0, 6))}</span>`;
}
export const debtBadge = (u) => `<span class="badge badge-${debtTone(u)}"><i class="dotc"></i>${debtLabel(u)}</span>`;
export const unitSub = (u) => [store.buildings.length > 1 ? store.bldName(u.buildingId) : '', u.ownerName || 'Sin propietario', u.occupancy === 'inquilino' && u.residentName ? `inquilino: ${u.residentName}` : ''].filter(Boolean).join(' · ');

/** <select> de edificios */
export function buildingOptions(selected = '', { all = false, allLabel = 'Todos los edificios' } = {}) {
  return `${all ? `<option value="">${esc(allLabel)}</option>` : ''}${store.liveBuildings.map((b) => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}`;
}

/** Elegir una unidad (busca por número, propietario, cédula o teléfono) */
export function pickUnit({ title = 'Elegir unidad', filter = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, size: 'md',
      body: `<div class="stack"><label class="search"><svg></svg><input data-q placeholder="Número de unidad, propietario, cédula o teléfono…" autofocus autocomplete="off"></label><div class="list pick-list" data-l style="max-height:52vh;overflow:auto"></div></div>`,
      onClose: () => { if (!done) resolve(null); }
    });
    m.el.querySelector('.search svg').outerHTML = icon('search');
    const draw = (q = '') => {
      const t = normalize(q).replace(/\s+/g, '');
      const list = store.scopeUnits.filter((u) => (!filter || filter(u)) && (!t || normalize(`${u.code}${u.ownerName}${u.ownerIdDoc}${u.ownerPhone}${u.residentName}`).replace(/\s+/g, '').includes(t))).slice(0, 80);
      m.el.querySelector('[data-l]').innerHTML = list.length ? list.map((u) => `<button type="button" class="list-item linkish" data-u="${u.id}" style="width:100%;text-align:left">${unitAvatar(u)}<div class="grow" style="min-width:0"><b>${esc(u.code)}</b><div class="t-sub ellipsis">${esc(unitSub(u))}</div></div><div class="r"><b class="num ${unitBalance(u) > 0.009 ? 'text-danger' : ''}">${usd(Math.max(0, unitBalance(u)))}</b><div class="t-sub">${debtLabel(u)}</div></div></button>`).join('')
        : emptyState('search', 'Sin resultados', 'Prueba con otro número o nombre.');
      m.el.querySelectorAll('[data-u]').forEach((b) => b.onclick = () => { done = true; m.close(); resolve(store.unit(b.dataset.u)); });
    };
    m.el.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
    draw();
  });
}

// ======================================================================
// FORMULARIO DE UNIDAD
// ======================================================================
export function unitForm(unit = null, preset = {}) {
  return new Promise((resolve) => {
    const u = { type: 'apartamento', occupancy: 'propietario', buildingId: store.currentBuilding?.id || store.liveBuildings[0]?.id || '', ...preset, ...(unit || {}) };
    if (!store.liveBuildings.length) { toast('Primero crea el edificio en Configuración › Edificios.', 'warning', 5000); resolve(null); return; }
    let done = false;
    const m = openModal({
      title: unit ? `Unidad ${esc(unit.code)}` : 'Nueva unidad', size: 'lg',
      sub: 'La alícuota es el porcentaje con el que la unidad participa en los gastos comunes (la suma del edificio debe dar 100%).',
      body: `<form class="stack" data-f>
        <div class="form-grid-3">
          <div class="field"><label>Edificio *</label><select class="input select" name="buildingId">${buildingOptions(u.buildingId)}</select></div>
          <div class="field"><label>Número / código *</label><input class="input" name="code" value="${esc(u.code || '')}" placeholder="Ej.: 4-B, PH-2, Casa 12" required ${unit ? '' : 'autofocus'}></div>
          <div class="field"><label>Tipo</label><select class="input select" name="type">${Object.entries(UNIT_TYPES).map(([k, t]) => `<option value="${k}" ${u.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
          <div class="field"><label>Piso / sector</label><input class="input" name="floor" value="${esc(u.floor || '')}"></div>
          <div class="field"><label>Alícuota (%) *</label><input class="input" name="aliquot" inputmode="decimal" value="${u.aliquot != null ? num(u.aliquot, 4) : ''}" placeholder="Ej.: 2,3456"></div>
          <div class="field"><label>Metros cuadrados</label><input class="input" name="m2" inputmode="decimal" value="${u.m2 || ''}"></div>
        </div>
        <div class="section-title">${icon('user')} Propietario</div>
        <div class="form-grid">
          <div class="field"><label>Nombre completo</label><input class="input" name="ownerName" value="${esc(u.ownerName || '')}"></div>
          <div class="field"><label>${esc(loc().id)} / ${esc(loc().tax)}</label><input class="input" name="ownerIdDoc" value="${esc(u.ownerIdDoc || '')}"></div>
          <div class="field"><label>Teléfono (WhatsApp)</label><input class="input" name="ownerPhone" inputmode="tel" value="${esc(u.ownerPhone || '')}"></div>
          <div class="field"><label>Correo</label><input class="input" name="ownerEmail" type="email" value="${esc(u.ownerEmail || '')}"></div>
        </div>
        <div class="section-title">${icon('home')} Quién vive</div>
        <div class="seg seg-block" data-occ>${Object.entries(OCCUPANCY).map(([k, l]) => `<button type="button" data-o="${k}" class="${u.occupancy === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="form-grid" data-res ${u.occupancy === 'inquilino' ? '' : 'hidden'}>
          <div class="field"><label>Inquilino</label><input class="input" name="residentName" value="${esc(u.residentName || '')}"></div>
          <div class="field"><label>Teléfono del inquilino</label><input class="input" name="residentPhone" inputmode="tel" value="${esc(u.residentPhone || '')}"></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Estacionamiento / maletero</label><input class="input" name="parking" value="${esc(u.parking || '')}" placeholder="Ej.: puesto 14, maletero 3"></div>
          ${unit ? '' : `<div class="field"><label>Deuda anterior (opcional)</label><div class="input-group"><span class="prefix">${esc(loc().sym)}</span><input class="input" name="opening" inputmode="decimal" placeholder="0"></div><span class="hint">Lo que ya debía antes de usar el sistema.</span></div>`}
          <div class="field full"><label>Notas</label><textarea class="input textarea" name="notes" rows="2">${esc(u.notes || '')}</textarea></div>
        </div>
        <div class="error-msg" data-err></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`,
      onClose: () => { if (!done) resolve(null); }
    });
    let occ = u.occupancy;
    m.el.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => { occ = b.dataset.o; m.el.querySelectorAll('[data-o]').forEach((x) => x.classList.toggle('on', x === b)); m.el.querySelector('[data-res]').hidden = occ !== 'inquilino'; });
    const submit = async (e) => {
      e?.preventDefault();
      const F = m.el.querySelector('[data-f]').elements;
      const err = m.el.querySelector('[data-err]');
      if (!F.code.value.trim()) { err.textContent = 'Escribe el número de la unidad.'; return; }
      const data = { buildingId: F.buildingId.value, code: F.code.value, type: F.type.value, floor: F.floor.value, aliquot: parseNum(F.aliquot.value), ownerName: F.ownerName.value, ownerIdDoc: F.ownerIdDoc.value, ownerPhone: F.ownerPhone.value, ownerEmail: F.ownerEmail.value, occupancy: occ, residentName: F.residentName.value, residentPhone: F.residentPhone.value, parking: F.parking.value, notes: F.notes.value };
      const btn = m.el.querySelector('[data-ok]'); setBusy(btn, true, 'Guardando…');
      try {
        const saved = await saveUnit(data, unit?.id || null);
        const m2 = parseNum(F.m2.value); if (m2 || unit?.m2) await store.save('units', saved.id, { m2 });
        const op = F.opening ? parseNum(F.opening.value) : 0;
        if (op > 0) await setOpeningBalance({ ...saved, billed: 0, paid: 0, ledger: [] }, op, 'Deuda anterior');
        done = true; m.close(); toast(unit ? 'Unidad actualizada' : `Unidad ${saved.code} creada`); resolve(saved);
      } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
    };
    m.el.querySelector('[data-f]').onsubmit = submit;
    m.el.querySelector('[data-ok]').onclick = submit;
  });
}

// ======================================================================
// REGISTRAR PAGO
// ======================================================================
export async function paymentModal(unit0 = null, preset = {}) {
  const u0 = unit0 || await pickUnit({ title: 'Registrar pago · ¿qué unidad paga?' });
  if (!u0) return null;
  return new Promise((resolve) => {
    const u = store.unit(u0.id) || u0;
    const bal = Math.max(0, unitBalance(u));
    const rateNow = Number(fx()?.rate) || 0;
    const allowBs = isVE() && rateNow > 0;
    let cur = preset.amountBs && allowBs ? 'bs' : 'main';
    let done = false;
    const open = openCharges(u);
    const banks = (store.settings.banks || []).filter((b) => b.active !== false);
    const m = openModal({
      title: `Registrar pago · ${esc(u.code)}`, size: 'md',
      sub: `${esc(u.ownerName || '')}${bal > 0 ? ` · debe <b>${usd(bal)}</b>${bs(bal) ? ` (${bs(bal)})` : ''}` : ' · solvente'}`,
      body: `<form class="stack" data-f>
        ${open.length ? `<div class="box"><div class="section-title" style="margin-top:0">Recibos pendientes</div>${open.slice(0, 8).map((x) => `<div class="between small"><span>${esc(x.k === 'extra' ? x.n : periodName(x.p))}${x.d && x.d < todayKey() ? ' <span class="text-danger">· vencido</span>' : ''}</span><b class="num">${usd(x.rest)}</b></div>`).join('')}</div>` : ''}
        ${allowBs ? `<div class="seg seg-block" data-cur><button type="button" data-c="main" class="${cur === 'main' ? 'on' : ''}">Pagó en ${esc(loc().sym)}</button><button type="button" data-c="bs" class="${cur === 'bs' ? 'on' : ''}">Pagó en bolívares</button></div>` : ''}
        <div class="form-grid">
          <div class="field" data-main-f><label>Monto (${esc(loc().sym)})</label><div class="input-group"><span class="prefix">${esc(loc().sym)}</span><input class="input input-lg" name="amount" inputmode="decimal" value="${preset.amount ? num(preset.amount) : ''}" placeholder="0" autofocus></div></div>
          ${allowBs ? `<div class="field" data-bs-f><label>Monto en Bs</label><div class="input-group"><span class="prefix">Bs</span><input class="input input-lg" name="amountBs" inputmode="decimal" value="${preset.amountBs ? num(preset.amountBs) : ''}" placeholder="0"></div></div>
          <div class="field" data-bs-f><label>Tasa (Bs por 1 $)</label><input class="input" name="rate" inputmode="decimal" value="${num(preset.rate || rateNow, 2)}"><span class="hint">Tasa BCV del día del pago.</span></div>` : ''}
          <div class="field"><label>Fecha del pago</label><input class="input" type="date" name="date" value="${preset.date || todayKey()}" max="${todayKey()}"></div>
          <div class="field"><label>Forma de pago</label><select class="input select" name="method">${Object.entries(PAY_METHODS).map(([k, p]) => `<option value="${k}" ${(preset.method || (allowBs ? 'pagomovil' : 'transferencia')) === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
          <div class="field"><label>Banco / cuenta destino</label>${banks.length ? `<select class="input select" name="bank"><option value="">—</option>${banks.map((b) => `<option ${preset.bank === b.bank ? 'selected' : ''}>${esc(b.bank || b.type)}</option>`).join('')}</select>` : `<input class="input" name="bank" value="${esc(preset.bank || '')}">`}</div>
          <div class="field"><label>Referencia</label><input class="input" name="reference" value="${esc(preset.reference || '')}" placeholder="Últimos dígitos"></div>
          <div class="field full"><label>Nota</label><input class="input" name="note" value="${esc(preset.note || '')}"></div>
        </div>
        <div class="pay-status due" data-st></div>
        <div class="error-msg" data-err></div>
      </form>`,
      footer: `${bal > 0 ? `<button class="btn btn-ghost" data-all>Paga todo ${usd(bal)}</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-success" data-ok>${icon('check')} Registrar pago</button>`,
      onClose: () => { if (!done) resolve(null); }
    });
    const F = m.el.querySelector('[data-f]').elements;
    const $ = (q) => m.el.querySelector(q);
    const amount = () => cur === 'bs' ? round2(parseNum(F.amountBs.value) / Math.max(0.0001, parseNum(F.rate.value))) : round2(parseNum(F.amount.value));
    const paint = () => {
      m.el.querySelectorAll('[data-bs-f]').forEach((x) => { x.hidden = cur !== 'bs'; });
      $('[data-main-f]').hidden = cur === 'bs';
      const a = amount();
      const st = $('[data-st]');
      if (!(a > 0)) { st.className = 'pay-status due'; st.innerHTML = '<span>Escribe el monto</span><span></span>'; return; }
      const rest = round2(bal - a);
      st.className = 'pay-status ' + (rest <= 0.009 ? 'ok' : 'due');
      st.innerHTML = `<span>${cur === 'bs' ? `Equivale a <b>${usd(a)}</b> · ` : ''}${rest > 0.009 ? 'Queda debiendo' : rest < -0.009 ? 'Queda a favor' : `${icon('check')} Queda solvente`}</span><span class="num">${Math.abs(rest) > 0.009 ? usd(Math.abs(rest)) : ''}</span>`;
    };
    m.el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cur = b.dataset.c; m.el.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b)); if (cur === 'bs') F.method.value = 'pagomovil'; paint(); });
    ['amount', 'amountBs', 'rate'].forEach((n) => { if (F[n]) F[n].oninput = paint; });
    $('[data-all]')?.addEventListener('click', () => { if (cur === 'bs') F.amountBs.value = num(bal * parseNum(F.rate.value), 2); else F.amount.value = num(bal); paint(); });
    paint();
    $('[data-ok]').onclick = async (e) => {
      const err = $('[data-err]'); err.textContent = '';
      const a = amount();
      if (!(a > 0)) { err.textContent = 'Escribe el monto del pago.'; return; }
      const btn = e.currentTarget; setBusy(btn, true, 'Registrando…');
      try {
        const p = await registerPayment({ unitId: u.id, amount: a, date: F.date.value, method: F.method.value, bank: F.bank.value, reference: F.reference.value, note: F.note.value, amountBs: cur === 'bs' ? parseNum(F.amountBs.value) : 0, rate: cur === 'bs' ? parseNum(F.rate.value) : rateNow, inboxId: preset.inboxId || '' });
        done = true; m.close(); resolve(p);
        paidDone(p);
      } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
    };
  });
}
export function paidDone(p) {
  const u = store.unit(p.unitId);
  const m = openModal({
    size: 'sm',
    body: `<div class="center stack" style="padding:18px 0 4px;align-items:center">
      <div class="kpi-icon tone-success" style="width:64px;height:64px;border-radius:20px">${icon('check')}</div>
      <div><div class="muted small">Pago registrado · ${esc(p.unitCode)}</div><div style="font-size:28px;font-weight:800">${usd(p.amount)}</div>${p.amountBs ? `<div class="muted">Bs ${num(p.amountBs, 2)}</div>` : ''}</div>
      <div>${u ? debtBadge(u) : ''}</div>
    </div>`,
    footer: `<button class="btn btn-secondary" data-pr>${icon('print')} Comprobante</button>${u?.ownerPhone ? `<button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Avisar</button>` : ''}<button class="btn btn-primary" data-close autofocus>Listo</button>`
  });
  m.el.querySelector('[data-pr]').onclick = () => printPayment(p);
  m.el.querySelector('[data-wa]')?.addEventListener('click', () => waUnit('pago', { unit: store.unit(p.unitId), payment: p }));
}

// ======================================================================
// PORTAL: QR y enlace
// ======================================================================
export async function portalModal(u) {
  const code = await publishUnitPortal(u).catch(() => u.portalCode);
  const unit = code && code !== u.portalCode ? { ...u, portalCode: code } : u;
  const url = PORTAL_URL(unit);
  const qr = await qrDataURL(url, 6);
  const m = openModal({
    title: `Portal de la unidad ${esc(unit.code)}`, size: 'sm',
    sub: 'El propietario ve sus recibos y la relación de gastos, reporta pagos, envía solicitudes, reserva áreas y vota. Sin usuario ni contraseña: solo con este enlace.',
    body: `<div class="center stack" style="align-items:center"><img src="${qr}" alt="QR" width="220" height="220" style="image-rendering:pixelated;border-radius:12px;background:#fff;padding:6px"><code class="mono" style="font-size:20px;letter-spacing:.15em">${esc(unit.portalCode)}</code><input class="input input-ro small" readonly value="${esc(url)}"></div>`,
    footer: `<button class="btn btn-ghost" data-new>${icon('refresh')} Cambiar código</button><button class="btn btn-secondary" data-copy>${icon('copy')} Copiar</button><a class="btn btn-secondary" href="${esc(url)}" target="_blank" rel="noopener">${icon('external')} Abrir</a>${unit.ownerPhone ? `<button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Enviar</button>` : ''}`
  });
  m.el.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch (_) { toast('No se pudo copiar', 'warning'); } };
  m.el.querySelector('[data-wa]')?.addEventListener('click', () => waUnit('portal', { unit }));
  m.el.querySelector('[data-new]').onclick = async () => {
    if (!(await confirmDialog({ title: 'Cambiar el código del portal', message: 'El enlace anterior dejará de funcionar (útil si la unidad se vendió o cambió de inquilino).', confirmText: 'Cambiar' }))) return;
    await renewPortalCode(unit); m.close(); toast('Código renovado'); portalModal(store.unit(unit.id) || unit);
  };
}

// ======================================================================
// FICHA DE LA UNIDAD
// ======================================================================
export async function openUnit(id, { tab = 'resumen' } = {}) {
  let u = store.unit(id);
  if (!u) { toast('Unidad no encontrada', 'warning'); return; }
  let cur = tab;
  let receipts = null, payments = null;
  const m = openModal({ title: '', size: 'lg', body: '<div data-b></div>' });
  const body = m.el.querySelector('[data-b]');
  const load = async () => {
    [receipts, payments] = await Promise.all([store.unitReceipts(id).catch(() => []), store.unitPayments(id).catch(() => [])]);
    draw();
  };
  const draw = () => {
    u = store.unit(id) || u;
    const bal = unitBalance(u);
    const led = ledgerStatus(u).slice().reverse();
    const reqs = store.inbox.filter((x) => x.unitId === id && x.type === 'solicitud');
    body.innerHTML = `
      <div class="u-head">
        ${unitAvatar(u, 'lg')}
        <div class="grow" style="min-width:0"><div class="u-title">${esc(u.code)} ${u.active === false ? '<span class="badge badge-neutral">Inactiva</span>' : ''}</div>
          <div class="t-sub">${esc(UNIT_TYPES[u.type]?.label || '')}${u.floor ? ` · piso ${esc(u.floor)}` : ''} · alícuota ${num(u.aliquot || 0, 4)}%${store.buildings.length > 1 ? ` · ${esc(store.bldName(u.buildingId))}` : ''}</div>
          <div class="mt-xs">${debtBadge(u)}</div></div>
        <div class="u-bal ${bal > 0.009 ? 'due' : 'ok'}"><small>${bal > 0.009 ? 'Debe' : bal < -0.009 ? 'A favor' : 'Solvente'}</small><b>${usd(Math.abs(bal))}</b>${bs(Math.abs(bal)) && Math.abs(bal) > 0.009 ? `<small>${bs(Math.abs(bal))}</small>` : ''}</div>
      </div>
      <div class="u-actions">
        <button class="btn btn-success btn-sm" data-a="pay">${icon('wallet')} Registrar pago</button>
        ${u.ownerPhone || u.residentPhone ? `<button class="btn btn-whatsapp btn-sm" data-a="wa">${icon('whatsapp')} ${bal > 0.009 ? 'Recordar deuda' : 'WhatsApp'}</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-a="portal">${icon('qr')} Portal</button>
        <button class="btn btn-secondary btn-sm" data-a="stmt">${icon('file')} Estado de cuenta</button>
        ${isSolvent(u) ? `<button class="btn btn-secondary btn-sm" data-a="solv">${icon('shieldCheck')} Solvencia</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-a="charge">${icon('plus')} Cargo</button>
        <button class="btn btn-ghost btn-sm" data-a="edit">${icon('edit')} Editar</button>
      </div>
      <div class="tabs" data-tabs>${[['resumen', 'Resumen'], ['recibos', `Recibos (${led.length})`], ['pagos', 'Pagos'], ['solicitudes', `Solicitudes${reqs.length ? ` (${reqs.length})` : ''}`]].map(([k, l]) => `<button data-t="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div data-tab></div>`;
    const tb = body.querySelector('[data-tab]');
    if (cur === 'resumen') {
      tb.innerHTML = `<div class="kv">
          <div><span>Propietario</span><b>${esc(u.ownerName || '—')}</b></div>
          <div><span>${esc(loc().id)}</span><b>${esc(u.ownerIdDoc || '—')}</b></div>
          <div><span>Teléfono</span><b>${esc(u.ownerPhone || '—')}</b></div>
          <div><span>Correo</span><b>${esc(u.ownerEmail || '—')}</b></div>
          <div><span>Ocupación</span><b>${esc(OCCUPANCY[u.occupancy] || '—')}</b></div>
          ${u.occupancy === 'inquilino' ? `<div><span>Inquilino</span><b>${esc(u.residentName || '—')}${u.residentPhone ? ` · ${esc(u.residentPhone)}` : ''}</b></div>` : ''}
          <div><span>Estacionamiento</span><b>${esc(u.parking || '—')}</b></div>
          <div><span>Último pago</span><b>${u.lastPaymentAt ? fmtDate(u.lastPaymentAt) : '—'}</b></div>
          <div><span>Meses que debe</span><b class="${monthsOwed(u) >= 2 ? 'text-danger' : ''}">${monthsOwed(u)}</b></div>
          <div><span>Código del portal</span><b class="mono">${esc(u.portalCode || '—')}</b></div>
        </div>
        ${u.notes ? `<div class="box mt"><b>Notas:</b> ${esc(u.notes)}</div>` : ''}
        ${openCharges(u).length ? `<div class="section-title mt">Pendiente por pagar</div><div class="list">${openCharges(u).map((x) => `<div class="list-item"><span class="kpi-icon tone-${x.d && x.d < todayKey() ? 'danger' : 'warning'}" style="width:34px;height:34px">${icon('receipt')}</span><div class="grow"><b>${esc(x.k === 'extra' ? x.n : periodName(x.p))}</b><div class="t-sub">${esc(x.n)} · vence ${fmtDate(x.d)}${x.status === 'parcial' ? ` · abonado ${usd(x.covered)}` : ''}</div></div><b class="num">${usd(x.rest)}</b></div>`).join('')}</div>` : ''}
        <div class="row mt-lg" style="justify-content:flex-end">${u.active === false ? `<button class="btn btn-secondary btn-sm" data-a="on">Reactivar unidad</button>` : `<button class="btn btn-ghost btn-sm text-danger" data-a="off">${icon('trash')} Desactivar unidad</button>`}</div>`;
    } else if (cur === 'recibos') {
      if (!receipts) { tb.innerHTML = '<div class="empty"><div class="spinner"></div></div>'; return; }
      tb.innerHTML = receipts.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Recibo</th><th>Mes</th><th class="hide-sm">Vence</th><th class="r">Monto</th><th>Estado</th><th></th></tr></thead><tbody>
        ${receipts.map((r) => { const st = led.find((x) => x.id === r.id); return `<tr><td class="mono small">${esc(r.number)}</td><td>${esc(r.kind === 'cargo' ? (r.items?.[0]?.concept || 'Cargo') : periodName(r.period))}</td><td class="hide-sm">${fmtDate(r.dueDate)}</td><td class="r num">${usd(r.total)}</td><td>${st ? (st.status === 'pagado' ? '<span class="badge badge-success">Pagado</span>' : st.status === 'parcial' ? `<span class="badge badge-warning">Resta ${usd(st.rest)}</span>` : '<span class="badge badge-danger">Pendiente</span>') : '<span class="badge badge-success">Pagado</span>'}</td><td><button class="btn btn-ghost btn-icon btn-sm" data-pr="${r.id}" title="Imprimir">${icon('print')}</button></td></tr>`; }).join('')}
        </tbody></table></div>` : emptyState('receipt', 'Sin recibos todavía', 'Aparecen al emitir los recibos del mes.');
      tb.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => { const r = receipts.find((x) => x.id === b.dataset.pr); printReceipts([r], store.closings.find((c) => c.id === r.closingId) || null); });
    } else if (cur === 'pagos') {
      if (!payments) { tb.innerHTML = '<div class="empty"><div class="spinner"></div></div>'; return; }
      tb.innerHTML = payments.length ? `<div class="list">${payments.map((p) => `<div class="list-item"><span class="kpi-icon tone-${p.status === 'confirmado' ? 'success' : 'neutral'}" style="width:34px;height:34px">${icon('wallet')}</span><div class="grow" style="min-width:0"><b>${usd(p.amount)}</b> <span class="t-sub">${esc(p.number)}</span><div class="t-sub">${fmtDate(p.date)} · ${esc(methodLabel(p.method))}${p.reference ? ` · ref. ${esc(p.reference)}` : ''}${p.amountBs ? ` · Bs ${num(p.amountBs, 2)}` : ''}</div></div>${badge(PAY_STATUS, p.status)}<button class="btn btn-ghost btn-icon btn-sm" data-pp="${p.id}">${icon('print')}</button>${p.status === 'confirmado' ? `<button class="btn btn-ghost btn-icon btn-sm" data-pv="${p.id}" title="Anular">${icon('x')}</button>` : ''}</div>`).join('')}</div>`
        : emptyState('wallet', 'Sin pagos registrados');
      tb.querySelectorAll('[data-pp]').forEach((b) => b.onclick = () => printPayment(payments.find((x) => x.id === b.dataset.pp)));
      tb.querySelectorAll('[data-pv]').forEach((b) => b.onclick = async () => {
        const { requirePin } = await import('./auth.js');
        if (!(await requirePin('Anular un pago'))) return;
        const reason = await promptDialog({ title: 'Anular pago', label: 'Motivo', confirmText: 'Anular' });
        if (reason == null) return;
        await voidPayment(payments.find((x) => x.id === b.dataset.pv), reason); toast('Pago anulado'); load();
      });
    } else {
      tb.innerHTML = `<div class="row" style="justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-a="req">${icon('plus')} Nueva solicitud</button></div>
        ${reqs.length ? `<div class="list mt">${reqs.map((x) => `<div class="list-item"><span class="kpi-icon tone-info" style="width:34px;height:34px">${icon(REQUEST_CATS[x.category]?.icon || 'info')}</span><div class="grow" style="min-width:0"><b>${esc(REQUEST_CATS[x.category]?.label || 'Solicitud')}</b><div class="t-sub">${esc(x.text)}</div><div class="t-sub">${fmtDateTime(x.createdAt)}${x.reply ? ` · respuesta: ${esc(x.reply)}` : ''}</div></div>${badge(REQUEST_STATUS, x.status)}</div>`).join('')}</div>` : emptyState('inbox', 'Sin solicitudes')}`;
    }
    body.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { cur = b.dataset.t; draw(); });
    body.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => act(b.dataset.a));
  };
  const act = async (a) => {
    if (a === 'pay') { const p = await paymentModal(u); if (p) load(); }
    if (a === 'wa') waUnit(unitBalance(u) > 0.009 ? (monthsOwed(u) >= 2 ? 'moroso' : 'recordatorio') : 'portal', { unit: u });
    if (a === 'portal') portalModal(u);
    if (a === 'stmt') printStatement(u, receipts || await store.unitReceipts(id), payments || await store.unitPayments(id));
    if (a === 'solv') printSolvency(u);
    if (a === 'edit') { const r = await unitForm(u); if (r) draw(); }
    if (a === 'charge') { if (await chargeModal(u)) load(); }
    if (a === 'req') { if (await requestModal(u)) draw(); }
    if (a === 'off' || a === 'on') {
      const { requirePin } = await import('./auth.js');
      if (!(await requirePin(a === 'off' ? 'Desactivar la unidad' : 'Reactivar la unidad'))) return;
      await setUnitActive(u, a === 'on'); toast(a === 'on' ? 'Unidad reactivada' : 'Unidad desactivada'); draw();
    }
  };
  const off = store.on('units', () => { if (document.body.contains(body)) draw(); else off(); });
  draw(); load();
}

export function chargeModal(u) {
  return new Promise((resolve) => {
    let ok = false;
    const m = openModal({
      title: `Cargo a la unidad ${esc(u.code)}`, size: 'sm', sub: 'Multa, reparación hecha por el condominio, llave, control del portón… Se suma a su deuda.',
      body: `<form class="stack" data-f><div class="field"><label>Concepto</label><input class="input" name="concept" autofocus placeholder="Ej.: Reposición control del portón"></div><div class="field"><label>Monto</label><div class="input-group"><span class="prefix">${esc(loc().sym)}</span><input class="input" name="amount" inputmode="decimal"></div></div><div class="error-msg" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('plus')} Cargar</button>`,
      onClose: () => resolve(ok)
    });
    const go = async (e) => {
      e?.preventDefault();
      const F = m.el.querySelector('[data-f]').elements;
      const { requirePin } = await import('./auth.js');
      if (!(await requirePin('Cargar un monto a la unidad'))) return;
      try { await addUnitCharge(u, { concept: F.concept.value, amount: parseNum(F.amount.value) }); ok = true; toast('Cargo registrado'); m.close(); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; }
    };
    m.el.querySelector('[data-f]').onsubmit = go; m.el.querySelector('[data-ok]').onclick = go;
  });
}

export function requestModal(u0 = null) {
  return new Promise(async (resolve) => {
    const u = u0 || await pickUnit({ title: 'Solicitud de la unidad…' });
    if (!u) { resolve(false); return; }
    let ok = false;
    const m = openModal({
      title: `Nueva solicitud · ${esc(u.code)}`, size: 'sm',
      body: `<form class="stack" data-f><div class="field"><label>Tipo</label><select class="input select" name="category">${Object.entries(REQUEST_CATS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('')}</select></div><div class="field"><label>Descripción</label><textarea class="input textarea" name="text" rows="3" autofocus></textarea></div><div class="error-msg" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`,
      onClose: () => resolve(ok)
    });
    const go = async (e) => {
      e?.preventDefault();
      const F = m.el.querySelector('[data-f]').elements;
      try { await createRequest({ unitId: u.id, category: F.category.value, text: F.text.value }); ok = true; toast('Solicitud registrada'); m.close(); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; }
    };
    m.el.querySelector('[data-f]').onsubmit = go; m.el.querySelector('[data-ok]').onclick = go;
  });
}
export { receiptHTML };
