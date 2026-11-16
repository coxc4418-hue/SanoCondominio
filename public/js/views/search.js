// SanoCondominio — Búsqueda global (Ctrl + K): unidades, propietarios, inquilinos, teléfonos y pagos
import { store } from '../store.js';
import { openModal, esc, usd, normalize, debounce } from '../utils.js';
import { icon } from '../icons.js';
import { unitAvatar, openUnit, debtBadge } from '../unit.js';

export function openSearch() {
  if (document.querySelector('.search-modal')) return;
  const m = openModal({
    size: 'lg',
    body: `<div class="search search-big">${icon('search')}<input data-q placeholder="Unidad (5-B), propietario, inquilino, cédula, teléfono o N° de pago…" autofocus autocomplete="off"></div><div data-res class="mt"></div>`
  });
  m.el.querySelector('.modal').classList.add('search-modal');
  const input = m.el.querySelector('[data-q]');
  const res = m.el.querySelector('[data-res]');
  const go = async (route, params = {}) => { m.close(); (await import('../main.js')).navigate(route, { params, force: true }); };
  const hint = () => `<div class="t-sub center pd-3">Escribe para buscar en ${store.liveUnits.length} unidades de ${store.liveBuildings.length} edificio(s).</div>
    <div class="row" style="gap:6px;justify-content:center;flex-wrap:wrap">${[['cobranza', 'Cobranza', 'cash'], ['gastos', 'Cargar gasto', 'receipt'], ['recibos', 'Recibos del mes', 'file'], ['comunicados', 'Comunicados', 'megaphone']].map(([r, l, i]) => `<button class="chip" data-go="${r}">${icon(i)} ${l}</button>`).join('')}</div>`;
  function bind() {
    res.querySelectorAll('[data-u]').forEach((x) => x.onclick = () => { m.close(); openUnit(x.dataset.u); });
    res.querySelectorAll('[data-go]').forEach((x) => x.onclick = () => go(x.dataset.go));
  }
  function run() {
    const raw = input.value.trim();
    const t = normalize(raw);
    const digits = raw.replace(/\D/g, '');
    if (!t) { res.innerHTML = hint(); bind(); return; }
    const units = store.liveUnits.filter((u) => {
      const hay = normalize([u.code, u.ownerName, u.residentName, u.ownerDoc, u.floor, store.bldName(u.buildingId), u.parking, u.portalCode].filter(Boolean).join(' '));
      if (hay.includes(t)) return true;
      if (digits.length >= 4 && [u.ownerPhone, u.residentPhone, u.ownerDoc].some((p) => String(p || '').replace(/\D/g, '').includes(digits))) return true;
      return false;
    }).sort((a, b) => (normalize(a.code) === t ? -1 : normalize(b.code) === t ? 1 : 0)).slice(0, 12);
    const pays = store.payments.filter((p) => normalize([p.number, p.reference].join(' ')).includes(t)).slice(0, 6);
    res.innerHTML = (units.length || pays.length) ? `
      ${units.length ? `<div class="section-title">Unidades</div><div class="list">${units.map((u) => `<button class="list-item click" data-u="${u.id}">${unitAvatar(u)}<div class="grow" style="min-width:0;text-align:left"><b>${esc(u.code)}</b> <span class="t-sub">${esc(store.bldName(u.buildingId))}</span><div class="t-sub ellipsis">${esc(u.ownerName || 'Sin propietario')}${u.residentName ? ` · inquilino ${esc(u.residentName)}` : ''}</div></div>${debtBadge(u)}</button>`).join('')}</div>` : ''}
      ${pays.length ? `<div class="section-title mt">Pagos</div><div class="list">${pays.map((p) => `<button class="list-item click" data-u="${p.unitId}"><span class="kpi-icon tone-success" style="width:34px;height:34px">${icon('cash')}</span><div class="grow" style="text-align:left"><b>${esc(p.number || '')}</b> · ${esc(p.unitCode)}<div class="t-sub">${esc(p.date)} · ref. ${esc(p.reference || '—')}${p.status === 'anulado' ? ' · ANULADO' : ''}</div></div><b class="num">${usd(p.amount)}</b></button>`).join('')}</div>` : ''}`
      : `<div class="t-sub center pd-3">Sin resultados para «${esc(raw)}».</div>`;
    bind();
  }
  input.addEventListener('input', debounce(run, 120));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') res.querySelector('[data-u]')?.click(); });
  run();
  setTimeout(() => input.focus(), 30);
}
