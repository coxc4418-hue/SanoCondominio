// SanoCondominio — Modo demo (sesión anónima de 30 minutos) con una administradora de ejemplo llena de vida
import { auth, db, doc, collection, writeBatch, getDoc, getDocs, query, where, Timestamp, signInAnonymously, signOut } from './firebase.js';
import { store, DEFAULT_SETTINGS } from './store.js';
import { saveBuilding, importUnits, saveSupplier, emitBilling, saveCharge, fundMove, saveNotice, saveVote, saveBooking, saveExpense, fmtSeq } from './ops.js';
import { round2, nowISO, todayKey, dayKey, addDays, sha256, scaleUSD } from './utils.js';
import { currentPeriod, addMonths, ledgerStatus, periodName } from './condo.js';

/** PIN de administrador de todas las demos (se muestra en pantalla) */
export const DEMO_PIN = '1234';
export const DEMO_MINUTES = 30;
const DATA_COLLECTIONS = ['buildings', 'units', 'expenses', 'charges', 'closings', 'receipts', 'payments', 'funds', 'notices', 'votes', 'bookings', 'suppliers', 'config'];
const BIZ = 'Administradora Horizonte (demo)';

export async function startDemo() { await signInAnonymously(auth); }

export function demoRemainingMs(tenant) {
  const exp = tenant?.expiresAt;
  if (!exp) return 0;
  const ms = typeof exp.toMillis === 'function' ? exp.toMillis() : new Date(exp).getTime();
  return ms - Date.now();
}

export async function createDemoTenant(uid) {
  const expiresAt = Timestamp.fromMillis(Date.now() + DEMO_MINUTES * 60 * 1000);
  const b1 = writeBatch(db);
  b1.set(doc(db, 'tenants', uid), { name: BIZ, code: 'demo', ownerUid: uid, ownerEmail: '', active: true, demo: true, createdAt: nowISO(), expiresAt });
  await b1.commit();
  const ref = (name, id) => doc(db, 'tenants', uid, name, id);
  const b = writeBatch(db);
  b.set(ref('config', 'settings'), {
    ...DEFAULT_SETTINGS, businessName: BIZ, rif: 'J-41234567-8', manager: 'Lcda. Carolina Méndez', phone: '0212-5551234', whatsapp: '0414-5551234', email: 'demo@sanocondominio.app',
    address: 'Av. Francisco de Miranda, Torre Horizonte, piso 3, ofic. 3-B',
    reservePct: 10, adminFee: { mode: 'pct', value: 8 }, lateFee: { enabled: true, pct: 1 }, dueDays: 15, invoicePrefix: 'R',
    banks: [
      { id: 'k1', type: 'transferencia', bank: 'Banesco', number: '0134-0000-11-0000123456', holder: 'Administradora Horizonte, C.A.', idDoc: 'J-41234567-8', active: true },
      { id: 'k2', type: 'pagomovil', bank: 'Banesco (0134)', phone: '0414-5551234', idDoc: 'J-41234567-8', holder: 'Administradora Horizonte, C.A.', active: true },
      { id: 'k3', type: 'zelle', email: 'pagos@horizonte-demo.com', holder: 'Horizonte Admin LLC', active: true }
    ],
    receiptNote: 'Pague antes de la fecha de vencimiento y evite el interés de mora. Reporte su pago desde su portal.',
    portal: { enabled: true, reports: true, expenses: true, requests: true, bookings: true }
  });
  b.set(ref('config', 'security'), { pinHash: await sha256(`${uid}:${DEMO_PIN}`), updatedAt: nowISO() });
  await b.commit();
}

async function waitFor(cond, ms = 8000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 120));
}
function rng(seed = 7) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

const OWNERS = ['María Fernanda Rojas', 'José Gregorio Pérez', 'Carmen Elena Díaz', 'Luis Alberto Márquez', 'Ana Karina Salazar', 'Pedro Luis Gómez', 'Yolanda Briceño', 'Carlos Eduardo Rivas',
  'Rosa María Hernández', 'Jesús Antonio Mora', 'Daniela Castillo', 'Miguel Ángel Suárez', 'Gabriela Ortiz', 'Rafael Medina', 'Mariela Contreras', 'Héctor Ramírez', 'Patricia Morales', 'Ricardo Fuentes',
  'Elena Suárez', 'Andrés Villalobos', 'Luisa Gutiérrez', 'Fernando Bravo', 'Isabel Quintero', 'Oscar Landaeta', 'Verónica Chacón', 'Francisco Arias', 'Lorena Pacheco', 'Alejandro Lugo',
  'Beatriz Montilla', 'Manuel Colmenares', 'Silvia Rangel', 'Jorge Peña', 'Adriana Mendoza', 'Ramón Escalona', 'Teresa Aponte', 'Víctor Nieves'];
const TENANTS = { 3: 'Kelly Torres', 9: 'Roberto Lugo', 15: 'Familia Da Silva', 27: 'Jonathan Pérez' };
// Conducta de pago por índice de unidad: moroso crónico, atrasado, parcial; el resto paga a tiempo
const DEBTOR = new Set([6, 17, 26]);
const LATE = new Set([11, 21, 30]);
const PARTIAL = new Set([4, 33]);

export async function seedDemoActivity() {
  const money = (v) => scaleUSD(v);
  const R = rng(17);
  const p0 = currentPeriod();
  const P = [addMonths(p0, -3), addMonths(p0, -2), addMonths(p0, -1)];
  const day = (p, d) => `${p}-${String(Math.min(28, d)).padStart(2, '0')}`;
  const phone = () => `04${['14', '24', '12', '16', '26'][Math.floor(R() * 5)]}-${String(1000000 + Math.floor(R() * 8999999))}`;

  // 1) Edificios
  const A = await saveBuilding({ name: 'Residencias Los Samanes', type: 'edificio', address: 'Calle Los Samanes, Urb. El Cafetal, Caracas', rif: 'J-30111222-3', floors: 6 });
  const B = await saveBuilding({ name: 'Torre El Parque', type: 'edificio', address: 'Av. Principal de Los Palos Grandes', rif: 'J-30999888-1', floors: 4, reservePct: 8 });
  await waitFor(() => store.buildings.length >= 2);
  store.setBuilding('');

  // 2) Unidades con propietarios (alícuotas que suman 100 %)
  const mkUnits = (floors, letters, weights, offset) => {
    const tot = floors * weights.reduce((a, w) => a + w, 0);
    const rows = [];
    let sum = 0;
    for (let f = 1; f <= floors; f++) letters.forEach((L, i) => {
      const k = offset + rows.length;
      const aliq = round2(weights[i] / tot * 100 * 100) / 100;
      sum += aliq;
      const tn = TENANTS[k];
      rows.push({ code: `${f}-${L}`, type: 'apartamento', floor: String(f), aliquot: aliq, ownerName: OWNERS[k], ownerIdDoc: `V-${8 + Math.floor(R() * 20)}.${String(100 + Math.floor(R() * 899))}.${String(100 + Math.floor(R() * 899))}`, ownerPhone: phone(),
        occupancy: tn ? 'inquilino' : 'propietario', residentName: tn || '', residentPhone: tn ? phone() : '', parking: `P-${f}${i + 1}`,
        debt: DEBTOR.has(k) ? money(k === 6 ? 210 : 95) : '' });
    });
    rows[rows.length - 1].aliquot = round2((rows[rows.length - 1].aliquot + 100 - sum) * 10000) / 10000;
    return rows;
  };
  await importUnits(A.id, mkUnits(6, ['A', 'B', 'C', 'D'], [1.15, 0.85, 0.85, 1.15], 0));
  await importUnits(B.id, mkUnits(4, ['A', 'B', 'C'], [1.2, 0.9, 0.9], 24));
  await waitFor(() => store.units.length >= 36);
  const UA = store.unitsOf(A.id), UB = store.unitsOf(B.id);
  const ALL = [...UA, ...UB];
  const idx = (u) => OWNERS.indexOf(u.ownerName);

  // 3) Proveedores
  const S = {};
  for (const [k, name, category, ph] of [['vig', 'Seguridad Centinela C.A.', 'vigilancia', '0212-5557788'], ['asc', 'Ascensores Otis-Ven', 'ascensores', '0212-5553311'], ['lim', 'Limpiezas Brillante', 'limpieza', '0414-3332211'], ['bom', 'Hidrobombas Express', 'mantenimiento', '0424-1112233']]) {
    S[k] = (await saveSupplier({ name, category, phone: ph, rif: `J-4${Math.floor(R() * 9000000 + 1000000)}-${Math.floor(R() * 9)}` })).id;
  }

  // 4) Fondos iniciales
  await fundMove({ buildingId: A.id, fund: 'reserva', type: 'in', amount: money(3200), concept: 'Saldo inicial del fondo de reserva', date: day(P[0], 1) });
  await fundMove({ buildingId: B.id, fund: 'reserva', type: 'in', amount: money(1150), concept: 'Saldo inicial del fondo de reserva', date: day(P[0], 1) });

  // 5) Tres meses: gastos → recibos emitidos
  const EXP = {
    [A.id]: [['vigilancia', 'Vigilancia 24 h', 'vig', 880], ['nomina', 'Sueldo y bono del conserje', '', 340], ['electricidad', 'Corpoelec áreas comunes', '', 150], ['agua', 'Hidrocapital + hidroneumático', '', 120], ['ascensores', 'Mantenimiento mensual de 2 ascensores', 'asc', 160], ['limpieza', 'Insumos de limpieza', 'lim', 55], ['jardineria', 'Jardinería de la entrada', '', 45], ['bancarios', 'Comisiones bancarias', '', 12]],
    [B.id]: [['vigilancia', 'Vigilancia nocturna', 'vig', 420], ['nomina', 'Conserje medio tiempo', '', 210], ['electricidad', 'Corpoelec áreas comunes', '', 70], ['agua', 'Hidrocapital', '', 60], ['ascensores', 'Mantenimiento del ascensor', 'asc', 85], ['limpieza', 'Insumos de limpieza', 'lim', 30]]
  };
  const EXTRA = [[A.id, 0, 'mantenimiento', 'Cambio de luminarias del pasillo piso 4', 'bom', 75], [A.id, 1, 'mantenimiento', 'Reparación del portón eléctrico', '', 140], [B.id, 2, 'mantenimiento', 'Destape de bajante', 'bom', 45], [A.id, 2, 'seguros', 'Póliza de responsabilidad civil (cuota)', '', 60]];
  const writeExpenses = async (bId, p, list) => {
    const b = store.batch();
    list.forEach(([category, concept, sup, amt], i) => {
      const v = round2(money(amt) * (0.94 + R() * 0.12));
      b.set(store.newRef('expenses'), { buildingId: bId, period: p, date: day(p, 3 + i * 3), category, concept, supplierId: sup ? S[sup] : '', supplierName: sup ? store.supplier(S[sup])?.name || '' : '', invoiceNo: sup ? `${1000 + Math.floor(R() * 8000)}` : '', amount: v, type: 'comun', unitIds: [], split: 'iguales', fromFund: '', paid: true, method: 'transferencia', reference: '', status: 'activo', number: fmtSeq('G', store.nextSeq(b, 'expense')), createdAt: nowISO(), updatedAt: nowISO(), by: 'demo' });
    });
    await store.commit(b);
  };
  let nExp = 0;
  for (let m = 0; m < 3; m++) {
    for (const bId of [A.id, B.id]) {
      const list = [...EXP[bId], ...EXTRA.filter((x) => x[0] === bId && x[1] === m).map((x) => x.slice(2))];
      await writeExpenses(bId, P[m], list); nExp += list.length;
    }
    await waitFor(() => store.expenses.length >= nExp);
    // Agua no común: el local comercial de PB paga aparte (no) — mantenemos gastos comunes
    for (const bId of [A.id, B.id]) {
      const due = m === 2 ? dayKey(addDays(new Date(), 4)) : day(addMonths(P[m], 1), 15);
      try { await emitBilling(bId, P[m], { dueDate: due }); } catch (e) { console.warn('[demo] emisión', e); }
      await waitFor(() => !!store.closing(bId, P[m]));
    }
    await waitFor(() => ALL.every((u) => (store.unit(u.id)?.ledger || []).some((x) => x.p === P[m])), 6000);
  }
  // Un gasto pagado con el fondo de reserva (no se cobra en el recibo)
  try { await saveExpense({ buildingId: A.id, period: P[2], date: day(P[2], 20), category: 'mantenimiento', concept: 'Reemplazo de bomba hidroneumática', supplierId: S.bom, amount: money(480), fromFund: 'reserva', paid: true }); } catch (e) { console.warn('[demo] gasto fondo', e); }

  // 6) Pagos históricos (en lotes): cada propietario según su conducta
  const rate = Number(store.settings.fx?.enabled && store.settings.fx.rate) || 0;
  const methods = rate ? ['pagomovil', 'transferencia', 'pagomovil', 'transferencia', 'zelle', 'efectivo'] : ['transferencia', 'transferencia', 'zelle', 'efectivo'];
  const banks = ['Banesco', 'Mercantil', 'Venezuela', 'Provincial', 'BNC', 'Bancamiga'];
  const pays = [];
  for (const u0 of ALL) {
    const u = store.unit(u0.id); const k = idx(u);
    const due = (p) => round2((u.ledger || []).filter((x) => x.p === p && x.k !== 'extra').reduce((a, x) => a + x.t, 0));
    const add = (date, amount) => { if (amount > 0.009) pays.push({ u, date, amount: round2(amount) }); };
    if (DEBTOR.has(k)) { if (k === 26) add(day(P[1], 9), due(P[0]) * 0.5); continue; }
    if (LATE.has(k)) { add(day(P[2], 25), due(P[0]) + due(P[1])); continue; }
    if (PARTIAL.has(k)) { add(day(P[1], 10), due(P[0])); add(day(P[2], 12), due(P[1]) * 0.6); continue; }
    add(day(P[1], 2 + Math.floor(R() * 12)), due(P[0]));
    add(day(P[2], 2 + Math.floor(R() * 12)), due(P[1]));
    if (R() < 0.62) { const d = dayKey(addDays(new Date(), -Math.floor(R() * 12))); add(d, due(P[2])); }
  }
  pays.sort((a, b) => a.date.localeCompare(b.date));
  const paidBy = {};
  let seq = Number(store.counters.payment) || 0;
  for (let i = 0; i < pays.length; i += 70) {
    const b = store.batch();
    for (const x of pays.slice(i, i + 70)) {
      const before = paidBy[x.u.id] || 0;
      const led = ledgerStatus({ ...x.u, paid: before });
      const applied = []; let left = x.amount;
      for (const c of led) { if (left <= 0.009) break; if (c.rest <= 0.009) continue; const a = round2(Math.min(left, c.rest)); applied.push({ n: c.n, p: c.p, amount: a }); left = round2(left - a); }
      paidBy[x.u.id] = round2(before + x.amount);
      const method = methods[Math.floor(R() * methods.length)];
      const bs = rate && ['pagomovil', 'transferencia'].includes(method);
      b.set(store.newRef('payments'), { unitId: x.u.id, unitCode: x.u.code, buildingId: x.u.buildingId, ownerName: x.u.ownerName || '', amount: x.amount, date: x.date, method, bank: method === 'efectivo' ? '' : banks[Math.floor(R() * banks.length)], reference: method === 'efectivo' ? '' : String(10000000 + Math.floor(R() * 89999999)), amountBs: bs ? round2(x.amount * rate) : 0, rate: bs ? rate : 0, note: '', status: 'confirmado', number: fmtSeq('P', ++seq, 6), applied, advance: left > 0.009 ? left : 0, source: R() < 0.55 ? 'portal' : 'oficina', inboxId: '', createdAt: `${x.date}T${String(9 + Math.floor(R() * 9)).padStart(2, '0')}:${String(Math.floor(R() * 59)).padStart(2, '0')}:00.000Z`, by: 'demo' });
    }
    await store.commit(b);
  }
  {
    const ids = Object.keys(paidBy);
    for (let i = 0; i < ids.length; i += 70) {
      const b = store.batch();
      ids.slice(i, i + 70).forEach((id) => { const last = pays.filter((x) => x.u.id === id).pop(); b.set(store.ref('units', id), { paid: store.inc(paidBy[id]), lastPaymentAt: last.date, updatedAt: nowISO() }, { merge: true }); });
      b.set(store.ref('config', 'counters'), { payment: seq }, { merge: true });
      await store.commit(b);
    }
  }

  // 7) El mes en curso: algunos gastos cargados + cuota especial
  try {
    await writeExpenses(A.id, p0, EXP[A.id].slice(0, 4));
    await writeExpenses(B.id, p0, EXP[B.id].slice(0, 2));
    await saveCharge({ buildingId: A.id, period: p0, concept: 'Cuota especial: impermeabilización de la azotea (1 de 3)', amount: money(900), mode: 'alicuota', fund: 'Impermeabilización' });
  } catch (e) { console.warn('[demo] mes en curso', e); }

  // 8) Comunidad: comunicados, votación, reservas
  try {
    await saveNotice({ kind: 'mantenimiento', title: 'Corte de agua el sábado', body: 'Este sábado de 8:00 a.m. a 1:00 p.m. se suspende el servicio de agua para lavar el tanque. Les pedimos almacenar agua el viernes.', buildingId: A.id, date: dayKey(addDays(new Date(), -1)), until: dayKey(addDays(new Date(), 6)), pinned: true });
    await saveNotice({ kind: 'asamblea', title: 'Asamblea extraordinaria: impermeabilización', body: `Se convoca a los propietarios a la asamblea del ${dayKey(addDays(new Date(), 5)).split('-').reverse().join('/')} a las 7:00 p.m. en el salón de fiestas.\n1. Presupuestos de impermeabilización.\n2. Cuota especial.\nTambién puedes votar desde tu portal.`, buildingId: A.id, date: dayKey(addDays(new Date(), -3)) });
    await saveNotice({ kind: 'cobranza', title: `Recibos de ${periodName(P[2])} disponibles`, body: 'Ya están los recibos con la relación de gastos. Reporta tu pago desde tu portal. ¡Gracias por pagar a tiempo!', buildingId: '', date: dayKey(addDays(new Date(), -10)) });
    const v = await saveVote({ buildingId: A.id, title: '¿Aprueban impermeabilizar la azotea con Techos Seguros C.A. por cuota especial en 3 meses?', detail: 'Tres presupuestos consultados; el elegido ofrece 5 años de garantía. La cuota se distribuye por alícuota.', options: ['Sí, apruebo', 'No apruebo', 'Me abstengo'], weight: 'alicuota', until: dayKey(addDays(new Date(), 5)), assembly: 'Asamblea extraordinaria' });
    const ballots = {};
    UA.slice(0, 15).forEach((u, i) => { ballots[u.id] = { option: i % 5 === 3 ? 'No apruebo' : i % 7 === 6 ? 'Me abstengo' : 'Sí, apruebo', at: nowISO(), via: i % 3 ? 'portal' : 'presencial' }; });
    await store.save('votes', v.id, { ballots });
    await saveBooking({ unitId: UA[5].id, areaId: 'salon', date: dayKey(addDays(new Date(), 4)), from: '15:00', to: '21:00', guests: 30, note: 'Cumpleaños', charge: true });
    await saveBooking({ unitId: UB[2].id, areaId: 'parrillera', date: dayKey(addDays(new Date(), 9)), from: '12:00', to: '18:00', guests: 12, charge: false });
  } catch (e) { console.warn('[demo] comunidad', e); }

  // 9) Bandeja del portal: pagos reportados, solicitudes y una reserva por aprobar
  try {
    const b = store.batch();
    const inbox = (u, type, data, minsAgo) => b.set(store.newInboxRef(), { tenantId: store.tenantId, code: u.portalCode || '', unitId: u.id, unitCode: u.code, buildingId: u.buildingId, type, status: 'nueva', name: u.ownerName || '', createdAt: new Date(Date.now() - minsAgo * 60000).toISOString(), ...data });
    const pend = ALL.map((u) => store.unit(u.id)).filter((u) => !DEBTOR.has(idx(u)) && (u.billed - (u.paid || 0)) > 1);
    pend.slice(0, 3).forEach((u, i) => { const amt = round2(u.billed - u.paid); inbox(u, 'pago', { amount: amt, amountBs: rate ? round2(amt * rate) : null, rate: rate || null, method: rate ? 'pagomovil' : 'transferencia', date: todayKey(), bank: ['Banesco', 'Mercantil', 'Venezuela'][i], reference: String(40000000 + Math.floor(R() * 9999999)), phone: u.ownerPhone || '', note: i === 0 ? `Pago de ${periodName(P[2]).toLowerCase()}` : '' }, 20 + i * 95); });
    inbox(UA[9], 'solicitud', { category: 'mantenimiento', text: 'La luz del pasillo del piso 3 no enciende desde anoche.', phone: UA[9].ownerPhone }, 45);
    inbox(UA[14], 'solicitud', { category: 'ruido', text: 'Hay mucho ruido en el apartamento de arriba después de las 11 pm los fines de semana.', phone: UA[14].ownerPhone }, 300);
    inbox(UB[7], 'solicitud', { category: 'seguridad', text: 'El portón del estacionamiento tarda en cerrar y queda abierto.', phone: UB[7].ownerPhone, status: 'en_proceso', reply: 'El técnico viene el jueves en la mañana.' }, 1800);
    inbox(UA[1], 'solicitud', { category: 'mantenimiento', text: 'Filtración en el techo del estacionamiento, puesto P-12.', status: 'resuelta', reply: 'Reparado el 05/11. ¡Gracias por avisar!' }, 9000);
    inbox(UA[19], 'reserva', { areaId: 'parrillera', areaName: 'Parrillera', date: dayKey(addDays(new Date(), 6)), from: '13:00', to: '19:00', guests: 15, note: 'Reunión familiar', phone: UA[19].ownerPhone }, 130);
    await store.commit(b);
  } catch (e) { console.warn('[demo] bandeja', e); }
}

/** Borra todos los datos de una cuenta: sus portales públicos, su bandeja y sus colecciones. */
export async function purgeTenant(tenantId, onlyDemo = true, codes = null) {
  try {
    let list = codes;
    if (!list) { const snap = await getDocs(collection(db, 'tenants', tenantId, 'units')); list = snap.docs.map((d) => d.data().portalCode).filter(Boolean); }
    for (let i = 0; i < list.length; i += 80) {
      const b = writeBatch(db);
      list.slice(i, i + 80).forEach((c) => b.delete(doc(db, 'portals', c)));
      await b.commit().catch((e) => console.warn('[purge] portales', e?.code || e));
    }
  } catch (e) { console.warn('[purge] portales', e?.code || e); }
  try {
    const rq = await getDocs(query(collection(db, 'inbox'), where('tenantId', '==', tenantId)));
    for (let i = 0; i < rq.docs.length; i += 80) { const b = writeBatch(db); rq.docs.slice(i, i + 80).forEach((d) => b.delete(d.ref)); await b.commit(); }
  } catch (e) { console.warn('[purge] bandeja', e?.code || e); }
  for (const c of DATA_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, 'tenants', tenantId, c));
      for (let i = 0; i < snap.docs.length; i += 80) {
        const b = writeBatch(db);
        snap.docs.slice(i, i + 80).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    } catch (e) { console.warn('[purge]', c, e?.code || e); }
  }
  if (onlyDemo) {
    try {
      const t = await getDoc(doc(db, 'tenants', tenantId));
      if (t.exists() && t.data().demo === true) { const b = writeBatch(db); b.delete(t.ref); await b.commit(); }
    } catch (e) { console.warn('[purge] cuenta', e?.code || e); }
  }
}

/** Borra la demo actual y la cuenta anónima. */
export async function cleanupDemo(tenantId, codes = null) {
  await purgeTenant(tenantId, true, codes && codes.length ? codes : null);
  const u = auth.currentUser;
  if (u && u.isAnonymous) {
    try { await u.delete(); } catch (_) { await signOut(auth).catch(() => {}); }
  }
}
