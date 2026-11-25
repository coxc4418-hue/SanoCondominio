// SanoCondominio — Configuración: administración, edificios, recibos, cuentas, áreas, portal, moneda y seguridad
import { store } from '../store.js';
import { requirePin, changePassword, authErrorMessage, session } from '../auth.js';
import { esc, num, toast, parseNum, setBusy, download, nowISO, round2, openModal, shortId, confirmDialog, emptyState, loc, flagImg, usd } from '../utils.js';
import { icon } from '../icons.js';
import { fxSectionHTML, bindFxSection } from '../bcv.js';
import { openCountryPicker, salesWa, SALES_PHONE_FMT } from '../shared.js';
import { isStandalone, bindInstallButtons } from '../install.js';
import { BUILDING_TYPES, EXPENSE_CATEGORIES, aliquotSum } from '../condo.js';
import { saveBuilding, slugify } from '../ops.js';

const SECTIONS = { admin: 'Administración', edificios: 'Edificios', recibos: 'Recibos y mora', cuentas: 'Cuentas para cobrar', areas: 'Áreas comunes', portal: 'Portal', moneda: 'Moneda', seguridad: 'Seguridad', apps: 'Instalar y respaldo' };
const sw = (name, on, title, sub) => `<label class="check box box-white"><span class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></span><span><b>${title}</b><br><small class="muted">${sub}</small></span></label>`;
const save = (t) => `<div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} ${t || 'Guardar'}</button></div>`;
const BANK_TYPES = { transferencia: 'Transferencia bancaria', pagomovil: 'Pago móvil', zelle: 'Zelle', efectivo: 'Efectivo en oficina', otro: 'Otro' };

/** Asistente para crear (o editar) un edificio */
export function buildingWizard({ first = false, building = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const b = building || { type: 'edificio' };
    const m = openModal({
      title: first ? '¡Bienvenido! Crea tu primer edificio 🏢' : building ? `Editar ${esc(building.name)}` : 'Nuevo edificio', size: 'md',
      sub: first ? 'Es el condominio que administras. Si administras varios, luego agregas los demás en Configuración › Edificios.' : '',
      body: `<form class="stack" data-f>
        <div class="field"><label>Nombre *</label><input class="input input-lg" name="name" value="${esc(b.name || '')}" placeholder="Ej.: Residencias Los Samanes" autofocus></div>
        <div class="field"><label>Tipo</label><div class="seg seg-block wrap" data-ty>${Object.entries(BUILDING_TYPES).map(([k, l]) => `<button type="button" data-t="${k}" class="${b.type === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="form-grid">
          <div class="field full"><label>Dirección</label><input class="input" name="address" value="${esc(b.address || '')}"></div>
          <div class="field"><label>${esc(loc().tax)} del condominio</label><input class="input" name="rif" value="${esc(b.rif || '')}"></div>
          <div class="field"><label>Fondo de reserva (%)</label><input class="input" name="reservePct" inputmode="decimal" value="${b.reservePct ?? ''}" placeholder="${num(store.settings.reservePct || 10, 0)} (el general)"></div>
        </div>
        ${building ? '' : `<div class="box stack"><b>${icon('sparkle')} Crear las unidades automáticamente (opcional)</b>
          <div class="form-grid-3"><div class="field"><label>Pisos</label><input class="input" name="floors" inputmode="numeric" placeholder="Ej.: 8"></div><div class="field"><label>Unidades por piso</label><input class="input" name="per" inputmode="numeric" placeholder="Ej.: 4"></div><div class="field"><label>Letras o números</label><select class="input select" name="naming"><option value="letras">1-A, 1-B, 2-A…</option><option value="numeros">101, 102, 201…</option><option value="casas">Casa 1, Casa 2…</option></select></div></div>
          <span class="hint">Se crean con alícuotas iguales; después cargas los propietarios o importas desde Excel.</span></div>`}
        <div class="error-msg" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary btn-lg" data-ok>${icon('check')} ${building ? 'Guardar' : 'Crear edificio'}</button>`,
      dismissible: true,
      onClose: () => { if (!done) resolve(null); }
    });
    let type = b.type || 'edificio';
    m.el.querySelectorAll('[data-t]').forEach((x) => x.onclick = () => { type = x.dataset.t; m.el.querySelectorAll('[data-t]').forEach((y) => y.classList.toggle('on', y === x)); if (type === 'urbanizacion' && m.el.querySelector('[name="naming"]')) m.el.querySelector('[name="naming"]').value = 'casas'; });
    const go = async (e) => {
      e?.preventDefault();
      const F = m.el.querySelector('[data-f]').elements;
      const err = m.el.querySelector('[data-err]');
      if (!F.name.value.trim()) { err.textContent = 'Escribe el nombre del edificio.'; return; }
      const btn = m.el.querySelector('[data-ok]'); setBusy(btn, true, 'Creando…');
      try {
        const saved = await saveBuilding({ ...b, name: F.name.value, type, address: F.address.value, rif: F.rif.value, reservePct: F.reservePct.value === '' ? null : parseNum(F.reservePct.value) }, building?.id || null);
        const floors = F.floors ? Math.min(60, parseInt(F.floors.value, 10) || 0) : 0;
        const per = F.per ? Math.min(30, parseInt(F.per.value, 10) || 0) : 0;
        if (floors && per) {
          const { importUnits } = await import('../ops.js');
          const naming = F.naming.value; const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          const rows = [];
          for (let f = 1; f <= floors; f++) for (let i = 0; i < per; i++) {
            const code = naming === 'numeros' ? `${f}${String(i + 1).padStart(2, '0')}` : naming === 'casas' ? `CASA ${(f - 1) * per + i + 1}` : `${f}-${L[i] || i + 1}`;
            rows.push({ code, type: naming === 'casas' ? 'casa' : 'apartamento', floor: String(f), aliquot: Math.round(10000 * 100 / (floors * per)) / 10000 });
          }
          await importUnits(saved.id, rows);
        }
        if (first) store.setBuilding('');
        done = true; m.close(); toast(building ? 'Edificio actualizado' : `${saved.name} creado${floors && per ? ` con ${floors * per} unidades` : ''}`); resolve(saved);
      } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
    };
    m.el.querySelector('[data-f]').onsubmit = go;
    m.el.querySelector('[data-ok]').onclick = go;
  });
}

export function mount(el, { params = {} }) {
  let sec = SECTIONS[params.tab || params.sec] ? (params.tab || params.sec) : 'admin';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Configuración</h1><p class="view-sub">Datos de la administración, edificios, reglas del recibo, cuentas para cobrar, áreas comunes, portal y seguridad.</p></div></div>
    <div class="tabs">${Object.entries(SECTIONS).map(([k, v]) => `<button data-s="${k}">${v}</button>`).join('')}</div>
    <div id="s-body" class="mt" style="max-width:980px"></div>`;
  const $ = (q) => el.querySelector(q);
  const s = () => store.settings;

  function render() {
    el.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
    const body = $('#s-body');

    if (sec === 'admin') {
      body.innerHTML = `<form class="card stack" id="f-adm">
        <div class="form-grid">
          <div class="field full"><label>Nombre de la administradora o junta de condominio</label><input class="input" name="businessName" value="${esc(s().businessName || store.tenant?.name || '')}" placeholder="Ej.: Administradora Horizonte · Junta de Condominio Res. Los Samanes"></div>
          <div class="field"><label>${esc(loc().tax)}</label><input class="input" name="rif" value="${esc(s().rif)}"></div>
          <div class="field"><label>Administrador(a) / firma</label><input class="input" name="manager" value="${esc(s().manager || '')}" placeholder="Nombre que firma las solvencias"></div>
          <div class="field"><label>Teléfono</label><input class="input" name="phone" value="${esc(s().phone)}"></div>
          <div class="field"><label>WhatsApp de la administración</label><input class="input" name="whatsapp" value="${esc(s().whatsapp || '')}"><span class="hint">Aparece en el portal del propietario.</span></div>
          <div class="field"><label>Correo</label><input class="input" name="email" value="${esc(s().email || '')}"></div>
          <div class="field"><label>Dirección de la oficina</label><input class="input" name="address" value="${esc(s().address)}"></div>
        </div>${save()}</form>`;
      $('#f-adm').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        await store.saveSettings({ businessName: F.businessName.value.trim(), rif: F.rif.value.trim(), manager: F.manager.value.trim(), phone: F.phone.value.trim(), whatsapp: F.whatsapp.value.trim(), email: F.email.value.trim(), address: F.address.value.trim() });
        if (F.businessName.value.trim() && !store.isDemo) { const { updateTenant } = await import('../store.js'); updateTenant(store.tenantId, { name: F.businessName.value.trim(), updatedAt: nowISO() }).catch(() => {}); }
        toast('Datos guardados');
      };
    }

    if (sec === 'edificios') {
      const list = store.buildings;
      body.innerHTML = `<div class="card card-flush"><div class="toolbar between"><b>${list.length} edificio(s)</b><button class="btn btn-primary btn-sm" id="b-new">${icon('plus')} Nuevo edificio</button></div>
        ${list.length ? `<div class="list" style="padding:6px 10px">${list.map((b) => { const us = store.unitsOf(b.id); const sum = aliquotSum(us); return `<div class="list-item ${b.active === false ? 'is-void' : ''}"><span class="kpi-icon tone-brand" style="width:40px;height:40px">${icon('building')}</span><div class="grow" style="min-width:0"><b>${esc(b.name)}</b><div class="t-sub">${esc(BUILDING_TYPES[b.type] || '')} · ${us.length} unidades · alícuotas ${num(sum, 2)}%${Math.abs(sum - 100) > 0.01 && us.length ? ' ⚠️' : ''} · reserva ${num(b.reservePct ?? s().reservePct, 0)}%</div>${b.address ? `<div class="t-sub ellipsis">${esc(b.address)}</div>` : ''}</div><button class="btn btn-ghost btn-sm" data-be="${b.id}">${icon('edit')} Editar</button>${b.active === false ? `<button class="btn btn-ghost btn-sm" data-on="${b.id}">Activar</button>` : us.length ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-off="${b.id}" title="Desactivar">${icon('trash')}</button>`}</div>`; }).join('')}</div>` : `<div class="pd-3">${emptyState('building', 'Sin edificios')}</div>`}</div>
        <p class="hint mt">Una administradora puede llevar varios edificios con la misma cuenta: cada uno con sus unidades, gastos, recibos y fondos. Arriba en el menú eliges con cuál trabajar.</p>`;
      $('#b-new').onclick = () => buildingWizard().then(() => render());
      body.querySelectorAll('[data-be]').forEach((x) => x.onclick = () => buildingWizard({ building: store.bld(x.dataset.be) }).then(() => render()));
      body.querySelectorAll('[data-off]').forEach((x) => x.onclick = async () => { if (await confirmDialog({ title: 'Desactivar edificio', message: 'Dejará de aparecer en las listas.', confirmText: 'Desactivar', danger: true })) { await saveBuilding({ ...store.bld(x.dataset.off), active: false }, x.dataset.off); render(); } });
      body.querySelectorAll('[data-on]').forEach((x) => x.onclick = async () => { await saveBuilding({ ...store.bld(x.dataset.on), active: true }, x.dataset.on); render(); });
    }

    if (sec === 'recibos') {
      const fee = s().adminFee || {}; const late = s().lateFee || {};
      body.innerHTML = `<form class="card stack" id="f-rec">
        <div class="form-grid">
          <div class="field"><label>Fondo de reserva (% sobre los gastos)</label><input class="input" name="reservePct" inputmode="decimal" value="${num(s().reservePct || 0, 2)}"><span class="hint">Normalmente 10%. Cada edificio puede tener el suyo.</span></div>
          <div class="field"><label>Días para pagar después de emitir</label><input class="input" name="dueDays" inputmode="numeric" value="${s().dueDays || 15}"></div>
          <div class="field"><label>Honorarios de administración</label><div class="row" style="gap:6px;flex-wrap:nowrap"><select class="input select" name="feeMode" style="max-width:150px"><option value="pct" ${fee.mode !== 'fijo' ? 'selected' : ''}>% de los gastos</option><option value="fijo" ${fee.mode === 'fijo' ? 'selected' : ''}>Monto fijo</option></select><input class="input" name="feeValue" inputmode="decimal" value="${num(fee.value || 0, 2)}"></div><span class="hint">Se suman a los gastos comunes. Deja 0 si es junta autogestionada.</span></div>
          <div class="field"><label>Prefijo del número de recibo</label><input class="input" name="invoicePrefix" maxlength="4" value="${esc(s().invoicePrefix || 'R')}"></div>
        </div>
        ${sw('lateOn', late.enabled, 'Cobrar interés de mora', 'Al emitir el mes, se agrega un % sobre lo vencido y no pagado de cada unidad.')}
        <div class="field" style="max-width:260px"><label>Interés de mora mensual (%)</label><input class="input" name="latePct" inputmode="decimal" value="${num(late.pct || 1, 2)}"></div>
        <div class="field"><label>Nota al pie del recibo</label><textarea class="input textarea" name="receiptNote" rows="2">${esc(s().receiptNote || '')}</textarea></div>
        ${save()}</form>
        <div class="card mt-lg"><div class="card-head"><div class="card-title">${icon('tag')} Categorías de gasto</div><button class="btn btn-ghost btn-sm" id="c-reset">Restaurar</button></div>
          <div class="chips chips-wrap mt">${store.categories.map((c) => `<span class="chip">${icon(c.icon)} ${esc(c.name)}${EXPENSE_CATEGORIES.some((x) => x.id === c.id) ? '' : ` <button class="linkish" data-cdel="${c.id}">${icon('x')}</button>`}</span>`).join('')}<button class="chip" id="c-add">${icon('plus')} Agregar</button></div></div>`;
      $('#f-rec').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        await store.saveSettings({ reservePct: round2(parseNum(F.reservePct.value)), dueDays: Math.max(1, parseInt(F.dueDays.value, 10) || 15), adminFee: { mode: F.feeMode.value, value: round2(parseNum(F.feeValue.value)) }, lateFee: { enabled: F.lateOn.checked, pct: round2(parseNum(F.latePct.value)) }, invoicePrefix: F.invoicePrefix.value.trim().toUpperCase() || 'R', receiptNote: F.receiptNote.value.trim() });
        toast('Reglas del recibo guardadas');
      };
      $('#c-add').onclick = async () => {
        const { promptDialog } = await import('../utils.js');
        const name = await promptDialog({ title: 'Nueva categoría de gasto', label: 'Nombre', placeholder: 'Ej.: Portón eléctrico' });
        if (!name?.trim()) return;
        await store.saveSettings({ categories: [...store.categories, { id: 'c' + shortId(5), name: name.trim(), icon: 'tag' }] }); render();
      };
      $('#c-reset').onclick = async () => { await store.saveSettings({ categories: EXPENSE_CATEGORIES }); render(); };
      body.querySelectorAll('[data-cdel]').forEach((x) => x.onclick = async () => { await store.saveSettings({ categories: store.categories.filter((c) => c.id !== x.dataset.cdel) }); render(); });
    }

    if (sec === 'cuentas') {
      const list = s().banks || [];
      body.innerHTML = `<div class="card card-flush"><div class="toolbar between"><div><b>Cuentas donde pagan los propietarios</b><div class="t-sub">Aparecen en el recibo, en los mensajes de WhatsApp y en el portal.</div></div><button class="btn btn-primary btn-sm" id="k-new">${icon('plus')} Agregar</button></div>
        ${list.length ? `<div class="list" style="padding:6px 10px">${list.map((b) => `<div class="list-item"><span class="kpi-icon tone-info" style="width:38px;height:38px">${icon(b.type === 'pagomovil' ? 'phone' : b.type === 'efectivo' ? 'cash' : 'card')}</span><div class="grow" style="min-width:0"><b>${esc(BANK_TYPES[b.type] || b.type)}${b.bank ? ` · ${esc(b.bank)}` : ''}</b><div class="t-sub ellipsis">${esc([b.number, b.phone, b.email, b.holder, b.idDoc].filter(Boolean).join(' · '))}</div></div><button class="btn btn-ghost btn-icon btn-sm" data-ke="${b.id}">${icon('edit')}</button><button class="btn btn-ghost btn-icon btn-sm" data-kd="${b.id}">${icon('trash')}</button></div>`).join('')}</div>` : `<div class="pd-3">${emptyState('card', 'Sin cuentas', 'Agrega la cuenta bancaria, el pago móvil o el Zelle del condominio.')}</div>`}</div>`;
      $('#k-new').onclick = () => bankForm();
      body.querySelectorAll('[data-ke]').forEach((x) => x.onclick = () => bankForm(list.find((b) => b.id === x.dataset.ke)));
      body.querySelectorAll('[data-kd]').forEach((x) => x.onclick = async () => { await store.saveSettings({ banks: list.filter((b) => b.id !== x.dataset.kd) }); render(); });
    }

    if (sec === 'areas') {
      const list = s().areas || [];
      body.innerHTML = `<div class="card card-flush"><div class="toolbar between"><b>Áreas comunes que se pueden reservar</b><button class="btn btn-primary btn-sm" id="a-new">${icon('plus')} Agregar</button></div>
        ${list.length ? `<div class="list" style="padding:6px 10px">${list.map((a) => `<div class="list-item ${a.active === false ? 'is-void' : ''}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon('calendar')}</span><div class="grow"><b>${esc(a.name)}</b><div class="t-sub">${a.fee ? usd(a.fee) : 'Gratis'}${a.deposit ? ` · depósito ${usd(a.deposit)}` : ''}${a.hours ? ` · ${esc(a.hours)}` : ''}${a.active === false ? ' · inactiva' : ''}</div></div><button class="btn btn-ghost btn-icon btn-sm" data-ae="${a.id}">${icon('edit')}</button></div>`).join('')}</div>` : `<div class="pd-3">${emptyState('calendar', 'Sin áreas')}</div>`}</div>`;
      $('#a-new').onclick = () => areaForm();
      body.querySelectorAll('[data-ae]').forEach((x) => x.onclick = () => areaForm(list.find((a) => a.id === x.dataset.ae)));
    }

    if (sec === 'portal') {
      const P = s().portal || {};
      body.innerHTML = `<form class="card stack" id="f-portal">
        <p class="small muted" style="margin:0">Cada unidad tiene un enlace privado (sanocondominio…/portal/CÓDIGO), sin usuario ni contraseña. El propietario ve <b>solo su unidad</b>: su deuda, sus recibos, sus pagos y lo que publiques para todos.</p>
        ${sw('enabled', P.enabled !== false, 'Portal del propietario activo', 'Si lo apagas, los enlaces muestran que el portal no está disponible.')}
        ${sw('reports', P.reports !== false, 'Permitir reportar pagos', 'El propietario indica monto, banco y referencia; tú lo confirmas en Cobranza.')}
        ${sw('expenses', P.expenses !== false, 'Mostrar la relación de gastos y el fondo de reserva', 'Transparencia: el resumen de gastos del último mes emitido.')}
        ${sw('requests', P.requests !== false, 'Recibir solicitudes e incidencias', 'Averías, ruidos, sugerencias…')}
        ${sw('bookings', P.bookings !== false, 'Pedir reservas de áreas comunes', 'Tú las apruebas en Áreas comunes.')}
        ${save()}</form>`;
      $('#f-portal').onsubmit = async (e) => { e.preventDefault(); const F = e.target.elements; await store.saveSettings({ portal: { enabled: F.enabled.checked, reports: F.reports.checked, expenses: F.expenses.checked, requests: F.requests.checked, bookings: F.bookings.checked } }); toast('Portal actualizado'); };
    }

    if (sec === 'moneda') {
      body.innerHTML = `<div class="card stack"><div class="between"><div><div class="card-title">${flagImg(loc().code, 20)} ${esc(loc().name)}</div><div class="t-sub">Trabajas en ${esc(loc().curName)} (${esc(loc().sym)})</div></div><button class="btn btn-secondary" id="m-country">${icon('globe')} Cambiar país</button></div></div><div class="mt-lg">${fxSectionHTML()}</div>`;
      bindFxSection(body, render);
      $('#m-country').onclick = async () => { if (!(await requirePin('Cambiar el país y la moneda'))) return; if (await openCountryPicker()) location.reload(); };
    }

    if (sec === 'seguridad') {
      body.innerHTML = `<div class="grid-2">
        <form class="card stack" id="f-pin"><div class="card-title">${icon('lock')} PIN de administrador</div><p class="small muted" style="margin:0">Protege la emisión y anulación de recibos, anular pagos, cargos a unidades, retiros de fondos, cambios de alícuota y los reportes.</p>
          <div class="field"><label>Nuevo PIN (4 a 12 dígitos)</label><input class="input" name="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <div class="field"><label>Repetir PIN</label><input class="input" name="pin2" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <button class="btn btn-primary">${icon('check')} Cambiar PIN</button></form>
        ${session.user?.isAnonymous ? `<div class="card stack"><div class="card-title">${icon('shield')} Contraseña</div><p class="muted" style="margin:0">En la demo no hay contraseña. Contrata SanoCondominio para tener tu propia cuenta.</p><a class="btn btn-whatsapp" href="${salesWa()}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>`
          : `<form class="card stack" id="f-pass"><div class="card-title">${icon('shield')} Contraseña de acceso</div>
          <div class="field"><label>Contraseña actual</label><input class="input" name="cur" type="password" autocomplete="current-password"></div>
          <div class="field"><label>Nueva contraseña (mínimo 8)</label><input class="input" name="next" type="password" autocomplete="new-password"></div>
          <div class="error-msg" data-err></div>
          <button class="btn btn-primary">${icon('check')} Cambiar contraseña</button></form>`}
      </div>
      <div class="box small mt-lg">${icon('shieldCheck')} Los datos de los propietarios solo son visibles con tu usuario. Cada portal muestra únicamente la información de su propia unidad y lo que publiques para todos (comunicados, votaciones, relación de gastos).</div>`;
      $('#f-pin').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        if (store.isDemo) { toast('En la demo el PIN siempre es 1234.', 'info'); return; }
        if (!/^\d{4,12}$/.test(F.pin.value)) { toast('El PIN debe tener de 4 a 12 dígitos', 'warning'); return; }
        if (F.pin.value !== F.pin2.value) { toast('Los PIN no coinciden', 'warning'); return; }
        if (store.hasPin() && !(await requirePin('Cambiar el PIN', { always: true }))) return;
        await store.setPin(F.pin.value); e.target.reset(); toast('PIN actualizado');
      };
      const fp = $('#f-pass');
      if (fp) fp.onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const err = fp.querySelector('[data-err]'); err.textContent = '';
        if (F.next.value.length < 8) { err.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; return; }
        const btn = fp.querySelector('button'); setBusy(btn, true);
        try { await changePassword(F.cur.value, F.next.value); e.target.reset(); toast('Contraseña actualizada'); }
        catch (ex) { err.textContent = authErrorMessage(ex); }
        setBusy(btn, false);
      };
    }

    if (sec === 'apps') {
      body.innerHTML = `<div class="grid-2">
        <div class="card stack"><div class="card-title">${icon('install')} Instalar la app</div>
          <p class="small muted" style="margin:0">Instala SanoCondominio en la computadora de la oficina y en tu teléfono. Todo conectado en tiempo real, también sin internet.</p>
          ${isStandalone() ? `<div class="pay-status ok"><span>${icon('check')} Estás usando la app instalada</span><span></span></div>` : `<button class="btn btn-primary btn-lg" data-install>${icon('install')} Instalar en este equipo</button>`}
          <div class="list">
            <div class="list-item"><span class="kpi-icon tone-success" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>Android</b><div class="t-sub">Chrome › menú ⋮ › Instalar app</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-info" style="width:34px;height:34px">${icon('laptop')}</span><div class="grow"><b>Computadora</b><div class="t-sub">Chrome o Edge › ícono de instalar en la barra de direcciones</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-violet" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>iPhone / iPad</b><div class="t-sub">Safari › Compartir › Agregar a inicio</div></div></div>
          </div></div>
        <div class="card stack"><div class="card-title">${icon('download')} Respaldo de datos</div>
          <p class="small muted" style="margin:0">Descarga una copia de edificios, unidades, gastos, recibos, pagos, fondos, comunicados, votaciones, reservas y configuración (JSON). Protegido con PIN.</p>
          <button class="btn btn-secondary" id="s-backup">${icon('download')} Descargar respaldo completo</button>
          <div class="divider"></div>
          <div class="card-title">${icon('whatsapp')} Soporte</div>
          <a class="btn btn-whatsapp" href="${salesWa('Hola, necesito soporte con SanoCondominio.')}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>
      </div>`;
      bindInstallButtons(body);
      $('#s-backup').onclick = async (e) => {
        const btn = e.currentTarget;
        if (!(await requirePin('Descargar el respaldo'))) return;
        setBusy(btn, true, 'Preparando…');
        try {
          const names = ['buildings', 'units', 'expenses', 'charges', 'closings', 'receipts', 'payments', 'funds', 'notices', 'votes', 'bookings', 'suppliers'];
          const got = await Promise.all(names.map((n) => store.listAll(n)));
          const data = { app: 'SanoCondominio', exportedAt: nowISO(), business: store.businessName, settings: store.settings, inbox: store.inbox };
          names.forEach((n, i) => { data[n] = got[i]; });
          download(`respaldo-${slugify(store.businessName || 'sanocondominio')}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
          toast('Respaldo descargado');
        } catch (ex) { toast('No se pudo generar el respaldo: ' + ex.message, 'danger'); }
        setBusy(btn, false);
      };
    }
  }

  function bankForm(b = null) {
    const x = b || { type: loc().code === 'VE' ? 'pagomovil' : 'transferencia', active: true };
    const m = openModal({
      title: b ? 'Editar cuenta' : 'Nueva cuenta para cobrar', size: 'md',
      body: `<form class="stack" data-f>
        <div class="field"><label>Tipo</label><select class="input select" name="type">${Object.entries(BANK_TYPES).map(([k, l]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="form-grid">
          <div class="field"><label>Banco</label><input class="input" name="bank" value="${esc(x.bank || '')}" placeholder="Ej.: Banesco"></div>
          <div class="field"><label>N° de cuenta</label><input class="input" name="number" value="${esc(x.number || '')}"></div>
          <div class="field"><label>Teléfono (pago móvil)</label><input class="input" name="phone" value="${esc(x.phone || '')}"></div>
          <div class="field"><label>Correo (Zelle)</label><input class="input" name="email" value="${esc(x.email || '')}"></div>
          <div class="field"><label>Titular</label><input class="input" name="holder" value="${esc(x.holder || '')}" placeholder="Condominio Res. Los Samanes"></div>
          <div class="field"><label>${esc(loc().tax)} / ${esc(loc().id)}</label><input class="input" name="idDoc" value="${esc(x.idDoc || '')}"></div>
        </div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    m.el.querySelector('[data-ok]').onclick = async () => {
      const F = m.el.querySelector('[data-f]').elements;
      const item = { id: x.id || 'k' + shortId(5), type: F.type.value, bank: F.bank.value.trim(), number: F.number.value.trim(), phone: F.phone.value.trim(), email: F.email.value.trim(), holder: F.holder.value.trim(), idDoc: F.idDoc.value.trim(), active: true };
      const list = s().banks || [];
      await store.saveSettings({ banks: b ? list.map((y) => (y.id === b.id ? item : y)) : [...list, item] });
      m.close(); toast('Cuenta guardada'); render();
    };
  }
  function areaForm(a = null) {
    const x = a || { name: '', fee: 0, deposit: 0, hours: '', active: true };
    const m = openModal({
      title: a ? 'Editar área' : 'Nueva área común', size: 'sm',
      body: `<form class="stack" data-f><div class="field"><label>Nombre</label><input class="input" name="name" value="${esc(x.name)}" autofocus placeholder="Ej.: Salón de fiestas"></div>
        <div class="form-grid"><div class="field"><label>Costo de la reserva</label><input class="input" name="fee" inputmode="decimal" value="${num(x.fee || 0)}"></div><div class="field"><label>Depósito</label><input class="input" name="deposit" inputmode="decimal" value="${num(x.deposit || 0)}"></div></div>
        <div class="field"><label>Horario</label><input class="input" name="hours" value="${esc(x.hours || '')}" placeholder="09:00 a 23:00"></div>
        <label class="check"><input type="checkbox" name="active" ${x.active !== false ? 'checked' : ''}> <span>Disponible para reservar</span></label></form>`,
      footer: `${a ? `<button class="btn btn-ghost text-danger" data-del style="margin-right:auto">${icon('trash')}</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    const list = s().areas || [];
    m.el.querySelector('[data-ok]').onclick = async () => {
      const F = m.el.querySelector('[data-f]').elements;
      if (!F.name.value.trim()) { toast('Escribe el nombre', 'warning'); return; }
      const item = { ...x, id: x.id || 'a' + shortId(5), name: F.name.value.trim(), fee: round2(parseNum(F.fee.value)), deposit: round2(parseNum(F.deposit.value)), hours: F.hours.value.trim(), active: F.active.checked };
      await store.saveSettings({ areas: a ? list.map((y) => (y.id === a.id ? item : y)) : [...list, item] });
      m.close(); toast('Área guardada'); render();
    };
    m.el.querySelector('[data-del]')?.addEventListener('click', async () => { await store.saveSettings({ areas: list.filter((y) => y.id !== a.id) }); m.close(); render(); });
  }

  el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sec = b.dataset.s; render(); });
  render();
  return store.on('*', (evt) => { if (evt === 'buildings' && sec === 'edificios') render(); });
}
