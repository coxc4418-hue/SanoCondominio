// SanoCondominio — Recibos: vista previa, emisión del mes, envío e historial
import { store } from '../store.js';
import { esc, usd, bs, num, emptyState, toast, openModal, setBusy, fmtDate, confirmDialog, dayKey, addDays } from '../utils.js';
import { icon } from '../icons.js';
import { unitAvatar, openUnit } from '../unit.js';
import { currentPeriod, addMonths, periodName, catOf, ledgerStatus, unitBalance, aliquotSum, dueDateFor } from '../condo.js';
import { previewBilling, emitBilling, annulBilling } from '../ops.js';
import { printReceipts, waUnit, printDoc } from '../shared.js';

export function mount(el, { params, navigate }) {
  let period = params?.period || currentPeriod();
  let receipts = null; let loadedKey = '';
  const bldId = () => store.currentBuilding?.id || '';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Recibos del mes</h1><p class="view-sub">Revisa cómo se reparten los gastos y emite los recibos de todas las unidades en un clic.</p></div></div>
    <div class="period-bar card">
      <button class="btn btn-ghost btn-icon" data-pm="-1" aria-label="Mes anterior">${icon('chevronLeft')}</button>
      <div class="grow center"><b id="b-period"></b><div class="t-sub" id="b-bld"></div></div>
      <button class="btn btn-ghost btn-icon" data-pm="1" aria-label="Mes siguiente">${icon('chevronRight')}</button>
    </div>
    <div id="b-body" class="mt"></div>
    <div class="card mt-lg"><div class="card-title">${icon('history')} Meses emitidos</div><div id="b-hist" class="mt"></div></div>`;
  const $ = (s) => el.querySelector(s);

  function draw() {
    $('#b-period').textContent = periodName(period);
    const b = bldId();
    $('#b-bld').textContent = b ? store.bldName(b) : '';
    if (!b) {
      $('#b-body').innerHTML = `<div class="card">${emptyState('building', 'Elige un edificio', 'Los recibos se emiten por edificio.')}<div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap">${store.liveBuildings.map((x) => `<button class="btn btn-secondary" data-pick="${x.id}">${icon('building')} ${esc(x.name)}</button>`).join('')}</div></div>`;
      el.querySelectorAll('[data-pick]').forEach((x) => x.onclick = () => store.setBuilding(x.dataset.pick));
      hist(); return;
    }
    const cl = store.closing(b, period);
    if (cl) emitted(cl); else preview(b);
    hist();
  }

  function sumRows(s) {
    const r = (l, v, cls = '') => v ? `<div class="sum-line ${cls}"><span>${l}</span><b class="num">${usd(v)}</b></div>` : '';
    return `${r('Gastos comunes', s.common)}${r('Honorarios de administración', s.adminFee)}${r(`Fondo de reserva (${num(s.reservePct, 0)}%)`, s.reserve)}
      <div class="sum-line sub"><span>A repartir por alícuota</span><b class="num">${usd(s.toDistribute)}</b></div>
      ${r('Gastos no comunes', s.nonCommon)}${r('Cuotas especiales', s.special)}${r('Intereses de mora', s.mora)}
      <div class="sum-total"><span>Total a facturar</span><b class="num">${usd(s.totalBilled)}</b></div>${bs(s.totalBilled) ? `<div class="t-sub r">${bs(s.totalBilled)}</div>` : ''}`;
  }

  function preview(b) {
    const { summary: s, receipts: rs } = previewBilling(b, period);
    const aliq = aliquotSum(store.unitsOf(b));
    const future = period > currentPeriod();
    const due = dueDateFor(store.settings);
    $('#b-body').innerHTML = `
      <div class="grid-main">
        <div class="card card-flush">
          <div class="toolbar between"><b>Vista previa · ${rs.length} recibo(s)</b><span class="badge badge-warning">Sin emitir</span></div>
          ${rs.length ? `<div class="table-wrap" style="max-height:60vh"><table class="table"><thead><tr><th>Unidad</th><th class="hide-sm">Propietario</th><th class="r">Alícuota</th><th class="r">Este mes</th><th class="r hide-sm">Deuda previa</th></tr></thead><tbody>
            ${rs.map((r) => `<tr><td><div class="row" style="gap:8px;flex-wrap:nowrap">${unitAvatar(r.unit)}<b>${esc(r.unit.code)}</b></div></td><td class="hide-sm ellipsis" style="max-width:200px">${esc(r.unit.ownerName || '')}</td><td class="r num">${num(r.unit.aliquot || 0, 4)}%</td><td class="r"><b class="num">${usd(r.total)}</b>${r.items.some((i) => i.kind !== 'comun' && i.kind !== 'reserva') ? `<div class="t-sub">${r.items.filter((i) => i.kind !== 'comun' && i.kind !== 'reserva').map((i) => esc(i.kind === 'mora' ? 'mora' : i.kind === 'no_comun' ? 'no común' : 'especial')).join(', ')}</div>` : ''}</td><td class="r hide-sm num ${unitBalance(r.unit) > 0.009 ? 'text-danger' : ''}">${unitBalance(r.unit) > 0.009 ? usd(unitBalance(r.unit)) : '—'}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="pd-3">${emptyState('building', 'Sin unidades', 'Crea las unidades del edificio primero.')}<div class="center"><button class="btn btn-primary" data-go="unidades">${icon('plus')} Crear unidades</button></div></div>`}
        </div>
        <div class="stack">
          <div class="card" data-tour="bill-sum"><div class="card-title">${icon('pie')} Resumen de ${esc(periodName(period))}</div><div class="mt">${sumRows(s)}</div>
            ${Math.abs(aliq - 100) > 0.01 && rs.length ? `<div class="vital-alert warning mt">Las alícuotas suman ${num(aliq, 4)}%: se reparte en proporción para que cuadre el 100%.</div>` : ''}
            ${!s.expensesCount ? `<div class="vital-alert warning mt">No hay gastos cargados en este mes. <button class="linkish" data-go="gastos"><b>Cargar gastos</b></button></div>` : ''}
            ${future ? '<div class="vital-alert warning mt">Este mes todavía no empieza.</div>' : ''}
            <div class="field mt"><label>Fecha de vencimiento</label><input class="input" type="date" id="b-due" value="${due}"></div>
            <button class="btn btn-primary btn-lg btn-block mt" id="b-emit" ${s.totalBilled > 0 && rs.length ? '' : 'disabled'}>${icon('send')} Emitir ${rs.length} recibos</button>
            <p class="hint center mt-sm">Se suman a la deuda de cada unidad y aparecen en su portal. Si te equivocas, puedes anular la emisión.</p>
          </div>
          <div class="card"><div class="card-title">${icon('receipt')} Gastos comunes por categoría</div>
            <div class="mt">${Object.entries(s.byCat).sort((a, c) => c[1] - a[1]).map(([k, v]) => `<div class="sum-line"><span>${esc(catOf(k, store.categories).name)}</span><b class="num">${usd(v)}</b></div>`).join('') || '<span class="t-sub">Sin gastos comunes</span>'}</div></div>
        </div>
      </div>`;
    el.querySelectorAll('[data-go]').forEach((x) => x.onclick = () => navigate(x.dataset.go));
    $('#b-emit')?.addEventListener('click', async (e) => {
      const { requirePin } = await import('../auth.js');
      if (!(await requirePin(`Emitir los recibos de ${periodName(period)}`))) return;
      if (!(await confirmDialog({ title: `Emitir recibos de ${periodName(period)}`, message: `Se generarán <b>${rs.length} recibos</b> por un total de <b>${usd(s.totalBilled)}</b> con vencimiento el ${fmtDate($('#b-due').value)}.`, confirmText: 'Emitir' }))) return;
      const btn = e.currentTarget; setBusy(btn, true, 'Emitiendo…');
      try { const r = await emitBilling(b, period, { dueDate: $('#b-due').value }); toast(`${r.count} recibos emitidos 🎉`); loadedKey = ''; afterEmit(); }
      catch (ex) { toast(ex.message, 'danger', 6000); setBusy(btn, false); }
    });
  }
  function afterEmit() {
    const m = openModal({
      size: 'sm', body: `<div class="center stack" style="padding:16px 0;align-items:center"><div class="kpi-icon tone-success" style="width:64px;height:64px;border-radius:20px">${icon('check')}</div><h3 style="margin:0">¡Recibos emitidos!</h3><p class="muted" style="margin:0">Ya están en el portal de cada propietario. ¿Qué hacemos ahora?</p></div>`,
      footer: `<button class="btn btn-ghost" data-close>Cerrar</button><button class="btn btn-secondary" data-pr>${icon('print')} Imprimir</button><button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Enviar por WhatsApp</button>`
    });
    m.el.querySelector('[data-pr]').onclick = async () => { m.close(); await ensureReceipts(); printReceipts(receipts, store.closing(bldId(), period)); };
    m.el.querySelector('[data-wa]').onclick = async () => { m.close(); sendAll(); };
  }

  async function ensureReceipts() {
    const key = `${bldId()}_${period}`;
    if (loadedKey === key && receipts) return receipts;
    receipts = await store.periodReceipts(bldId(), period).catch(() => []);
    loadedKey = key;
    return receipts;
  }

  async function emitted(cl) {
    $('#b-body').innerHTML = `<div class="card"><div class="empty"><div class="spinner"></div></div></div>`;
    await ensureReceipts();
    if (store.closing(bldId(), period)?.id !== cl.id) return;
    const rows = receipts.map((r) => { const u = store.unit(r.unitId); const st = u ? ledgerStatus(u).find((x) => x.id === r.id) : null; return { r, u, st: st || { status: 'pagado', rest: 0 } }; });
    const paidN = rows.filter((x) => x.st.status === 'pagado').length;
    const collected = rows.reduce((a, x) => a + (x.r.total - x.st.rest), 0);
    const pct = cl.totalBilled ? Math.round(collected / cl.totalBilled * 100) : 0;
    $('#b-body').innerHTML = `
      <div class="grid-main">
        <div class="card card-flush">
          <div class="toolbar between"><b>${rows.length} recibos · ${esc(cl.firstNumber || '')} al ${esc(cl.lastNumber || '')}</b>
            <div class="row" style="gap:6px"><button class="btn btn-secondary btn-sm" id="b-print">${icon('print')} Imprimir todos</button><button class="btn btn-whatsapp btn-sm" id="b-send">${icon('whatsapp')} Enviar</button></div></div>
          <div class="table-wrap" style="max-height:62vh"><table class="table rt"><thead><tr><th>Unidad</th><th class="hide-sm">Recibo</th><th class="r">Monto</th><th>Estado</th><th></th></tr></thead><tbody>
            ${rows.map(({ r, u, st }) => `<tr class="click" data-u="${r.unitId}"><td><div class="row" style="gap:8px;flex-wrap:nowrap">${u ? unitAvatar(u) : ''}<div style="min-width:0"><b>${esc(r.unitCode)}</b><div class="t-sub ellipsis" style="max-width:180px">${esc(r.ownerName || '')}</div></div></div></td><td class="hide-sm mono small">${esc(r.number)}</td><td class="r num">${usd(r.total)}</td>
              <td>${st.status === 'pagado' ? '<span class="badge badge-success">Pagado</span>' : st.status === 'parcial' ? `<span class="badge badge-warning">Resta ${usd(st.rest)}</span>` : '<span class="badge badge-danger">Pendiente</span>'}</td>
              <td class="r" style="white-space:nowrap"><button class="btn btn-ghost btn-icon btn-sm hide-sm" data-pr="${r.id}" title="Imprimir">${icon('print')}</button>${u?.ownerPhone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${r.id}" title="Enviar">${icon('whatsapp')}</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <div class="stack">
          <div class="card"><div class="between"><div class="card-title">${icon('check')} Emitido</div><span class="badge badge-success">${fmtDate(cl.emittedAt)}</span></div>
            <div class="mt">${sumRows(cl)}</div>
            <div class="sum-line mt"><span>Vence</span><b>${fmtDate(cl.dueDate)}</b></div>
            <div class="section-title mt">Cobranza de este mes</div>
            <div class="between"><b class="num">${usd(collected)}</b><span class="t-sub">${paidN} de ${rows.length} pagados · ${pct}%</span></div>
            <div class="progress mt-sm"><span style="width:${pct}%"></span></div>
            <button class="btn btn-ghost btn-sm btn-block mt-lg text-danger" id="b-annul">${icon('x')} Anular la emisión</button>
          </div>
        </div>
      </div>`;
    el.querySelectorAll('[data-u]').forEach((tr) => tr.onclick = (e) => { if (e.target.closest('button')) return; openUnit(tr.dataset.u, { tab: 'recibos' }); });
    el.querySelectorAll('[data-pr]').forEach((x) => x.onclick = () => printReceipts([receipts.find((r) => r.id === x.dataset.pr)], cl));
    el.querySelectorAll('[data-wa]').forEach((x) => x.onclick = () => { const r = receipts.find((y) => y.id === x.dataset.wa); waUnit('recibo', { unit: store.unit(r.unitId), receipt: r }); });
    $('#b-print').onclick = () => printReceipts(receipts, cl);
    $('#b-send').onclick = sendAll;
    $('#b-annul').onclick = async () => {
      const { requirePin } = await import('../auth.js');
      if (!(await requirePin('Anular la emisión de recibos', { always: true }))) return;
      if (!(await confirmDialog({ title: 'Anular emisión', message: `Se borrarán los ${rows.length} recibos de ${periodName(period)} y se descontarán de la deuda de cada unidad. Los pagos ya registrados se conservan como saldo a favor.`, confirmText: 'Anular emisión', danger: true }))) return;
      try { await annulBilling(cl); loadedKey = ''; toast('Emisión anulada. Puedes corregir los gastos y volver a emitir.'); }
      catch (ex) { toast(ex.message, 'danger', 6000); }
    };
  }

  async function sendAll() {
    await ensureReceipts();
    const list = receipts.filter((r) => store.unit(r.unitId)?.ownerPhone);
    const m = openModal({
      title: `Enviar recibos de ${esc(periodName(period))}`, size: 'md', sub: 'Toca cada propietario: WhatsApp se abre con su recibo, su deuda, los datos de pago y el enlace a su portal.',
      body: list.length ? `<div class="list" style="max-height:55vh;overflow:auto">${list.map((r) => `<div class="list-item">${unitAvatar(store.unit(r.unitId))}<div class="grow"><b>${esc(r.unitCode)}</b><div class="t-sub">${esc(r.ownerName || '')} · ${usd(r.total)}</div></div><button class="btn btn-whatsapp btn-sm" data-s="${r.id}">${icon('whatsapp')} Enviar</button></div>`).join('')}</div>` : emptyState('phone', 'Ninguna unidad tiene teléfono', 'Carga el WhatsApp de los propietarios en Unidades.')
    });
    m.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { const r = receipts.find((x) => x.id === b.dataset.s); waUnit('recibo', { unit: store.unit(r.unitId), receipt: r }); b.classList.replace('btn-whatsapp', 'btn-secondary'); b.innerHTML = `${icon('check')} Enviado`; });
  }

  function hist() {
    const list = store.closings.filter((c) => c.status !== 'anulado' && store.inScope(c)).slice(0, 12);
    $('#b-hist').innerHTML = list.length ? `<div class="table-wrap"><table class="table rt"><thead><tr><th>Mes</th>${store.liveBuildings.length > 1 ? '<th class="hide-sm">Edificio</th>' : ''}<th class="r">Facturado</th><th class="r hide-sm">Gastos comunes</th><th class="r hide-sm">Reserva</th><th class="r">Recibos</th></tr></thead><tbody>
      ${list.map((c) => `<tr class="click" data-h="${c.period}" data-hb="${c.buildingId}"><td><b>${esc(periodName(c.period))}</b></td>${store.liveBuildings.length > 1 ? `<td class="hide-sm">${esc(store.bldName(c.buildingId))}</td>` : ''}<td class="r num">${usd(c.totalBilled)}</td><td class="r hide-sm num">${usd(c.common)}</td><td class="r hide-sm num">${usd(c.reserve)}</td><td class="r">${c.receipts}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('history', 'Aún no se ha emitido ningún mes');
    el.querySelectorAll('[data-h]').forEach((tr) => tr.onclick = () => { if (store.building !== tr.dataset.hb && store.liveBuildings.length > 1) store.setBuilding(tr.dataset.hb); period = tr.dataset.h; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  el.querySelectorAll('[data-pm]').forEach((b) => b.onclick = () => { period = addMonths(period, Number(b.dataset.pm)); draw(); });
  draw();
  let tRefresh = null;
  const refresh = () => { clearTimeout(tRefresh); tRefresh = setTimeout(() => { if (el.isConnected) draw(); }, 250); };
  const off = store.on('*', (e) => { if (['closings', 'expenses', 'charges', 'units', 'building', 'buildings', 'settings', 'rate'].includes(e)) { if (e === 'closings') loadedKey = ''; refresh(); } });
  return () => { off(); clearTimeout(tRefresh); };
}
