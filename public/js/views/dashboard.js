// SanoCondominio — Inicio: el mes del condominio de un vistazo
import { store } from '../store.js';
import { esc, usd, bs, fmtLongDate, todayKey, emptyState, fmtDate, num } from '../utils.js';
import { icon } from '../icons.js';
import { unitAvatar, openUnit, paymentModal, debtBadge } from '../unit.js';
import { waUnit } from '../shared.js';
import { currentPeriod, periodName, unitBalance, monthsOwed, lastPeriods, NOTICE_KINDS } from '../condo.js';
import { voteResults } from '../ops.js';

export function mount(el, { navigate }) {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const scopeName = store.bld(store.building)?.name || (store.liveBuildings.length > 1 ? 'Todos los edificios' : store.liveBuildings[0]?.name || store.businessName);
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">${hello} ${h < 12 ? '☀️' : h < 19 ? '🏢' : '🌙'}</h1><p class="view-sub">${fmtLongDate()} · ${esc(scopeName)}</p></div>
      <div class="view-actions" data-tour="quick">
        <button class="btn btn-primary" data-q="pay">${icon('wallet')} Registrar pago <kbd class="hide-sm">F1</kbd></button>
        <button class="btn btn-secondary" data-q="exp">${icon('receipt')} Cargar gasto</button>
        <button class="btn btn-secondary" data-q="bill">${icon('file')} Emitir recibos</button>
        <button class="btn btn-ghost" data-q="notice">${icon('megaphone')} Comunicado</button>
      </div></div>
    <div id="d-alerts"></div>
    <div class="card month-card" data-tour="month" id="d-month"></div>
    <div class="kpis mt-lg" data-tour="kpis" id="d-kpis"></div>
    <div class="grid-2 mt-lg">
      <div class="card" data-tour="debtors"><div class="card-head"><div class="card-title">${icon('alert')} Morosos y por cobrar</div><button class="btn btn-ghost btn-sm" data-go="cobranza">Cobranza</button></div><div id="d-debt"></div></div>
      <div class="card"><div class="card-head"><div class="card-title">${icon('chart')} Facturado vs. cobrado</div><button class="btn btn-ghost btn-sm" data-go="reportes">Reportes</button></div><div id="d-chart"></div></div>
    </div>
    <div class="grid-2 mt-lg">
      <div class="card"><div class="card-head"><div class="card-title">${icon('wallet')} Últimos pagos</div><button class="btn btn-ghost btn-sm" data-go="cobranza">Ver todos</button></div><div id="d-pays"></div></div>
      <div class="card" data-tour="community"><div class="card-head"><div class="card-title">${icon('users')} Comunidad</div><button class="btn btn-ghost btn-sm" data-go="comunicados">Comunicados</button></div><div id="d-comm"></div></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => navigate(b.dataset.go));
  $('[data-q="pay"]').onclick = () => paymentModal();
  $('[data-q="exp"]').onclick = () => navigate('gastos', { new: true });
  $('[data-q="bill"]').onclick = () => navigate('recibos');
  $('[data-q="notice"]').onclick = () => navigate('comunicados', { new: true });

  function alerts() {
    const rep = store.reportedPayments; const req = store.newRequests; const bk = store.bookingRequests;
    $('#d-alerts').innerHTML = (rep.length ? `<div class="banner req-banner"><span>${icon('bell')} <b>${rep.length} pago(s) reportado(s)</b> desde el portal esperan tu confirmación: ${rep.slice(0, 3).map((x) => `${esc(x.unitCode)} (${usd(x.amount)})`).join(', ')}</span><button class="btn btn-sm btn-primary" id="d-rep">Revisar</button></div>` : '')
      + (req.length || bk.length ? `<div class="banner lic-banner"><span>${icon('inbox')} ${req.length ? `<b>${req.length} solicitud(es)</b> nueva(s)` : ''}${req.length && bk.length ? ' · ' : ''}${bk.length ? `<b>${bk.length} reserva(s)</b> por aprobar` : ''}</span><button class="btn btn-sm btn-secondary" id="d-req">Ver</button></div>` : '')
      + (!store.liveBuildings.length ? `<div class="banner req-banner"><span>${icon('building')} Empieza creando tu edificio y sus unidades.</span><button class="btn btn-sm btn-primary" id="d-new-b">Crear edificio</button></div>` : '');
    $('#d-rep')?.addEventListener('click', () => navigate('cobranza', { tab: 'reportados' }));
    $('#d-req')?.addEventListener('click', () => navigate(req.length ? 'solicitudes' : 'reservas'));
    $('#d-new-b')?.addEventListener('click', async () => { const { buildingWizard } = await import('./settings.js'); if (await buildingWizard({ first: true })) navigate('unidades'); });
  }

  function month() {
    const p = currentPeriod();
    const blds = store.building ? [store.bld(store.building)].filter(Boolean) : store.liveBuildings;
    if (!blds.length) { $('#d-month').innerHTML = emptyState('building', 'Sin edificios', 'Crea tu primer edificio en Configuración.'); return; }
    const row = (b) => {
      const exp = store.expensesOf(b.id, p);
      const expT = exp.filter((e) => !e.fromFund).reduce((a, e) => a + (Number(e.amount) || 0), 0);
      const cl = store.closing(b.id, p);
      const coll = store.collectedIn(p, b.id);
      const billed = cl?.totalBilled || 0;
      const pct = billed ? Math.min(100, Math.round(coll / billed * 100)) : 0;
      const step = !exp.length ? 1 : !cl ? 2 : 3;
      const st = (n, title, sub, done) => `<div class="mstep ${done ? 'done' : step === n ? 'now' : ''}"><span class="mstep-n">${done ? icon('check') : n}</span><div><b>${title}</b><small>${sub}</small></div></div>`;
      return `<div class="month-row">
        ${blds.length > 1 ? `<div class="month-bld">${icon('building')} ${esc(b.name)}</div>` : ''}
        <div class="msteps">
          ${st(1, 'Cargar gastos', exp.length ? `${exp.length} gasto(s) · ${usd(expT)}` : 'Aún sin gastos este mes', exp.length > 0)}
          ${st(2, 'Emitir recibos', cl ? `${cl.receipts} recibos · ${usd(cl.totalBilled)}` : exp.length ? 'Listo para emitir' : 'Después de los gastos', !!cl)}
          ${st(3, 'Cobrar', cl ? `${usd(coll)} de ${usd(billed)} · ${pct}%` : `Cobrado este mes: ${usd(coll)}`, cl && pct >= 100)}
        </div>
        ${cl ? `<div class="progress mt-sm"><span style="width:${pct}%"></span></div>` : ''}
        <div class="month-cta"><button class="btn btn-sm ${step === 3 ? 'btn-secondary' : 'btn-primary'}" data-step="${step}" data-b="${b.id}">${step === 1 ? `${icon('plus')} Cargar gastos` : step === 2 ? `${icon('file')} Revisar y emitir` : `${icon('wallet')} Ir a cobranza`}</button></div>
      </div>`;
    };
    $('#d-month').innerHTML = `<div class="card-head"><div class="card-title">${icon('calendar')} Tu mes: ${esc(periodName(p))}</div><span class="t-sub hide-sm">Gastos → recibos → cobranza</span></div>${blds.map(row).join('')}`;
    el.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
      if (b.dataset.b && store.liveBuildings.length > 1 && store.building !== b.dataset.b) store.setBuilding(b.dataset.b);
      navigate(b.dataset.step === '1' ? 'gastos' : b.dataset.step === '2' ? 'recibos' : 'cobranza');
    });
  }

  function kpis() {
    const p = currentPeriod();
    const units = store.scopeUnits;
    const debt = store.totalDebt;
    const del = store.delinquent;
    const coll = store.collectedIn(p);
    const reserve = (store.building ? [store.building] : store.liveBuildings.map((b) => b.id)).reduce((a, id) => a + store.fundBalance(id, 'reserva'), 0);
    $('#d-kpis').innerHTML = `
      <div class="card kpi kpi-link" data-go2="cobranza"><div class="kpi-top"><span class="kpi-label">Por cobrar</span><span class="kpi-icon tone-danger">${icon('wallet')}</span></div><div class="kpi-value">${usd(debt)}</div><div class="kpi-sub">${store.debtors.length} unidad(es) con deuda${bs(debt) ? ` · ${bs(debt)}` : ''}</div></div>
      <div class="card kpi kpi-link" data-go2="cobranza" data-p="morosos"><div class="kpi-top"><span class="kpi-label">Morosos (2+ meses)</span><span class="kpi-icon tone-warning">${icon('alert')}</span></div><div class="kpi-value">${del.length}</div><div class="kpi-sub">${del.length ? `${usd(del.reduce((a, u) => a + unitBalance(u), 0))} en mora` : 'nadie en mora'}</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Cobrado en ${esc(periodName(p).split(' ')[0].toLowerCase())}</span><span class="kpi-icon tone-success">${icon('trend')}</span></div><div class="kpi-value">${usd(coll)}</div><div class="kpi-sub">${store.confirmedPayments.filter((x) => (x.date || '').startsWith(p) && store.inScope(x)).length} pago(s)</div></div>
      <div class="card kpi kpi-link" data-go2="unidades"><div class="kpi-top"><span class="kpi-label">Solventes</span><span class="kpi-icon tone-brand">${icon('shieldCheck')}</span></div><div class="kpi-value">${store.solventPct}%</div><div class="kpi-sub">${units.length} unidad(es)</div></div>
      <div class="card kpi kpi-link" data-go2="fondos"><div class="kpi-top"><span class="kpi-label">Fondo de reserva</span><span class="kpi-icon tone-violet">${icon('piggy')}</span></div><div class="kpi-value">${usd(reserve)}</div><div class="kpi-sub">${bs(reserve) || 'disponible'}</div></div>
      <div class="card kpi kpi-link" data-go2="solicitudes"><div class="kpi-top"><span class="kpi-label">Solicitudes abiertas</span><span class="kpi-icon tone-info">${icon('inbox')}</span></div><div class="kpi-value">${store.openRequests.length}</div><div class="kpi-sub">${store.newRequests.length ? `<span class="text-warning">${store.newRequests.length} sin atender</span>` : 'todo atendido'}</div></div>`;
    el.querySelectorAll('[data-go2]').forEach((b) => b.onclick = () => navigate(b.dataset.go2, b.dataset.p ? { tab: b.dataset.p } : {}));
  }

  function debt() {
    const list = store.debtors.slice(0, 7);
    $('#d-debt').innerHTML = list.length ? `<div class="list">${list.map((u) => `<div class="list-item">${unitAvatar(u)}<div class="grow" style="min-width:0"><button class="linkish ellipsis" data-u="${u.id}"><b>${esc(u.code)}</b> · ${esc(u.ownerName || 'Sin propietario')}</button><div class="t-sub">${debtBadge(u)} ${monthsOwed(u) ? `· ${monthsOwed(u)} recibo(s)` : ''}</div></div><b class="num">${usd(unitBalance(u))}</b>${u.ownerPhone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${u.id}" title="Recordar por WhatsApp">${icon('whatsapp')}</button>` : ''}</div>`).join('')}</div>`
      : emptyState('checkCircle', '¡Todos al día!', 'Ninguna unidad tiene deuda pendiente.');
    el.querySelectorAll('#d-debt [data-u]').forEach((b) => b.onclick = () => openUnit(b.dataset.u));
    el.querySelectorAll('#d-debt [data-wa]').forEach((b) => b.onclick = () => { const u = store.unit(b.dataset.wa); waUnit(monthsOwed(u) >= 2 ? 'moroso' : 'recordatorio', { unit: u }); });
  }

  function chart() {
    const ps = lastPeriods(6).reverse();
    const data = ps.map((p) => ({
      p, billed: store.closings.filter((c) => c.period === p && c.status !== 'anulado' && store.inScope(c)).reduce((a, c) => a + (Number(c.totalBilled) || 0), 0),
      coll: store.collectedIn(p)
    }));
    const max = Math.max(1, ...data.map((d) => Math.max(d.billed, d.coll)));
    $('#d-chart').innerHTML = data.some((d) => d.billed || d.coll) ? `<div class="bars2">${data.map((d) => `<div class="bar2"><div class="bar2-cols"><i class="b" style="height:${d.billed / max * 100}%" title="Facturado ${usd(d.billed)}"></i><i class="c" style="height:${d.coll / max * 100}%" title="Cobrado ${usd(d.coll)}"></i></div><span>${esc(periodName(d.p, true))}</span><small>${d.billed ? Math.round(d.coll / d.billed * 100) + '%' : ''}</small></div>`).join('')}</div>
      <div class="ag-legend mt"><span><i class="lg-b"></i> Facturado</span><span><i class="lg-c"></i> Cobrado</span></div>`
      : emptyState('chart', 'Aún sin datos', 'Aquí verás cuánto se factura y cuánto se cobra cada mes.');
  }

  function pays() {
    const list = store.confirmedPayments.filter((p) => store.inScope(p)).slice(0, 6);
    $('#d-pays').innerHTML = list.length ? `<div class="list">${list.map((p) => `<div class="list-item"><span class="kpi-icon tone-success" style="width:34px;height:34px">${icon('check')}</span><div class="grow" style="min-width:0"><button class="linkish" data-u="${p.unitId}"><b>${esc(p.unitCode)}</b> · ${esc(p.ownerName || '')}</button><div class="t-sub">${fmtDate(p.date)} · ${esc(p.reference ? 'ref. ' + p.reference : p.number)}</div></div><b class="num">${usd(p.amount)}</b></div>`).join('')}</div>`
      : emptyState('wallet', 'Sin pagos aún', 'Registra un pago con F1 o confírmalo desde lo que reportan los propietarios.');
    el.querySelectorAll('#d-pays [data-u]').forEach((b) => b.onclick = () => openUnit(b.dataset.u));
  }

  function comm() {
    const notices = store.notices.filter((n) => store.inScope(n)).slice(0, 3);
    const votes = store.openVotes.slice(0, 2);
    const bks = store.upcomingBookings.slice(0, 3);
    $('#d-comm').innerHTML = `
      ${votes.map((v) => { const r = voteResults(v); return `<div class="box mb"><div class="between"><b>${icon('vote')} ${esc(v.title)}</b><span class="badge badge-violet">Abierta</span></div><div class="t-sub mt-xs">${r.cast} de ${r.units} unidades votaron · participación ${num(r.quorum, 1)}%</div><div class="progress mt-sm"><span style="width:${Math.min(100, r.quorum)}%"></span></div></div>`; }).join('')}
      ${bks.length ? `<div class="section-title">${icon('calendar')} Próximas reservas</div><div class="list">${bks.map((b) => `<div class="list-item"><span class="kpi-icon tone-info" style="width:34px;height:34px">${icon('calendar')}</span><div class="grow"><b>${esc(b.areaName)}</b><div class="t-sub">${fmtDate(b.date)}${b.from ? ` · ${esc(b.from)}-${esc(b.to)}` : ''} · ${esc(b.unitCode)}</div></div></div>`).join('')}</div>` : ''}
      ${notices.length ? `<div class="section-title mt">${icon('megaphone')} Comunicados</div><div class="list">${notices.map((n) => `<div class="list-item"><span class="kpi-icon tone-${NOTICE_KINDS[n.kind]?.tone || 'info'}" style="width:34px;height:34px">${icon(NOTICE_KINDS[n.kind]?.icon || 'bell')}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(n.title)}</b><div class="t-sub">${fmtDate(n.date)}</div></div></div>`).join('')}</div>` : ''}
      ${!votes.length && !bks.length && !notices.length ? emptyState('megaphone', 'Sin novedades', 'Publica comunicados, abre votaciones y gestiona reservas de áreas comunes.') : ''}`;
  }

  const all = () => { alerts(); month(); kpis(); debt(); chart(); pays(); comm(); };
  all();
  const off = store.on('*', (evt) => {
    if (['units', 'payments', 'closings', 'expenses', 'funds', 'building', 'buildings', 'settings', 'rate'].includes(evt)) { month(); kpis(); debt(); chart(); pays(); }
    if (evt === 'inbox') { alerts(); kpis(); }
    if (['notices', 'votes', 'bookings'].includes(evt)) comm();
  });
  return () => off();
}
