// SanoCondominio — Unidades y propietarios
import { store } from '../store.js';
import { esc, usd, num, emptyState, normalize, debounce, toast, download, toCSV, parseCSV, openModal, setBusy, confirmDialog, loc } from '../utils.js';
import { icon } from '../icons.js';
import { unitAvatar, openUnit, unitForm, debtBadge, portalModal, buildingOptions } from '../unit.js';
import { waUnit, PORTAL_URL } from '../shared.js';
import { unitBalance, monthsOwed, aliquotSum, UNIT_TYPES, OCCUPANCY } from '../condo.js';
import { equalizeAliquots, importUnits } from '../ops.js';

const FILTERS = [
  ['todas', 'Todas'], ['deuda', 'Con deuda'], ['morosos', 'Morosos'], ['solventes', 'Solventes'], ['favor', 'Saldo a favor'], ['alquiladas', 'Alquiladas'], ['inactivas', 'Inactivas']
];

export function mount(el, { params }) {
  let filter = params?.tab || 'todas';
  let q = '';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Unidades y propietarios</h1><p class="view-sub">Apartamentos, casas y locales con su alícuota, propietario, inquilino y estado de cuenta.</p></div>
      <div class="view-actions">
        <button class="btn btn-primary" id="u-new">${icon('plus')} Nueva unidad</button>
        <button class="btn btn-secondary" id="u-imp">${icon('upload')} Importar</button>
        <button class="btn btn-ghost" id="u-exp">${icon('download')} Exportar</button>
        <button class="btn btn-ghost" id="u-wa" title="Enviar el portal a todos">${icon('whatsapp')} Portal a todos</button>
      </div></div>
    <div id="u-aliq"></div>
    <div class="card card-flush">
      <div class="toolbar" data-tour="filters">
        <label class="search grow" style="min-width:200px">${icon('search')}<input id="u-q" placeholder="Buscar por número, propietario, cédula o teléfono…" autocomplete="off"></label>
        <div class="chips" id="u-chips"></div>
      </div>
      <div id="u-list"></div>
    </div>`;
  const $ = (s) => el.querySelector(s);

  const match = (u) => {
    const b = unitBalance(u);
    if (filter === 'inactivas') return u.active === false;
    if (u.active === false) return false;
    if (filter === 'deuda') return b > 0.009;
    if (filter === 'morosos') return monthsOwed(u) >= 2;
    if (filter === 'solventes') return b <= 0.009;
    if (filter === 'favor') return b < -0.009;
    if (filter === 'alquiladas') return u.occupancy === 'inquilino';
    return true;
  };
  function aliq() {
    const blds = store.building ? [store.bld(store.building)].filter(Boolean) : store.liveBuildings;
    const bad = blds.map((b) => ({ b, s: aliquotSum(store.unitsOf(b.id)), n: store.unitsOf(b.id).length })).filter((x) => x.n && Math.abs(x.s - 100) > 0.01);
    $('#u-aliq').innerHTML = bad.map((x) => `<div class="banner lic-banner"><span>${icon('pie')} Las alícuotas de <b>${esc(x.b.name)}</b> suman <b>${num(x.s, 4)}%</b> (deben sumar 100%). Los recibos se reparten igual de forma proporcional, pero conviene corregirlas.</span><button class="btn btn-sm btn-secondary" data-eq="${x.b.id}">Repartir</button></div>`).join('');
    el.querySelectorAll('[data-eq]').forEach((b) => b.onclick = () => equalize(b.dataset.eq));
  }
  async function equalize(bid) {
    const units = store.unitsOf(bid);
    const hasM2 = units.some((u) => Number(u.m2) > 0);
    const m = openModal({
      title: 'Repartir alícuotas', size: 'sm', sub: `${units.length} unidades en ${esc(store.bldName(bid))}`,
      body: `<div class="stack"><label class="check box box-white"><input type="radio" name="m" value="iguales" checked> <span><b>Partes iguales</b><br><small class="muted">${num(100 / units.length, 4)}% cada una</small></span></label>
        <label class="check box box-white" ${hasM2 ? '' : 'style="opacity:.5"'}><input type="radio" name="m" value="m2" ${hasM2 ? '' : 'disabled'}> <span><b>Según metros cuadrados</b><br><small class="muted">${hasM2 ? 'Proporcional al área de cada unidad' : 'Carga los m² de cada unidad primero'}</small></span></label></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Aplicar</button>`
    });
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      const { requirePin } = await import('../auth.js');
      if (!(await requirePin('Cambiar las alícuotas'))) return;
      setBusy(e.currentTarget, true, 'Aplicando…');
      await equalizeAliquots(bid, m.el.querySelector('input[name="m"]:checked').value);
      m.close(); toast('Alícuotas actualizadas');
    };
  }

  function chips() {
    const base = store.units.filter((u) => store.inScope(u));
    $('#u-chips').innerHTML = FILTERS.map(([k, l]) => { const n = base.filter((u) => { const f = filter; filter = k; const r = match(u); filter = f; return r; }).length; return `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l} <span class="count">${n}</span></button>`; }).join('');
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; chips(); list(); });
  }
  function list() {
    const t = normalize(q).replace(/\s+/g, '');
    const rows = store.units.filter((u) => store.inScope(u) && match(u) && (!t || normalize(`${u.code}${u.ownerName}${u.ownerIdDoc}${u.ownerPhone}${u.residentName}${u.residentPhone}`).replace(/\s+/g, '').includes(t)));
    if (!store.units.length) {
      $('#u-list').innerHTML = `<div class="pd-3">${emptyState('building', 'Aún no hay unidades', 'Crea cada apartamento o casa con su alícuota y propietario, o impórtalos todos de una vez desde Excel (CSV).')}<div class="row" style="justify-content:center;gap:8px"><button class="btn btn-primary" data-x="new">${icon('plus')} Nueva unidad</button><button class="btn btn-secondary" data-x="imp">${icon('upload')} Importar CSV</button></div></div>`;
      el.querySelector('[data-x="new"]').onclick = () => unitForm();
      el.querySelector('[data-x="imp"]').onclick = importDialog;
      return;
    }
    const multi = store.liveBuildings.length > 1 && !store.building;
    $('#u-list').innerHTML = rows.length ? `<div class="table-wrap"><table class="table rt"><thead><tr><th>Unidad</th><th class="hide-sm">Propietario</th><th class="hide-sm r">Alícuota</th><th class="r">Deuda</th><th class="hide-sm">Estado</th><th></th></tr></thead><tbody>
      ${rows.map((u) => `<tr class="click" data-u="${u.id}"><td><div class="row" style="gap:10px;flex-wrap:nowrap">${unitAvatar(u)}<div style="min-width:0"><b>${esc(u.code)}</b><div class="t-sub hide-sm">${esc(UNIT_TYPES[u.type]?.label || '')}${multi ? ` · ${esc(store.bldName(u.buildingId))}` : ''}</div><div class="t-sub show-sm ellipsis" style="max-width:46vw">${esc(u.ownerName || '—')}</div></div></div></td>
        <td class="hide-sm" style="min-width:0"><div class="ellipsis" style="max-width:240px">${esc(u.ownerName || '—')}</div><div class="t-sub">${u.occupancy === 'inquilino' ? `Alquilado${u.residentName ? ': ' + esc(u.residentName) : ''}` : esc(OCCUPANCY[u.occupancy] || '')}</div></td>
        <td class="hide-sm r num">${num(u.aliquot || 0, 4)}%</td>
        <td class="r"><b class="num ${unitBalance(u) > 0.009 ? 'text-danger' : unitBalance(u) < -0.009 ? 'text-success' : ''}">${unitBalance(u) < -0.009 ? '+' + usd(-unitBalance(u)) : usd(Math.max(0, unitBalance(u)))}</b><div class="t-sub show-sm">${debtBadge(u)}</div></td>
        <td class="hide-sm">${debtBadge(u)}</td>
        <td class="r" style="white-space:nowrap">${u.ownerPhone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${u.id}" title="WhatsApp">${icon('whatsapp')}</button>` : ''}<button class="btn btn-ghost btn-icon btn-sm hide-sm" data-pt="${u.id}" title="Portal">${icon('qr')}</button></td></tr>`).join('')}
      </tbody></table></div><div class="t-sub pd-3" style="padding-top:8px">${rows.length} unidad(es) · deuda ${usd(rows.reduce((a, u) => a + Math.max(0, unitBalance(u)), 0))}</div>`
      : `<div class="pd-3">${emptyState('search', 'Sin resultados', 'Prueba con otro filtro o búsqueda.')}</div>`;
    el.querySelectorAll('[data-u]').forEach((r) => r.onclick = (e) => { if (e.target.closest('button')) return; openUnit(r.dataset.u); });
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => { const u = store.unit(b.dataset.wa); const bal = unitBalance(u); waUnit(bal > 0.009 ? (monthsOwed(u) >= 2 ? 'moroso' : 'recordatorio') : 'portal', { unit: u }); });
    el.querySelectorAll('[data-pt]').forEach((b) => b.onclick = () => portalModal(store.unit(b.dataset.pt)));
  }

  function importDialog() {
    if (!store.liveBuildings.length) { toast('Primero crea el edificio en Configuración.', 'warning'); return; }
    const m = openModal({
      title: 'Importar unidades desde Excel (CSV)', size: 'md',
      sub: 'Guarda tu hoja como CSV con estas columnas en este orden (la primera fila puede ser el encabezado):',
      body: `<div class="stack"><code class="box small" style="white-space:pre-wrap">unidad; tipo; piso; alícuota; propietario; ${esc(loc().id)}; teléfono; correo; deuda anterior</code>
        <div class="hint">Tipo: apartamento, casa, local, oficina, estacionamiento. Si la unidad ya existe, se actualizan sus datos (no su deuda).</div>
        <div class="field"><label>Edificio</label><select class="input select" data-b>${buildingOptions(store.currentBuilding?.id || store.liveBuildings[0].id)}</select></div>
        <div class="row"><button class="btn btn-ghost btn-sm" data-tpl>${icon('download')} Descargar plantilla</button></div>
        <input type="file" accept=".csv,text/csv" data-file class="input"><div data-prev class="small"></div><div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok disabled>${icon('upload')} Importar</button>`
    });
    let rows = [];
    m.el.querySelector('[data-tpl]').onclick = () => download('plantilla-unidades.csv', toCSV([['unidad', 'tipo', 'piso', 'alicuota', 'propietario', 'cedula', 'telefono', 'correo', 'deuda'], ['1-A', 'apartamento', '1', '2.5', 'María Pérez', 'V-12345678', '04141234567', 'maria@correo.com', '0'], ['1-B', 'apartamento', '1', '2.5', 'José Rodríguez', 'V-9876543', '04241234567', '', '45']]), 'text/csv;charset=utf-8');
    m.el.querySelector('[data-file]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const all = parseCSV(await f.text());
      const first = (all[0] || []).join(' ').toLowerCase();
      const data = /unidad|alic|propiet/.test(first) ? all.slice(1) : all;
      const T = Object.keys(UNIT_TYPES);
      rows = data.map((r) => ({ code: r[0], type: T.find((k) => normalize(r[1] || '').startsWith(k.slice(0, 4))) || 'apartamento', floor: r[2] || '', aliquot: r[3] || '', ownerName: r[4] || '', ownerIdDoc: r[5] || '', ownerPhone: r[6] || '', ownerEmail: r[7] || '', debt: r[8] || '' })).filter((r) => r.code);
      const sum = rows.reduce((a, r) => a + (Number(String(r.aliquot).replace(',', '.')) || 0), 0);
      m.el.querySelector('[data-prev]').innerHTML = `<b>${rows.length}</b> unidad(es) leídas · alícuotas suman <b>${num(sum, 4)}%</b>${rows.slice(0, 4).map((r) => `<div class="t-sub">${esc(r.code)} · ${esc(r.ownerName)} · ${esc(r.aliquot)}%</div>`).join('')}`;
      m.el.querySelector('[data-ok]').disabled = !rows.length;
    };
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      setBusy(e.currentTarget, true, 'Importando…');
      try { const r = await importUnits(m.el.querySelector('[data-b]').value, rows); m.close(); toast(`Listo: ${r.created} nueva(s), ${r.updated} actualizada(s)`); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
  }

  $('#u-new').onclick = () => unitForm();
  $('#u-imp').onclick = importDialog;
  $('#u-exp').onclick = () => download('unidades-sano-condominio.csv', toCSV([['Edificio', 'Unidad', 'Tipo', 'Piso', 'Alícuota %', 'Propietario', loc().id, 'Teléfono', 'Correo', 'Ocupación', 'Inquilino', 'Teléfono inquilino', 'Deuda', 'Meses', 'Portal'],
    ...store.units.filter((u) => store.inScope(u)).map((u) => [store.bldName(u.buildingId), u.code, UNIT_TYPES[u.type]?.label || '', u.floor || '', num(u.aliquot || 0, 4), u.ownerName || '', u.ownerIdDoc || '', u.ownerPhone || '', u.ownerEmail || '', OCCUPANCY[u.occupancy] || '', u.residentName || '', u.residentPhone || '', num(unitBalance(u)), monthsOwed(u), PORTAL_URL(u)])]), 'text/csv;charset=utf-8');
  $('#u-wa').onclick = async () => {
    const list = store.scopeUnits.filter((u) => u.ownerPhone);
    if (!list.length) { toast('Ninguna unidad tiene teléfono cargado.', 'warning'); return; }
    import('../ops.js').then(({ publishPortals }) => publishPortals().catch(() => {}));
    const m = openModal({
      title: 'Enviar el portal a cada propietario', size: 'md', sub: 'Toca cada uno: se abre WhatsApp con su enlace personal listo para enviar.',
      body: `<div class="list" style="max-height:55vh;overflow:auto">${list.map((u) => `<div class="list-item">${unitAvatar(u)}<div class="grow"><b>${esc(u.code)}</b><div class="t-sub">${esc(u.ownerName || '')}</div></div><button class="btn btn-whatsapp btn-sm" data-s="${u.id}">${icon('whatsapp')} Enviar</button></div>`).join('')}</div>`
    });
    m.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { waUnit('portal', { unit: store.unit(b.dataset.s) }); b.classList.replace('btn-whatsapp', 'btn-secondary'); b.innerHTML = `${icon('check')} Enviado`; });
  };
  $('#u-q').oninput = debounce((e) => { q = e.target.value; list(); }, 150);
  const all = () => { aliq(); chips(); list(); };
  all();
  if (params?.new) unitForm();
  const off = store.on('*', (e) => { if (['units', 'buildings', 'building', 'settings', 'rate'].includes(e)) all(); });
  return () => off();
}
