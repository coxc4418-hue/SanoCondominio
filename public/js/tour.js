// SanoCondominio — Recorrido guiado: ilumina zonas de la pantalla y explica para qué sirven
import { esc, openModal, closeAllModals } from './utils.js';
import { icon } from './icons.js';

// Cada paso: { route, sel: [selectores alternativos], title, text }. Sin elemento visible → tarjeta centrada.
export const TOURS = {
  general: {
    name: 'Recorrido general', desc: 'Lo esencial del sistema en 1 minuto', icon: 'sparkle',
    steps: [
      { route: 'inicio', title: '¡Bienvenido a SanoCondominio! 🏢', text: 'En un minuto te mostramos cómo administrar tus condominios aquí: cargar gastos, emitir los recibos por alícuota, cobrar con WhatsApp y el portal de cada propietario.' },
      { route: 'inicio', sel: ['.bld-switch', '#tb-bld'], title: 'Tus edificios', text: 'Si administras varios condominios, aquí eliges con cuál trabajar o ves todos juntos. Cada edificio tiene sus unidades, gastos, recibos y fondos.' },
      { route: 'inicio', sel: ['[data-tour="month"]'], title: 'Tu mes en 3 pasos', text: 'Cargas los gastos del mes, emites los recibos (se reparten solos por alícuota con fondo de reserva, honorarios y mora) y cobras. Aquí ves en qué paso va cada edificio.' },
      { route: 'inicio', sel: ['[data-tour="kpis"]'], title: 'Cómo va la cobranza', text: 'Lo cobrado este mes, la deuda total, cuántas unidades están solventes, el fondo de reserva y los pagos reportados por confirmar.' },
      { route: 'inicio', sel: ['[data-tour="debtors"]'], title: 'Morosos', text: 'Quién debe y cuántos meses. Un toque y le llega por WhatsApp el recordatorio con su saldo y el enlace a su portal para pagar.' },
      { route: 'gastos', sel: ['#x-new', '#view'], title: 'Cargar gastos', text: 'Vigilancia, conserje, luz, agua, ascensores… Elige la categoría con un toque. Los gastos no comunes se cobran solo a las unidades que indiques; y lo que pagas con el fondo de reserva no va al recibo.' },
      { route: 'recibos', sel: ['[data-tour="bill-sum"]', '#view'], title: 'Emitir los recibos', text: 'Revisa el resumen y la vista previa por unidad y emite con tu PIN. Imprime todos o envíalos por WhatsApp con la relación de gastos.' },
      { route: 'cobranza', sel: ['#c-tabs', '#view'], title: 'Cobranza', text: 'Registra pagos en dólares o bolívares a la tasa BCV, confirma los que reportan los propietarios desde su portal y entrega el comprobante.' },
      { route: 'unidades', sel: ['[data-tour="filters"]', '#view'], title: 'Unidades y propietarios', text: 'Cada unidad con su alícuota, propietario, inquilino, estado de cuenta, solvencia y su enlace privado al portal. Importa todo desde Excel.' },
      { route: 'inicio', title: '¡Listo! 🎉', text: 'Prueba ahora: en Cobranza confirma un pago reportado, en Asambleas mira la votación por alícuota y abre el portal de una unidad desde su ficha para verlo como el propietario.', final: true }
    ]
  },
  mes: {
    name: 'El cierre del mes', desc: 'Gastos, cuotas especiales y emisión de recibos', icon: 'file',
    steps: [
      { route: 'gastos', sel: ['#x-period', '#view'], title: 'Mes de trabajo', text: 'Los gastos se cargan en el mes al que pertenecen. Con “Copiar fijos del mes anterior” traes vigilancia, conserje y demás en un clic.' },
      { route: 'gastos', sel: ['#x-tabs'], title: 'Cuotas especiales', text: 'Impermeabilización, pintura, una bomba nueva… Crea la cuota (por alícuota o monto fijo) y lo recaudado va a su propio fondo.' },
      { route: 'recibos', sel: ['[data-tour="bill-sum"]', '#view'], title: 'Cómo se calcula', text: 'Gastos comunes + honorarios + fondo de reserva, repartidos por alícuota. Encima se suman los gastos no comunes, las cuotas especiales y el interés de mora de quien debe.' },
      { route: 'fondos', sel: ['#f-tabs', '#view'], title: 'Fondos y libro', text: 'El fondo de reserva crece solo con cada emisión. Registra aportes y retiros (con PIN) y consulta el libro de ingresos y egresos para la rendición de cuentas.', final: true }
    ]
  },
  comunidad: {
    name: 'Comunidad y portal', desc: 'Comunicados, solicitudes, reservas y votaciones', icon: 'users',
    steps: [
      { route: 'comunicados', sel: ['#view'], title: 'Comunicados', text: 'Cortes de agua, fumigación, convocatorias… Se publican en el portal de cada propietario y los envías por WhatsApp con plantillas listas.' },
      { route: 'solicitudes', sel: ['#view'], title: 'Solicitudes', text: 'Averías y reclamos que llegan desde el portal. Cambia el estado y responde: el propietario lo ve en su teléfono.' },
      { route: 'reservas', sel: ['#view'], title: 'Áreas comunes', text: 'Salón de fiestas y parrillera sin choques de horario. Apruebas las reservas del portal y el costo se suma a la deuda de la unidad.' },
      { route: 'asambleas', sel: ['#view'], title: 'Votaciones', text: 'Los propietarios votan desde su portal o en la asamblea. El resultado se pondera por alícuota y sale el acta lista para imprimir.', final: true }
    ]
  }
};

let state = null;

const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
async function findTarget(sels = [], timeout = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    for (const s of sels) { const el = [...document.querySelectorAll(s)].find(visible); if (el) return el; }
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

/** Inicia un recorrido (por defecto el general). */
export async function startTour(id = 'general') {
  stopTour();
  const tour = TOURS[id];
  if (!tour) return;
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  state = { id, tour, i: 0, root, target: null };
  const onKey = (e) => {
    if (!state) return;
    if (e.key === 'Escape') { e.stopPropagation(); stopTour(); }
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  };
  const onResize = () => place();
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  state.cleanup = () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onResize, true); };
  await show();
}

export function stopTour() {
  if (!state) return;
  state.cleanup?.();
  state.root.remove();
  state = null;
  try { localStorage.setItem('sc_tour_done', '1'); } catch (_) {}
}
export const tourActive = () => !!state;

async function go(d) {
  if (!state) return;
  const n = state.i + d;
  if (n < 0) return;
  if (n >= state.tour.steps.length) { stopTour(); return; }
  state.i = n;
  await show();
}

async function show() {
  const s = state.tour.steps[state.i];
  const tip = state.root.querySelector('.tour-tip');
  tip.classList.add('busy');
  const { navigate } = await import('./main.js');
  if (s.route && location.hash.replace(/^#\/?/, '') !== s.route) {
    await navigate(s.route);
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!state) return;
  closeAllModals();
  state.target = s.sel ? await findTarget(s.sel) : null;
  if (!state) return;
  if (state.target) state.target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const total = state.tour.steps.length;
  tip.innerHTML = `
    <div class="tour-step">${state.i + 1} de ${total}</div>
    <div class="tour-title">${esc(s.title)}</div>
    <div class="tour-text">${esc(s.text)}</div>
    <div class="tour-dots">${Array.from({ length: total }, (_, k) => `<i class="${k === state.i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="tour-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-t="stop">${s.final ? 'Cerrar' : 'Salir'}</button>
      <span class="grow"></span>
      ${state.i > 0 ? `<button type="button" class="btn btn-secondary btn-sm" data-t="prev">${icon('arrowLeft')}</button>` : ''}
      ${s.final && videoOk ? `<button type="button" class="btn btn-secondary btn-sm" data-t="video">${icon('eye')} Ver video</button>` : ''}
      <button type="button" class="btn btn-primary btn-sm" data-t="next">${state.i === total - 1 ? 'Terminar' : 'Siguiente'} ${state.i === total - 1 ? '' : icon('arrowRight')}</button>
    </div>`;
  tip.querySelector('[data-t="stop"]').onclick = stopTour;
  tip.querySelector('[data-t="next"]').onclick = () => go(1);
  const pv = tip.querySelector('[data-t="prev"]'); if (pv) pv.onclick = () => go(-1);
  const vd = tip.querySelector('[data-t="video"]'); if (vd) vd.onclick = () => { stopTour(); openVideo(); };
  tip.classList.remove('busy');
  place();
  tip.querySelector('[data-t="next"]').focus({ preventScroll: true });
}

function place() {
  if (!state) return;
  const spot = state.root.querySelector('.tour-spot');
  const tip = state.root.querySelector('.tour-tip');
  const vw = innerWidth, vh = innerHeight, pad = 8;
  const el = state.target;
  if (!el || !document.contains(el)) {
    spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0;`;
    tip.className = 'tour-tip center';
    tip.style.left = `${Math.max(12, (vw - tip.offsetWidth) / 2)}px`;
    tip.style.top = `${Math.max(12, (vh - tip.offsetHeight) / 2)}px`;
    return;
  }
  const r = el.getBoundingClientRect();
  const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
  const w = Math.min(vw - x - 4, r.width + pad * 2), h = Math.min(vh - y - 4, r.height + pad * 2);
  spot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14;
  let left, top, side;
  if (y + h + gap + th <= vh - 8) { side = 'bottom'; top = y + h + gap; left = x + w / 2 - tw / 2; }
  else if (y - gap - th >= 8) { side = 'top'; top = y - gap - th; left = x + w / 2 - tw / 2; }
  else if (x + w + gap + tw <= vw - 8) { side = 'right'; left = x + w + gap; top = y + h / 2 - th / 2; }
  else if (x - gap - tw >= 8) { side = 'left'; left = x - gap - tw; top = y + h / 2 - th / 2; }
  else { side = 'inside'; left = vw / 2 - tw / 2; top = vh - th - 16; }
  left = Math.max(10, Math.min(vw - tw - 10, left));
  top = Math.max(10, Math.min(vh - th - 10, top));
  tip.className = `tour-tip side-${side}`;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// ======================================================================
// Ayuda: lista de recorridos y video tutorial
// ======================================================================
export const VIDEO_URL = '/tutorial/sano-condominio-tutorial.mp4';

export function openVideo() {
  const m = openModal({
    title: 'Video tutorial', sub: 'Cómo usar SanoCondominio, paso a paso', size: 'xl',
    body: `<video class="tutorial-video" src="${VIDEO_URL}" poster="/tutorial/portada.jpg" controls autoplay playsinline preload="metadata"></video>`,
    footer: '<a class="btn btn-secondary" href="' + VIDEO_URL + '" download>' + icon('download') + ' Descargar</a><button class="btn btn-primary" data-close>Cerrar</button>'
  });
  return m;
}

let videoOk = null;
async function hasVideo() {
  if (videoOk != null) return videoOk;
  try { const r = await fetch(VIDEO_URL, { method: 'HEAD' }); videoOk = r.ok && /video/.test(r.headers.get('content-type') || ''); } catch (_) { videoOk = false; }
  return videoOk;
}

export async function openHelp() {
  const video = await hasVideo();
  const m = openModal({
    title: 'Ayuda', sub: video ? 'Elige un recorrido guiado o mira el video tutorial' : 'Elige un recorrido guiado', size: 'md',
    body: `<div class="stack">
      ${video ? `<button type="button" class="help-video" data-video><span class="help-play">${icon('arrowRight')}</span><span><b>Video tutorial</b><small>Las funciones principales explicadas con voz</small></span></button>` : ''}
      <div class="section-title">Recorridos guiados</div>
      <div class="help-list">${Object.entries(TOURS).map(([k, t]) => `<button type="button" class="help-item" data-tour-id="${k}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon(t.icon)}</span><span class="grow"><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></span>${icon('arrowRight')}</button>`).join('')}</div>
    </div>`,
    footer: '<button class="btn btn-primary" data-close>Cerrar</button>'
  });
  const vb = m.el.querySelector('[data-video]'); if (vb) vb.onclick = () => { m.close(); openVideo(); };
  m.el.querySelectorAll('[data-tour-id]').forEach((b) => b.onclick = () => { m.close(); startTour(b.dataset.tourId); });
}
