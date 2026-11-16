// SanoCondominio — Fondos (reserva y especiales) e ingresos/egresos
import { store } from '../store.js';
import { esc, usd, bs, emptyState, toast, openModal, parseNum, todayKey, fmtDate, confirmDialog, loc } from '../utils.js';
import { icon } from '../icons.js';
import { buildingOptions } from '../unit.js';
import { lastPeriods, periodName, catOf } from '../condo.js';
import { fundMove, voidFundMove } from '../ops.js';
import { printDoc } from '../shared.js';

export function mount(el) {
  let tab = 'fondos';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Fondos y cuentas</h1><p class="view-sub">El fondo de reserva crece con cada recibo; los fondos especiales con las cuotas extraordinarias. Todo transparente para los propietarios.</p></div>
      <div class="view-actions"><button class="btn btn-primary" id="f-in">${icon('plus')} Aporte</button><button class="btn btn-secondary" id="f-out">${icon('minus')} Retiro</button></div></div>
    <div class="tabs" id="f-tabs">${[['fondos', 'Fondos'], ['libro', 'Ingresos y egresos']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="f-body"></div>`;
  const $ = (s) => el.querySelector(s);
  const blds = () => (store.building ? [store.bld(store.building)].filter(Boolean) : store.liveBuildings);

  function fondos() {
    const list = blds();
    if (!list.length) { $('#f-body').innerHTML = `<div class="card">${emptyState('piggy', 'Sin edificios', 'Crea un edificio en Configuración.')}</div>`; return; }
    $('#f-body').innerHTML = list.map((b) => {
      const names = store.fundNames(b.id);
      const moves = store.funds.filter((f) => f.buildingId === b.id).slice(0, 25);
      return `<div class="card mb-lg">
        ${list.length > 1 ? `<div class="card-title">${icon('building')} ${esc(b.name)}</div>` : ''}
        <div class="fund-grid mt">${names.map((f) => { const v = store.fundBalance(b.id, f); return `<div class="fund-card ${f === 'reserva' ? 'is-main' : ''}"><span>${icon(f === 'reserva' ? 'piggy' : 'layers')}</span><small>${f === 'reserva' ? 'Fondo de reserva' : esc(f)}</small><b class="num">${usd(v)}</b>${bs(v) ? `<em>${bs(v)}</em>` : ''}</div>`; }).join('')}</div>
        <div class="section-title mt-lg">Movimientos</div>
        ${moves.length ? `<div class="list">${moves.map((f) => `<div class="list-item ${f.status === 'anulado' ? 'is-void' : ''}"><span class="kpi-icon tone-${f.type === 'out' ? 'danger' : 'success'}" style="width:34px;height:34px">${icon(f.type === 'out' ? 'arrowUp' : 'arrowDown')}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(f.concept || '')}</b><div class="t-sub">${fmtDate(f.date)} · ${f.fund === 'reserva' || !f.fund ? 'Reserva' : esc(f.fund)}${f.status === 'anulado' ? ' · anulado' : ''}</div></div><b class="num ${f.type === 'out' ? 'text-danger' : 'text-success'}">${f.type === 'out' ? '−' : '+'}${usd(f.amount)}</b>${!f.closingId && !f.expenseId && f.status !== 'anulado' ? `<button class="btn btn-ghost btn-icon btn-sm" data-fv="${f.id}" title="Anular">${icon('x')}</button>` : ''}</div>`).join('')}</div>` : emptyState('piggy', 'Sin movimientos', 'Al emitir recibos, el aporte al fondo de reserva se registra solo.')}
      </div>`;
    }).join('');
    el.querySelectorAll('[data-fv]').forEach((b) => b.onclick = async () => {
      if (!(await confirmDialog({ title: 'Anular movimiento', message: '¿Anular este movimiento del fondo?', confirmText: 'Anular', danger: true }))) return;
      await voidFundMove(store.funds.find((f) => f.id === b.dataset.fv)); toast('Movimiento anulado');
    });
  }

  function libro() {
    const ps = lastPeriods(12);
    const rows = ps.map((p) => {
      const inc = store.collectedIn(p);
      const out = store.expenses.filter((e) => e.period === p && e.status !== 'anulado' && e.paid !== false && store.inScope(e)).reduce((a, e) => a + (Number(e.amount) || 0), 0);
      return { p, inc, out, net: inc - out };
    });
    const pend = store.expenses.filter((e) => e.status !== 'anulado' && e.paid === false && store.inScope(e));
    $('#f-body').innerHTML = `<div class="grid-main">
      <div class="card card-flush"><div class="toolbar between"><b>Últimos 12 meses</b><button class="btn btn-ghost btn-sm" id="f-print">${icon('print')} Imprimir</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Mes</th><th class="r">Ingresos (cobrado)</th><th class="r">Egresos (gastos pagados)</th><th class="r">Resultado</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><b>${esc(periodName(r.p))}</b></td><td class="r num text-success">${usd(r.inc)}</td><td class="r num">${usd(r.out)}</td><td class="r num ${r.net < 0 ? 'text-danger' : ''}"><b>${usd(r.net)}</b></td></tr>`).join('')}
        </tbody></table></div><p class="t-sub pd-3" style="padding-top:6px">Los pagos de más de 6 meses se consultan en Reportes.</p></div>
      <div class="card"><div class="card-title">${icon('clock')} Por pagar a proveedores</div>
        ${pend.length ? `<div class="list mt">${pend.map((e) => `<div class="list-item"><span class="kpi-icon tone-warning" style="width:34px;height:34px">${icon(catOf(e.category, store.categories).icon)}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(e.concept)}</b><div class="t-sub">${esc(e.supplierName || '')} · ${esc(periodName(e.period))}</div></div><b class="num">${usd(e.amount)}</b><button class="btn btn-ghost btn-sm" data-pd="${e.id}">${icon('check')} Pagado</button></div>`).join('')}</div>` : emptyState('checkCircle', 'Nada pendiente', 'Todos los gastos registrados están pagados.')}
      </div></div>`;
    el.querySelectorAll('[data-pd]').forEach((b) => b.onclick = async () => { await store.save('expenses', b.dataset.pd, { paid: true, paidAt: todayKey() }); toast('Marcado como pagado'); });
    $('#f-print').onclick = () => printDoc('Ingresos y egresos', `<table><tr><th>Mes</th><th class="r">Ingresos</th><th class="r">Egresos</th><th class="r">Resultado</th></tr>${rows.map((r) => `<tr><td>${esc(periodName(r.p))}</td><td class="r">${usd(r.inc)}</td><td class="r">${usd(r.out)}</td><td class="r">${usd(r.net)}</td></tr>`).join('')}</table>`);
  }

  function moveForm(type) {
    const b0 = store.currentBuilding?.id || store.liveBuildings[0]?.id;
    if (!b0) { toast('Crea un edificio primero.', 'warning'); return; }
    const m = openModal({
      title: type === 'in' ? 'Aporte a un fondo' : 'Retiro de un fondo', size: 'sm',
      sub: type === 'in' ? 'Intereses del banco, donaciones, venta de chatarra, saldo inicial del fondo…' : 'Para gastos que se pagan con un fondo usa mejor "Nuevo gasto › Se paga con el fondo".',
      body: `<form class="stack" data-f>
        <div class="field"><label>Edificio</label><select class="input select" name="b">${buildingOptions(b0)}</select></div>
        <div class="field"><label>Fondo</label><input class="input" name="fund" list="fl" value="reserva"><datalist id="fl">${store.fundNames().map((f) => `<option value="${esc(f)}">`).join('')}</datalist></div>
        <div class="field"><label>Monto</label><div class="input-group"><span class="prefix">${esc(loc().sym)}</span><input class="input input-lg" name="amount" inputmode="decimal" autofocus></div></div>
        <div class="field"><label>Concepto</label><input class="input" name="concept" placeholder="${type === 'in' ? 'Ej.: Saldo inicial del fondo de reserva' : 'Ej.: Compra de bomba de agua'}"></div>
        <div class="field"><label>Fecha</label><input class="input" type="date" name="date" value="${todayKey()}"></div>
        <div class="error-msg" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    const go = async (e) => {
      e?.preventDefault();
      const F = m.el.querySelector('[data-f]').elements;
      if (type === 'out') { const { requirePin } = await import('../auth.js'); if (!(await requirePin('Retirar dinero de un fondo'))) return; }
      try { await fundMove({ buildingId: F.b.value, fund: F.fund.value.trim() || 'reserva', type, amount: parseNum(F.amount.value), concept: F.concept.value, date: F.date.value }); m.close(); toast('Movimiento registrado'); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; }
    };
    m.el.querySelector('[data-f]').onsubmit = go; m.el.querySelector('[data-ok]').onclick = go;
  }

  const draw = () => { el.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab)); (tab === 'fondos' ? fondos : libro)(); };
  el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  $('#f-in').onclick = () => moveForm('in');
  $('#f-out').onclick = () => moveForm('out');
  draw();
  const off = store.on('*', (e) => { if (['funds', 'payments', 'expenses', 'building', 'buildings', 'settings', 'rate'].includes(e)) draw(); });
  return () => off();
}
