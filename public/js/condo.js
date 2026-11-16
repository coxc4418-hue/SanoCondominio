// SanoCondominio — Reglas del condominio: alícuotas, recibos, mora, solvencia y catálogos
import { round2, todayKey, fromKey, dayKey, addDays } from './utils.js';

// ---------- Catálogos ----------
export const UNIT_TYPES = {
  apartamento: { label: 'Apartamento', icon: 'building' },
  casa: { label: 'Casa', icon: 'home' },
  townhouse: { label: 'Townhouse', icon: 'home' },
  local: { label: 'Local comercial', icon: 'bag' },
  oficina: { label: 'Oficina', icon: 'laptop' },
  estacionamiento: { label: 'Puesto de estacionamiento', icon: 'car' },
  deposito: { label: 'Maletero / depósito', icon: 'box' }
};
export const BUILDING_TYPES = { edificio: 'Edificio', residencias: 'Residencias / conjunto', urbanizacion: 'Urbanización / calle cerrada', centro: 'Centro comercial / empresarial' };
export const OCCUPANCY = { propietario: 'Vive el propietario', inquilino: 'Alquilado', desocupado: 'Desocupado' };

export const EXPENSE_CATEGORIES = [
  { id: 'nomina', name: 'Conserjería y nómina', icon: 'users' },
  { id: 'vigilancia', name: 'Vigilancia', icon: 'shield' },
  { id: 'limpieza', name: 'Limpieza y aseo', icon: 'sparkle' },
  { id: 'electricidad', name: 'Electricidad áreas comunes', icon: 'zap' },
  { id: 'agua', name: 'Agua / hidroneumático', icon: 'droplet' },
  { id: 'ascensores', name: 'Ascensores', icon: 'layers' },
  { id: 'mantenimiento', name: 'Mantenimiento y reparaciones', icon: 'wrench' },
  { id: 'jardineria', name: 'Jardinería', icon: 'leaf' },
  { id: 'piscina', name: 'Piscina', icon: 'droplet' },
  { id: 'gas', name: 'Gas', icon: 'flame' },
  { id: 'basura', name: 'Aseo urbano / basura', icon: 'trash' },
  { id: 'administracion', name: 'Honorarios de administración', icon: 'briefcase' },
  { id: 'bancarios', name: 'Gastos bancarios', icon: 'card' },
  { id: 'seguros', name: 'Seguros', icon: 'shieldCheck' },
  { id: 'impuestos', name: 'Impuestos y tasas', icon: 'receipt' },
  { id: 'papeleria', name: 'Papelería y oficina', icon: 'file' },
  { id: 'otros', name: 'Otros gastos', icon: 'tag' }
];
export const catOf = (id, list = EXPENSE_CATEGORIES) => list.find((c) => c.id === id) || { id, name: id || 'Otros', icon: 'tag' };

export const REQUEST_CATS = {
  mantenimiento: { label: 'Mantenimiento / avería', icon: 'wrench' },
  seguridad: { label: 'Seguridad', icon: 'shield' },
  ruido: { label: 'Ruido / convivencia', icon: 'volume' },
  limpieza: { label: 'Limpieza', icon: 'sparkle' },
  agua: { label: 'Agua / servicios', icon: 'droplet' },
  administrativo: { label: 'Administrativo / recibo', icon: 'receipt' },
  sugerencia: { label: 'Sugerencia', icon: 'star' },
  otro: { label: 'Otro', icon: 'info' }
};
export const REQUEST_STATUS = {
  nueva: { label: 'Nueva', tone: 'info' },
  en_proceso: { label: 'En proceso', tone: 'warning' },
  resuelta: { label: 'Resuelta', tone: 'success' },
  descartada: { label: 'Descartada', tone: 'neutral' }
};
export const NOTICE_KINDS = {
  aviso: { label: 'Aviso', tone: 'info', icon: 'bell' },
  mantenimiento: { label: 'Mantenimiento', tone: 'warning', icon: 'wrench' },
  asamblea: { label: 'Asamblea', tone: 'violet', icon: 'users' },
  urgente: { label: 'Urgente', tone: 'danger', icon: 'alert' },
  cobranza: { label: 'Cobranza', tone: 'brand', icon: 'wallet' }
};
export const AREAS_DEFAULT = [
  { id: 'salon', name: 'Salón de fiestas', fee: 20, deposit: 30, hours: '09:00 a 23:00', active: true },
  { id: 'parrillera', name: 'Parrillera', fee: 10, deposit: 15, hours: '10:00 a 22:00', active: true },
  { id: 'piscina', name: 'Piscina (evento privado)', fee: 15, deposit: 0, hours: '09:00 a 19:00', active: false },
  { id: 'cancha', name: 'Cancha', fee: 0, deposit: 0, hours: '07:00 a 21:00', active: false }
];
export const PAY_STATUS = {
  confirmado: { label: 'Confirmado', tone: 'success' },
  pendiente: { label: 'Por confirmar', tone: 'warning' },
  rechazado: { label: 'Rechazado', tone: 'neutral' },
  anulado: { label: 'Anulado', tone: 'neutral' }
};

export const badge = (map, k) => { const s = map[k] || { label: k, tone: 'neutral' }; return `<span class="badge badge-${s.tone}"><i class="dotc"></i>${s.label}</span>`; };

// ---------- Períodos (YYYY-MM) ----------
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const periodOf = (d = new Date()) => dayKey(d).slice(0, 7);
export const currentPeriod = () => periodOf(new Date());
export function addMonths(period, n) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function periodName(period, short = false) {
  if (!period) return '—';
  const [y, m] = period.split('-').map(Number);
  const n = MONTHS[m - 1] || '';
  return short ? `${n.slice(0, 3)} ${String(y).slice(2)}` : `${n.charAt(0).toUpperCase()}${n.slice(1)} ${y}`;
}
export const lastPeriods = (n, from = currentPeriod()) => Array.from({ length: n }, (_, i) => addMonths(from, -i));

// ---------- Unidades ----------
export const unitLabel = (u) => (u ? `${u.code}` : '—');
export const ownerFirst = (u) => String(u?.ownerName || '').split(' ')[0] || '';
/** Deuda de la unidad (positivo = debe; negativo = saldo a favor) */
export const unitBalance = (u) => round2((Number(u?.billed) || 0) - (Number(u?.paid) || 0));
export const unitCredit = (u) => Math.max(0, -unitBalance(u));
/**
 * Estado de cada cargo del libro de la unidad: cuánto se ha pagado de cada uno (los pagos se aplican
 * del más viejo al más nuevo). ledger: [{ p: período, c: acumulado antes del cargo, t: total, n: número, d: vence }]
 */
export function ledgerStatus(u) {
  const paid = Number(u?.paid) || 0;
  return (u?.ledger || []).map((x) => {
    const covered = Math.max(0, Math.min(Number(x.t) || 0, paid - (Number(x.c) || 0)));
    const rest = round2((Number(x.t) || 0) - covered);
    return { ...x, covered: round2(covered), rest, status: rest <= 0.009 ? 'pagado' : covered > 0.009 ? 'parcial' : 'pendiente' };
  });
}
/** Cargos (recibos) pendientes de la unidad */
export const openCharges = (u) => ledgerStatus(u).filter((x) => x.rest > 0.009);
/** Meses que adeuda (recibos con saldo) */
export const monthsOwed = (u) => openCharges(u).filter((x) => x.k !== 'extra').length;
/** Recibos vencidos sin pagar */
export const overdueCharges = (u, today = todayKey()) => openCharges(u).filter((x) => x.d && x.d < today);
export function debtTone(u) {
  const m = monthsOwed(u);
  if (unitBalance(u) <= 0.009) return 'success';
  if (m >= 3) return 'danger';
  if (m >= 2 || overdueCharges(u).length) return 'warning';
  return 'info';
}
export function debtLabel(u) {
  const b = unitBalance(u);
  if (b < -0.009) return 'Saldo a favor';
  if (b <= 0.009) return 'Solvente';
  const m = monthsOwed(u);
  return m >= 2 ? `Debe ${m} meses` : overdueCharges(u).length ? 'Vencido' : 'Por pagar';
}
export const isSolvent = (u) => unitBalance(u) <= 0.009;

/** Suma de alícuotas de un grupo de unidades */
export const aliquotSum = (units) => round2(units.reduce((a, u) => a + (Number(u.aliquot) || 0), 0) * 10000) / 10000;

// ---------- Cálculo del recibo de condominio ----------
/**
 * Calcula los recibos de un edificio para un período.
 * input: { building, units, expenses (del período), charges (cuotas especiales), settings }
 * Devuelve { summary, receipts: [{ unit, items: [{ concept, amount, kind }], total }] }
 */
export function computeBilling({ building, units, expenses, charges = [], settings }) {
  const live = units.filter((u) => u.active !== false);
  const reservePct = Number(building?.reservePct ?? settings.reservePct) || 0;
  const fee = building?.adminFee || settings.adminFee || { mode: 'pct', value: 0 };
  const late = settings.lateFee || {};
  const totalAliq = aliquotSum(live) || 100;

  const commons = expenses.filter((e) => (e.type || 'comun') === 'comun' && !e.fromFund && e.status !== 'anulado');
  const nonCommons = expenses.filter((e) => e.type === 'no_comun' && !e.fromFund && e.status !== 'anulado');
  const byCat = {};
  for (const e of commons) byCat[e.category || 'otros'] = round2((byCat[e.category || 'otros'] || 0) + (Number(e.amount) || 0));
  const common = round2(commons.reduce((a, e) => a + (Number(e.amount) || 0), 0));
  const adminFee = round2(fee.mode === 'fijo' ? Number(fee.value) || 0 : common * (Number(fee.value) || 0) / 100);
  const base = round2(common + adminFee);
  const reserve = round2(base * reservePct / 100);
  const toDistribute = round2(base + reserve);

  // Reparte cada monto en céntimos por el método del mayor residuo: la suma de los recibos cuadra exacta
  const alloc = (total, list, weight) => {
    const out = new Map(); const cents = Math.round((Number(total) || 0) * 100);
    if (!list.length || cents <= 0) return out;
    const ws = list.map((u) => Math.max(0, weight(u))); const W = ws.reduce((a, w) => a + w, 0) || list.length;
    const raw = list.map((u, i) => (W === list.length && !ws.some(Boolean) ? 1 : ws[i]) * cents / W);
    const base = raw.map(Math.floor); let left = cents - base.reduce((a, x) => a + x, 0);
    raw.map((r, i) => [r - base[i], i]).sort((x, y) => y[0] - x[0]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
    list.forEach((u, i) => out.set(u.id, base[i] / 100));
    return out;
  };
  const byAliq = (u) => Number(u.aliquot) || 0;
  const aCommon = alloc(common, live, byAliq), aFee = alloc(adminFee, live, byAliq), aRes = alloc(reserve, live, byAliq);
  const aNon = nonCommons.map((e) => { const t = live.filter((x) => (e.unitIds || []).includes(x.id)); return alloc(e.amount, t, e.split === 'alicuota' ? byAliq : () => 1); });
  const aCh = charges.map((c) => { if (c.status === 'anulado' || c.mode === 'fijo') return null; const t = live.filter((x) => !c.unitIds?.length || c.unitIds.includes(x.id)); return alloc(c.amount, t, byAliq); });

  const receipts = live.map((u) => {
    const items = [];
    if (common > 0) items.push({ concept: 'Gastos comunes', amount: aCommon.get(u.id) || 0, kind: 'comun' });
    if (adminFee > 0) items.push({ concept: 'Honorarios de administración', amount: aFee.get(u.id) || 0, kind: 'comun' });
    if (reserve > 0) items.push({ concept: `Fondo de reserva (${reservePct}%)`, amount: aRes.get(u.id) || 0, kind: 'reserva' });
    nonCommons.forEach((e, i) => { const amt = aNon[i].get(u.id); if (amt > 0) items.push({ concept: e.concept || 'Gasto no común', amount: amt, kind: 'no_comun' }); });
    charges.forEach((c, i) => {
      if (c.status === 'anulado') return;
      if (c.unitIds?.length && !c.unitIds.includes(u.id)) return;
      const amt = c.mode === 'fijo' ? round2(Number(c.amount) || 0) : aCh[i].get(u.id) || 0;
      if (amt > 0) items.push({ concept: c.concept || 'Cuota especial', amount: amt, kind: 'especial', fund: c.fund || '' });
    });
    if (late.enabled && Number(late.pct) > 0) {
      const overdue = overdueCharges(u).reduce((a, x) => a + x.rest, 0);
      if (overdue > 0.009) items.push({ concept: `Interés de mora (${late.pct}% sobre ${round2(overdue)})`, amount: round2(overdue * Number(late.pct) / 100), kind: 'mora' });
    }
    const total = round2(items.reduce((a, i) => a + i.amount, 0));
    return { unit: u, items, total };
  });
  const totalBilled = round2(receipts.reduce((a, r) => a + r.total, 0));
  const nonCommon = round2(nonCommons.reduce((a, e) => a + (Number(e.amount) || 0), 0));
  const special = round2(receipts.reduce((a, r) => a + r.items.filter((i) => i.kind === 'especial').reduce((x, i) => x + i.amount, 0), 0));
  const mora = round2(receipts.reduce((a, r) => a + r.items.filter((i) => i.kind === 'mora').reduce((x, i) => x + i.amount, 0), 0));
  return {
    summary: { common, adminFee, reserve, reservePct, base, toDistribute, nonCommon, special, mora, totalBilled, byCat, units: live.length, aliquotTotal: totalAliq, expensesCount: commons.length + nonCommons.length },
    receipts
  };
}

/** Fecha de vencimiento de un recibo emitido hoy */
export const dueDateFor = (settings, from = new Date()) => dayKey(addDays(from, Number(settings.dueDays) || 15));
export const daysTo = (key) => (key ? Math.round((fromKey(key) - fromKey(todayKey())) / 864e5) : null);
