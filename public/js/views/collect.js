// SanoCondominio — Cobranza: por cobrar, pagos reportados desde el portal, pagos recibidos y morosos
import { store } from '../store.js';
import { esc, usd, bs, num, emptyState, toast, openModal, fmtDate, fmtDateTime, methodLabel, promptDialog, download, toCSV, normalize, debounce } from '../utils.js';
import { icon } from '../icons.js';
import { unitAvatar, openUnit, paymentModal, debtBadge } from '../unit.js';
import { unitBalance, monthsOwed, openCharges, periodName, currentPeriod, lastPeriods, badge, PAY_STATUS } from '../condo.js';
import { rejectReport, voidPayment } from '../ops.js';
import { waUnit, printPayment, printDoc, unitMessage } from '../shared.js';

export function mount(el, { params }) {
  let tab = params?.tab || (store.reportedPayments.length ? 'reportados' : 'cobrar');
  let month = currentPeriod();
  let q = '';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Cobranza</h1><p class="view-sub">Quién debe, qué pagos reportaron los propietarios y todo lo cobrado.</p></div>
      <div class="view-actions"><button class="btn btn-success" id="c-pay">${icon('wallet')} Registrar pago <kbd class="hide-sm">F1</kbd></button><button class="btn btn-whatsapp" id="c-remind">${icon('whatsapp')} Recordar a todos</button></div></div>
    <div class="kpis kpis-4" id="c-kpis"></div>
    <div class="tabs mt-lg" id="c-tabs"></div>
    <div id="c-body"></div>`;
  const $ = (s) => el.querySelector(s);

  function kpis() {
    const p = currentPeriod();
    const coll = store.collectedIn(p);
    const prev = store.collectedIn(lastPeriods(2)[1]);
    $('#c-kpis').innerHTML = `
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Por cobrar</span><span class="kpi-icon tone-danger">${icon('wallet')}</span></div><div class="kpi-value">${usd(store.totalDebt)}</div><div class="kpi-sub">${store.debtors.length} unidad(es)${bs(store.totalDebt) ? ` · ${bs(store.totalDebt)}` : ''}</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Cobrado este mes</span><span class="kpi-icon tone-success">${icon('trend')}</span></div><div class="kpi-value">${usd(coll)}</div><div class="kpi-sub">mes anterior ${usd(prev)}</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Por confirmar</span><span class="kpi-icon tone-info">${icon('bell')}</span></div><div class="kpi-value">${store.reportedPayments.length}</div><div class="kpi-sub">${usd(store.reportedPayments.reduce((a, x) => a + (Number(x.amount) || 0), 0))} reportados</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Morosos</span><span class="kpi-icon tone-warning">${icon('alert')}</span></div><div class="kpi-value">${store.delinquent.length}</div><div class="kpi-sub">2 o más meses sin pagar</div></div>`;
  }
  function tabs() {
    $('#c-tabs').innerHTML = [['cobrar', `Por cobrar (${store.debtors.length})`], ['reportados', `Reportados${store.reportedPayments.length ? ` <span class="tab-n">${store.reportedPayments.length}</span>` : ''}`], ['pagos', 'Pagos recibidos'], ['morosos', `Morosos (${store.delinquent.length})`]].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('');
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  }

  const debtRow = (u) => `<div class="list-item">${unitAvatar(u)}<div class="grow" style="min-width:0"><button class="linkish ellipsis" data-u="${u.id}"><b>${esc(u.code)}</b> · ${esc(u.ownerName || 'Sin propietario')}</button>
      <div class="t-sub">${debtBadge(u)} ${openCharges(u).slice(0, 4).map((x) => esc(x.k === 'extra' ? 'cargo' : periodName(x.p, true))).join(', ')}${u.lastPaymentAt ? ` · último pago ${fmtDate(u.lastPaymentAt)}` : ''}</div></div>
      <div class="r"><b class="num text-danger">${usd(unitBalance(u))}</b>${bs(unitBalance(u)) ? `<div class="t-sub">${bs(unitBalance(u))}</div>` : ''}</div>
      <div class="row" style="gap:4px;flex-wrap:nowrap">${u.ownerPhone || u.residentPhone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${u.id}" title="Recordar">${icon('whatsapp')}</button>` : ''}<button class="btn btn-success btn-icon btn-sm" data-pay="${u.id}" title="Registrar pago">${icon('wallet')}</button></div></div>`;

  function cobrar(list = store.debtors) {
    const t = normalize(q).replace(/\s+/g, '');
    const rows = list.filter((u) => !t || normalize(`${u.code}${u.ownerName}`).replace(/\s+/g, '').includes(t));
    $('#c-body').innerHTML = `<div class="card card-flush"><div class="toolbar"><label class="search grow">${icon('search')}<input id="c-q" value="${esc(q)}" placeholder="Buscar unidad o propietario…"></label>${tab === 'morosos' ? `<button class="btn btn-ghost btn-sm" id="c-print">${icon('print')} Imprimir listado</button>` : ''}</div>
      ${rows.length ? `<div class="list" style="padding:6px 10px">${rows.map(debtRow).join('')}</div>` : `<div class="pd-3">${emptyState('checkCircle', tab === 'morosos' ? 'Sin morosos' : '¡Todos al día!', 'No hay unidades con deuda en esta lista.')}</div>`}</div>`;
    $('#c-q').oninput = debounce((e) => { q = e.target.value; cobrar(list); setTimeout(() => { const i = $('#c-q'); i?.focus(); i?.setSelectionRange(q.length, q.length); }, 0); }, 250);
    $('#c-print')?.addEventListener('click', () => printDoc('Listado de morosos', `<table><tr><th>Unidad</th><th>Propietario</th><th>Teléfono</th><th class="c">Meses</th><th>Desde</th><th class="r">Deuda</th></tr>${rows.map((u) => `<tr><td>${esc(u.code)}</td><td>${esc(u.ownerName || '')}</td><td>${esc(u.ownerPhone || '')}</td><td class="c">${monthsOwed(u)}</td><td>${esc(periodName(openCharges(u)[0]?.p || ''))}</td><td class="r">${usd(unitBalance(u))}</td></tr>`).join('')}<tr class="tot"><td colspan="5">Total</td><td class="r">${usd(rows.reduce((a, u) => a + unitBalance(u), 0))}</td></tr></table>`));
    bindRows();
  }
  function bindRows() {
    el.querySelectorAll('#c-body [data-u]').forEach((b) => b.onclick = () => openUnit(b.dataset.u));
    el.querySelectorAll('#c-body [data-wa]').forEach((b) => b.onclick = () => { const u = store.unit(b.dataset.wa); waUnit(monthsOwed(u) >= 2 ? 'moroso' : 'recordatorio', { unit: u }); });
    el.querySelectorAll('#c-body [data-pay]').forEach((b) => b.onclick = () => paymentModal(store.unit(b.dataset.pay)));
  }

  function reportados() {
    const list = store.reportedPayments;
    const done = store.inboxOf('pago', ['procesada', 'rechazada']).slice(0, 10);
    $('#c-body').innerHTML = `${list.length ? `<div class="grid-cards">${list.map((x) => { const u = store.unit(x.unitId); return `<div class="card rep-card">
        <div class="between"><div class="row" style="gap:8px">${u ? unitAvatar(u) : ''}<div><b>${esc(x.unitCode)}</b><div class="t-sub">${esc(x.name || u?.ownerName || '')}</div></div></div><span class="badge badge-info">Reportado</span></div>
        <div class="rep-amt">${usd(x.amount)}${x.amountBs ? `<small>Bs ${num(x.amountBs, 2)}${x.rate ? ` · tasa ${num(x.rate, 2)}` : ''}</small>` : ''}</div>
        <div class="kv kv-1 small"><div><span>Forma de pago</span><b>${esc(methodLabel(x.method))}${x.bank ? ` · ${esc(x.bank)}` : ''}</b></div><div><span>Referencia</span><b class="mono">${esc(x.reference || '—')}</b></div><div><span>Fecha del pago</span><b>${fmtDate(x.date)}</b></div>${x.note ? `<div><span>Nota</span><b>${esc(x.note)}</b></div>` : ''}<div><span>Deuda de la unidad</span><b>${u ? usd(Math.max(0, unitBalance(u))) : '—'}</b></div></div>
        <div class="row mt" style="gap:6px"><button class="btn btn-success grow" data-ok="${x.id}">${icon('check')} Confirmar</button><button class="btn btn-ghost" data-no="${x.id}">${icon('x')} Rechazar</button></div>
        <div class="t-sub mt-xs">Recibido ${fmtDateTime(x.createdAt)}</div></div>`; }).join('')}</div>`
      : `<div class="card">${emptyState('bell', 'No hay pagos por confirmar', 'Cuando un propietario reporte su pago desde su portal, aparecerá aquí para que lo verifiques en el banco y lo confirmes con un toque.')}</div>`}
      ${done.length ? `<div class="card mt-lg"><div class="card-title">${icon('history')} Revisados recientemente</div><div class="list mt">${done.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.unitCode)}</b> · ${usd(x.amount)}<div class="t-sub">${esc(methodLabel(x.method))} ${x.reference ? '· ref. ' + esc(x.reference) : ''} · ${fmtDate(x.date)}</div></div>${x.status === 'procesada' ? '<span class="badge badge-success">Confirmado</span>' : '<span class="badge badge-neutral">Rechazado</span>'}</div>`).join('')}</div></div>` : ''}`;
    el.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
      const x = store.inbox.find((y) => y.id === b.dataset.ok); const u = store.unit(x.unitId);
      if (!u) { toast('La unidad ya no existe.', 'warning'); return; }
      await paymentModal(u, { amount: x.amount, amountBs: x.amountBs, rate: x.rate, method: x.method, bank: x.bank, reference: x.reference, date: x.date, note: x.note ? `Portal: ${x.note}` : 'Reportado desde el portal', inboxId: x.id });
    });
    el.querySelectorAll('[data-no]').forEach((b) => b.onclick = async () => {
      const x = store.inbox.find((y) => y.id === b.dataset.no);
      const reason = await promptDialog({ title: 'Rechazar pago reportado', label: 'Motivo (lo verá el propietario en su portal)', value: 'No aparece en el banco. Envíanos el comprobante.', confirmText: 'Rechazar' });
      if (reason == null) return;
      await rejectReport(x, reason); toast('Pago rechazado');
      const u = store.unit(x.unitId);
      if (u?.ownerPhone) waUnit('rechazo', { unit: u, extra: reason });
    });
  }

  function pagos() {
    const months = lastPeriods(6);
    const list = store.payments.filter((p) => store.inScope(p) && (p.date || '').startsWith(month));
    const ok = list.filter((p) => p.status === 'confirmado');
    const byM = {};
    for (const p of ok) byM[p.method] = (byM[p.method] || 0) + (Number(p.amount) || 0);
    $('#c-body').innerHTML = `<div class="card card-flush">
      <div class="toolbar"><div class="chips">${months.map((p) => `<button class="chip ${month === p ? 'on' : ''}" data-m="${p}">${esc(periodName(p))}</button>`).join('')}</div><button class="btn btn-ghost btn-sm" id="c-csv">${icon('download')} CSV</button></div>
      <div class="pd-3" style="padding-bottom:0"><div class="row" style="gap:8px;flex-wrap:wrap"><span class="badge badge-success">Total ${usd(ok.reduce((a, p) => a + (Number(p.amount) || 0), 0))}</span>${Object.entries(byM).map(([k, v]) => `<span class="badge badge-neutral">${esc(methodLabel(k))}: ${usd(v)}</span>`).join('')}</div></div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Unidad</th><th class="hide-sm">Forma de pago</th><th class="hide-sm">Referencia</th><th class="r">Monto</th><th></th></tr></thead><tbody>
        ${list.map((p) => `<tr class="${p.status !== 'confirmado' ? 'is-void' : ''}"><td>${fmtDate(p.date)}</td><td><button class="linkish" data-u="${p.unitId}"><b>${esc(p.unitCode)}</b></button><div class="t-sub ellipsis" style="max-width:160px">${esc(p.ownerName || '')}</div></td><td class="hide-sm">${esc(methodLabel(p.method))}${p.source === 'portal' ? ' <span class="badge badge-info">portal</span>' : ''}</td><td class="hide-sm mono small">${esc(p.reference || '—')}</td><td class="r"><b class="num">${usd(p.amount)}</b>${p.amountBs ? `<div class="t-sub">Bs ${num(p.amountBs, 2)}</div>` : ''}${p.status !== 'confirmado' ? `<div>${badge(PAY_STATUS, p.status)}</div>` : ''}</td>
          <td class="r" style="white-space:nowrap"><button class="btn btn-ghost btn-icon btn-sm" data-pp="${p.id}" title="Comprobante">${icon('print')}</button>${p.status === 'confirmado' ? `<button class="btn btn-ghost btn-icon btn-sm" data-pv="${p.id}" title="Anular">${icon('x')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="pd-3">${emptyState('wallet', 'Sin pagos en este mes')}</div>`}</div>`;
    el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { month = b.dataset.m; pagos(); });
    el.querySelectorAll('#c-body [data-u]').forEach((b) => b.onclick = () => openUnit(b.dataset.u, { tab: 'pagos' }));
    el.querySelectorAll('[data-pp]').forEach((b) => b.onclick = () => printPayment(store.payments.find((p) => p.id === b.dataset.pp)));
    el.querySelectorAll('[data-pv]').forEach((b) => b.onclick = async () => {
      const { requirePin } = await import('../auth.js');
      if (!(await requirePin('Anular un pago'))) return;
      const reason = await promptDialog({ title: 'Anular pago', label: 'Motivo', confirmText: 'Anular' });
      if (reason == null) return;
      await voidPayment(store.payments.find((p) => p.id === b.dataset.pv), reason); toast('Pago anulado: la deuda de la unidad se restableció');
    });
    $('#c-csv').onclick = () => download(`pagos-${month}.csv`, toCSV([['Fecha', 'N°', 'Edificio', 'Unidad', 'Propietario', 'Forma de pago', 'Banco', 'Referencia', 'Monto', 'Monto Bs', 'Tasa', 'Estado', 'Origen'], ...list.map((p) => [p.date, p.number, store.bldName(p.buildingId), p.unitCode, p.ownerName || '', methodLabel(p.method), p.bank || '', p.reference || '', num(p.amount), p.amountBs ? num(p.amountBs) : '', p.rate ? num(p.rate) : '', PAY_STATUS[p.status]?.label || p.status, p.source || ''])]), 'text/csv;charset=utf-8');
  }

  function draw() {
    kpis(); tabs();
    if (tab === 'cobrar') cobrar(store.debtors);
    else if (tab === 'morosos') cobrar(store.delinquent);
    else if (tab === 'reportados') reportados();
    else pagos();
  }

  $('#c-pay').onclick = () => paymentModal();
  $('#c-remind').onclick = () => {
    const list = store.debtors.filter((u) => u.ownerPhone || u.residentPhone);
    const m = openModal({
      title: 'Recordar la deuda por WhatsApp', size: 'md', sub: 'Toca cada unidad: se abre WhatsApp con su deuda detallada, los datos para pagar y su portal.',
      body: list.length ? `<div class="list" style="max-height:55vh;overflow:auto">${list.map((u) => `<div class="list-item">${unitAvatar(u)}<div class="grow"><b>${esc(u.code)}</b> · ${esc(u.ownerName || '')}<div class="t-sub">${usd(unitBalance(u))} · ${monthsOwed(u)} mes(es)</div></div><button class="btn btn-whatsapp btn-sm" data-s="${u.id}">${icon('whatsapp')} Enviar</button></div>`).join('')}</div>` : emptyState('checkCircle', 'Nadie a quien recordar', 'No hay unidades con deuda y teléfono.')
    });
    m.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { const u = store.unit(b.dataset.s); waUnit(monthsOwed(u) >= 2 ? 'moroso' : 'recordatorio', { unit: u }); b.classList.replace('btn-whatsapp', 'btn-secondary'); b.innerHTML = `${icon('check')} Enviado`; });
  };
  draw();
  const off = store.on('*', (e) => { if (['units', 'payments', 'inbox', 'building', 'settings', 'rate'].includes(e) && !el.querySelector('#c-q:focus')) draw(); });
  return () => off();
}
