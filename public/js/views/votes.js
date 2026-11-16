// SanoCondominio — Asambleas y votaciones ponderadas por alícuota
import { store } from '../store.js';
import { esc, num, emptyState, toast, openModal, fmtDate, todayKey, confirmDialog } from '../utils.js';
import { icon } from '../icons.js';
import { buildingOptions, unitAvatar } from '../unit.js';
import { saveVote, castVote, setVoteStatus, voteResults } from '../ops.js';
import { waUnit, printDoc } from '../shared.js';

const COLORS = ['var(--success)', 'var(--danger)', 'var(--faint)', 'var(--info)', 'var(--violet)', 'var(--warning)'];

export function mount(el) {
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Asambleas y votaciones</h1><p class="view-sub">Cada propietario vota desde su portal o en la asamblea. El resultado se pondera por alícuota (o una unidad, un voto) y muestra el quórum en vivo.</p></div>
      <div class="view-actions"><button class="btn btn-primary" id="v-new">${icon('plus')} Nueva votación</button></div></div>
    <div id="v-list"></div>`;
  const $ = (s) => el.querySelector(s);
  function bars(v) {
    const r = voteResults(v);
    const tot = Math.max(0.0001, r.castW);
    return `<div class="stack" style="gap:8px">${v.options.map((o, i) => { const x = r.res[o]; const pct = x.weight / tot * 100; return `<div><div class="between small"><b>${esc(o)}</b><span>${x.votes} voto(s) · <b>${num(pct, 1)}%</b>${v.weight === 'alicuota' ? ` <span class="t-sub">(${num(x.weight, 2)}% alíc.)</span>` : ''}</span></div><div class="vbar"><i style="width:${pct}%;background:${COLORS[i % COLORS.length]}"></i></div></div>`; }).join('')}
      <div class="between t-sub"><span>Participación: <b>${r.cast} de ${r.units}</b> unidades</span><span>Quórum ${v.weight === 'alicuota' ? 'por alícuota' : 'por unidades'}: <b>${num(r.quorum, 1)}%</b></span></div>
      <div class="progress"><span style="width:${Math.min(100, r.quorum)}%"></span></div></div>`;
  }
  function draw() {
    const list = store.votes.filter((v) => store.inScope(v));
    $('#v-list').innerHTML = list.length ? `<div class="grid-2">${list.map((v) => `<div class="card vote-card">
        <div class="between"><span class="badge badge-${v.status === 'abierta' ? 'violet' : 'neutral'}">${v.status === 'abierta' ? 'Abierta' : 'Cerrada'}</span><span class="t-sub">${esc(store.bldName(v.buildingId))}${v.until ? ` · hasta ${fmtDate(v.until)}` : ''}</span></div>
        <h3 class="notice-title">${esc(v.title)}</h3>${v.detail ? `<p class="small muted" style="margin:0 0 10px">${esc(v.detail)}</p>` : ''}${v.assembly ? `<div class="t-sub mb">${icon('users')} ${esc(v.assembly)}</div>` : ''}
        ${bars(v)}
        <div class="row mt" style="gap:6px;flex-wrap:wrap">${v.status === 'abierta' ? `<button class="btn btn-primary btn-sm" data-cast="${v.id}">${icon('vote')} Registrar votos</button><button class="btn btn-whatsapp btn-sm" data-wa="${v.id}">${icon('whatsapp')} Invitar a votar</button><button class="btn btn-ghost btn-sm" data-close-v="${v.id}">${icon('lock')} Cerrar</button>` : `<button class="btn btn-ghost btn-sm" data-open-v="${v.id}">${icon('unlock')} Reabrir</button>`}<button class="btn btn-ghost btn-sm" data-pr="${v.id}">${icon('print')} Acta</button></div></div>`).join('')}</div>`
      : `<div class="card">${emptyState('vote', 'Sin votaciones', '¿Pintamos la fachada? ¿Aprobamos el presupuesto? Crea la pregunta y los propietarios votan desde su teléfono.')}</div>`;
    el.querySelectorAll('[data-cast]').forEach((b) => b.onclick = () => castModal(store.votes.find((v) => v.id === b.dataset.cast)));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => invite(store.votes.find((v) => v.id === b.dataset.wa)));
    el.querySelectorAll('[data-close-v]').forEach((b) => b.onclick = async () => { if (await confirmDialog({ title: 'Cerrar votación', message: 'Ya no se aceptarán más votos.', confirmText: 'Cerrar' })) { await setVoteStatus(store.votes.find((v) => v.id === b.dataset.closeV), 'cerrada'); toast('Votación cerrada'); } });
    el.querySelectorAll('[data-open-v]').forEach((b) => b.onclick = async () => { await setVoteStatus(store.votes.find((v) => v.id === b.dataset.openV), 'abierta'); toast('Votación reabierta'); });
    el.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => acta(store.votes.find((v) => v.id === b.dataset.pr)));
  }
  function acta(v) {
    const r = voteResults(v);
    const units = store.unitsOf(v.buildingId);
    printDoc(`Acta de votación · ${v.title}`, `<p><b>Edificio:</b> ${esc(store.bldName(v.buildingId))}${v.assembly ? ` · <b>Asamblea:</b> ${esc(v.assembly)}` : ''}<br><b>Ponderación:</b> ${v.weight === 'alicuota' ? 'por alícuota' : 'una unidad, un voto'} · <b>Participación:</b> ${r.cast} de ${r.units} unidades (${num(r.quorum, 2)}%)</p>${v.detail ? `<p>${esc(v.detail)}</p>` : ''}
      <h2>Resultado</h2><table><tr><th>Opción</th><th class="r">Votos</th><th class="r">${v.weight === 'alicuota' ? 'Alícuota' : 'Unidades'}</th><th class="r">%</th></tr>${v.options.map((o) => `<tr><td>${esc(o)}</td><td class="r">${r.res[o].votes}</td><td class="r">${num(r.res[o].weight, 4)}</td><td class="r">${num(r.res[o].weight / Math.max(0.0001, r.castW) * 100, 2)}%</td></tr>`).join('')}</table>
      <h2>Detalle por unidad</h2><table><tr><th>Unidad</th><th>Propietario</th><th class="r">Alícuota</th><th>Voto</th><th>Vía</th></tr>${units.map((u) => { const bl = v.ballots?.[u.id]; return `<tr><td>${esc(u.code)}</td><td>${esc(u.ownerName || '')}</td><td class="r">${num(u.aliquot || 0, 4)}%</td><td>${bl ? esc(bl.option) : '—'}</td><td>${bl ? esc(bl.via) : ''}</td></tr>`; }).join('')}</table>
      <div class="sign"><div>Presidente de la junta</div><div>Secretario(a)</div></div>`);
  }
  function invite(v) {
    const list = store.unitsOf(v.buildingId).filter((u) => u.ownerPhone && !v.ballots?.[u.id]);
    const m = openModal({
      title: 'Invitar a votar', size: 'md', sub: 'Solo aparecen quienes aún no votan. Cada mensaje lleva el enlace a su portal.',
      body: list.length ? `<div class="list" style="max-height:55vh;overflow:auto">${list.map((u) => `<div class="list-item">${unitAvatar(u)}<div class="grow"><b>${esc(u.code)}</b><div class="t-sub">${esc(u.ownerName || '')}</div></div><button class="btn btn-whatsapp btn-sm" data-s="${u.id}">${icon('whatsapp')}</button></div>`).join('')}</div>` : emptyState('checkCircle', 'Todos votaron (o no tienen teléfono)')
    });
    m.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { waUnit('votacion', { unit: store.unit(b.dataset.s), vote: v }); b.classList.replace('btn-whatsapp', 'btn-secondary'); b.innerHTML = icon('check'); });
  }
  function castModal(v) {
    const units = store.unitsOf(v.buildingId);
    const m = openModal({
      title: `Votos presenciales · ${esc(v.title)}`, size: 'lg', sub: 'Marca la opción de cada unidad presente o representada. Los votos del portal llegan solos.',
      body: `<div class="list" style="max-height:60vh;overflow:auto">${units.map((u) => { const bl = v.ballots?.[u.id]; return `<div class="list-item">${unitAvatar(u)}<div class="grow" style="min-width:0"><b>${esc(u.code)}</b> <span class="t-sub">${num(u.aliquot || 0, 4)}%</span><div class="t-sub ellipsis">${esc(u.ownerName || '')}${bl ? ` · votó por ${bl.via}` : ''}</div></div><div class="seg seg-sm">${v.options.map((o) => `<button type="button" data-u="${u.id}" data-o="${esc(o)}" class="${bl?.option === o ? 'on' : ''}">${esc(o)}</button>`).join('')}</div></div>`; }).join('')}</div>`,
      footer: `<button class="btn btn-primary" data-close>Listo</button>`
    });
    m.el.querySelectorAll('[data-o]').forEach((b) => b.onclick = async () => {
      try { await castVote(store.votes.find((x) => x.id === v.id), b.dataset.u, b.dataset.o, 'presencial'); m.el.querySelectorAll(`[data-u="${b.dataset.u}"]`).forEach((y) => y.classList.toggle('on', y === b)); }
      catch (ex) { toast(ex.message, 'warning'); }
    });
  }
  function form() {
    const b0 = store.currentBuilding?.id || store.liveBuildings[0]?.id;
    if (!b0) { toast('Crea un edificio primero.', 'warning'); return; }
    const m = openModal({
      title: 'Nueva votación', size: 'md',
      body: `<form class="stack" data-f>
        <div class="field"><label>Pregunta</label><input class="input" name="title" placeholder="¿Aprueban pintar la fachada con cuota especial de 3 meses?" autofocus></div>
        <div class="field"><label>Detalle (opcional)</label><textarea class="input textarea" name="detail" rows="3" placeholder="Presupuesto, empresas consultadas, condiciones…"></textarea></div>
        <div class="field"><label>Opciones (una por línea)</label><textarea class="input textarea" name="options" rows="3">Sí, apruebo\nNo apruebo\nMe abstengo</textarea></div>
        <div class="form-grid">
          <div class="field"><label>Edificio</label><select class="input select" name="b">${buildingOptions(b0)}</select></div>
          <div class="field"><label>Abierta hasta</label><input class="input" type="date" name="until" min="${todayKey()}"></div>
          <div class="field"><label>Ponderación</label><select class="input select" name="weight"><option value="alicuota">Por alícuota (Ley de Propiedad Horizontal)</option><option value="unidad">Una unidad, un voto</option></select></div>
          <div class="field"><label>Asamblea (opcional)</label><input class="input" name="assembly" placeholder="Asamblea ordinaria del 20/11"></div>
        </div><div class="error-msg" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('vote')} Abrir votación</button>`
    });
    const go = async (e) => {
      e?.preventDefault();
      const F = m.el.querySelector('[data-f]').elements;
      try { const v = await saveVote({ title: F.title.value, detail: F.detail.value, options: F.options.value.split('\n'), buildingId: F.b.value, until: F.until.value, weight: F.weight.value, assembly: F.assembly.value }); m.close(); toast('Votación abierta: ya aparece en el portal'); invite(v); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; }
    };
    m.el.querySelector('[data-f]').onsubmit = go; m.el.querySelector('[data-ok]').onclick = go;
  }
  $('#v-new').onclick = form;
  draw();
  const off = store.on('*', (e) => { if (['votes', 'units', 'building', 'buildings'].includes(e)) draw(); });
  return () => off();
}
