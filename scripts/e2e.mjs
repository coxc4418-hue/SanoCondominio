// SanoCondominio — Prueba de punta a punta contra los emuladores (datos creados por test-emu.sh)
// Uso: node e2e.mjs [url=http://127.0.0.1:5171] [carpeta de capturas]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5171';
const BASE = ORIGIN + '/?emu=1';
const OUT = path.resolve(here, process.argv[3] || 'shots');
mkdirSync(OUT, { recursive: true });
const acc = JSON.parse(readFileSync(path.join(here, '.accounts-emu.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; let passed = 0;
const ok = (name, cond, extra = '') => { console.log(cond ? '  ✔' : '  ✘', name, extra); if (cond) passed++; else fails++; };
const errs = [];
const logs = [];
const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
async function newPage(w = 1366, h = 860) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errs.push(`${e.message} @ ${(e.stack || '').split(String.fromCharCode(10)).slice(1, 3).join(' ').trim()}`));
  p.on('dialog', (d) => d.accept());
  p.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) logs.push(m.text()); });
  return { ctx, p };
}
// Ejecuta una función con acceso a los módulos de la app
const run = (p, fn, arg = null) => p.evaluate(async (src, a) => {
  const M = { store: (await import('/js/store.js')).store, ops: await import('/js/ops.js'), utils: await import('/js/utils.js'), condo: await import('/js/condo.js'), f: await import('/js/firebase.js') };
  M.wait = async (f, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return f(); };
  return (0, eval)(src)(M, a);
}, fn.toString(), arg);
const go = async (p, route) => { await p.evaluate((r) => { location.hash = '#/' + r; }, route); await sleep(1100); };
const text = (p) => p.evaluate(() => document.body.innerText);
const lastModalBtn = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(`.modal ${s}`)].pop()?.click(), sel);
const maybePin = async (p, value = acc.sede01.pin) => {
  const h = await p.waitForSelector('.modal [data-pin]', { timeout: 2500 }).catch(() => null);
  if (!h) return;
  await p.type('.modal [data-pin]', value);
  await lastModalBtn(p, '[data-ok]');
  await sleep(900);
};
const pickCountry = async (p, code) => {
  await p.waitForSelector(`.country-grid [data-c="${code}"]`, { timeout: 60000 });
  await p.click(`.country-grid [data-c="${code}"]`); await sleep(250);
  await lastModalBtn(p, '[data-ok]');
  await sleep(1500);
};

try {
  // ==================================================================
  console.log('1) Inicio de sesión, país y primer edificio');
  let { ctx, p } = await newPage();
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.screenshot({ path: path.join(OUT, '01-login.png') });
  await p.type('#lg-user', 'sede01'); await p.type('#lg-pass', acc.sede01.password); await p.click('#lg-btn');
  await pickCountry(p, 'VE');
  await p.waitForSelector('.modal [name="floors"]', { timeout: 30000 });
  await p.screenshot({ path: path.join(OUT, '02-asistente-edificio.png') });
  await p.type('.modal [name="name"]', 'Residencias Las Acacias');
  await p.type('.modal [name="floors"]', '4'); await p.type('.modal [name="per"]', '4');
  await lastModalBtn(p, '[data-ok]');
  await p.waitForSelector('.sb-nav', { timeout: 30000 });
  const r1 = await run(p, async ({ store, wait, condo }) => { await wait(() => store.units.length >= 16); return { c: store.settings.country, b: store.buildings.length, u: store.units.length, sum: condo.aliquotSum(store.units), codes: store.units.map((u) => u.code).sort().slice(0, 3).join(',') }; });
  ok('sede01 entra y elige Venezuela', r1.c === 'VE');
  ok('El asistente crea el edificio con 16 unidades', r1.b === 1 && r1.u === 16, r1.codes);
  ok('Las alícuotas suman 100 %', near(r1.sum, 100, 0.01), String(r1.sum));
  await p.evaluate(async () => (await import('/js/tour.js')).stopTour());

  // ==================================================================
  console.log('2) Configuración, propietarios y saldo inicial');
  const r2 = await run(p, async ({ store, ops, wait }) => {
    await store.saveSettings({ businessName: 'Junta Res. Las Acacias', reservePct: 10, adminFee: { mode: 'pct', value: 10 }, lateFee: { enabled: true, pct: 2 }, fx: { enabled: true, sym: 'Bs', name: 'Bolívares', rate: 40, updatedAt: new Date().toISOString() },
      banks: [{ id: 'k1', type: 'pagomovil', bank: 'Banesco', phone: '04141234567', idDoc: 'J-1234', holder: 'Condominio', active: true }] });
    const b = store.buildings[0];
    const rows = store.unitsOf(b.id).map((u, i) => ({ code: u.code, ownerName: `Propietario ${i + 1}`, ownerPhone: `0414${String(1000000 + i)}`, aliquot: i === 0 ? 7.5 : (100 - 7.5) / 15 }));
    await ops.importUnits(b.id, rows);
    await wait(() => store.unitsOf(b.id)[0]?.ownerName);
    const u = store.unitsOf(b.id).find((x) => x.code === '4-D');
    await ops.setOpeningBalance(u, 30, 'Deuda anterior');
    await wait(() => store.unit(u.id).billed === 30);
    return { owners: store.liveUnits.filter((x) => x.ownerName).length, bal: store.unit(u.id).billed, rate: store.settings.fx.rate };
  });
  ok('Propietarios importados', r2.owners === 16);
  ok('Saldo inicial cargado a una unidad', r2.bal === 30);
  await go(p, 'unidades'); await p.screenshot({ path: path.join(OUT, '03-unidades.png') });

  // ==================================================================
  console.log('3) Gastos del mes (formulario) y emisión de recibos');
  await go(p, 'gastos');
  await p.click('#x-new'); await p.waitForSelector('.modal .cat-grid');
  await p.click('.modal [data-cat="vigilancia"]');
  await p.type('.modal [name="concept"]', 'Vigilancia del mes');
  await p.type('.modal [name="amount"]', '800');
  await p.screenshot({ path: path.join(OUT, '04-gasto-form.png') });
  await lastModalBtn(p, '[data-ok]'); await sleep(1200);
  const r3 = await run(p, async ({ store, ops, condo, wait }) => {
    const b = store.buildings[0].id; const p0 = condo.currentPeriod();
    await ops.saveExpense({ buildingId: b, period: p0, category: 'agua', concept: 'Hidrocapital', amount: 200 });
    await ops.saveExpense({ buildingId: b, period: p0, category: 'mantenimiento', concept: 'Reparación puerta del 1-A', amount: 50, type: 'no_comun', unitIds: [store.unitsOf(b).find((u) => u.code === '1-A').id] });
    await ops.saveCharge({ buildingId: b, period: p0, concept: 'Cuota especial pintura', amount: 160, mode: 'alicuota', fund: 'Pintura' });
    await wait(() => store.expensesOf(b, p0).length >= 3 && store.chargesOf(b, p0).length >= 1);
    const pv = ops.previewBilling(b, p0);
    return { n: store.expensesOf(b, p0).length, s: pv.summary, sumR: pv.receipts.reduce((a, r) => a + r.total, 0) };
  });
  // común 1000 + 10 % honorarios = 1100; reserva 10 % de la base = 110 → 1210 a distribuir + 50 no común + 160 cuota
  ok('Gastos cargados desde el formulario y por código', r3.n === 3);
  ok('Cálculo: comunes, honorarios y reserva', near(r3.s.common, 1000) && near(r3.s.adminFee, 100) && near(r3.s.reserve, 110) && near(r3.s.toDistribute, 1210), JSON.stringify({ c: r3.s.common, a: r3.s.adminFee, r: r3.s.reserve, d: r3.s.toDistribute }));
  ok('No comunes y cuota especial exacta (sin mora: el saldo aún no vence)', near(r3.s.nonCommon, 50) && near(r3.s.special, 160, 0.001) && near(r3.s.mora, 0), JSON.stringify({ n: r3.s.nonCommon, s: r3.s.special, m: r3.s.mora }));
  ok('La suma de los recibos cuadra al céntimo', near(r3.sumR, r3.s.totalBilled, 0.001) && near(r3.s.totalBilled, 1420, 0.001), `${r3.sumR} / ${r3.s.totalBilled}`);
  await go(p, 'recibos'); await sleep(600);
  await p.screenshot({ path: path.join(OUT, '05-recibos-vista-previa.png') });
  await p.click('#b-emit'); await maybePin(p);
  await p.waitForSelector('.modal [data-yes]', { timeout: 8000 }); await lastModalBtn(p, '[data-yes]');
  const r3b = await run(p, async ({ store, condo, wait }) => {
    const b = store.buildings[0].id; const p0 = condo.currentPeriod();
    const cl = await wait(() => store.closing(b, p0), 15000);
    await wait(() => store.unitsOf(b).every((u) => (u.ledger || []).some((x) => x.p === p0)), 10000);
    const billed = store.unitsOf(b).reduce((a, u) => a + u.billed, 0);
    const recs = await store.periodReceipts(b, p0);
    return { cl: !!cl, total: cl?.totalBilled, billed, recs: recs.length, reserva: store.fundBalance(b, 'reserva'), pintura: store.fundBalance(b, 'Pintura') };
  });
  ok('Recibos emitidos desde la pantalla (PIN + confirmar)', r3b.cl && r3b.recs === 16, `${r3b.recs} recibos`);
  ok('La deuda de las unidades = saldo inicial + emisión', near(r3b.billed, 30 + r3b.total, 0.05), `${r3b.billed}`);
  ok('Fondo de reserva y fondo de la cuota especial acreditados', near(r3b.reserva, 110, 0.001) && near(r3b.pintura, 160, 0.001), `${r3b.reserva} / ${r3b.pintura}`);
  await sleep(800); await p.screenshot({ path: path.join(OUT, '06-recibos-emitidos.png') });
  await p.evaluate(() => document.querySelectorAll('.modal [data-close]').forEach((b) => b.click()));
  const r3c = await run(p, async ({ store, ops, condo }) => { try { await ops.saveExpense({ buildingId: store.buildings[0].id, period: condo.currentPeriod(), category: 'otros', concept: 'tarde', amount: 5 }); return 'pasó'; } catch (e) { return e.message; } });
  ok('No deja cargar gastos en un mes ya emitido', /ya se emitieron/.test(r3c), r3c);

  // ==================================================================
  console.log('4) Cobranza: pagos, abonos, saldo a favor y Bs');
  const r4 = await run(p, async ({ store, ops, condo, wait }) => {
    const b = store.buildings[0].id;
    const U = (c) => store.unitsOf(b).find((u) => u.code === c);
    const a = U('2-A'); const owe = condo.unitBalance(a);
    await ops.registerPayment({ unitId: a.id, amount: owe, method: 'pagomovil', reference: '123456', amountBs: owe * 40, rate: 40 });
    const half = U('2-B'); const oweH = condo.unitBalance(half);
    await ops.registerPayment({ unitId: half.id, amount: Math.round(oweH / 2 * 100) / 100, method: 'transferencia', reference: '777' });
    const d = U('4-D'); const oweD = condo.unitBalance(d);
    await ops.registerPayment({ unitId: d.id, amount: 30, method: 'efectivo' });
    const c = U('3-C'); const oweC = condo.unitBalance(c);
    await ops.registerPayment({ unitId: c.id, amount: oweC + 20, method: 'zelle', reference: 'ZL1' });
    await wait(() => store.unit(c.id).paid > 0 && store.unit(d.id).paid > 0, 8000);
    let dup = 'no';
    try { await ops.registerPayment({ unitId: a.id, amount: owe, method: 'pagomovil', reference: '123456' }); } catch (e) { dup = e.message; }
    const st = (u) => condo.ledgerStatus(store.unit(u.id)).map((x) => x.status).join(',');
    return { aBal: condo.unitBalance(store.unit(a.id)), aSolv: condo.isSolvent(store.unit(a.id)), hSt: st(half), dSt: st(d), dBal: condo.unitBalance(store.unit(d.id)), dOwe: oweD, cBal: condo.unitBalance(store.unit(c.id)), dup, pays: store.payments.length };
  });
  ok('Pago completo deja la unidad solvente', near(r4.aBal, 0) && r4.aSolv);
  ok('Abono parcial marca el recibo como abonado', /parcial/.test(r4.hSt), r4.hSt);
  ok('El pago se aplica primero a la deuda más vieja', /^pagado/.test(r4.dSt) && near(r4.dBal, r4.dOwe - 30), r4.dSt);
  ok('Pago de más queda como saldo a favor', near(r4.cBal, -20), String(r4.cBal));
  ok('Detecta referencia duplicada', /duplicado|referencia/.test(r4.dup), r4.dup);
  await go(p, 'cobranza'); await sleep(500); await p.screenshot({ path: path.join(OUT, '07-cobranza.png') });

  // ==================================================================
  console.log('5) Portal del propietario (página pública, sin sesión)');
  const info = await run(p, async ({ store, ops, wait }) => {
    const b = store.buildings[0].id;
    const v = await ops.saveVote({ buildingId: b, title: '¿Aprueban cambiar la bomba?', options: ['Sí', 'No'], weight: 'alicuota' });
    await wait(() => store.votes.length);
    await ops.saveNotice({ title: 'Corte de agua el sábado', body: 'De 8 a 12', kind: 'mantenimiento', pinned: true });
    ops.resetPublished();
    const n = await ops.publishPortals();
    const u = store.unitsOf(b).find((x) => x.code === '2-B');
    const u2 = store.unitsOf(b).find((x) => x.code === '2-A');
    return { n, code: u.portalCode, code2: u2.portalCode, unitId: u.id, tenantId: store.tenantId, vote: v.id, other: store.unitsOf(b).find((x) => x.code === '1-B').id };
  });
  ok('Portales publicados', info.n >= 16, `${info.n}`);
  const { ctx: c2, p: q } = await newPage(390, 844);
  await q.goto(`${ORIGIN}/portal/${info.code}?emu=1`, { waitUntil: 'networkidle2' });
  await q.waitForSelector('.portal-hero', { timeout: 20000 });
  const pt = await text(q);
  ok('El portal muestra la unidad, su deuda y el aviso fijado', pt.includes('2-B') && pt.includes('Saldo pendiente') && pt.includes('Corte de agua'));
  ok('El portal NO muestra datos de otras unidades', !pt.includes('Propietario 1 ') && !pt.includes('2-A'));
  await q.screenshot({ path: path.join(OUT, '10-portal.png'), fullPage: true });
  await q.click('[data-tab="pagar"]'); await sleep(400);
  await q.type('#f-pay [name="reference"]', '99887766'); await q.type('#f-pay [name="bank"]', 'Mercantil');
  await q.screenshot({ path: path.join(OUT, '11-portal-pagar.png'), fullPage: true });
  await q.click('#f-pay button.btn-lg'); await q.waitForSelector('.portal-done', { timeout: 15000 });
  ok('El propietario reporta su pago desde el portal', true);
  await q.click('[data-tab="solicitud"]'); await sleep(300);
  await q.type('#f-req [name="text"]', 'Se fue la luz del pasillo del piso 2');
  await q.click('#f-req button.btn-primary'); await q.waitForSelector('.portal-done', { timeout: 15000 });
  await q.click('[data-tab="votar"]'); await sleep(300);
  await q.click('.portal-opt'); await sleep(1500);
  await q.click('[data-tab="reservar"]'); await sleep(300);
  await q.evaluate(() => { const d = new Date(Date.now() + 5 * 864e5); document.querySelector('#f-bk [name="date"]').value = d.toISOString().slice(0, 10); });
  await q.click('#f-bk button.btn-primary'); await q.waitForSelector('.portal-done', { timeout: 15000 });
  ok('Solicitud, voto y reserva enviados desde el portal', true);
  // Seguridad: un portal no puede escribir a nombre de otra unidad ni con un código falso
  const hack = await q.evaluate(async (i) => {
    const f = await import('/js/firebase.js');
    const tryW = async (data) => { try { await f.setDoc(f.doc(f.collection(f.db, 'inbox')), data); return 'ok'; } catch (e) { return e.code || e.message; } };
    const base = { tenantId: i.tenantId, code: i.code, unitCode: 'X', buildingId: '', type: 'solicitud', status: 'nueva', createdAt: new Date().toISOString(), text: 'hola mundo', category: 'otro' };
    const readP = async () => { try { await f.getDocs(f.collection(f.db, 'portals')); return 'ok'; } catch (e) { return e.code; } };
    const readT = async () => { try { await f.getDocs(f.collection(f.db, 'tenants', i.tenantId, 'units')); return 'ok'; } catch (e) { return e.code; } };
    return { otherUnit: await tryW({ ...base, unitId: i.other }), fakeCode: await tryW({ ...base, unitId: i.unitId, code: 'ZZZZZZZZ' }), procesada: await tryW({ ...base, unitId: i.unitId, status: 'procesada' }), listPortals: await readP(), readUnits: await readT() };
  }, info);
  ok('Reglas: no se puede escribir por otra unidad / código falso / estado', hack.otherUnit !== 'ok' && hack.fakeCode !== 'ok' && hack.procesada !== 'ok', JSON.stringify(hack));
  ok('Reglas: no se pueden listar portales ni leer datos de la administración', hack.listPortals !== 'ok' && hack.readUnits !== 'ok');
  const bad = await (async () => { const { ctx: c3, p: z } = await newPage(390, 844); await z.goto(`${ORIGIN}/portal/NOEXISTE?emu=1`, { waitUntil: 'networkidle2' }); await z.waitForSelector('.portal-err', { timeout: 15000 }).catch(() => null); const t = await text(z); await c3.close(); return t; })();
  ok('Código inexistente muestra "Portal no encontrado"', bad.includes('Portal no encontrado'));

  // ==================================================================
  console.log('6) La administración procesa la bandeja');
  const r6 = await run(p, async ({ store, ops, wait }) => {
    await wait(() => store.inbox.length >= 4, 10000);
    const rep = store.reportedPayments[0];
    await ops.registerPayment({ unitId: rep.unitId, amount: rep.amount, method: rep.method, reference: rep.reference, bank: rep.bank, inboxId: rep.id });
    await ops.processInboxVotes();
    const req = store.inboxOf('solicitud')[0];
    await ops.setInbox(req, { status: 'en_proceso', reply: 'El electricista viene mañana' });
    const bk = store.bookingRequests[0];
    let booking = null; try { booking = await ops.saveBooking({ unitId: bk.unitId, areaId: bk.areaId, date: bk.date, from: bk.from, to: bk.to, inboxId: bk.id, charge: true }); } catch (e) { booking = e.message; }
    await wait(() => store.inbox.find((x) => x.id === rep.id)?.status === 'procesada', 6000);
    const v = store.votes[0];
    await wait(() => Object.keys(store.votes[0].ballots || {}).length, 6000);
    const res = ops.voteResults(store.votes[0]);
    const u = store.unit(rep.unitId);
    ops.resetPublished(); await ops.publishPortals();
    return { inbox: store.inbox.length, repSt: store.inbox.find((x) => x.id === rep.id)?.status, ballots: Object.keys(store.votes[0].ballots || {}).length, quorum: res.quorum, booking: typeof booking === 'string' ? booking : 'ok', bal: u.billed - u.paid, vid: v.id };
  });
  ok('Llegan pago reportado, solicitud, voto y reserva', r6.inbox >= 4, `${r6.inbox}`);
  ok('Confirmar el pago reportado lo marca procesado', r6.repSt === 'procesada');
  ok('El voto del portal se cuenta (ponderado por alícuota)', r6.ballots === 1 && r6.quorum > 0, `quórum ${r6.quorum}`);
  ok('Reserva aprobada con su cargo', r6.booking === 'ok', r6.booking);
  await sleep(1500);
  await q.reload({ waitUntil: 'networkidle2' }); await q.waitForSelector('.portal-hero');
  const pt2 = await text(q);
  ok('El portal refleja el pago confirmado y la respuesta', pt2.includes('Confirmado') || pt2.includes('Pagado'));
  await q.click('[data-tab="solicitud"]'); await sleep(300);
  ok('El propietario ve la respuesta a su solicitud', (await text(q)).includes('El electricista viene mañana'));
  await c2.close();
  for (const v of ['solicitudes', 'reservas', 'asambleas', 'comunicados']) { await go(p, v); await sleep(400); await p.screenshot({ path: path.join(OUT, `12-${v}.png`) }); }

  // ==================================================================
  console.log('7) Aislamiento entre sedes');
  const { ctx: c4, p: s2 } = await newPage();
  await s2.goto(BASE, { waitUntil: 'networkidle2' });
  await s2.waitForSelector('#login-form');
  await s2.type('#lg-user', 'sede02'); await s2.type('#lg-pass', acc.sede02.password); await s2.click('#lg-btn');
  await pickCountry(s2, 'CO');
  await s2.waitForSelector('.modal [name="floors"]', { timeout: 30000 });
  const iso = await s2.evaluate(async (t) => {
    const f = await import('/js/firebase.js');
    const r = async (fn) => { try { await fn(); return 'ok'; } catch (e) { return e.code; } };
    return { units: await r(() => f.getDocs(f.collection(f.db, 'tenants', t, 'units'))), inbox: await r(() => f.getDocs(f.query(f.collection(f.db, 'inbox'), f.where('tenantId', '==', t)))), write: await r(() => f.setDoc(f.doc(f.db, 'tenants', t, 'units', 'x'), { a: 1 })) };
  }, info.tenantId);
  ok('sede02 no puede leer ni escribir datos de sede01', iso.units !== 'ok' && iso.inbox !== 'ok' && iso.write !== 'ok', JSON.stringify(iso));
  await c4.close();

  // ==================================================================
  console.log('8) Anular la emisión y volver a emitir con mora');
  await go(p, 'recibos'); await sleep(500);
  await p.click('#b-annul'); await maybePin(p);
  const yes = await p.waitForSelector('.modal [data-yes]', { timeout: 5000 }).catch(() => null);
  const r8 = await run(p, async ({ store, condo, wait }) => {
    const b = store.buildings[0].id; const p0 = condo.currentPeriod();
    return { b, p0, before: store.unitsOf(b).reduce((a, u) => a + u.billed, 0), pays: store.payments.filter((x) => x.status === 'confirmado').length };
  });
  if (yes) { await lastModalBtn(p, '[data-yes]'); await sleep(2500); }
  const r8b = await run(p, async ({ store, condo, wait }) => {
    const b = store.buildings[0].id; const p0 = condo.currentPeriod();
    await wait(() => store.closing(b, p0)?.status === 'anulado' || !store.closing(b, p0), 6000);
    return { st: store.closing(b, p0)?.status || 'sin', billed: store.unitsOf(b).reduce((a, u) => a + u.billed, 0) };
  });
  // Con pagos ya aplicados la anulación debe bloquearse o revertir limpia; ambos casos válidos si la deuda queda consistente
  ok('Anular: la deuda queda consistente', r8b.st === 'anulado' ? near(r8b.billed, 30 + 0, 1) || r8b.billed < r8.before : near(r8b.billed, r8.before, 0.05), JSON.stringify(r8b));
  await p.evaluate(() => document.querySelectorAll('.modal [data-close], .modal [data-no]').forEach((b) => b.click()));

  // ==================================================================
  console.log('9) Todas las pantallas sin errores (escritorio y teléfono)');
  const b0 = errs.length;
  const views = ['inicio', 'cobranza', 'unidades', 'gastos', 'recibos', 'fondos', 'comunicados', 'solicitudes', 'reservas', 'asambleas', 'ajustes'];
  for (const v of views) { await go(p, v); await p.screenshot({ path: path.join(OUT, `20-${v}.png`) }); }
  await go(p, 'reportes'); await maybePin(p); await sleep(600); await p.screenshot({ path: path.join(OUT, '20-reportes.png') });
  for (const t of ['morosidad', 'gastos', 'pagos', 'solvencias']) { await p.evaluate((x) => document.querySelector(`[data-t="${x}"]`)?.click(), t); await sleep(700); }
  await p.evaluate(async () => (await import('/js/unit.js')).openUnit((await import('/js/store.js')).store.liveUnits[0].id)); await sleep(800);
  await p.screenshot({ path: path.join(OUT, '21-ficha-unidad.png') });
  await p.evaluate(() => document.querySelectorAll('.modal [data-close]').forEach((b) => b.click()));
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  let overflow = [];
  for (const v of views) {
    await go(p, v);
    const w = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (w > 1) overflow.push(`${v}:${w}`);
    await p.screenshot({ path: path.join(OUT, `22-movil-${v}.png`) });
  }
  ok('Pantallas sin errores de JavaScript', errs.length === b0, errs.slice(b0).join(' | '));
  ok('En teléfono nada se sale de la pantalla', !overflow.length, overflow.join(' '));
  await p.setViewport({ width: 1366, height: 860 });
  await ctx.close();

  // ==================================================================
  console.log('10) Demo');
  ({ ctx, p } = await newPage());
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.click('#lg-demo');
  await pickCountry(p, 'VE');
  await p.waitForFunction(() => document.body.innerText.includes('Modo demo') && !document.getElementById('boot'), { timeout: 180000 });
  await sleep(4000);
  const d = await run(p, async ({ store, condo }) => ({
    blds: store.buildings.length, units: store.units.length, closings: store.closings.length, pays: store.payments.length, debtors: store.debtors.length, del: store.delinquent?.length ?? 0,
    sum: condo.aliquotSum(store.unitsOf(store.buildings[0].id)), inbox: store.inbox.length, reported: store.reportedPayments.length, votes: store.votes.length, notices: store.notices.length, bookings: store.bookings.length,
    reserva: store.fundBalance(store.buildings[0].id, 'reserva'), cur: store.settings.currency, consistent: store.units.every((u) => Math.abs((u.ledger || []).reduce((a, x) => a + x.t, 0) - u.billed) < 0.05)
  }));
  ok('Demo: 2 edificios, 36 unidades, 3 meses emitidos', d.blds === 2 && d.units === 36 && d.closings === 6, JSON.stringify({ b: d.blds, u: d.units, c: d.closings }));
  ok('Demo: pagos, morosos, bandeja, votación, avisos y reservas', d.pays >= 50 && d.debtors >= 5 && d.reported >= 3 && d.votes === 1 && d.notices >= 3 && d.bookings >= 2, JSON.stringify(d));
  ok('Demo: libro de cada unidad consistente y alícuotas al 100 %', d.consistent && near(d.sum, 100, 0.01));
  ok('Recorrido guiado abierto al entrar', !!(await p.waitForSelector('.tour-tip', { timeout: 20000 }).catch(() => null)));
  await p.screenshot({ path: path.join(OUT, '30-demo-tour.png') });
  await p.evaluate(async () => (await import('/js/tour.js')).stopTour());
  const b2 = errs.length;
  for (const v of views) { await go(p, v); await sleep(300); await p.screenshot({ path: path.join(OUT, `31-demo-${v}.png`) }); }
  ok('Pantallas de la demo sin errores', errs.length === b2, errs.slice(b2).join(' | '));
  await sleep(4000);
  const codes = await run(p, ({ store }) => store.units.map((u) => u.portalCode));
  const pubd = await p.evaluate(async (c) => { const f = await import('/js/firebase.js'); return (await f.getDoc(f.doc(f.db, 'portals', c))).exists(); }, codes[0]);
  ok('La demo publica los portales', pubd);
  const uid = await p.evaluate(async () => (await import('/js/firebase.js')).auth.currentUser.uid);
  await p.evaluate(() => document.getElementById('demo-end').click());
  await p.waitForSelector('.modal [data-yes]'); await p.click('.modal [data-yes]');
  await p.waitForSelector('#login-form', { timeout: 90000 }).catch(async (e) => { await p.screenshot({ path: path.join(OUT, '39-demo-fin.png') }); console.log('LOGS', logs.slice(-15).join(' || ')); throw e; });
  ok('Terminar la demo vuelve al login', true);
  await ctx.close();

  // ==================================================================
  console.log('11) Administrador general');
  ({ ctx, p } = await newPage());
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.type('#lg-user', 'admin'); await p.type('#lg-pass', acc.admin.password); await p.click('#lg-btn');
  await p.waitForSelector('[data-enter]', { timeout: 30000 }); await sleep(2000);
  ok('Admin ve las sedes', (await p.$$('[data-enter]')).length === 3);
  await p.screenshot({ path: path.join(OUT, '40-admin.png') });
  const gone = await p.evaluate(async (u, cs) => {
    const f = await import('/js/firebase.js');
    const t = await f.getDoc(f.doc(f.db, 'tenants', u)); const c = await f.getDoc(f.doc(f.db, 'portals', cs[0]));
    const ib = await f.getDocs(f.query(f.collection(f.db, 'inbox'), f.where('tenantId', '==', u)));
    return !t.exists() && !c.exists() && ib.empty;
  }, uid, codes);
  ok('La demo, sus portales y su bandeja se borraron', gone);
  await ctx.close();
} catch (e) { console.log('ERROR', e.stack || e.message); fails++; }
await browser.close();
console.log('Errores de página:', errs.length ? errs.join(' | ') : 'ninguno');
console.log(`${passed} OK · ${fails} fallas`);
process.exit(fails ? 1 : 0);
