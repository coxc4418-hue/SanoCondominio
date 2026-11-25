// SanoCondominio — Componentes compartidos: país y moneda, QR, WhatsApp e impresión de recibos y constancias
import { store } from './store.js';
import { openModal, toast, num, esc, fmtDateTime, fmtDate, setBusy, usd, bs, fx, methodLabel, printHTML, todayKey, waLink, COUNTRIES, loc, flagImg, fmtLongDate } from './utils.js';
import { icon } from './icons.js';
import { periodName, unitBalance, ledgerStatus, openCharges, monthsOwed, catOf, UNIT_TYPES, isSolvent } from './condo.js';

export const APP_NAME = 'SanoCondominio';
export const SALES_PHONE = '584221906045';
export const SALES_PHONE_FMT = '+58 422-190 6045';
export const salesWa = (msg = 'Hola, me interesa SanoCondominio para administrar mi condominio. ¿Me pueden dar más información?') =>
  `https://wa.me/${SALES_PHONE}?text=${encodeURIComponent(msg)}`;

// ======================================================================
// PAÍS DE TRABAJO (se elige una sola vez, al entrar por primera vez)
// ======================================================================
export function openCountryPicker({ force = false } = {}) {
  return new Promise((resolve) => {
    let picked = store.settings.country || '';
    let cur = store.settings.currency || '';
    const list = Object.entries(COUNTRIES).sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'));
    const m = openModal({
      title: force ? '¿En qué país está tu condominio?' : 'País y moneda', size: 'md', dismissible: true,
      sub: 'Según el país, SanoCondominio trabaja con su moneda, sus formas de pago y el código telefónico para WhatsApp.',
      body: `<div class="stack"><label class="search"><svg></svg><input data-q placeholder="Buscar país…" autocomplete="off"></label><div class="country-grid" data-l></div><div data-cur></div><div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary btn-lg" data-ok disabled>Continuar</button>`,
      onClose: () => resolve(picked && store.settings.country === picked ? picked : null)
    });
    m.el.querySelector('.search svg').outerHTML = icon('search');
    const draw = (qv = '') => {
      const t = qv.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      m.el.querySelector('[data-l]').innerHTML = list.filter(([, c]) => !t || c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t)).map(([k, c]) =>
        `<button type="button" class="country ${picked === k ? 'on' : ''}" data-c="${k}"><span class="flag">${flagImg(k, 24)}</span><span class="grow"><b>${esc(c.name)}</b><small>${esc(c.curName)} · ${esc(c.sym)}</small></span></button>`).join('');
      m.el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { picked = b.dataset.c; cur = COUNTRIES[picked].cur; draw(m.el.querySelector('[data-q]').value); });
      const c = COUNTRIES[picked];
      m.el.querySelector('[data-cur]').innerHTML = c ? `<div class="card stack" style="padding:12px 14px"><div class="row" style="gap:10px"><span class="flag">${flagImg(picked, 30)}</span><div class="grow"><b>${esc(c.name)}</b><div class="t-sub">Formas de pago: efectivo, transferencia${(c.extra || []).length ? ' y otras locales' : ''} · WhatsApp +${esc(c.dial)}</div></div></div>
        ${c.alt ? `<div class="field"><label>Moneda en la que emites los recibos</label><div class="seg seg-block">${[[c.cur, c.curName + ' (' + c.sym + ')'], [c.alt.cur, c.alt.curName + ' (' + c.alt.sym + ')']].map(([k, l]) => `<button type="button" data-mc="${k}" class="${cur === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>${picked === 'VE' ? '<span class="hint">Recomendado: dólares. Cada recibo y cada pago muestra su equivalente en bolívares a la tasa BCV del día.</span>' : ''}</div>` : `<div class="small">Moneda: <b>${esc(c.curName)} (${esc(c.sym)})</b></div>`}
        ${store.settings.country && store.settings.country !== picked ? `<div class="vital-alert warning">Los montos ya registrados no se convierten.</div>` : ''}</div>` : '';
      m.el.querySelectorAll('[data-mc]').forEach((b) => b.onclick = () => { cur = b.dataset.mc; draw(m.el.querySelector('[data-q]').value); });
      m.el.querySelector('[data-ok]').disabled = !picked;
    };
    m.el.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      if (!picked) return;
      setBusy(e.currentTarget, true, 'Guardando…');
      try { await store.setCountry(picked, cur); await (await import('./bcv.js')).onCountryChanged().catch(() => {}); toast(`Listo: trabajarás en ${loc().curName} (${loc().sym})`); m.close(); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
    draw();
  });
}

// ======================================================================
// QR
// ======================================================================
let qrLoad = null;
function loadQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrLoad ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/js/vendor/qrcode.js';
    s.onload = () => res(window.qrcode); s.onerror = rej;
    document.head.appendChild(s);
  });
  return qrLoad;
}
export async function qrDataURL(text, cell = 4) {
  try { const q = await loadQR(); const qr = q(0, 'M'); qr.addData(text); qr.make(); return qr.createDataURL(cell, 2); } catch (_) { return ''; }
}

// ======================================================================
// WHATSAPP AL PROPIETARIO
// ======================================================================
const BASE = 'https://sano-condominio.web.app';
export const PORTAL_URL = (u) => (u?.portalCode ? `${BASE}/portal/${u.portalCode}` : '');
const amt = (v) => `${usd(v)}${bs(v) ? ` (${bs(v)})` : ''}`;
export function banksText() {
  const list = (store.settings.banks || []).filter((b) => b.active !== false);
  if (!list.length) return '';
  return '\n\n🏦 *Datos para pagar*\n' + list.map((b) => b.type === 'pagomovil'
    ? `• Pago móvil: ${b.bank || ''} · ${b.phone || ''} · ${b.idDoc || ''}`
    : b.type === 'zelle' ? `• Zelle: ${b.email || b.number || ''} (${b.holder || ''})`
      : b.type === 'efectivo' ? `• Efectivo en la oficina de administración`
        : `• ${b.bank || 'Transferencia'}: ${b.number || ''} · ${b.holder || ''} · ${b.idDoc || ''}`).join('\n');
}
export function unitMessage(kind, { unit = {}, extra = '', receipt = null, payment = null, notice = null, vote = null, booking = null } = {}) {
  const name = String(unit.ownerName || '').split(' ')[0];
  const biz = store.businessName;
  const bld = store.bldName(unit.buildingId);
  const portal = PORTAL_URL(unit);
  const h = `Hola ${name || 'vecino/a'} 👋, te escribimos de *${biz}*${bld && bld !== '—' ? ` (${bld})` : ''}.`;
  const bal = unitBalance(unit);
  const open = openCharges(unit);
  const det = open.slice(0, 6).map((x) => `• ${x.k === 'extra' ? x.n : periodName(x.p)}: ${usd(x.rest)}`).join('\n');
  const T = {
    recibo: () => `${h}

🧾 Ya está disponible el recibo de condominio de *${periodName(receipt?.period)}* de la unidad *${unit.code}*.
Monto del mes: *${amt(receipt?.total || 0)}*${bal > (receipt?.total || 0) + 0.009 ? `
Deuda total con meses anteriores: *${amt(bal)}*` : ''}${receipt?.dueDate ? `
📅 Vence: ${fmtDate(receipt.dueDate)}` : ''}${banksText()}${portal ? `

📲 Ve el detalle, la relación de gastos y reporta tu pago aquí: ${portal}` : ''}`,
    recordatorio: () => `${h}

🔔 Te recordamos que la unidad *${unit.code}* tiene un saldo pendiente de *${amt(bal)}*:
${det}${banksText()}${portal ? `

📲 Reporta tu pago aquí: ${portal}` : ''}

¡Gracias por mantener el condominio al día! 🏢`,
    moroso: () => `${h}

⚠️ La unidad *${unit.code}* acumula *${monthsOwed(unit)} meses* sin pagar, por un total de *${amt(bal)}*:
${det}

Te pedimos ponerte al día lo antes posible o comunicarte con la administración para acordar un plan de pago.${banksText()}${portal ? `

📲 ${portal}` : ''}`,
    pago: () => `${h}

✅ Recibimos y confirmamos tu pago${payment?.number ? ` *${payment.number}*` : ''} por *${amt(payment?.amount || 0)}* para la unidad *${unit.code}*.
${bal <= 0.009 ? `🎉 Tu unidad está *solvente*${bal < -0.009 ? ` y tiene ${usd(-bal)} a favor` : ''}.` : `Saldo pendiente: *${amt(bal)}*.`}${portal ? `

📲 ${portal}` : ''}`,
    rechazo: () => `${h}

No pudimos verificar el pago que reportaste para la unidad *${unit.code}*${extra ? `: ${extra}` : '.'} Por favor envíanos el comprobante o comunícate con la administración.`,
    solvencia: () => `${h}

📄 Te enviamos la constancia de solvencia de la unidad *${unit.code}* al ${fmtLongDate()}. ¡Gracias por estar al día!`,
    portal: () => `${h}

📲 Este es el portal de tu unidad *${unit.code}*: ${portal}

Ahí ves tus recibos y la relación de gastos, reportas tus pagos, envías solicitudes, reservas áreas comunes y votas en las asambleas. Guárdalo en tu pantalla de inicio.`,
    comunicado: () => `📢 *${notice?.title || 'Comunicado'}*
${biz}${bld && bld !== '—' ? ` · ${bld}` : ''}

${notice?.body || extra}${portal ? `

📲 ${portal}` : ''}`,
    votacion: () => `${h}

🗳️ Está abierta la votación: *${vote?.title || ''}*${vote?.until ? ` (hasta el ${fmtDate(vote.until)})` : ''}.
Opciones: ${(vote?.options || []).join(' / ')}${portal ? `

Vota desde tu portal: ${portal}` : ''}`,
    reserva: () => `${h}

📅 Tu reserva de *${booking?.areaName || ''}* para el ${fmtDate(booking?.date)}${booking?.from ? ` de ${booking.from} a ${booking.to}` : ''} quedó *${booking?.status === 'cancelada' ? 'cancelada' : 'confirmada'}*.${booking?.fee > 0 && booking?.status !== 'cancelada' ? `
Costo: ${amt(booking.fee)} (se carga a tu unidad).` : ''}`,
    solicitud: () => `${h}

Sobre tu solicitud${extra ? `: ${extra}` : '.'}`,
    libre: () => `${h}

${extra || ''}`
  };
  return (T[kind] || T.libre)();
}
export function waUnit(kind, ctx = {}, to = 'owner') {
  const u = ctx.unit || {};
  const phone = to === 'resident' ? u.residentPhone : (u.ownerPhone || u.residentPhone || '');
  const text = unitMessage(kind, ctx);
  window.open(phone ? waLink(phone, text) : 'https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

// ======================================================================
// IMPRESIÓN
// ======================================================================
export const PRINT_HEAD = '<meta charset="utf-8"><meta name="color-scheme" content="light"><style>:root{color-scheme:light}html,body{background:#fff;color:#000}</style>';
const ACCENT = '#0f766e';
const baseCSS = `@page { margin: 12mm; } body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 2px; } h2 { font-size: 13px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: ${ACCENT}; }
  .muted { color: #555; } table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background: ${ACCENT}; color: #fff; text-align: left; padding: 6px; font-size: 11px; }
  td { padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; } .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
  .tot td { font-weight: bold; border-top: 2px solid #111; border-bottom: 0; } .big { font-size: 16px; font-weight: bold; }
  .head { display: flex; justify-content: space-between; gap: 20px; border-bottom: 3px solid ${ACCENT}; padding-bottom: 10px; margin-bottom: 10px; }
  .box { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; } .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .kpis { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; } .kpi { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; min-width: 140px; } .kpi b { display: block; font-size: 15px; }
  .sign { margin-top: 60px; display: flex; gap: 40px; } .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; }
  .stamp { display: inline-block; border: 3px solid #15803d; color: #15803d; font-weight: bold; padding: 6px 14px; border-radius: 8px; font-size: 18px; transform: rotate(-4deg); }
  .pb { page-break-after: always; } .foot { margin-top: 18px; font-size: 10px; color: #666; }`;
function adminHead(u = null) {
  const s = store.settings;
  const bld = u ? store.bld(u.buildingId) : null;
  return `<div class="head"><div><h1>${esc(store.businessName)}</h1>
    ${s.rif ? `<div>${esc(loc().tax)}: ${esc(s.rif)}</div>` : ''}${s.address ? `<div class="muted">${esc(s.address)}</div>` : ''}${s.phone || s.whatsapp ? `<div class="muted">Tel: ${esc(s.phone || s.whatsapp)}${s.email ? ' · ' + esc(s.email) : ''}</div>` : ''}</div>
    ${bld ? `<div style="text-align:right"><b>${esc(bld.name)}</b>${bld.rif ? `<div>${esc(loc().tax)}: ${esc(bld.rif)}</div>` : ''}${bld.address ? `<div class="muted">${esc(bld.address)}</div>` : ''}</div>` : ''}</div>`;
}
const eqTxt = (v, rate) => (rate > 0 && fx() ? `${fx().sym} ${num(v * rate, 2)}` : '');

/** Recibo de condominio de una unidad, con la relación de gastos del edificio */
export function receiptHTML(r, closing = null, { withExpenses = true, expenses = null } = {}) {
  const u = store.unit(r.unitId) || { code: r.unitCode, ownerName: r.ownerName, buildingId: r.buildingId };
  const rate = Number(r.fxRate) || 0;
  const led = ledgerStatus(u).find((x) => x.id === r.id);
  const exp = expenses || (closing ? store.expensesOf(closing.buildingId, closing.period) : []);
  const commons = exp.filter((e) => (e.type || 'comun') === 'comun' && !e.fromFund);
  const prev = Number(r.prevDebt) || 0;
  return `<div class="rc">${adminHead(u)}
    <div class="grid"><div class="box"><div class="muted">Recibo de condominio</div><div class="big">N° ${esc(r.number)}</div><div>${r.kind === 'cargo' ? 'Cargo' : 'Mes'}: <b>${esc(r.kind === 'cargo' ? fmtDate(r.emittedAt) : periodName(r.period))}</b></div><div>Emitido: ${fmtDate(r.emittedAt)} · Vence: <b>${fmtDate(r.dueDate)}</b></div></div>
      <div class="box"><div class="muted">Unidad</div><div class="big">${esc(u.code)} <small style="font-weight:normal">${esc(UNIT_TYPES[u.type]?.label || '')}</small></div><div>Propietario: <b>${esc(u.ownerName || r.ownerName || '—')}</b></div><div>Alícuota: ${num(r.aliquot ?? u.aliquot ?? 0, 4)}%</div></div></div>
    <h2>Detalle del recibo</h2>
    <table><tr><th>Concepto</th><th class="r">Monto</th>${rate > 0 && fx() ? `<th class="r">${esc(fx().sym)}</th>` : ''}</tr>
      ${(r.items || []).map((i) => `<tr><td>${esc(i.concept)}</td><td class="r">${usd(i.amount)}</td>${rate > 0 && fx() ? `<td class="r">${eqTxt(i.amount, rate)}</td>` : ''}</tr>`).join('')}
      <tr class="tot"><td>TOTAL DEL ${r.kind === 'cargo' ? 'CARGO' : 'MES'}</td><td class="r">${usd(r.total)}</td>${rate > 0 && fx() ? `<td class="r">${eqTxt(r.total, rate)}</td>` : ''}</tr>
      ${prev > 0.009 ? `<tr><td>Deuda anterior al emitir</td><td class="r">${usd(prev)}</td>${rate > 0 && fx() ? '<td></td>' : ''}</tr><tr class="tot"><td>TOTAL A PAGAR</td><td class="r">${usd(prev + r.total)}</td>${rate > 0 && fx() ? `<td class="r">${eqTxt(prev + r.total, rate)}</td>` : ''}</tr>` : ''}
      ${Number(r.credit) > 0.009 ? `<tr><td>Saldo a favor aplicado</td><td class="r">-${usd(Math.min(r.credit, r.total))}</td>${rate > 0 && fx() ? '<td></td>' : ''}</tr>` : ''}
    </table>
    ${rate > 0 && fx() ? `<div class="muted" style="margin-top:4px">Tasa de referencia al emitir: 1 ${esc(loc().sym)} = ${num(rate, 2)} ${esc(fx().sym)}. El pago en ${esc(fx().sym)} se calcula a la tasa del día en que pagas.</div>` : ''}
    ${led ? `<div style="margin-top:6px">Estado actual: <b>${led.status === 'pagado' ? 'PAGADO' : led.status === 'parcial' ? `ABONADO · resta ${usd(led.rest)}` : 'PENDIENTE'}</b></div>` : ''}
    ${withExpenses && closing && commons.length ? `<h2>Relación de gastos del edificio · ${esc(periodName(closing.period))}</h2>
      <table><tr><th>Fecha</th><th>Concepto</th><th>Proveedor</th><th class="r">Monto</th></tr>
      ${commons.map((e) => `<tr><td>${fmtDate(e.date)}</td><td>${esc(catOf(e.category, store.categories).name)} · ${esc(e.concept)}</td><td>${esc(e.supplierName || '')}</td><td class="r">${usd(e.amount)}</td></tr>`).join('')}
      <tr class="tot"><td colspan="3">Gastos comunes</td><td class="r">${usd(closing.common)}</td></tr>
      ${closing.adminFee > 0 ? `<tr><td colspan="3">Honorarios de administración</td><td class="r">${usd(closing.adminFee)}</td></tr>` : ''}
      ${closing.reserve > 0 ? `<tr><td colspan="3">Fondo de reserva (${num(closing.reservePct, 0)}%)</td><td class="r">${usd(closing.reserve)}</td></tr>` : ''}
      <tr class="tot"><td colspan="3">Total a repartir por alícuota</td><td class="r">${usd(closing.toDistribute)}</td></tr></table>
      <div class="muted">Fondo de reserva disponible: <b>${usd(store.fundBalance(closing.buildingId, 'reserva'))}</b></div>` : ''}
    ${banksPrint()}
    ${PORTAL_URL(u) ? `<div class="foot">Reporta tu pago y consulta tus recibos en: <b>${esc(PORTAL_URL(u))}</b></div>` : ''}
    <div class="foot">${esc(store.settings.receiptNote || '')} · SanoCondominio</div></div>`;
}
function banksPrint() {
  const list = (store.settings.banks || []).filter((b) => b.active !== false);
  if (!list.length) return '';
  return `<h2>Formas de pago</h2><table>${list.map((b) => `<tr><td><b>${esc(b.type === 'pagomovil' ? 'Pago móvil' : b.type === 'zelle' ? 'Zelle' : b.type === 'efectivo' ? 'Efectivo' : 'Transferencia')}</b></td><td>${esc([b.bank, b.number, b.phone, b.email, b.holder, b.idDoc].filter(Boolean).join(' · '))}</td></tr>`).join('')}</table>`;
}
export function printReceipts(list, closing = null) {
  const exp = closing ? store.expensesOf(closing.buildingId, closing.period) : null;
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>Recibos ${esc(closing ? periodName(closing.period) : '')}</title><style>${baseCSS}</style></head><body>
    ${list.map((r, i) => `${receiptHTML(r, closing, { expenses: exp })}${i < list.length - 1 ? '<div class="pb"></div>' : ''}`).join('')}</body></html>`);
}

/** Estado de cuenta de una unidad */
export function statementHTML(u, receipts = [], payments = []) {
  const bal = unitBalance(u);
  const rows = [
    ...receipts.map((r) => ({ date: (r.emittedAt || '').slice(0, 10), text: `${r.kind === 'cargo' ? 'Cargo' : 'Recibo'} ${r.number} · ${r.kind === 'cargo' ? (r.items?.[0]?.concept || '') : periodName(r.period)}`, debit: r.total, credit: 0 })),
    ...payments.filter((p) => p.status === 'confirmado').map((p) => ({ date: p.date, text: `Pago ${p.number} · ${methodLabel(p.method)}${p.reference ? ' ref. ' + p.reference : ''}`, debit: 0, credit: p.amount }))
  ].sort((a, b) => a.date.localeCompare(b.date));
  const billedShown = rows.reduce((a, r) => a + r.debit, 0); const paidShown = rows.reduce((a, r) => a + r.credit, 0);
  let run = round(bal - (billedShown - paidShown));
  return `${adminHead(u)}<h1 style="font-size:16px">Estado de cuenta · Unidad ${esc(u.code)}</h1>
    <div class="muted">Propietario: <b>${esc(u.ownerName || '—')}</b>${u.ownerIdDoc ? ` · ${esc(loc().id)} ${esc(u.ownerIdDoc)}` : ''} · Alícuota ${num(u.aliquot || 0, 4)}% · Al ${fmtLongDate()}</div>
    <table><tr><th>Fecha</th><th>Movimiento</th><th class="r">Cargo</th><th class="r">Abono</th><th class="r">Saldo</th></tr>
    ${Math.abs(run) > 0.009 ? `<tr><td></td><td>Saldo anterior</td><td></td><td></td><td class="r">${usd(run)}</td></tr>` : ''}
    ${rows.map((r) => { run = round(run + r.debit - r.credit); return `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.text)}</td><td class="r">${r.debit ? usd(r.debit) : ''}</td><td class="r">${r.credit ? usd(r.credit) : ''}</td><td class="r">${usd(run)}</td></tr>`; }).join('')}
    <tr class="tot"><td colspan="4">${bal > 0.009 ? 'SALDO DEUDOR' : bal < -0.009 ? 'SALDO A FAVOR' : 'SOLVENTE'}</td><td class="r">${usd(Math.abs(bal))}</td></tr></table>
    ${bal > 0.009 ? `<h2>Recibos pendientes</h2><table><tr><th>Recibo</th><th>Mes</th><th>Vence</th><th class="r">Pendiente</th></tr>${openCharges(u).map((x) => `<tr><td>${esc(x.n)}</td><td>${esc(x.k === 'extra' ? 'Cargo' : periodName(x.p))}</td><td>${fmtDate(x.d)}</td><td class="r">${usd(x.rest)}</td></tr>`).join('')}</table>${banksPrint()}` : ''}
    <div class="foot">Documento generado por SanoCondominio · ${fmtDateTime(new Date().toISOString())}</div>`;
}
const round = (v) => Math.round((Number(v) || 0) * 100) / 100;
export function printStatement(u, receipts, payments) {
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>Estado de cuenta ${esc(u.code)}</title><style>${baseCSS}</style></head><body>${statementHTML(u, receipts, payments)}</body></html>`);
}

/** Constancia de solvencia (solo si la unidad no debe) */
export function printSolvency(u) {
  if (!isSolvent(u)) { toast('La unidad tiene deuda: no se puede emitir la solvencia.', 'warning'); return false; }
  const bld = store.bld(u.buildingId);
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>Solvencia ${esc(u.code)}</title><style>${baseCSS} .body{font-size:14px;line-height:1.7;margin-top:30px;text-align:justify}</style></head><body>
    ${adminHead(u)}
    <div style="text-align:center;margin-top:24px"><h1 style="font-size:22px">CONSTANCIA DE SOLVENCIA</h1><div class="muted">${esc(fmtLongDate())}</div></div>
    <div class="body">Quien suscribe, en representación de la administración de <b>${esc(bld?.name || store.businessName)}</b>${bld?.address ? `, ubicado en ${esc(bld.address)}` : ''}, hace constar que la unidad <b>${esc(u.code)}</b> (${esc(UNIT_TYPES[u.type]?.label || 'inmueble')})${u.ownerName ? `, propiedad de <b>${esc(u.ownerName)}</b>${u.ownerIdDoc ? `, ${esc(loc().id)} <b>${esc(u.ownerIdDoc)}</b>` : ''},` : ''} con una alícuota de ${num(u.aliquot || 0, 4)}%, se encuentra <b>SOLVENTE</b> con el pago de las cuotas de condominio hasta la fecha${u.lastPaymentAt ? `, siendo su último pago registrado el ${fmtDate(u.lastPaymentAt)}` : ''}.
    <br><br>Constancia que se expide a solicitud de la parte interesada, a los fines que estime convenientes.</div>
    <div style="text-align:center;margin-top:30px"><span class="stamp">SOLVENTE</span></div>
    <div class="sign"><div>${esc(store.settings.manager || 'Administración')}<br><small>${esc(store.businessName)}</small></div><div>Junta de condominio</div></div>
    <div class="foot">Válida por 30 días a partir de su emisión · Generada con SanoCondominio</div></body></html>`);
  return true;
}

/** Comprobante de pago */
export function printPayment(p) {
  const u = store.unit(p.unitId) || { code: p.unitCode, ownerName: p.ownerName, buildingId: p.buildingId };
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>${esc(p.number)}</title><style>${baseCSS}</style></head><body>
    ${adminHead(u)}
    <div class="grid"><div class="box"><div class="muted">Comprobante de pago</div><div class="big">N° ${esc(p.number)}</div><div>Fecha: ${fmtDate(p.date)}</div>${p.status === 'anulado' ? '<div><b>*** ANULADO ***</b></div>' : ''}</div>
      <div class="box"><div class="muted">Unidad</div><div class="big">${esc(u.code)}</div><div>${esc(u.ownerName || '')}</div></div></div>
    <table><tr><th>Forma de pago</th><th>Banco / referencia</th><th class="r">Monto</th></tr>
      <tr><td>${esc(methodLabel(p.method))}</td><td>${esc([p.bank, p.reference].filter(Boolean).join(' · '))}</td><td class="r">${usd(p.amount)}${p.amountBs ? `<br><small>${esc(fx()?.sym || 'Bs')} ${num(p.amountBs, 2)} · tasa ${num(p.rate, 2)}</small>` : ''}</td></tr></table>
    ${(p.applied || []).length ? `<h2>Aplicado a</h2><table><tr><th>Recibo</th><th>Mes</th><th class="r">Monto</th></tr>${p.applied.map((a) => `<tr><td>${esc(a.n)}</td><td>${esc(periodName(a.p))}</td><td class="r">${usd(a.amount)}</td></tr>`).join('')}</table>` : ''}
    ${p.advance > 0.009 ? `<div style="margin-top:6px">Queda a favor: <b>${usd(p.advance)}</b></div>` : ''}
    <div style="margin-top:8px">Saldo actual de la unidad: <b>${usd(Math.max(0, unitBalance(u)))}</b>${unitBalance(u) < -0.009 ? ` · a favor ${usd(-unitBalance(u))}` : ''}</div>
    <div class="foot">SanoCondominio · ${fmtDateTime(new Date().toISOString())}</div></body></html>`);
}

/** Documento imprimible genérico (reportes, listados, relación de gastos) */
export function printDoc(title, inner, { landscape = false } = {}) {
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>${esc(title)}</title><style>${baseCSS} @page { margin: 12mm; ${landscape ? 'size: landscape;' : ''} }</style></head><body>
  ${adminHead()}<h1 style="font-size:16px">${esc(title)}</h1><div class="muted">Generado ${fmtDateTime(new Date().toISOString())}</div>
  ${inner}
  <p class="foot">SanoCondominio — Administración de condominios</p></body></html>`);
}
export { usd, bs, amt as moneyBoth };
