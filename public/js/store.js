// SanoCondominio — Capa de datos (Firestore en tiempo real + caché offline)
import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, where, writeBatch, increment
} from './firebase.js';
import { sha256, toast, todayKey, dayKey, addDays, applyLocale, setFx, fromKey, round2 } from './utils.js';
import { EXPENSE_CATEGORIES, AREAS_DEFAULT, unitBalance, monthsOwed, currentPeriod, addMonths, isSolvent } from './condo.js';

export const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);

const DEFAULT_SETTINGS = {
  businessName: '', rif: '', phone: '', whatsapp: '', email: '', address: '', manager: '',
  country: '', currency: '', fx: { enabled: false, sym: 'Bs', name: 'Bolívares', rate: 0, updatedAt: '' },
  reservePct: 10,
  adminFee: { mode: 'pct', value: 0 },
  lateFee: { enabled: false, pct: 1 },
  dueDays: 15,
  categories: EXPENSE_CATEGORIES,
  areas: AREAS_DEFAULT,
  banks: [],
  receiptNote: 'Pague a tiempo y mantenga su inmueble solvente. Reporte su pago desde el portal del propietario.',
  portal: { enabled: true, reports: true, expenses: true, requests: true, bookings: true },
  invoicePrefix: 'R'
};

class Store {
  constructor() {
    this.tenantId = null; this.tenant = null;
    this.settings = { ...DEFAULT_SETTINGS }; this.security = {}; this.counters = {}; this.announcement = null;
    this.buildings = []; this.units = []; this.expenses = []; this.payments = []; this.closings = []; this.charges = [];
    this.notices = []; this.votes = []; this.bookings = []; this.suppliers = []; this.funds = []; this.inbox = [];
    this.ready = false; this._unsubs = []; this._listeners = {}; this._loaded = new Set();
    this.building = ''; // edificio elegido para trabajar ('' = todos)
  }

  on(evt, fn) { (this._listeners[evt] ||= new Set()).add(fn); return () => this._listeners[evt].delete(fn); }
  emit(evt, data) {
    (this._listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
    (this._listeners['*'] || []).forEach((fn) => { try { fn(evt); } catch (e) { console.error(e); } });
  }

  col(name) { return collection(db, 'tenants', this.tenantId, name); }
  ref(name, id) { return doc(db, 'tenants', this.tenantId, name, String(id)); }
  newRef(name) { return doc(this.col(name)); }
  tenantRef(id = this.tenantId) { return doc(db, 'tenants', id); }
  portalRef(code) { return doc(db, 'portals', String(code)); }
  inboxRef(id) { return doc(db, 'inbox', String(id)); }
  newInboxRef() { return doc(collection(db, 'inbox')); }
  batch() { return writeBatch(db); }
  get isDemo() { return this.tenant?.demo === true; }
  inc(n) { return increment(n); }

  /** La caché local aplica el cambio al instante (también sin internet); se espera al servidor como máximo unos segundos. */
  async commit(batch) {
    const p = batch.commit();
    p.catch((err) => {
      console.error('[store] commit', err);
      toast(err?.code === 'permission-denied' ? 'Sin permiso para guardar. Verifica que la cuenta esté activa.' : 'No se pudo sincronizar un cambio: ' + (err?.message || err), 'danger', 5000);
    });
    if (!navigator.onLine) return;
    await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 3500))]);
  }
  async save(name, id, data, merge = true) { const b = this.batch(); b.set(this.ref(name, id), data, { merge }); await this.commit(b); }
  async remove(name, id) { const b = this.batch(); b.delete(this.ref(name, id)); await this.commit(b); }

  async start(tenantId) {
    this.stop();
    this.tenantId = tenantId;
    this._loaded = new Set();
    try { this.building = localStorage.getItem('sc_bld_' + tenantId) || ''; } catch (_) { this.building = ''; }
    const need = ['tenant', 'settings', 'buildings', 'units', 'payments', 'expenses'];
    let resolveReady;
    const readyP = new Promise((r) => { resolveReady = r; });
    const mark = (k) => { this._loaded.add(k); if (need.every((x) => this._loaded.has(x))) resolveReady(); };
    const fail = (k) => (err) => { console.error('[store]', k, err); mark(k); if (err?.code === 'permission-denied') this.emit('denied', err); };
    const listen = (q, k, fn) => this._unsubs.push(onSnapshot(q, (s) => { fn(s); mark(k); this.emit(k); this.emit('change', k); }, fail(k)));
    const rows = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'es', { numeric: true });
    const byCode = (a, b) => (a.code || '').localeCompare(b.code || '', 'es', { numeric: true });

    listen(this.tenantRef(), 'tenant', (s) => { this.tenant = s.exists() ? { id: s.id, ...s.data() } : null; });
    listen(this.ref('config', 'settings'), 'settings', (s) => {
      this.settings = { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
      applyLocale(this.settings.country || 'VE', this.settings.currency);
      if (!Array.isArray(this.settings.categories) || !this.settings.categories.length) this.settings.categories = EXPENSE_CATEGORIES;
      if (!Array.isArray(this.settings.areas)) this.settings.areas = AREAS_DEFAULT;
      if (!Array.isArray(this.settings.banks)) this.settings.banks = [];
      for (const k of ['portal', 'fx', 'adminFee', 'lateFee']) this.settings[k] = { ...DEFAULT_SETTINGS[k], ...(this.settings[k] || {}) };
      setFx(this.settings.fx);
    });
    this._unsubs.push(onSnapshot(this.ref('config', 'security'), (s) => { this.security = s.exists() ? s.data() : {}; }, () => {}));
    this._unsubs.push(onSnapshot(this.ref('config', 'counters'), (s) => { this.counters = s.exists() ? s.data() : {}; }, () => {}));
    this._unsubs.push(onSnapshot(doc(db, 'system', 'announcement'), (s) => { this.announcement = s.exists() ? s.data() : null; this.emit('announcement'); }, () => {}));
    listen(this.col('buildings'), 'buildings', (s) => {
      this.buildings = rows(s).sort(byName);
      if (this.building && !this.buildings.some((b) => b.id === this.building)) this.building = '';
    });
    listen(this.col('units'), 'units', (s) => { this.units = rows(s).sort(byCode); this._uMap = null; });
    const since = addMonths(currentPeriod(), -12);
    listen(query(this.col('expenses'), where('period', '>=', since)), 'expenses', (s) => {
      this.expenses = rows(s).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    });
    const paySince = dayKey(addDays(new Date(), -190));
    listen(query(this.col('payments'), where('date', '>=', paySince)), 'payments', (s) => {
      this.payments = rows(s).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
    });
    const sub = (name, key, sort) => this._unsubs.push(onSnapshot(this.col(name), (s) => { this[key] = rows(s).sort(sort); this.emit(key); this.emit('change', key); }, (e) => console.warn('[store]', name, e?.code || e)));
    sub('closings', 'closings', (a, b) => (b.period || '').localeCompare(a.period || ''));
    sub('charges', 'charges', (a, b) => (b.period || '').localeCompare(a.period || ''));
    sub('notices', 'notices', (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.date || '').localeCompare(a.date || ''));
    sub('votes', 'votes', (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    sub('bookings', 'bookings', (a, b) => (a.date || '').localeCompare(b.date || '') || (a.from || '').localeCompare(b.from || ''));
    sub('suppliers', 'suppliers', byName);
    sub('funds', 'funds', (a, b) => (b.date || '').localeCompare(a.date || ''));
    // Buzón público: pagos reportados, solicitudes, votos y reservas desde el portal del propietario
    this._unsubs.push(onSnapshot(query(collection(db, 'inbox'), where('tenantId', '==', tenantId)), (s) => {
      this.inbox = rows(s).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      this.emit('inbox');
    }, (e) => console.warn('[store] inbox', e?.code || e)));

    await Promise.race([readyP, new Promise((r) => setTimeout(r, 8000))]);
    this.ready = true;
  }

  stop() {
    this._unsubs.forEach((u) => { try { u(); } catch (_) {} });
    this._unsubs = []; this.ready = false;
    this.tenant = null; this.buildings = []; this.units = []; this.expenses = []; this.payments = []; this.closings = []; this.charges = [];
    this.notices = []; this.votes = []; this.bookings = []; this.suppliers = []; this.funds = []; this.inbox = [];
    this.settings = { ...DEFAULT_SETTINGS }; this.security = {}; this.counters = {}; this._uMap = null;
  }

  // ---------- Ajustes ----------
  get country() { return this.settings.country || ''; }
  get businessName() { return this.settings.businessName || this.tenant?.name || 'Mi condominio'; }
  get categories() { return this.settings.categories || EXPENSE_CATEGORIES; }
  get areas() { return (this.settings.areas || []).filter((a) => a.active !== false); }
  area(id) { return (this.settings.areas || []).find((a) => a.id === id) || null; }
  supplier(id) { return this.suppliers.find((s) => s.id === id) || null; }

  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    if (patch.fx) setFx(this.settings.fx);
    await this.save('config', 'settings', patch, true);
    this.emit('settings');
  }
  async setCountry(code, currency = null) {
    const l = applyLocale(code, currency);
    await this.saveSettings({ country: code, currency: l.cur, countrySetAt: new Date().toISOString() });
    this.emit('rate', 1);
  }
  nextSeq(b, key) {
    const n = (Number(this.counters[key]) || 0) + 1;
    this.counters = { ...this.counters, [key]: n };
    b.set(this.ref('config', 'counters'), { [key]: n }, { merge: true });
    return n;
  }

  // ---------- PIN ----------
  hasPin() { return !!this.security.pinHash; }
  async verifyPin(pin) {
    if (!this.security.pinHash) { const s = await getDoc(this.ref('config', 'security')).catch(() => null); if (s?.exists()) this.security = s.data(); }
    if (!this.security.pinHash) return true;
    return (await sha256(`${this.tenantId}:${pin}`)) === this.security.pinHash;
  }
  async setPin(pin) {
    const pinHash = await sha256(`${this.tenantId}:${pin}`);
    this.security = { ...this.security, pinHash, updatedAt: new Date().toISOString() };
    await this.save('config', 'security', this.security, true);
  }

  // ---------- Edificio de trabajo ----------
  setBuilding(id) {
    this.building = id || '';
    try { localStorage.setItem('sc_bld_' + this.tenantId, this.building); } catch (_) {}
    this.emit('building');
  }
  bld(id) { return this.buildings.find((b) => b.id === id) || null; }
  get liveBuildings() { return this.buildings.filter((b) => b.active !== false); }
  /** Edificio actual (o el único que hay) */
  get currentBuilding() { return this.bld(this.building) || (this.liveBuildings.length === 1 ? this.liveBuildings[0] : null); }
  inScope(x) { return !this.building || !x?.buildingId || x.buildingId === this.building; }
  bldName(id) { return this.bld(id)?.name || '—'; }

  // ---------- Unidades ----------
  unit(id) { if (!this._uMap) this._uMap = new Map(this.units.map((u) => [u.id, u])); return this._uMap.get(id); }
  get liveUnits() { return this.units.filter((u) => u.active !== false); }
  get scopeUnits() { return this.liveUnits.filter((u) => this.inScope(u)); }
  unitsOf(buildingId) { return this.liveUnits.filter((u) => u.buildingId === buildingId); }
  get debtors() { return this.scopeUnits.filter((u) => unitBalance(u) > 0.009).sort((a, b) => unitBalance(b) - unitBalance(a)); }
  get delinquent() { return this.scopeUnits.filter((u) => monthsOwed(u) >= 2).sort((a, b) => monthsOwed(b) - monthsOwed(a) || unitBalance(b) - unitBalance(a)); }
  get totalDebt() { return round2(this.debtors.reduce((a, u) => a + unitBalance(u), 0)); }
  get solventPct() { const l = this.scopeUnits; return l.length ? Math.round(l.filter(isSolvent).length / l.length * 100) : 0; }
  findUnit(text) {
    const raw = String(text || '').trim();
    const v = raw.toLowerCase().replace(/\s+/g, '');
    if (!v) return null;
    const url = /\/portal\/([a-z0-9]+)/i.exec(raw);
    if (url) return this.units.find((u) => (u.portalCode || '').toLowerCase() === url[1].toLowerCase()) || null;
    return this.units.find((u) => (u.code || '').toLowerCase().replace(/\s+/g, '') === v)
      || this.units.find((u) => (u.portalCode || '').toLowerCase() === v) || null;
  }

  // ---------- Buzón del portal ----------
  inboxOf(type, status = null) { return this.inbox.filter((x) => x.type === type && (!status || (Array.isArray(status) ? status.includes(x.status) : x.status === status)) && this.inScope(x)); }
  get reportedPayments() { return this.inboxOf('pago', 'nueva'); }
  get openRequests() { return this.inboxOf('solicitud', ['nueva', 'en_proceso']); }
  get newRequests() { return this.inboxOf('solicitud', 'nueva'); }
  get bookingRequests() { return this.inboxOf('reserva', 'nueva'); }

  // ---------- Fondos ----------
  fundBalance(buildingId, fund = 'reserva') {
    return round2(this.funds.filter((f) => (!buildingId || f.buildingId === buildingId) && (f.fund || 'reserva') === fund && f.status !== 'anulado')
      .reduce((a, f) => a + (f.type === 'out' ? -1 : 1) * (Number(f.amount) || 0), 0));
  }
  fundNames(buildingId) { return [...new Set(['reserva', ...this.funds.filter((f) => !buildingId || f.buildingId === buildingId).map((f) => f.fund || 'reserva')])]; }

  // ---------- Período ----------
  closing(buildingId, period) { return this.closings.find((c) => c.buildingId === buildingId && c.period === period && c.status !== 'anulado') || null; }
  expensesOf(buildingId, period) { return this.expenses.filter((e) => e.buildingId === buildingId && e.period === period && e.status !== 'anulado'); }
  chargesOf(buildingId, period) { return this.charges.filter((c) => c.buildingId === buildingId && c.period === period && c.status !== 'anulado'); }
  get confirmedPayments() { return this.payments.filter((p) => p.status === 'confirmado'); }
  collectedIn(period, buildingId = this.building) {
    return round2(this.confirmedPayments.filter((p) => (p.date || '').startsWith(period) && (!buildingId || p.buildingId === buildingId)).reduce((a, p) => a + (Number(p.amount) || 0), 0));
  }
  get upcomingBookings() { const t = todayKey(); return this.bookings.filter((b) => b.date >= t && b.status !== 'cancelada' && this.inScope(b)); }
  get openVotes() { return this.votes.filter((v) => v.status === 'abierta' && this.inScope(v)); }

  // ---------- Consultas ----------
  async listBetween(name, field, from, to) {
    const s = await getDocs(query(this.col(name), where(field, '>=', from), where(field, '<=', to)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async listEq(name, field, value) {
    const s = await getDocs(query(this.col(name), where(field, '==', value)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async listAll(name) { const s = await getDocs(this.col(name)); return s.docs.map((d) => ({ id: d.id, ...d.data() })); }
  async getDocById(name, id) { const s = await getDoc(this.ref(name, id)); return s.exists() ? { id: s.id, ...s.data() } : null; }
  async unitReceipts(unitId) { return (await this.listEq('receipts', 'unitId', unitId)).sort((a, b) => (b.period || '').localeCompare(a.period || '')); }
  async unitPayments(unitId) { return (await this.listEq('payments', 'unitId', unitId)).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
  async periodReceipts(buildingId, period) { return (await this.listEq('receipts', 'closingId', `${buildingId}_${period}`)).sort((a, b) => (a.unitCode || '').localeCompare(b.unitCode || '', 'es', { numeric: true })); }
}

export const store = new Store();

// ---------- Administración de sedes (solo administrador general) ----------
export async function listTenants() {
  const s = await getDocs(collection(db, 'tenants'));
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.code || a.name || '').localeCompare(b.code || b.name || '', 'es', { numeric: true }));
}
export async function updateTenant(id, data) { await setDoc(doc(db, 'tenants', id), data, { merge: true }); }
/** Cobros confirmados de una sede desde una fecha (para el panel del administrador) */
export async function tenantSalesSince(tenantId, fromISO) {
  const s = await getDocs(query(collection(db, 'tenants', tenantId, 'payments'), where('date', '>=', String(fromISO).slice(0, 10))));
  return s.docs.map((d) => d.data()).map((p) => ({ ...p, total: Number(p.amount) || 0, status: p.status === 'confirmado' ? 'ok' : 'voided' }));
}
export async function getTenant(id) { const s = await getDoc(doc(db, 'tenants', id)); return s.exists() ? { id: s.id, ...s.data() } : null; }
export async function createTenantDoc(id, data) { await setDoc(doc(db, 'tenants', id), data); }
export async function getUsername(username) { const s = await getDoc(doc(db, 'usernames', String(username).toLowerCase())); return s.exists() ? s.data() : null; }
export async function setUsername(username, data) { await setDoc(doc(db, 'usernames', String(username).toLowerCase()), data); }
export async function deleteUsername(username) { await deleteDoc(doc(db, 'usernames', String(username).toLowerCase())); }
export async function setAnnouncement(data) { await setDoc(doc(db, 'system', 'announcement'), data); }
export async function getAnnouncement() { const s = await getDoc(doc(db, 'system', 'announcement')); return s.exists() ? s.data() : null; }
/** Portal público del propietario (/portal/CODIGO) */
export async function getPortal(code) { const s = await getDoc(doc(db, 'portals', String(code).toUpperCase())); return s.exists() ? s.data() : null; }
export { DEFAULT_SETTINGS };
