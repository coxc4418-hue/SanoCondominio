// SanoCondominio — Operaciones: edificios, unidades, gastos, cierre del mes, cobranza, fondos y portal
import { auth } from './firebase.js';
import { store } from './store.js';
import { round2, nowISO, todayKey, dayKey, addDays, fmtDate, normalize, toast, num } from './utils.js';
import {
  computeBilling, dueDateFor, unitBalance, ledgerStatus, periodName, currentPeriod, addMonths, monthsOwed, catOf, openCharges
} from './condo.js';

export const APP_URL = 'https://sano-condominio.web.app';
export const by = () => (auth.currentUser?.isAnonymous ? 'demo' : (auth.currentUser?.email || '').split('@')[0] || '—');
const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genCode(n = 8) { return Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => CODE_ALPHA[x % CODE_ALPHA.length]).join(''); }
export const portalUrl = (code) => `${APP_URL}/portal/${code}`;
export const fmtSeq = (prefix, n, len = 5) => `${prefix}-${String(n).padStart(len, '0')}`;
export function slugify(s) {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'condominio';
}
const clean = (o) => { const out = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v; return out; };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

/** Escribe en varios lotes (Firestore admite 500 operaciones por lote) */
async function chunked(ops, size = 80) {
  for (let i = 0; i < ops.length; i += size) {
    const b = store.batch();
    ops.slice(i, i + size).forEach((fn) => fn(b));
    await store.commit(b);
  }
}

// ======================================================================
// EDIFICIOS
// ======================================================================
export async function saveBuilding(data, id = null) {
  const ref = id ? store.ref('buildings', id) : store.newRef('buildings');
  const d = clean({
    name: str(data.name, 80), type: data.type || 'edificio', address: str(data.address, 200), rif: str(data.rif, 30),
    reservePct: data.reservePct === '' || data.reservePct == null ? null : Number(data.reservePct),
    floors: Number(data.floors) || 0, notes: str(data.notes, 400), active: data.active !== false,
    updatedAt: nowISO(), ...(id ? {} : { createdAt: nowISO() })
  });
  const b = store.batch(); b.set(ref, d, { merge: true }); await store.commit(b);
  return { id: ref.id, ...d };
}

// ======================================================================
// UNIDADES
// ======================================================================
export function cleanUnit(d) {
  return clean({
    buildingId: d.buildingId, code: str(d.code, 20).toUpperCase(), type: d.type || 'apartamento', floor: str(d.floor, 10),
    aliquot: round2((Number(String(d.aliquot ?? '').replace(',', '.')) || 0) * 10000) / 10000,
    ownerName: str(d.ownerName, 80), ownerIdDoc: str(d.ownerIdDoc, 20), ownerPhone: str(d.ownerPhone, 20), ownerEmail: str(d.ownerEmail, 80),
    occupancy: d.occupancy || 'propietario', residentName: str(d.residentName, 80), residentPhone: str(d.residentPhone, 20),
    parking: str(d.parking, 40), notes: str(d.notes, 400)
  });
}
export async function saveUnit(data, id = null) {
  const ref = id ? store.ref('units', id) : store.newRef('units');
  const prev = id ? store.unit(id) : null;
  const d = { ...cleanUnit(data), updatedAt: nowISO() };
  if (!prev) Object.assign(d, { billed: Number(data.billed) || 0, paid: Number(data.paid) || 0, ledger: data.ledger || [], active: true, createdAt: nowISO(), portalCode: genCode(8) });
  else if (!prev.portalCode) d.portalCode = genCode(8);
  const dup = store.units.find((u) => u.id !== ref.id && u.buildingId === d.buildingId && (u.code || '') === d.code && u.active !== false);
  if (dup) throw new Error(`Ya existe la unidad ${d.code} en este edificio.`);
  const b = store.batch(); b.set(ref, d, { merge: true }); await store.commit(b);
  const saved = { id: ref.id, ...(prev || {}), ...d };
  if (saved.active !== false && saved.portalCode) await publishUnitPortal(saved).catch((e) => console.warn('[portal]', e?.code || e));
  return saved;
}
export async function setUnitActive(u, active) {
  const b = store.batch(); b.set(store.ref('units', u.id), { active, updatedAt: nowISO() }, { merge: true });
  if (!active && u.portalCode) b.delete(store.portalRef(u.portalCode));
  await store.commit(b);
  if (active && u.portalCode) await publishUnitPortal({ ...u, active: true }).catch(() => {});
}
export async function renewPortalCode(u) {
  const code = genCode(8);
  const updated = { ...u, portalCode: code };
  const docData = JSON.parse(JSON.stringify(portalDoc(updated)));
  const b = store.batch();
  if (u.portalCode) b.delete(store.portalRef(u.portalCode));
  b.set(store.ref('units', u.id), { portalCode: code, updatedAt: nowISO() }, { merge: true });
  if (updated.active !== false) b.set(store.portalRef(code), docData);
  await store.commit(b);
  published.delete(u.portalCode);
  const { updatedAt, ...cmp } = docData;
  published.set(code, JSON.stringify(cmp));
  return code;
}
/** Reparte el 100% de la alícuota: en partes iguales o proporcional a los metros cuadrados */
export async function equalizeAliquots(buildingId, mode = 'iguales') {
  const units = store.unitsOf(buildingId);
  if (!units.length) return;
  const totalM2 = units.reduce((a, u) => a + (Number(u.m2) || 0), 0);
  const ops = units.map((u) => (b) => {
    const v = mode === 'm2' && totalM2 > 0 ? (Number(u.m2) || 0) / totalM2 * 100 : 100 / units.length;
    b.set(store.ref('units', u.id), { aliquot: Math.round(v * 10000) / 10000, updatedAt: nowISO() }, { merge: true });
  });
  await chunked(ops);
}
/** Saldo inicial (deuda anterior al sistema o saldo a favor) */
export async function setOpeningBalance(u, amount, note = 'Saldo inicial') {
  const amt = round2(amount);
  if (!amt) return;
  if (amt > 0) return addUnitCharge(u, { concept: note, amount: amt, kind: 'extra' });
  const b = store.batch();
  b.set(store.ref('units', u.id), { paid: store.inc(-amt), updatedAt: nowISO() }, { merge: true });
  await store.commit(b);
}

/** Importa unidades desde filas CSV: código; tipo; piso; alícuota; propietario; cédula; teléfono; correo; deuda inicial */
export async function importUnits(buildingId, rows) {
  let created = 0, updated = 0;
  const ops = [];
  const toPublish = [];
  for (const r of rows) {
    const code = str(r.code, 20).toUpperCase();
    if (!code) continue;
    const prev = store.units.find((u) => u.buildingId === buildingId && u.code === code);
    const ref = prev ? store.ref('units', prev.id) : store.newRef('units');
    const d = { ...cleanUnit({ ...prev, ...r, code, buildingId }), updatedAt: nowISO() };
    if (!prev) {
      const debt = round2(Number(String(r.debt || '').replace(',', '.')) || 0);
      Object.assign(d, { billed: 0, paid: 0, ledger: [], active: true, createdAt: nowISO(), portalCode: genCode(8) });
      if (debt > 0) Object.assign(d, { billed: debt, ledger: [{ id: 'saldo', p: addMonths(currentPeriod(), -1), c: 0, t: debt, n: 'Saldo anterior', d: todayKey(), k: 'extra' }] });
      else if (debt < 0) d.paid = -debt;
      created++;
    } else {
      if (!prev.portalCode) d.portalCode = genCode(8);
      updated++;
    }
    const merged = { id: ref.id, ...(prev || {}), ...d };
    ops.push((b) => b.set(ref, d, { merge: true }));
    if (merged.active !== false && merged.portalCode) toPublish.push(merged);
  }
  await chunked(ops);
  if (toPublish.length) {
    const pOps = toPublish.map((u) => {
      const pd = JSON.parse(JSON.stringify(portalDoc(u)));
      return { code: u.portalCode, pd, fn: (b) => b.set(store.portalRef(u.portalCode), pd) };
    });
    await chunked(pOps.map((x) => x.fn), 60).catch((e) => console.warn('[portal]', e?.code || e));
    pOps.forEach(({ code, pd }) => { const { updatedAt, ...cmp } = pd; published.set(code, JSON.stringify(cmp)); });
  }
  return { created, updated };
}

// ======================================================================
// PROVEEDORES Y GASTOS
// ======================================================================
export async function saveSupplier(data, id = null) {
  const ref = id ? store.ref('suppliers', id) : store.newRef('suppliers');
  const d = clean({ name: str(data.name, 80), rif: str(data.rif, 30), phone: str(data.phone, 20), category: data.category || '', bank: str(data.bank, 120), notes: str(data.notes, 300), active: data.active !== false, updatedAt: nowISO() });
  const b = store.batch(); b.set(ref, d, { merge: true }); await store.commit(b);
  return { id: ref.id, ...d };
}

export async function saveExpense(data, id = null) {
  const prev = id ? store.expenses.find((e) => e.id === id) : null;
  const period = data.period || currentPeriod();
  if (store.closing(data.buildingId, period) && (!prev || !prev.fromFund)) {
    if (!data.fromFund) throw new Error(`Los recibos de ${periodName(period)} ya se emitieron. Registra el gasto en el mes siguiente o págalo con un fondo.`);
  }
  const ref = id ? store.ref('expenses', id) : store.newRef('expenses');
  const b = store.batch();
  const amount = round2(data.amount);
  if (!(amount > 0)) throw new Error('Indica el monto del gasto.');
  const d = clean({
    buildingId: data.buildingId, period, date: data.date || todayKey(), category: data.category || 'otros',
    concept: str(data.concept, 140), supplierId: data.supplierId || '', supplierName: data.supplierId ? store.supplier(data.supplierId)?.name || '' : str(data.supplierName, 80),
    invoiceNo: str(data.invoiceNo, 30), amount, type: data.type === 'no_comun' ? 'no_comun' : 'comun',
    unitIds: data.type === 'no_comun' ? (data.unitIds || []) : [], split: data.split === 'alicuota' ? 'alicuota' : 'iguales',
    fromFund: data.fromFund || '', paid: data.paid !== false, method: data.method || '', reference: str(data.reference, 40),
    status: 'activo', updatedAt: nowISO(), by: by()
  });
  if (!prev) { d.number = fmtSeq('G', store.nextSeq(b, 'expense')); d.createdAt = nowISO(); }
  b.set(ref, d, { merge: true });
  // Pagado con un fondo: sale del fondo (y no se cobra en el recibo)
  const fundRef = store.ref('funds', 'exp_' + ref.id);
  if (d.fromFund) b.set(fundRef, { buildingId: d.buildingId, fund: d.fromFund, type: 'out', amount, concept: `Gasto ${d.number || prev?.number || ''}: ${d.concept}`, date: d.date, expenseId: ref.id, createdAt: nowISO(), by: by() });
  else if (prev?.fromFund) b.delete(fundRef);
  await store.commit(b);
  return { id: ref.id, ...(prev || {}), ...d };
}
export async function voidExpense(e) {
  if (store.closing(e.buildingId, e.period) && !e.fromFund) throw new Error('Ese mes ya se facturó: anula primero la emisión de recibos.');
  const b = store.batch();
  b.set(store.ref('expenses', e.id), { status: 'anulado', updatedAt: nowISO(), by: by() }, { merge: true });
  if (e.fromFund) b.delete(store.ref('funds', 'exp_' + e.id));
  await store.commit(b);
}
/** Copia los gastos fijos de un mes al siguiente (nómina, vigilancia, ascensores…) */
export async function copyRecurring(buildingId, fromPeriod, toPeriod) {
  const list = store.expensesOf(buildingId, fromPeriod).filter((e) => e.recurring || ['nomina', 'vigilancia', 'limpieza', 'ascensores', 'administracion', 'jardineria'].includes(e.category));
  const existing = new Set(store.expensesOf(buildingId, toPeriod).map((e) => normalize(e.concept)));
  let n = 0;
  for (const e of list) {
    if (existing.has(normalize(e.concept))) continue;
    await saveExpense({ ...e, period: toPeriod, date: `${toPeriod}-01` > todayKey() ? todayKey() : `${toPeriod}-01`, paid: false });
    n++;
  }
  return n;
}

// ---------- Cuotas especiales (se suman al recibo) ----------
export async function saveCharge(data, id = null) {
  if (store.closing(data.buildingId, data.period)) throw new Error(`Los recibos de ${periodName(data.period)} ya se emitieron.`);
  const ref = id ? store.ref('charges', id) : store.newRef('charges');
  const d = clean({ buildingId: data.buildingId, period: data.period, concept: str(data.concept, 120), amount: round2(data.amount), mode: data.mode === 'fijo' ? 'fijo' : 'alicuota', fund: str(data.fund, 40), unitIds: data.unitIds || [], status: 'activo', updatedAt: nowISO() });
  if (!(d.amount > 0)) throw new Error('Indica el monto de la cuota.');
  const b = store.batch(); b.set(ref, d, { merge: true }); await store.commit(b);
  return { id: ref.id, ...d };
}
export async function voidCharge(c) {
  if (store.closing(c.buildingId, c.period)) throw new Error('Ese mes ya se facturó.');
  await store.save('charges', c.id, { status: 'anulado', updatedAt: nowISO() });
}

// ======================================================================
// CIERRE DEL MES: emisión de recibos
// ======================================================================
export function previewBilling(buildingId, period) {
  return computeBilling({
    building: store.bld(buildingId), units: store.unitsOf(buildingId), expenses: store.expensesOf(buildingId, period),
    charges: store.chargesOf(buildingId, period), settings: store.settings
  });
}
const trimLedger = (u, extra) => {
  const all = [...(u.ledger || []), extra];
  const st = ledgerStatus({ ...u, ledger: all });
  // Conserva todo lo pendiente y los últimos 24 cargos
  return all.filter((x, i) => st[i].rest > 0.009 || i >= all.length - 24);
};

export async function emitBilling(buildingId, period, { dueDate = null, note = '' } = {}) {
  if (store.closing(buildingId, period)) throw new Error(`Los recibos de ${periodName(period)} ya están emitidos.`);
  const { summary, receipts } = previewBilling(buildingId, period);
  if (!receipts.length) throw new Error('Este edificio no tiene unidades.');
  if (!(summary.totalBilled > 0)) throw new Error('No hay gastos ni cuotas para facturar en este mes.');
  const due = dueDate || dueDateFor(store.settings);
  const closingId = `${buildingId}_${period}`;
  const rate = Number(store.settings.fx?.enabled && store.settings.fx.rate) || 0;
  const now = nowISO();
  const ops = [];
  const b0 = store.batch();
  const firstSeq = (Number(store.counters.receipt) || 0) + 1;
  b0.set(store.ref('config', 'counters'), { receipt: firstSeq + receipts.length - 1 }, { merge: true });
  store.counters = { ...store.counters, receipt: firstSeq + receipts.length - 1 };
  await store.commit(b0);
  const prefix = store.settings.invoicePrefix || 'R';
  receipts.forEach((r, i) => {
    const u = r.unit;
    const id = `${closingId}_${u.id}`;
    const number = fmtSeq(prefix, firstSeq + i, 6);
    const cumBefore = Number(u.billed) || 0;
    const prevDebt = round2(Math.max(0, unitBalance(u)));
    const credit = round2(Math.max(0, -unitBalance(u)));
    ops.push((b) => b.set(store.ref('receipts', id), {
      closingId, buildingId, period, unitId: u.id, unitCode: u.code, ownerName: u.ownerName || '', aliquot: Number(u.aliquot) || 0,
      items: r.items, total: r.total, number, dueDate: due, cumBefore, prevDebt, credit, emittedAt: now, fxRate: rate, by: by()
    }));
    const entry = { id, p: period, c: cumBefore, t: r.total, n: number, d: due, k: 'mes' };
    ops.push((b) => b.set(store.ref('units', u.id), { billed: store.inc(r.total), ledger: trimLedger(u, entry), updatedAt: now }, { merge: true }));
  });
  ops.push((b) => b.set(store.ref('closings', closingId), {
    buildingId, period, status: 'emitido', dueDate: due, emittedAt: now, by: by(), note: str(note, 300), fxRate: rate,
    ...summary, receipts: receipts.length, firstNumber: fmtSeq(prefix, firstSeq, 6), lastNumber: fmtSeq(prefix, firstSeq + receipts.length - 1, 6)
  }));
  if (summary.reserve > 0) ops.push((b) => b.set(store.ref('funds', `res_${closingId}`), { buildingId, fund: 'reserva', type: 'in', amount: summary.reserve, concept: `Aporte al fondo de reserva · ${periodName(period)}`, date: todayKey(), closingId, createdAt: now, by: by() }));
  const byFund = {};
  for (const r of receipts) for (const it of r.items) if (it.kind === 'especial' && it.fund) byFund[it.fund] = round2((byFund[it.fund] || 0) + it.amount);
  for (const [fund, amount] of Object.entries(byFund)) ops.push((b) => b.set(store.ref('funds', `esp_${closingId}_${slugify(fund)}`), { buildingId, fund, type: 'in', amount, concept: `Cuota especial · ${periodName(period)}`, date: todayKey(), closingId, createdAt: now, by: by() }));
  await chunked(ops);
  resetPublished();
  return { closingId, summary, count: receipts.length };
}

/** Anula la emisión del mes (solo si es la última de la unidad y nadie pagó después de emitir) */
export async function annulBilling(closing) {
  const list = await store.periodReceipts(closing.buildingId, closing.period);
  const blocked = list.filter((r) => { const u = store.unit(r.unitId); return u && Math.abs((Number(u.billed) || 0) - (Number(r.cumBefore) || 0) - (Number(r.total) || 0)) > 0.009; });
  if (blocked.length) throw new Error(`No se puede anular: ${blocked.length} unidad(es) tienen cargos posteriores a este mes.`);
  const now = nowISO();
  const ops = [];
  for (const r of list) {
    const u = store.unit(r.unitId);
    ops.push((b) => b.delete(store.ref('receipts', r.id)));
    if (u) ops.push((b) => b.set(store.ref('units', u.id), { billed: store.inc(-r.total), ledger: (u.ledger || []).filter((x) => x.id !== r.id), updatedAt: now }, { merge: true }));
  }
  ops.push((b) => b.set(store.ref('closings', closing.id), { status: 'anulado', annulledAt: now, by: by() }, { merge: true }));
  for (const f of store.funds.filter((x) => x.closingId === closing.id)) ops.push((b) => b.delete(store.ref('funds', f.id)));
  await chunked(ops);
  resetPublished();
}

/** Cargo individual a una unidad (multa, reparación, saldo anterior…) */
export async function addUnitCharge(u, { concept, amount, kind = 'extra', due = null }) {
  const amt = round2(amount);
  if (!(amt > 0)) throw new Error('Indica el monto.');
  const b = store.batch();
  const ref = store.newRef('receipts');
  const number = fmtSeq('C', store.nextSeq(b, 'charge'), 5);
  const cumBefore = Number(u.billed) || 0;
  const period = currentPeriod();
  const d = due || dayKey(addDays(new Date(), Number(store.settings.dueDays) || 15));
  b.set(ref, { closingId: '', buildingId: u.buildingId, period, unitId: u.id, unitCode: u.code, ownerName: u.ownerName || '', items: [{ concept: str(concept, 120) || 'Cargo', amount: amt, kind }], total: amt, number, dueDate: d, cumBefore, emittedAt: nowISO(), kind: 'cargo', by: by() });
  b.set(store.ref('units', u.id), { billed: store.inc(amt), ledger: trimLedger(u, { id: ref.id, p: period, c: cumBefore, t: amt, n: number, d, k: 'extra' }), updatedAt: nowISO() }, { merge: true });
  await store.commit(b);
  resetPublished();
}

// ======================================================================
// COBRANZA
// ======================================================================
/**
 * Registra un pago confirmado de una unidad. p: { unitId, amount (moneda de trabajo), date, method, bank, reference, amountBs, rate, note, inboxId }
 */
export async function registerPayment(p) {
  const u = store.unit(p.unitId);
  if (!u) throw new Error('Unidad no encontrada.');
  const amount = round2(p.amount);
  if (!(amount > 0)) throw new Error('Indica el monto del pago.');
  if (p.reference && store.payments.some((x) => x.status === 'confirmado' && x.reference && x.reference === String(p.reference).trim() && x.method === p.method && Math.abs((Number(x.amount) || 0) - amount) < 0.01)) {
    throw new Error(`Ya hay un pago confirmado con la referencia ${p.reference}. Revisa que no esté duplicado.`);
  }
  const b = store.batch();
  const ref = store.newRef('payments');
  const number = fmtSeq('P', store.nextSeq(b, 'payment'), 6);
  const before = ledgerStatus(u);
  const applied = [];
  let left = amount;
  for (const x of before) { if (left <= 0.009) break; if (x.rest <= 0.009) continue; const a = round2(Math.min(left, x.rest)); applied.push({ n: x.n, p: x.p, amount: a }); left = round2(left - a); }
  const d = clean({
    unitId: u.id, unitCode: u.code, buildingId: u.buildingId, ownerName: u.ownerName || '', amount, date: p.date || todayKey(),
    method: p.method || 'transferencia', bank: str(p.bank, 60), reference: str(p.reference, 40), amountBs: round2(p.amountBs || 0), rate: Number(p.rate) || 0,
    note: str(p.note, 300), status: 'confirmado', number, applied, advance: left > 0.009 ? left : 0, source: p.inboxId ? 'portal' : 'oficina', inboxId: p.inboxId || '',
    createdAt: nowISO(), by: by()
  });
  b.set(ref, d);
  b.set(store.ref('units', u.id), { paid: store.inc(amount), lastPaymentAt: d.date, updatedAt: nowISO() }, { merge: true });
  if (p.inboxId) b.set(store.inboxRef(p.inboxId), { status: 'procesada', paymentId: ref.id, processedAt: nowISO() }, { merge: true });
  await store.commit(b);
  resetPublished();
  return { id: ref.id, ...d };
}
export async function voidPayment(pay, reason = '') {
  if (pay.status !== 'confirmado') return;
  const b = store.batch();
  b.set(store.ref('payments', pay.id), { status: 'anulado', voidReason: str(reason, 200), voidedAt: nowISO(), voidedBy: by() }, { merge: true });
  b.set(store.ref('units', pay.unitId), { paid: store.inc(-(Number(pay.amount) || 0)), updatedAt: nowISO() }, { merge: true });
  await store.commit(b);
  resetPublished();
}
export async function rejectReport(item, reason = '') {
  await setInbox(item, { status: 'rechazada', reply: str(reason, 300) || 'No pudimos verificar el pago. Comunícate con la administración.' });
}

// ======================================================================
// FONDOS
// ======================================================================
export async function fundMove({ buildingId, fund = 'reserva', type = 'in', amount, concept, date = todayKey() }) {
  const amt = round2(amount);
  if (!(amt > 0)) throw new Error('Indica el monto.');
  if (type === 'out' && amt > store.fundBalance(buildingId, fund) + 0.009) throw new Error(`El fondo solo tiene ${num(store.fundBalance(buildingId, fund))}.`);
  const ref = store.newRef('funds');
  await store.save('funds', ref.id, { buildingId, fund: str(fund, 40) || 'reserva', type, amount: amt, concept: str(concept, 160), date, createdAt: nowISO(), by: by() }, false);
}
export async function voidFundMove(f) { await store.save('funds', f.id, { status: 'anulado', voidedAt: nowISO() }); }

// ======================================================================
// COMUNICADOS, VOTACIONES, RESERVAS Y SOLICITUDES
// ======================================================================
export async function saveNotice(data, id = null) {
  const ref = id ? store.ref('notices', id) : store.newRef('notices');
  const d = clean({ buildingId: data.buildingId || '', title: str(data.title, 100), body: str(data.body, 2000), kind: data.kind || 'aviso', pinned: !!data.pinned, date: data.date || todayKey(), until: data.until || '', updatedAt: nowISO(), by: by() });
  if (!d.title) throw new Error('Escribe el título del comunicado.');
  const b = store.batch(); b.set(ref, d, { merge: true }); await store.commit(b);
  resetPublished();
  return { id: ref.id, ...d };
}
export async function deleteNotice(n) { await store.remove('notices', n.id); resetPublished(); }

export async function saveVote(data, id = null) {
  const ref = id ? store.ref('votes', id) : store.newRef('votes');
  const options = (data.options || []).map((o) => str(o, 60)).filter(Boolean).slice(0, 6);
  if (!str(data.title)) throw new Error('Escribe la pregunta.');
  if (options.length < 2) throw new Error('Agrega al menos dos opciones.');
  const d = clean({ buildingId: data.buildingId, title: str(data.title, 160), detail: str(data.detail, 1200), options, weight: data.weight === 'unidad' ? 'unidad' : 'alicuota', until: data.until || '', assembly: str(data.assembly, 120), updatedAt: nowISO() });
  if (!id) Object.assign(d, { status: 'abierta', ballots: {}, createdAt: nowISO(), by: by() });
  const b = store.batch(); b.set(ref, d, { merge: true }); await store.commit(b);
  resetPublished();
  return { id: ref.id, ...d };
}
export async function castVote(vote, unitId, option, via = 'presencial') {
  if (vote.status !== 'abierta') throw new Error('La votación está cerrada.');
  if (!vote.options.includes(option)) throw new Error('Opción no válida.');
  await store.save('votes', vote.id, { ballots: { [unitId]: { option, at: nowISO(), via } } });
}
export async function setVoteStatus(vote, status) { await store.save('votes', vote.id, { status, closedAt: status === 'cerrada' ? nowISO() : '' }); resetPublished(); }
export function voteResults(vote) {
  const units = store.unitsOf(vote.buildingId);
  const totalW = vote.weight === 'unidad' ? units.length : units.reduce((a, u) => a + (Number(u.aliquot) || 0), 0) || 1;
  const res = Object.fromEntries(vote.options.map((o) => [o, { votes: 0, weight: 0 }]));
  let castW = 0, cast = 0;
  for (const [uid, bl] of Object.entries(vote.ballots || {})) {
    const u = store.unit(uid); if (!u || !res[bl.option]) continue;
    const w = vote.weight === 'unidad' ? 1 : Number(u.aliquot) || 0;
    res[bl.option].votes++; res[bl.option].weight += w; castW += w; cast++;
  }
  return { res, cast, castW, totalW, quorum: totalW ? castW / totalW * 100 : 0, units: units.length };
}
/** Los votos que llegan desde el portal se pasan a la votación */
export async function processInboxVotes() {
  const pend = store.inbox.filter((x) => x.type === 'voto' && x.status === 'nueva');
  for (const x of pend) {
    const v = store.votes.find((y) => y.id === x.voteId);
    const ok = v && v.status === 'abierta' && v.options.includes(x.option) && store.unit(x.unitId);
    const b = store.batch();
    if (ok) b.set(store.ref('votes', v.id), { ballots: { [x.unitId]: { option: x.option, at: x.createdAt || nowISO(), via: 'portal' } } }, { merge: true });
    b.set(store.inboxRef(x.id), { status: ok ? 'procesada' : 'rechazada', processedAt: nowISO() }, { merge: true });
    await store.commit(b);
  }
  return pend.length;
}

export async function saveBooking(data, id = null) {
  const ref = id ? store.ref('bookings', id) : store.newRef('bookings');
  const u = store.unit(data.unitId);
  if (!u) throw new Error('Elige la unidad que reserva.');
  if (!data.date || !data.areaId) throw new Error('Indica el área y la fecha.');
  const clash = store.bookings.find((x) => x.id !== ref.id && x.status !== 'cancelada' && x.areaId === data.areaId && x.buildingId === u.buildingId && x.date === data.date && !(String(data.to || '23:59') <= String(x.from || '00:00') || String(data.from || '00:00') >= String(x.to || '23:59')));
  if (clash) throw new Error(`${store.area(data.areaId)?.name || 'El área'} ya está reservada ese día (${clash.unitCode} ${clash.from || ''}-${clash.to || ''}).`);
  const area = store.area(data.areaId);
  const d = clean({ buildingId: u.buildingId, unitId: u.id, unitCode: u.code, ownerName: u.ownerName || '', areaId: data.areaId, areaName: area?.name || '', date: data.date, from: data.from || '', to: data.to || '', guests: Number(data.guests) || 0, fee: round2(data.fee ?? area?.fee ?? 0), note: str(data.note, 300), status: data.status || 'confirmada', updatedAt: nowISO(), inboxId: data.inboxId || '' });
  const b = store.batch(); b.set(ref, d, { merge: true });
  if (data.inboxId) b.set(store.inboxRef(data.inboxId), { status: 'procesada', processedAt: nowISO(), bookingId: ref.id }, { merge: true });
  await store.commit(b);
  if (data.charge && d.fee > 0) await addUnitCharge(u, { concept: `Reserva ${d.areaName} · ${fmtDate(d.date)}`, amount: d.fee, kind: 'extra' });
  resetPublished();
  return { id: ref.id, ...d };
}
export async function setBookingStatus(bk, status) { await store.save('bookings', bk.id, { status, updatedAt: nowISO() }); resetPublished(); }

export async function setInbox(item, patch) {
  const b = store.batch(); b.set(store.inboxRef(item.id), { ...patch, updatedAt: nowISO() }, { merge: true }); await store.commit(b);
  resetPublished();
}
/** Solicitud creada desde la oficina (queda en el mismo buzón que las del portal) */
export async function createRequest({ unitId, category, text, name = '', phone = '' }) {
  const u = store.unit(unitId);
  if (!u) throw new Error('Elige la unidad.');
  if (str(text).length < 4) throw new Error('Describe la solicitud.');
  const ref = store.newInboxRef();
  const b = store.batch();
  b.set(ref, { tenantId: store.tenantId, code: u.portalCode || '', unitId: u.id, unitCode: u.code, buildingId: u.buildingId, type: 'solicitud', category: category || 'otro', text: str(text, 600), name: str(name || u.ownerName, 60) || 'Administración', phone: str(phone, 20), status: 'nueva', createdAt: nowISO() });
  await store.commit(b);
}

// ======================================================================
// PORTAL DEL PROPIETARIO (documento público por unidad)
// ======================================================================
const fx = () => (store.settings.fx?.enabled ? Number(store.settings.fx.rate) || 0 : 0);
export function portalDoc(u) {
  const s = store.settings;
  const bld = store.bld(u.buildingId);
  const led = ledgerStatus(u);
  const lastClosing = store.closings.filter((c) => c.buildingId === u.buildingId && c.status !== 'anulado')[0] || null;
  const notices = store.notices.filter((n) => (!n.buildingId || n.buildingId === u.buildingId) && (!n.until || n.until >= todayKey())).slice(0, 6)
    .map((n) => ({ title: n.title, body: String(n.body || '').slice(0, 600), kind: n.kind, date: n.date, pinned: !!n.pinned }));
  const pays = store.payments.filter((p) => p.unitId === u.id && p.status === 'confirmado').slice(0, 6).map((p) => ({ n: p.number, date: p.date, amount: p.amount, method: p.method, ref: p.reference || '' }));
  const reports = store.inbox.filter((x) => x.unitId === u.id && x.type === 'pago').slice(0, 4).map((x) => ({ date: (x.createdAt || '').slice(0, 10), amount: x.amount, status: x.status, reply: x.reply || '' }));
  const reqs = store.inbox.filter((x) => x.unitId === u.id && x.type === 'solicitud').slice(0, 5).map((x) => ({ date: (x.createdAt || '').slice(0, 10), category: x.category, text: String(x.text || '').slice(0, 160), status: x.status, reply: x.reply || '' }));
  const votes = store.votes.filter((v) => v.buildingId === u.buildingId && v.status === 'abierta').slice(0, 3).map((v) => ({ id: v.id, title: v.title, detail: String(v.detail || '').slice(0, 400), options: v.options, until: v.until || '', mine: v.ballots?.[u.id]?.option || '' }));
  const bookings = store.bookings.filter((b) => b.unitId === u.id && b.date >= todayKey() && b.status !== 'cancelada').slice(0, 4).map((b) => ({ area: b.areaName, date: b.date, from: b.from, to: b.to, status: b.status }));
  const exp = s.portal?.expenses !== false && lastClosing ? {
    period: lastClosing.period, common: lastClosing.common, adminFee: lastClosing.adminFee, reserve: lastClosing.reserve, total: lastClosing.toDistribute,
    byCat: Object.entries(lastClosing.byCat || {}).map(([k, v]) => ({ name: catOf(k, store.categories).name, amount: v })).sort((a, b) => b.amount - a.amount).slice(0, 12)
  } : null;
  return {
    tenantId: store.tenantId, unitId: u.id, code: u.portalCode,
    admin: store.businessName, adminPhone: s.whatsapp || s.phone || '', adminEmail: s.email || '', country: s.country || 'VE', currency: s.currency || '',
    building: bld?.name || '', buildingId: u.buildingId, unit: u.code, unitType: u.type || 'apartamento', aliquot: Number(u.aliquot) || 0,
    owner: String(u.ownerName || '').split(' ').slice(0, 2).join(' '),
    balance: unitBalance(u), months: monthsOwed(u), rate: fx(), fxSym: store.settings.fx?.sym || 'Bs',
    charges: led.slice(-12).reverse().map((x) => ({ n: x.n, p: x.p, t: x.t, rest: x.rest, d: x.d || '', st: x.status, k: x.k || 'mes' })),
    payments: pays, reports, requests: reqs, votes, bookings, notices, expenses: exp,
    reserve: s.portal?.expenses !== false ? store.fundBalance(u.buildingId, 'reserva') : null,
    banks: (s.banks || []).filter((b) => b.active !== false).slice(0, 6).map((b) => ({ type: b.type, bank: b.bank, holder: b.holder, number: b.number, idDoc: b.idDoc, phone: b.phone, email: b.email })),
    areas: s.portal?.bookings !== false ? store.areas.map((a) => ({ id: a.id, name: a.name, fee: a.fee, hours: a.hours || '' })) : [],
    allow: { reports: s.portal?.reports !== false, requests: s.portal?.requests !== false, bookings: s.portal?.bookings !== false },
    active: u.active !== false && s.portal?.enabled !== false,
    updatedAt: nowISO()
  };
}
let published = new Map();
export function resetPublished() { published = new Map(); schedulePublish?.(); }
let schedulePublish = null;
export function setPublishScheduler(fn) { schedulePublish = fn; }
/** Publica de inmediato el portal público de una sola unidad (ej. al abrir su QR o crearla) */
export async function publishUnitPortal(u) {
  if (!store.tenantId || !u) return null;
  let unit = u;
  if (!unit.portalCode) {
    const code = genCode(8);
    const b0 = store.batch();
    b0.set(store.ref('units', unit.id), { portalCode: code, updatedAt: nowISO() }, { merge: true });
    await store.commit(b0);
    unit = { ...unit, portalCode: code };
  }
  const d = JSON.parse(JSON.stringify(portalDoc(unit)));
  const { updatedAt, ...cmp } = d;
  const h = JSON.stringify(cmp);
  const b = store.batch();
  b.set(store.portalRef(unit.portalCode), d);
  await store.commit(b);
  published.set(unit.portalCode, h);
  return unit.portalCode;
}
/** Publica (solo lo que cambió) el portal de cada unidad activa */
export async function publishPortals() {
  if (!store.tenantId || !store.ready) return 0;
  const ops = [];
  for (const u of store.liveUnits) {
    let unit = u;
    if (!unit.portalCode) {
      const code = genCode(8);
      ops.push({ code, h: '', fn: (b) => b.set(store.ref('units', unit.id), { portalCode: code, updatedAt: nowISO() }, { merge: true }) });
      unit = { ...unit, portalCode: code };
    }
    // Sin campos undefined (Firestore los rechaza) y comparación por contenido para publicar solo lo que cambió
    const d = JSON.parse(JSON.stringify(portalDoc(unit)));
    const { updatedAt, ...cmp } = d;
    const h = JSON.stringify(cmp);
    if (published.get(unit.portalCode) === h) continue;
    ops.push({ code: unit.portalCode, h, fn: (b) => b.set(store.portalRef(unit.portalCode), d) });
  }
  if (!ops.length) return 0;
  await chunked(ops.map((o) => o.fn), 60);
  ops.forEach((o) => { if (o.h) published.set(o.code, o.h); }); // solo después de guardarse bien: si falla, se reintenta
  return ops.length;
}

// ======================================================================
// MENSAJES
// ======================================================================
export function debtSummary(u) {
  const open = openCharges(u);
  return open.map((x) => `• ${x.k === 'extra' ? x.n : periodName(x.p)}: ${num(x.rest)}`).join('\n');
}

export { addDays, dayKey, fmtDate, normalize, toast };
