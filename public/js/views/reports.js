// SanoCondominio — Reportes: cobranza, morosidad, gastos, pagos y solvencias
import { store } from '../store.js';
import { esc, usd, num, emptyState, download, toCSV, todayKey, dayKey, addDays, fmtDate, methodLabel, setBusy, toast } from '../utils.js';
import { icon } from '../icons.js';
import { unitAvatar, openUnit, pickUnit } from '../unit.js';
import { lastPeriods, periodName, catOf, unitBalance, monthsOwed, isSolvent, openCharges } from '../condo.js';
import { printDoc, printSolvency, printStatement } from '../shared.js';

export function mount(el) {
  let tab = 'cobranza';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Reportes</h1><p class="view-sub">Para la junta de condominio, la asamblea y la rendición de cuentas.</p></div></div>
    <div class="tabs" id="r-tabs">${[['cobranza', 'Cobranza'], ['morosidad', 'Morosidad'], ['gastos', 'Gastos'], ['pagos', 'Pagos'], ['solvencias', 'Solvencias y estados de cuenta']].map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}</div>
    <div id="r-body"></div>`;
  const $ = (s) => el.querySelector(s);
  const ps = lastPeriods(12).reverse();

  function cobranza() {
    const rows = ps.map((p) => {
      const billed = store.closings.filter((c) => c.period === p && c.status !== 'anulado' && store.inScope(c)).reduce((a, c) => a + (Number(c.totalBilled) || 0), 0);
      return { p, billed, coll: store.collectedIn(p) };
    });
    const max = Math.max(1, ...rows.map((r) => Math.max(r.billed, r.coll)));
    const tb = rows.reduce((a, r) => a + r.billed, 0), tc = rows.reduce((a, r) => a + r.coll, 0);
    $('#r-body').innerHTML = `<div class="kpis kpis-4"><div class="card kpi"><div class="kpi-label">Facturado (12 meses)</div><div class="kpi-value">${usd(tb)}</div></div><div class="card kpi"><div class="kpi-label">Cobrado (6 meses en línea)</div><div class="kpi-value">${usd(tc)}</div></div><div class="card kpi"><div class="kpi-label">Deuda actual</div><div class="kpi-value">${usd(store.totalDebt)}</div></div><div class="card kpi"><div class="kpi-label">Unidades solventes</div><div class="kpi-value">${store.solventPct}%</div></div></div>
      <div class="card mt-lg"><div class="card-head"><div class="card-title">${icon('chart')} Facturado vs. cobrado</div><button class="btn btn-ghost btn-sm" id="r-pr">${icon('print')} Imprimir</button></div>
        <div class="bars2 tall">${rows.map((r) => `<div class="bar2"><div class="bar2-cols"><i class="b" style="height:${r.billed / max * 100}%" title="Facturado ${usd(r.billed)}"></i><i class="c" style="height:${r.coll / max * 100}%" title="Cobrado ${usd(r.coll)}"></i></div><span>${esc(periodName(r.p, true))}</span><small>${r.billed ? Math.round(r.coll / r.billed * 100) + '%' : ''}</small></div>`).join('')}</div>
        <div class="ag-legend mt"><span><i class="lg-b"></i> Facturado</span><span><i class="lg-c"></i> Cobrado</span></div>
        <div class="table-wrap mt"><table class="table"><thead><tr><th>Mes</th><th class="r">Facturado</th><th class="r">Cobrado</th><th class="r">%</th></tr></thead><tbody>${rows.slice().reverse().map((r) => `<tr><td><span class="hide-xs">${esc(periodName(r.p))}</span><span class="show-xs">${esc(periodName(r.p, true))}</span></td><td class="r num">${usd(r.billed)}</td><td class="r num">${usd(r.coll)}</td><td class="r">${r.billed ? Math.round(r.coll / r.billed * 100) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#r-pr').onclick = () => printDoc('Cobranza mensual', `<table><tr><th>Mes</th><th class="r">Facturado</th><th class="r">Cobrado</th><th class="r">%</th></tr>${rows.map((r) => `<tr><td>${esc(periodName(r.p))}</td><td class="r">${usd(r.billed)}</td><td class="r">${usd(r.coll)}</td><td class="r">${r.billed ? Math.round(r.coll / r.billed * 100) + '%' : '—'}</td></tr>`).join('')}</table><div class="kpis"><div class="kpi">Deuda actual<b>${usd(store.totalDebt)}</b></div><div class="kpi">Solventes<b>${store.solventPct}%</b></div></div>`);
  }

  function morosidad() {
    const units = store.scopeUnits;
    const B = [['Al día', (u) => unitBalance(u) <= 0.009, 'success'], ['1 mes', (u) => unitBalance(u) > 0.009 && monthsOwed(u) <= 1, 'info'], ['2 meses', (u) => monthsOwed(u) === 2, 'warning'], ['3 a 5 meses', (u) => monthsOwed(u) >= 3 && monthsOwed(u) <= 5, 'danger'], ['6 o más', (u) => monthsOwed(u) >= 6, 'danger']];
    const groups = B.map(([l, f, t]) => { const list = units.filter(f); return { l, t, list, debt: list.reduce((a, u) => a + Math.max(0, unitBalance(u)), 0) }; });
    $('#r-body').innerHTML = `<div class="aging">${groups.map((g) => `<div class="card aging-card tone-b-${g.t}"><small>${g.l}</small><b>${g.list.length}</b><span>${usd(g.debt)}</span></div>`).join('')}</div>
      <div class="card card-flush mt-lg"><div class="toolbar between"><b>Unidades con deuda</b><div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" id="r-csv">${icon('download')} CSV</button><button class="btn btn-ghost btn-sm" id="r-pr">${icon('print')} Imprimir</button></div></div>
        ${store.debtors.length ? `<div class="table-wrap"><table class="table rt"><thead><tr><th>Unidad</th><th class="hide-sm">Propietario</th><th class="c">Meses</th><th class="hide-sm">Desde</th><th class="r">Deuda</th></tr></thead><tbody>${store.debtors.map((u) => `<tr class="click" data-u="${u.id}"><td><div class="row" style="gap:8px;flex-wrap:nowrap">${unitAvatar(u)}<b>${esc(u.code)}</b></div></td><td class="hide-sm">${esc(u.ownerName || '')}</td><td class="c">${monthsOwed(u)}</td><td class="hide-sm">${esc(periodName(openCharges(u)[0]?.p || ''))}</td><td class="r num"><b>${usd(unitBalance(u))}</b></td></tr>`).join('')}</tbody></table></div>` : `<div class="pd-3">${emptyState('checkCircle', 'Sin deudas')}</div>`}</div>`;
    el.querySelectorAll('[data-u]').forEach((r) => r.onclick = () => openUnit(r.dataset.u));
    const data = store.debtors.map((u) => [store.bldName(u.buildingId), u.code, u.ownerName || '', u.ownerPhone || '', monthsOwed(u), periodName(openCharges(u)[0]?.p || ''), num(unitBalance(u))]);
    $('#r-csv').onclick = () => download('morosidad.csv', toCSV([['Edificio', 'Unidad', 'Propietario', 'Teléfono', 'Meses', 'Desde', 'Deuda'], ...data]), 'text/csv;charset=utf-8');
    $('#r-pr').onclick = () => printDoc('Morosidad por antigüedad', `<div class="kpis">${groups.map((g) => `<div class="kpi">${g.l}<b>${g.list.length} · ${usd(g.debt)}</b></div>`).join('')}</div><table><tr><th>Unidad</th><th>Propietario</th><th class="c">Meses</th><th>Desde</th><th class="r">Deuda</th></tr>${store.debtors.map((u) => `<tr><td>${esc(u.code)}</td><td>${esc(u.ownerName || '')}</td><td class="c">${monthsOwed(u)}</td><td>${esc(periodName(openCharges(u)[0]?.p || ''))}</td><td class="r">${usd(unitBalance(u))}</td></tr>`).join('')}</table>`);
  }

  function gastos() {
    const exp = store.expenses.filter((e) => e.status !== 'anulado' && store.inScope(e));
    const cats = {};
    for (const e of exp) { cats[e.category] ||= {}; cats[e.category][e.period] = (cats[e.category][e.period] || 0) + (Number(e.amount) || 0); }
    const list = Object.entries(cats).map(([k, v]) => ({ k, v, t: Object.values(v).reduce((a, x) => a + x, 0) })).sort((a, b) => b.t - a.t);
    const total = list.reduce((a, r) => a + r.t, 0) || 1;
    const p6 = ps.slice(-6);
    $('#r-body').innerHTML = `<div class="grid-main"><div class="card"><div class="card-head"><div class="card-title">${icon('pie')} Gastos por categoría (12 meses)</div><button class="btn btn-ghost btn-sm" id="r-pr">${icon('print')}</button></div>
        ${list.length ? `<div class="mt">${list.map((r) => `<div class="hbar"><span class="ellipsis">${esc(catOf(r.k, store.categories).name)}</span><span class="track"><i style="width:${Math.max(2, r.t / list[0].t * 100)}%"></i></span><b class="num">${usd(r.t)} <small class="t-sub">${Math.round(r.t / total * 100)}%</small></b></div>`).join('')}</div>` : emptyState('pie', 'Sin gastos')}</div>
      <div class="card"><div class="card-title">${icon('receipt')} Total</div><div class="kpi-value mt">${usd(list.reduce((a, r) => a + r.t, 0))}</div><div class="t-sub">${exp.length} gasto(s) registrados</div></div></div>
      ${list.length ? `<div class="card card-flush mt-lg"><div class="table-wrap"><table class="table"><thead><tr><th>Categoría</th>${p6.map((p) => `<th class="r">${esc(periodName(p, true))}</th>`).join('')}</tr></thead><tbody>${list.map((r) => `<tr><td>${esc(catOf(r.k, store.categories).name)}</td>${p6.map((p) => `<td class="r num">${r.v[p] ? usd(r.v[p]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>` : ''}`;
    $('#r-pr').onclick = () => printDoc('Gastos por categoría', `<table><tr><th>Categoría</th>${p6.map((p) => `<th class="r">${esc(periodName(p, true))}</th>`).join('')}<th class="r">12 meses</th></tr>${list.map((r) => `<tr><td>${esc(catOf(r.k, store.categories).name)}</td>${p6.map((p) => `<td class="r">${r.v[p] ? usd(r.v[p]) : '—'}</td>`).join('')}<td class="r">${usd(r.t)}</td></tr>`).join('')}</table>`, { landscape: true });
  }

  function pagos() {
    $('#r-body').innerHTML = `<div class="card"><div class="form-grid-3"><div class="field"><label>Desde</label><input class="input" type="date" id="r-from" value="${dayKey(addDays(new Date(), -90))}"></div><div class="field"><label>Hasta</label><input class="input" type="date" id="r-to" value="${todayKey()}"></div><div class="field"><label>&nbsp;</label><button class="btn btn-primary" id="r-go">${icon('search')} Consultar</button></div></div></div><div id="r-res" class="mt-lg"></div>`;
    $('#r-go').onclick = async (e) => {
      setBusy(e.currentTarget, true, 'Consultando…');
      try {
        const list = (await store.listBetween('payments', 'date', $('#r-from').value, $('#r-to').value)).filter((p) => p.status === 'confirmado' && store.inScope(p)).sort((a, b) => a.date.localeCompare(b.date));
        const byM = {}; for (const p of list) byM[p.method] = (byM[p.method] || 0) + (Number(p.amount) || 0);
        $('#r-res').innerHTML = `<div class="card card-flush"><div class="toolbar between"><b>${list.length} pago(s) · ${usd(list.reduce((a, p) => a + (Number(p.amount) || 0), 0))}</b><button class="btn btn-ghost btn-sm" id="r-csv">${icon('download')} CSV</button></div>
          <div class="pd-3"><div class="row" style="gap:6px;flex-wrap:wrap">${Object.entries(byM).map(([k, v]) => `<span class="badge badge-neutral">${esc(methodLabel(k))}: ${usd(v)}</span>`).join('')}</div></div>
          ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Unidad</th><th class="hide-sm">Forma</th><th class="hide-sm">Ref.</th><th class="r">Monto</th></tr></thead><tbody>${list.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${esc(p.unitCode)}</td><td class="hide-sm">${esc(methodLabel(p.method))}</td><td class="hide-sm mono small">${esc(p.reference || '')}</td><td class="r num">${usd(p.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
        $('#r-csv').onclick = () => download('pagos.csv', toCSV([['Fecha', 'N°', 'Unidad', 'Propietario', 'Forma', 'Banco', 'Referencia', 'Monto', 'Bs', 'Tasa'], ...list.map((p) => [p.date, p.number, p.unitCode, p.ownerName || '', methodLabel(p.method), p.bank || '', p.reference || '', num(p.amount), p.amountBs ? num(p.amountBs) : '', p.rate ? num(p.rate) : ''])]), 'text/csv;charset=utf-8');
      } catch (ex) { toast(ex.message, 'danger'); }
      setBusy(e.currentTarget, false);
    };
    $('#r-go').click();
  }

  function solvencias() {
    const sol = store.scopeUnits.filter(isSolvent);
    $('#r-body').innerHTML = `<div class="grid-2"><div class="card"><div class="card-title">${icon('file')} Estado de cuenta</div><p class="small muted">Todos los recibos y pagos de una unidad con su saldo.</p><button class="btn btn-primary" id="r-st">${icon('search')} Elegir unidad</button></div>
      <div class="card"><div class="card-title">${icon('shieldCheck')} Constancia de solvencia</div><p class="small muted">Para vender, alquilar o tramitar. Solo para unidades sin deuda.</p><button class="btn btn-primary" id="r-sv">${icon('search')} Elegir unidad</button></div></div>
      <div class="card card-flush mt-lg"><div class="toolbar"><b>${sol.length} unidad(es) solventes</b></div>${sol.length ? `<div class="list" style="padding:6px 10px">${sol.map((u) => `<div class="list-item">${unitAvatar(u)}<div class="grow"><b>${esc(u.code)}</b><div class="t-sub">${esc(u.ownerName || '')}${u.lastPaymentAt ? ` · último pago ${fmtDate(u.lastPaymentAt)}` : ''}</div></div><button class="btn btn-ghost btn-sm" data-sv="${u.id}">${icon('print')} Solvencia</button></div>`).join('')}</div>` : `<div class="pd-3">${emptyState('shieldCheck', 'Ninguna unidad solvente aún')}</div>`}</div>`;
    $('#r-st').onclick = async () => { const u = await pickUnit({ title: 'Estado de cuenta de…' }); if (u) printStatement(u, await store.unitReceipts(u.id), await store.unitPayments(u.id)); };
    $('#r-sv').onclick = async () => { const u = await pickUnit({ title: 'Solvencia de…', filter: isSolvent }); if (u) printSolvency(u); };
    el.querySelectorAll('[data-sv]').forEach((b) => b.onclick = () => printSolvency(store.unit(b.dataset.sv)));
  }

  const draw = () => { el.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab)); ({ cobranza, morosidad, gastos, pagos, solvencias })[tab](); };
  el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  draw();
  const off = store.on('*', (e) => { if (['building'].includes(e)) draw(); });
  return () => off();
}
