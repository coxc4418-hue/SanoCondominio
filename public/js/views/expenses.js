// SanoCondominio — Gastos del mes, cuotas especiales y proveedores
import { store } from '../store.js';
import { esc, usd, num, emptyState, toast, openModal, setBusy, parseNum, todayKey, fmtDate, confirmDialog, loc, PAY_METHODS, methodLabel, normalize } from '../utils.js';
import { icon } from '../icons.js';
import { buildingOptions } from '../unit.js';
import { currentPeriod, addMonths, periodName, catOf, aliquotSum } from '../condo.js';
import { saveExpense, voidExpense, copyRecurring, saveSupplier, saveCharge, voidCharge } from '../ops.js';
import { printDoc } from '../shared.js';

export function mount(el, { params, navigate }) {
  let period = params?.period || currentPeriod();
  let tab = params?.tab || 'gastos';
  const bldId = () => store.currentBuilding?.id || '';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Gastos del mes</h1><p class="view-sub">Todo lo que se paga en el condominio. Los gastos comunes se reparten por alícuota en los recibos.</p></div>
      <div class="view-actions">
        <button class="btn btn-primary" id="x-new">${icon('plus')} Nuevo gasto <kbd class="hide-sm">F2</kbd></button>
        <button class="btn btn-secondary" id="x-copy">${icon('copy')} Copiar fijos del mes anterior</button>
      </div></div>
    <div class="period-bar card">
      <button class="btn btn-ghost btn-icon" data-pm="-1" aria-label="Mes anterior">${icon('chevronLeft')}</button>
      <div class="grow center"><b id="x-period"></b><div class="t-sub" id="x-state"></div></div>
      <button class="btn btn-ghost btn-icon" data-pm="1" aria-label="Mes siguiente">${icon('chevronRight')}</button>
    </div>
    <div class="tabs mt" id="x-tabs">${[['gastos', 'Gastos'], ['cuotas', 'Cuotas especiales'], ['proveedores', 'Proveedores']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="x-body"></div>`;
  const $ = (s) => el.querySelector(s);
  const needBld = () => {
    if (bldId()) return false;
    $('#x-body').innerHTML = `<div class="card">${emptyState('building', store.liveBuildings.length ? 'Elige un edificio' : 'Crea tu primer edificio', store.liveBuildings.length ? 'Los gastos se cargan por edificio. Elige con cuál trabajar:' : 'Ve a Configuración › Edificios.')}<div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap">${store.liveBuildings.map((b) => `<button class="btn btn-secondary" data-pick="${b.id}">${icon('building')} ${esc(b.name)}</button>`).join('')}</div></div>`;
    el.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => store.setBuilding(b.dataset.pick));
    return true;
  };

  function head() {
    $('#x-period').textContent = periodName(period);
    const b = bldId();
    const cl = b ? store.closing(b, period) : null;
    $('#x-state').innerHTML = !b ? '' : cl ? `<span class="badge badge-success">${icon('check')} Recibos emitidos el ${fmtDate(cl.emittedAt)}</span>` : period > currentPeriod() ? '<span class="badge badge-info">Mes futuro</span>' : '<span class="badge badge-warning">Abierto: puedes cargar gastos</span>';
  }

  function gastos() {
    if (needBld()) return;
    const b = bldId();
    const list = store.expenses.filter((e) => e.buildingId === b && e.period === period);
    const live = list.filter((e) => e.status !== 'anulado');
    const commons = live.filter((e) => e.type !== 'no_comun' && !e.fromFund);
    const nonC = live.filter((e) => e.type === 'no_comun' && !e.fromFund);
    const fund = live.filter((e) => e.fromFund);
    const sum = (l) => l.reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const byCat = {};
    for (const e of commons) byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0);
    const cats = Object.entries(byCat).sort((a, c) => c[1] - a[1]);
    const max = cats[0]?.[1] || 1;
    const cl = store.closing(b, period);
    $('#x-body').innerHTML = `
      <div class="kpis kpis-4">
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Gastos comunes</span><span class="kpi-icon tone-brand">${icon('receipt')}</span></div><div class="kpi-value">${usd(sum(commons))}</div><div class="kpi-sub">${commons.length} gasto(s) · se reparten por alícuota</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">No comunes</span><span class="kpi-icon tone-info">${icon('home')}</span></div><div class="kpi-value">${usd(sum(nonC))}</div><div class="kpi-sub">a unidades específicas</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Pagado con fondos</span><span class="kpi-icon tone-violet">${icon('piggy')}</span></div><div class="kpi-value">${usd(sum(fund))}</div><div class="kpi-sub">no se cobra en el recibo</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Por pagar a proveedores</span><span class="kpi-icon tone-warning">${icon('clock')}</span></div><div class="kpi-value">${usd(sum(live.filter((e) => e.paid === false)))}</div><div class="kpi-sub">${live.filter((e) => e.paid === false).length} pendiente(s)</div></div>
      </div>
      ${!cl && live.length ? `<div class="banner req-banner mt"><span>${icon('file')} ¿Ya cargaste todos los gastos de ${esc(periodName(period))}? Revisa cómo quedan los recibos y emítelos.</span><button class="btn btn-sm btn-primary" id="x-go-bill">Ir a recibos</button></div>` : ''}
      <div class="grid-main mt-lg">
        <div class="card card-flush">
          <div class="toolbar between"><b>${live.length} gasto(s) en ${esc(periodName(period))}</b><button class="btn btn-ghost btn-sm" id="x-print">${icon('print')} Relación de gastos</button></div>
          ${list.length ? `<div class="list" style="padding:6px 10px">${list.map((e) => { const c = catOf(e.category, store.categories); return `<div class="list-item ${e.status === 'anulado' ? 'is-void' : ''}"><span class="kpi-icon tone-${e.fromFund ? 'violet' : e.type === 'no_comun' ? 'info' : 'brand'}" style="width:38px;height:38px">${icon(c.icon)}</span>
            <div class="grow" style="min-width:0"><b class="ellipsis">${esc(e.concept || c.name)}</b><div class="t-sub ellipsis">${esc(c.name)}${e.supplierName ? ` · ${esc(e.supplierName)}` : ''} · ${fmtDate(e.date)}${e.invoiceNo ? ` · fact. ${esc(e.invoiceNo)}` : ''}</div>
              <div class="row mt-xs" style="gap:6px">${e.type === 'no_comun' ? `<span class="badge badge-info">No común · ${(e.unitIds || []).length} unidad(es)</span>` : ''}${e.fromFund ? `<span class="badge badge-violet">Fondo: ${esc(e.fromFund)}</span>` : ''}${e.paid === false ? '<span class="badge badge-warning">Por pagar</span>' : ''}${e.status === 'anulado' ? '<span class="badge badge-neutral">Anulado</span>' : ''}</div></div>
            <b class="num">${usd(e.amount)}</b>${e.status !== 'anulado' ? `<button class="btn btn-ghost btn-icon btn-sm" data-ed="${e.id}" title="Editar">${icon('edit')}</button><button class="btn btn-ghost btn-icon btn-sm" data-vo="${e.id}" title="Anular">${icon('trash')}</button>` : ''}</div>`; }).join('')}</div>`
            : `<div class="pd-3">${emptyState('receipt', 'Sin gastos en este mes', 'Carga la nómina del conserje, vigilancia, electricidad, agua, mantenimiento… o copia los gastos fijos del mes anterior.')}</div>`}
        </div>
        <div class="card"><div class="card-title">${icon('pie')} Por categoría</div>
          ${cats.length ? `<div class="mt">${cats.map(([k, v]) => `<div class="hbar"><span class="ellipsis">${esc(catOf(k, store.categories).name)}</span><span class="track"><i style="width:${Math.max(3, v / max * 100)}%"></i></span><b class="num">${usd(v)}</b></div>`).join('')}</div>` : emptyState('pie', 'Sin datos')}
          <div class="box mt"><div class="between small"><span>Fondo de reserva disponible</span><b>${usd(store.fundBalance(b, 'reserva'))}</b></div></div>
        </div>
      </div>`;
    $('#x-go-bill')?.addEventListener('click', () => navigate('recibos', { period }));
    $('#x-print').onclick = () => printDoc(`Relación de gastos · ${store.bldName(b)} · ${periodName(period)}`, `<table><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Proveedor</th><th>Tipo</th><th class="r">Monto</th></tr>${live.map((e) => `<tr><td>${fmtDate(e.date)}</td><td>${esc(catOf(e.category, store.categories).name)}</td><td>${esc(e.concept)}</td><td>${esc(e.supplierName || '')}</td><td>${e.fromFund ? 'Fondo ' + esc(e.fromFund) : e.type === 'no_comun' ? 'No común' : 'Común'}</td><td class="r">${usd(e.amount)}</td></tr>`).join('')}<tr class="tot"><td colspan="5">Total gastos comunes</td><td class="r">${usd(sum(commons))}</td></tr></table>`);
    el.querySelectorAll('[data-ed]').forEach((x) => x.onclick = () => expenseForm(store.expenses.find((e) => e.id === x.dataset.ed)));
    el.querySelectorAll('[data-vo]').forEach((x) => x.onclick = async () => {
      const e = store.expenses.find((y) => y.id === x.dataset.vo);
      if (!(await confirmDialog({ title: 'Anular gasto', message: `¿Anular "${esc(e.concept)}" por ${usd(e.amount)}?`, confirmText: 'Anular', danger: true }))) return;
      try { await voidExpense(e); toast('Gasto anulado'); } catch (ex) { toast(ex.message, 'warning', 5000); }
    });
  }

  function cuotas() {
    if (needBld()) return;
    const b = bldId();
    const list = store.charges.filter((c) => c.buildingId === b && c.period === period);
    $('#x-body').innerHTML = `<div class="card">
      <div class="card-head"><div class="card-title">${icon('layers')} Cuotas especiales de ${esc(periodName(period))}</div><button class="btn btn-primary btn-sm" id="c-new">${icon('plus')} Nueva cuota</button></div>
      <p class="small muted" style="margin-top:0">Para obras o compras grandes (impermeabilización, bomba de agua, pintura): se suman al recibo del mes, repartidas por alícuota o con un monto fijo por unidad, y pueden ir a un fondo propio.</p>
      ${list.length ? `<div class="list">${list.map((c) => `<div class="list-item ${c.status === 'anulado' ? 'is-void' : ''}"><span class="kpi-icon tone-violet" style="width:36px;height:36px">${icon('layers')}</span><div class="grow"><b>${esc(c.concept)}</b><div class="t-sub">${c.mode === 'fijo' ? `${usd(c.amount)} por unidad` : `${usd(c.amount)} repartidos por alícuota`}${c.fund ? ` · va al fondo "${esc(c.fund)}"` : ''}${c.unitIds?.length ? ` · ${c.unitIds.length} unidad(es)` : ''}</div></div>${c.status === 'anulado' ? '<span class="badge badge-neutral">Anulada</span>' : `<button class="btn btn-ghost btn-icon btn-sm" data-cv="${c.id}">${icon('trash')}</button>`}</div>`).join('')}</div>` : emptyState('layers', 'Sin cuotas especiales este mes')}
    </div>`;
    $('#c-new').onclick = () => chargeForm();
    el.querySelectorAll('[data-cv]').forEach((x) => x.onclick = async () => { try { await voidCharge(store.charges.find((c) => c.id === x.dataset.cv)); toast('Cuota anulada'); } catch (ex) { toast(ex.message, 'warning'); } });
  }

  function proveedores() {
    $('#x-body').innerHTML = `<div class="card card-flush"><div class="toolbar between"><b>${store.suppliers.length} proveedor(es)</b><button class="btn btn-primary btn-sm" id="s-new">${icon('plus')} Nuevo proveedor</button></div>
      ${store.suppliers.length ? `<div class="list" style="padding:6px 10px">${store.suppliers.map((s) => { const tot = store.expenses.filter((e) => e.supplierId === s.id && e.status !== 'anulado').reduce((a, e) => a + (Number(e.amount) || 0), 0); return `<div class="list-item"><span class="kpi-icon tone-info" style="width:36px;height:36px">${icon(catOf(s.category, store.categories).icon)}</span><div class="grow" style="min-width:0"><b>${esc(s.name)}</b><div class="t-sub">${esc(catOf(s.category, store.categories).name)}${s.rif ? ` · ${esc(s.rif)}` : ''}${s.phone ? ` · ${esc(s.phone)}` : ''}</div></div><div class="r"><b class="num">${usd(tot)}</b><div class="t-sub">12 meses</div></div><button class="btn btn-ghost btn-icon btn-sm" data-se="${s.id}">${icon('edit')}</button></div>`; }).join('')}</div>` : `<div class="pd-3">${emptyState('truck', 'Sin proveedores', 'Registra a la empresa de vigilancia, el técnico de ascensores, la de limpieza…')}</div>`}</div>`;
    $('#s-new').onclick = () => supplierForm();
    el.querySelectorAll('[data-se]').forEach((x) => x.onclick = () => supplierForm(store.supplier(x.dataset.se)));
  }

  function draw() {
    head();
    el.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    ({ gastos, cuotas, proveedores })[tab]();
  }

  // ---------- Formularios ----------
  function expenseForm(e = null) {
    const b = e?.buildingId || bldId() || store.liveBuildings[0]?.id;
    if (!b) { toast('Primero crea el edificio.', 'warning'); return; }
    const d = { period, date: period === currentPeriod() ? todayKey() : `${period}-01`, category: 'mantenimiento', type: 'comun', split: 'iguales', paid: true, method: 'transferencia', ...(e || {}) };
    const funds = store.fundNames(b);
    const m = openModal({
      title: e ? 'Editar gasto' : 'Nuevo gasto', size: 'lg',
      body: `<form class="stack" data-f>
        <div class="form-grid-3">
          <div class="field"><label>Edificio</label><select class="input select" name="buildingId">${buildingOptions(b)}</select></div>
          <div class="field"><label>Mes del recibo</label><input class="input" type="month" name="period" value="${d.period}"></div>
          <div class="field"><label>Fecha del gasto</label><input class="input" type="date" name="date" value="${d.date}"></div>
        </div>
        <div class="field"><label>Categoría</label><div class="cat-grid">${store.categories.map((c) => `<button type="button" class="cat-btn ${d.category === c.id ? 'on' : ''}" data-cat="${c.id}">${icon(c.icon)}<span>${esc(c.name)}</span></button>`).join('')}</div></div>
        <div class="form-grid">
          <div class="field full"><label>Concepto *</label><input class="input" name="concept" value="${esc(d.concept || '')}" placeholder="Ej.: Sueldo del conserje · Reparación de la bomba de agua" ${e ? '' : 'autofocus'}></div>
          <div class="field"><label>Monto *</label><div class="input-group"><span class="prefix">${esc(loc().sym)}</span><input class="input input-lg" name="amount" inputmode="decimal" value="${d.amount ? num(d.amount) : ''}" placeholder="0"></div></div>
          <div class="field"><label>Proveedor</label><select class="input select" name="supplierId"><option value="">— Sin proveedor —</option>${store.suppliers.map((s) => `<option value="${s.id}" ${d.supplierId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="__new">+ Nuevo proveedor…</option></select></div>
          <div class="field"><label>N° de factura</label><input class="input" name="invoiceNo" value="${esc(d.invoiceNo || '')}"></div>
          <div class="field"><label>¿Quién lo paga?</label><select class="input select" name="fromFund"><option value="">Se cobra en el recibo del mes</option>${funds.map((f) => `<option value="${esc(f)}" ${d.fromFund === f ? 'selected' : ''}>Se paga con el fondo "${esc(f)}" (${usd(store.fundBalance(b, f))})</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Se reparte entre</label><div class="seg seg-block" data-type><button type="button" data-ty="comun" class="${d.type !== 'no_comun' ? 'on' : ''}">Todas las unidades (común)</button><button type="button" data-ty="no_comun" class="${d.type === 'no_comun' ? 'on' : ''}">Solo algunas unidades</button></div></div>
        <div data-nc ${d.type === 'no_comun' ? '' : 'hidden'} class="box stack">
          <div class="between"><b>¿A qué unidades se les cobra?</b><div class="seg seg-sm"><button type="button" data-sp="iguales" class="${d.split !== 'alicuota' ? 'on' : ''}">Partes iguales</button><button type="button" data-sp="alicuota" class="${d.split === 'alicuota' ? 'on' : ''}">Por alícuota</button></div></div>
          <div class="check-grid" data-units></div>
        </div>
        <div class="form-grid">
          <label class="check box box-white"><span class="switch"><input type="checkbox" name="paid" ${d.paid !== false ? 'checked' : ''}><span></span></span><span><b>Ya está pagado al proveedor</b></span></label>
          <div class="field"><label>Forma de pago</label><select class="input select" name="method">${Object.entries(PAY_METHODS).map(([k, p]) => `<option value="${k}" ${d.method === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
          <div class="field"><label>Referencia</label><input class="input" name="reference" value="${esc(d.reference || '')}"></div>
        </div>
        <div class="error-msg" data-err></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar gasto</button>`
    });
    let cat = d.category, type = d.type === 'no_comun' ? 'no_comun' : 'comun', split = d.split;
    const sel = new Set(d.unitIds || []);
    const F = m.el.querySelector('[data-f]').elements;
    const drawUnits = () => {
      const us = store.unitsOf(F.buildingId.value);
      m.el.querySelector('[data-units]').innerHTML = us.map((u) => `<label class="chk-mini"><input type="checkbox" value="${u.id}" ${sel.has(u.id) ? 'checked' : ''}> ${esc(u.code)}</label>`).join('') || '<span class="t-sub">Sin unidades</span>';
      m.el.querySelectorAll('[data-units] input').forEach((i) => i.onchange = () => { if (i.checked) sel.add(i.value); else sel.delete(i.value); });
    };
    m.el.querySelectorAll('[data-cat]').forEach((x) => x.onclick = () => { cat = x.dataset.cat; m.el.querySelectorAll('[data-cat]').forEach((y) => y.classList.toggle('on', y === x)); if (!F.concept.value) F.concept.placeholder = catOf(cat, store.categories).name; });
    m.el.querySelectorAll('[data-ty]').forEach((x) => x.onclick = () => { type = x.dataset.ty; m.el.querySelectorAll('[data-ty]').forEach((y) => y.classList.toggle('on', y === x)); m.el.querySelector('[data-nc]').hidden = type !== 'no_comun'; drawUnits(); });
    m.el.querySelectorAll('[data-sp]').forEach((x) => x.onclick = () => { split = x.dataset.sp; m.el.querySelectorAll('[data-sp]').forEach((y) => y.classList.toggle('on', y === x)); });
    F.buildingId.onchange = drawUnits;
    F.supplierId.onchange = async () => { if (F.supplierId.value !== '__new') return; const s = await supplierForm(null, cat); if (s) { F.supplierId.insertAdjacentHTML('afterbegin', `<option value="${s.id}">${esc(s.name)}</option>`); F.supplierId.value = s.id; } else F.supplierId.value = ''; };
    drawUnits();
    const go = async (ev) => {
      ev?.preventDefault();
      const err = m.el.querySelector('[data-err]');
      const amount = parseNum(F.amount.value);
      if (!F.concept.value.trim() && !cat) { err.textContent = 'Escribe el concepto.'; return; }
      if (type === 'no_comun' && !sel.size) { err.textContent = 'Marca al menos una unidad.'; return; }
      const btn = m.el.querySelector('[data-ok]'); setBusy(btn, true, 'Guardando…');
      try {
        await saveExpense({ buildingId: F.buildingId.value, period: F.period.value || period, date: F.date.value, category: cat, concept: F.concept.value.trim() || catOf(cat, store.categories).name, amount, supplierId: F.supplierId.value === '__new' ? '' : F.supplierId.value, invoiceNo: F.invoiceNo.value, fromFund: F.fromFund.value, type, unitIds: [...sel], split, paid: F.paid.checked, method: F.method.value, reference: F.reference.value }, e?.id || null);
        m.close(); toast(e ? 'Gasto actualizado' : 'Gasto registrado');
        if (F.period.value && F.period.value !== period) { period = F.period.value; draw(); }
      } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
    };
    m.el.querySelector('[data-f]').onsubmit = go;
    m.el.querySelector('[data-ok]').onclick = go;
  }

  function chargeForm() {
    const b = bldId();
    const m = openModal({
      title: `Cuota especial · ${esc(periodName(period))}`, size: 'md',
      body: `<form class="stack" data-f>
        <div class="field"><label>Concepto</label><input class="input" name="concept" placeholder="Ej.: Impermeabilización de la azotea (cuota 1 de 3)" autofocus></div>
        <div class="field"><label>Cómo se cobra</label><div class="seg seg-block" data-md><button type="button" data-m="alicuota" class="on">Monto total, repartido por alícuota</button><button type="button" data-m="fijo">Monto fijo por unidad</button></div></div>
        <div class="field"><label data-lbl>Monto total</label><div class="input-group"><span class="prefix">${esc(loc().sym)}</span><input class="input input-lg" name="amount" inputmode="decimal"></div></div>
        <div class="field"><label>Fondo al que va (opcional)</label><input class="input" name="fund" list="fund-list" placeholder="Ej.: Impermeabilización"><datalist id="fund-list">${store.fundNames(b).map((f) => `<option value="${esc(f)}">`).join('')}</datalist><span class="hint">Lo cobrado se suma a ese fondo para pagar la obra.</span></div>
        <div class="error-msg" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Agregar al recibo</button>`
    });
    let mode = 'alicuota';
    m.el.querySelectorAll('[data-m]').forEach((x) => x.onclick = () => { mode = x.dataset.m; m.el.querySelectorAll('[data-m]').forEach((y) => y.classList.toggle('on', y === x)); m.el.querySelector('[data-lbl]').textContent = mode === 'fijo' ? 'Monto por unidad' : 'Monto total'; });
    const go = async (ev) => {
      ev?.preventDefault();
      const F = m.el.querySelector('[data-f]').elements;
      try { await saveCharge({ buildingId: b, period, concept: F.concept.value, amount: parseNum(F.amount.value), mode, fund: F.fund.value }); m.close(); toast('Cuota especial agregada'); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; }
    };
    m.el.querySelector('[data-f]').onsubmit = go; m.el.querySelector('[data-ok]').onclick = go;
  }

  $('#x-new').onclick = () => expenseForm();
  $('#x-copy').onclick = async (e) => {
    const b = bldId(); if (!b) { toast('Elige un edificio', 'warning'); return; }
    if (store.closing(b, period)) { toast('Este mes ya está facturado.', 'warning'); return; }
    setBusy(e.currentTarget, true, 'Copiando…');
    try { const n = await copyRecurring(b, addMonths(period, -1), period); toast(n ? `${n} gasto(s) fijo(s) copiado(s) como "por pagar". Revisa los montos.` : 'No hay gastos fijos nuevos que copiar.', n ? 'success' : 'info', 5000); }
    catch (ex) { toast(ex.message, 'warning'); }
    setBusy(e.currentTarget, false);
  };
  el.querySelectorAll('[data-pm]').forEach((b) => b.onclick = () => { period = addMonths(period, Number(b.dataset.pm)); draw(); });
  el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  draw();
  if (params?.new) setTimeout(() => expenseForm(), 50);
  const off = store.on('*', (e) => { if (['expenses', 'charges', 'closings', 'suppliers', 'funds', 'building', 'buildings', 'settings', 'rate'].includes(e)) draw(); });
  return () => off();
}

export function supplierForm(s = null, category = '') {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title: s ? 'Editar proveedor' : 'Nuevo proveedor', size: 'md',
      body: `<form class="stack" data-f><div class="form-grid">
        <div class="field full"><label>Nombre *</label><input class="input" name="name" value="${esc(s?.name || '')}" autofocus></div>
        <div class="field"><label>${esc(loc().tax)}</label><input class="input" name="rif" value="${esc(s?.rif || '')}"></div>
        <div class="field"><label>Teléfono</label><input class="input" name="phone" value="${esc(s?.phone || '')}"></div>
        <div class="field"><label>Rubro</label><select class="input select" name="category">${store.categories.map((c) => `<option value="${c.id}" ${(s?.category || category) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Datos bancarios</label><input class="input" name="bank" value="${esc(s?.bank || '')}"></div>
      </div><div class="error-msg" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`,
      onClose: () => { if (!done) resolve(null); }
    });
    const go = async (ev) => {
      ev?.preventDefault();
      const F = m.el.querySelector('[data-f]').elements;
      if (!F.name.value.trim()) { m.el.querySelector('[data-err]').textContent = 'Escribe el nombre.'; return; }
      const r = await saveSupplier({ name: F.name.value, rif: F.rif.value, phone: F.phone.value, category: F.category.value, bank: F.bank.value }, s?.id || null);
      done = true; m.close(); toast('Proveedor guardado'); resolve(r);
    };
    m.el.querySelector('[data-f]').onsubmit = go; m.el.querySelector('[data-ok]').onclick = go;
  });
}
