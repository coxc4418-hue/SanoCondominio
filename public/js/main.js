// SanoCondominio — Arranque, inicio de sesión, estructura y navegación
import { auth, onAuthStateChanged } from './firebase.js';
import { store, getTenant } from './store.js';
import { session, login, logout, freshStart, authErrorMessage, SUPER_EMAIL, usernameOf } from './auth.js';
import { esc, toast, closeAllModals, $, $$, setBusy, confirmDialog, toggleTheme, openModal, fmtDate, loc, flagImg, debounce } from './utils.js';
import { icon } from './icons.js';
import { rateChip, startBcv } from './bcv.js';
import { openCountryPicker, salesWa, SALES_PHONE_FMT } from './shared.js';
import { isStandalone, platform, bindInstallButtons } from './install.js';
import { buildingOptions } from './unit.js';

export const VERSION = '1.0.1';

const ROUTES = {
  inicio: { title: 'Inicio', icon: 'home', group: 'Condominio', load: () => import('./views/dashboard.js') },
  cobranza: { title: 'Cobranza', icon: 'wallet', group: 'Condominio', load: () => import('./views/collect.js') },
  unidades: { title: 'Unidades y propietarios', icon: 'building', group: 'Condominio', load: () => import('./views/units.js') },
  gastos: { title: 'Gastos del mes', icon: 'receipt', group: 'Mes a mes', load: () => import('./views/expenses.js') },
  recibos: { title: 'Recibos (cierre del mes)', icon: 'file', group: 'Mes a mes', load: () => import('./views/billing.js') },
  fondos: { title: 'Fondos y cuentas', icon: 'piggy', group: 'Mes a mes', load: () => import('./views/funds.js') },
  comunicados: { title: 'Comunicados', icon: 'megaphone', group: 'Comunidad', load: () => import('./views/notices.js') },
  solicitudes: { title: 'Solicitudes', icon: 'inbox', group: 'Comunidad', load: () => import('./views/requests.js') },
  reservas: { title: 'Áreas comunes', icon: 'calendar', group: 'Comunidad', load: () => import('./views/bookings.js') },
  asambleas: { title: 'Asambleas y votaciones', icon: 'vote', group: 'Comunidad', load: () => import('./views/votes.js') },
  reportes: { title: 'Reportes', icon: 'chart', group: 'Administración', pin: true, load: () => import('./views/reports.js') },
  ajustes: { title: 'Configuración', icon: 'settings', group: 'Administración', load: () => import('./views/settings.js') }
};

let currentRoute = null;
let currentCleanup = null;
let storeUnsub = null;
let routeParams = {};

// Página pública (sin sesión): portal del propietario
const PUBLIC_PORTAL = /^\/portal(\/|$)/i.test(location.pathname);

const root = () => document.getElementById('root');
function hideBoot() {
  const b = document.getElementById('boot');
  if (b) { b.style.opacity = '0'; b.style.pointerEvents = 'none'; setTimeout(() => b.remove(), 300); }
}
function showBoot() {
  if (document.getElementById('boot')) return;
  const b = document.createElement('div');
  b.id = 'boot'; b.className = 'boot';
  b.innerHTML = '<div class="boot-inner"><img src="/assets/icon-192.png" alt=""><div class="spinner"></div></div>';
  document.body.appendChild(b);
}

// ======================================================================
// LOGIN
// ======================================================================
function renderLogin() {
  teardownApp();
  root().innerHTML = `
    <div class="auth-screen">
      <section class="auth-hero">
        <div class="auth-skyline" aria-hidden="true">${'<i></i>'.repeat(9)}</div>
        <div class="auth-brand"><img src="/assets/logo.svg" alt=""><div>SanoCondominio<small>Administración de condominios</small></div></div>
        <div style="position:relative;z-index:1">
          <h1>Tu condominio claro, <em>cada cuenta al día.</em></h1>
          <p>Carga los gastos, emite los recibos por alícuota en un clic y cobra con recordatorios por WhatsApp. Cada propietario tiene su portal para ver sus recibos, reportar su pago y votar. Transparencia total, cero hojas de cálculo.</p>
          <div class="auth-features">
            <div class="auth-feature"><span>${icon('receipt')}</span>Recibos por alícuota con fondo de reserva, cuotas especiales y mora</div>
            <div class="auth-feature"><span>${icon('wallet')}</span>Cobranza en dólares y bolívares a tasa BCV · morosos al día</div>
            <div class="auth-feature"><span>${icon('qr')}</span>Portal del propietario: recibos, relación de gastos y reporte de pago</div>
            <div class="auth-feature"><span>${icon('vote')}</span>Asambleas y votaciones por alícuota desde el teléfono</div>
            <div class="auth-feature"><span>${icon('calendar')}</span>Reservas del salón de fiestas, parrillera y áreas comunes</div>
            <div class="auth-feature"><span>${icon('shieldCheck')}</span>Constancias de solvencia y estados de cuenta en segundos · 20 países</div>
          </div>
        </div>
        <div class="small" style="color:rgba(255,255,255,.55);position:relative;z-index:1">© ${new Date().getFullYear()} SanoCondominio · Instálalo desde Chrome en tu teléfono o computadora</div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <div class="auth-mobile-brand"><img src="/assets/logo.svg" alt=""> SanoCondominio</div>
          <h2>Bienvenido</h2>
          <p class="muted" style="margin:0">Ingresa con el usuario de tu administración o junta de condominio.</p>
          <form class="stack mt-lg" id="login-form" autocomplete="on">
            <div class="field">
              <label for="lg-user">Usuario o correo</label>
              <input class="input" id="lg-user" name="username" autocomplete="username" placeholder="ej. sede01" autocapitalize="off" spellcheck="false" required>
            </div>
            <div class="field">
              <label for="lg-pass">Contraseña</label>
              <div class="input-group">
                <input class="input" id="lg-pass" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required style="padding-right:44px">
                <button type="button" class="btn btn-ghost btn-icon btn-sm suffix-btn" id="lg-eye" aria-label="Mostrar contraseña">${icon('eye')}</button>
              </div>
            </div>
            <div class="error-msg" id="lg-err"></div>
            <button class="btn btn-primary btn-lg btn-block" id="lg-btn" type="submit">${icon('lock')} Entrar</button>
          </form>
          <div class="auth-or"><span>¿Quieres conocerlo?</span></div>
          <button class="btn btn-demo btn-lg btn-block" id="lg-demo" type="button">${icon('sparkle')} Probar demo gratis · 30 min</button>
          <p class="hint center mt">Sin registro. Incluye una administradora de ejemplo con dos edificios, propietarios, gastos, recibos, pagos, morosos, solicitudes y una votación; se borra al terminar. PIN de la demo: <b>1234</b>.</p>
          <a class="btn btn-whatsapp btn-lg btn-block mt" id="lg-wa" href="${salesWa()}" target="_blank" rel="noopener">${icon('whatsapp')} Contratar SanoCondominio</a>
          <p class="hint center mt">WhatsApp: <b>${SALES_PHONE_FMT}</b></p>
          <button type="button" class="btn btn-ghost btn-block" id="lg-portal">${icon('key')} Soy propietario: ver mi portal</button>
          ${isStandalone() ? '' : `<div class="install-card mt">
            <img src="/assets/icon-192.png" alt="">
            <div class="grow"><b>Instala la app</b><span>${platform() === 'desktop' ? 'Acceso directo en tu computadora' : 'Ícono en tu teléfono'}, sin tiendas ni descargas.</span></div>
            <button type="button" class="btn btn-primary btn-sm" data-install>${icon('install')} Instalar</button>
          </div>`}
          <p class="auth-foot">¿Olvidaste tu contraseña? Escríbenos por WhatsApp.</p>
        </div>
      </section>
    </div>`;
  hideBoot();
  const eye = $('#lg-eye');
  eye.onclick = () => {
    const p = $('#lg-pass');
    p.type = p.type === 'password' ? 'text' : 'password';
    eye.innerHTML = icon(p.type === 'password' ? 'eye' : 'eyeOff');
  };
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#lg-btn'); const err = $('#lg-err');
    err.textContent = '';
    setBusy(btn, true, 'Verificando…');
    try { await login($('#lg-user').value, $('#lg-pass').value); }
    catch (ex) {
      err.textContent = authErrorMessage(ex);
      const p = $('#lg-pass'); p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake');
      setBusy(btn, false);
    }
  };
  $('#lg-demo').onclick = async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Preparando tu condominio de prueba…');
    try { const { startDemo } = await import('./demo.js'); await startDemo(); }
    catch (ex) {
      $('#lg-err').textContent = ex?.code === 'auth/operation-not-allowed' ? 'La demo no está disponible en este momento.' : authErrorMessage(ex);
      setBusy(btn, false);
    }
  };
  $('#lg-portal').onclick = () => {
    const m = openModal({
      title: 'Portal del propietario', sub: 'Escribe el código de 8 letras que te dio la administración (está en tu recibo y en el enlace que te enviaron).', size: 'sm',
      body: `<form class="stack" data-f><input class="input input-lg center mono" data-c maxlength="8" placeholder="Ej.: K7P3QXZ2" autocapitalize="characters" autofocus style="letter-spacing:.2em;text-transform:uppercase"></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('key')} Entrar</button>`
    });
    const go = (ev) => { ev?.preventDefault(); const c = m.el.querySelector('[data-c]').value.trim().toUpperCase(); if (c.length >= 4) location.href = '/portal/' + encodeURIComponent(c); };
    m.el.querySelector('[data-f]').onsubmit = go; m.el.querySelector('[data-ok]').onclick = go;
  };
  bindInstallButtons(root());
  // Cursor en el usuario solo en computadoras con mouse y sin aviso encima: en teléfonos
  // abriría el teclado y taparía el aviso de la demo / el botón de contacto.
  const desk = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  if (desk && !demoEndedNotice) setTimeout(() => $('#lg-user')?.focus(), 50);
  if (demoEndedNotice) showDemoEnded();
}

// ======================================================================
// SESIÓN
// ======================================================================
if (PUBLIC_PORTAL) {
  import('./views/portal.js').then((m) => { m.mount(root()); hideBoot(); }).catch((e) => { console.error(e); hideBoot(); });
} else {
  onAuthStateChanged(auth, async (user) => {
    session.user = user;
    if (!user) { renderLogin(); return; }
    session.isSuper = user.email === SUPER_EMAIL;
    showBoot();
    try {
      if (user.isAnonymous) await enterDemo(user);
      else if (session.isSuper) {
        const viewing = sessionStorage.getItem('sc_view_tenant');
        if (viewing) await enterTenant(viewing); else await renderAdminPanel();
      } else await enterTenant(user.uid);
    } catch (e) { console.error(e); renderError(e); }
  });
}

function centerCard(inner) {
  teardownApp();
  root().innerHTML = `<div class="auth-screen" style="grid-template-columns:1fr"><section class="auth-panel"><div class="auth-card center">${inner}</div></section></div>`;
  hideBoot();
}
function renderError(e) {
  centerCard(`
    <div class="kpi-icon tone-danger" style="margin:0 auto 12px;width:56px;height:56px">${icon('alert')}</div>
    <h2>No se pudo abrir el condominio</h2>
    <p class="muted mt">${esc(e?.message || e)}</p>
    <button class="btn btn-primary btn-block mt-lg" id="err-retry">Reintentar</button>
    <button class="btn btn-ghost btn-block mt" id="err-out">Cerrar sesión</button>`);
  $('#err-retry').onclick = () => location.reload();
  $('#err-out').onclick = () => logout();
}
function renderBlocked(t, kind) {
  const texts = {
    frozen: ['Cuenta congelada', `El acceso de <b>${esc(t?.name || 'tu condominio')}</b> está temporalmente congelado${t?.frozenReason ? ': ' + esc(t.frozenReason) : '.'} Tus datos están a salvo.`],
    expired: ['Tu plan venció', `El plan de <b>${esc(t?.name || 'tu condominio')}</b> venció el ${fmtDate(paidUntilISO(t))}. Renuévalo para seguir trabajando; tus datos están a salvo.`],
    missing: ['Cuenta sin condominio asignado', 'Esta cuenta no tiene un condominio activo en SanoCondominio. Contáctanos para activarla.']
  }[kind];
  centerCard(`
    <div class="kpi-icon tone-warning" style="margin:0 auto 12px;width:56px;height:56px">${icon('lock')}</div>
    <h2>${texts[0]}</h2>
    <p class="muted mt">${texts[1]}</p>
    <a class="btn btn-whatsapp btn-lg btn-block mt-lg" href="${salesWa(`Hola, necesito ayuda con mi cuenta de SanoCondominio (${t?.code || session.user?.email || ''}).`)}" target="_blank" rel="noopener">${icon('whatsapp')} Escríbenos por WhatsApp</a>
    <p class="hint center mt">${SALES_PHONE_FMT}</p>
    <button class="btn btn-secondary btn-block mt" id="blk-out">Cerrar sesión</button>`);
  $('#blk-out').onclick = () => logout();
}
const tsMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v ? new Date(v).getTime() : 0);
const paidUntilISO = (t) => (t?.paidUntil ? new Date(tsMillis(t.paidUntil)).toISOString() : null);
function tenantState(t) {
  if (!t || t.deleted) return 'missing';
  if (t.active === false) return 'frozen';
  if (t.paidUntil && tsMillis(t.paidUntil) < Date.now()) return 'expired';
  return 'ok';
}

async function enterTenant(tenantId) {
  let t = null;
  try { t = await getTenant(tenantId); } catch (e) { if (e?.code !== 'unavailable' && e?.code !== 'permission-denied') throw e; }
  if (session.isSuper && !t) { sessionStorage.removeItem('sc_view_tenant'); await renderAdminPanel(); return; }
  const st = tenantState(t);
  if (st !== 'ok' && !session.isSuper) { renderBlocked(t, st); return; }
  if (session.isSuper) sessionStorage.setItem('sc_view_tenant', tenantId);
  await store.start(tenantId); startBcv();
  renderShell();
  const hash = location.hash.replace(/^#\/?/, '');
  navigate(ROUTES[hash] ? hash : 'inicio', { replace: true });
  hideBoot();
  afterEnter();
}

/** La primera vez se elige el país (moneda, formas de pago y WhatsApp) */
async function ensureCountry() {
  if (store.country) return;
  await openCountryPicker({ force: true });
  if (store.country) { renderShell(); navigate(currentRoute || 'inicio', { replace: true, force: true }); }
}
/** Sin edificios: asistente para crear el primero */
async function ensureBuilding() {
  if (store.buildings.length || session.isSuper) return;
  const { buildingWizard } = await import('./views/settings.js');
  const b = await buildingWizard({ first: true });
  if (b) { store.setBuilding(''); renderShell(); navigate('unidades', { replace: true, force: true }); }
}
async function afterEnter() {
  await ensureCountry();
  await ensureBuilding();
  startPublisher();
}

// Mantiene al día el portal de cada propietario mientras la app está abierta
let pubOff = null;
function startPublisher() {
  pubOff?.();
  if (session.isSuper && !store.isDemo) return;
  import('./ops.js').then(({ publishPortals, resetPublished, processInboxVotes, setPublishScheduler }) => {
    resetPublished();
    const run = debounce(() => publishPortals().catch((e) => console.warn('[portal]', e?.code || e)), 3500);
    setPublishScheduler(run);
    run();
    const votes = debounce(() => processInboxVotes().catch((e) => console.warn('[votos]', e?.code || e)), 1500);
    votes();
    const offs = ['units', 'notices', 'votes', 'bookings', 'closings', 'settings', 'payments', 'funds', 'buildings'].map((k) => store.on(k, run));
    offs.push(store.on('inbox', () => { run(); votes(); }));
    const iv = setInterval(run, 10 * 60000);
    pubOff = () => { offs.forEach((o) => o()); clearInterval(iv); setPublishScheduler(null); pubOff = null; };
  });
}

// ======================================================================
// DEMO
// ======================================================================
let demoTimer = null;
let demoEndedNotice = false;
try { if (sessionStorage.getItem('sc_demo_ended')) { sessionStorage.removeItem('sc_demo_ended'); demoEndedNotice = true; } } catch (_) {}
let autoTourStarted = false;
async function enterDemo(user) {
  const demo = await import('./demo.js');
  let t = null;
  try { t = await getTenant(user.uid); } catch (_) {}
  if (!t) {
    await demo.createDemoTenant(user.uid);
    await store.start(user.uid); startBcv();
    hideBoot();
    await ensureCountry();
    showBoot();
    await demo.seedDemoActivity();
  } else {
    if (demo.demoRemainingMs(t) <= 0) { await endDemo(true); return; }
    await store.start(user.uid); startBcv();
  }
  renderShell();
  // Recién creada: Inicio; al recargar la página se queda en la pantalla donde estaba
  const want = location.hash.replace(/^#\/?/, '').split('?')[0];
  navigate(t && ROUTES[want] ? want : 'inicio', { replace: true, force: true });
  hideBoot();
  startDemoTimer();
  await ensureCountry();
  startPublisher();
  if (!t && !autoTourStarted) { autoTourStarted = true; setTimeout(() => import('./tour.js').then((m) => { if (!m.tourActive()) m.startTour('general'); }), 700); }
}
function startDemoTimer() {
  clearInterval(demoTimer);
  const tick = async () => {
    const { demoRemainingMs } = await import('./demo.js');
    const ms = demoRemainingMs(store.tenant);
    const el = document.getElementById('demo-left');
    if (ms <= 0) { clearInterval(demoTimer); await endDemo(false); return; }
    if (el) {
      const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
      el.textContent = `${m}:${String(sec).padStart(2, '0')}`;
      el.closest('.demo-clock')?.classList.toggle('demo-ending', ms < 5 * 60000);
    }
    if (ms < 5 * 60000 && ms > 4 * 60000 + 58000) toast('Quedan 5 minutos de demo.', 'warning', 4000);
  };
  tick();
  demoTimer = setInterval(tick, 1000);
}
async function endDemo(silent) {
  clearInterval(demoTimer);
  const tenantId = auth.currentUser?.uid;
  const codes = store.units.map((u) => u.portalCode).filter(Boolean);
  pubOff?.();
  teardownApp();
  store.stop();
  showBoot();
  if (!silent) { demoEndedNotice = true; try { sessionStorage.setItem('sc_demo_ended', '1'); } catch (_) {} }
  const { cleanupDemo } = await import('./demo.js');
  if (tenantId) await cleanupDemo(tenantId, codes);
  try { if (tenantId) localStorage.removeItem('sc_bld_' + tenantId); } catch (_) {}
  if (auth.currentUser) await logout().catch(() => {});
  freshStart();
}
function showDemoEnded() {
  demoEndedNotice = false;
  openModal({
    title: 'Tu demo terminó', size: 'sm',
    body: `<div class="stack"><p class="muted" style="margin:0">Los datos de prueba se eliminaron.</p>
      <p style="margin:0">¿Te gustó SanoCondominio? Escríbenos al <b>${SALES_PHONE_FMT}</b> y activa la cuenta de tu condominio con tus propios datos.</p></div>`,
    footer: `<button class="btn btn-secondary" data-close>Cerrar</button><a class="btn btn-whatsapp" href="${salesWa()}" target="_blank" rel="noopener">${icon('whatsapp')} Escríbenos</a>`
  });
}

// ======================================================================
// PANEL DEL ADMINISTRADOR GENERAL
// ======================================================================
async function renderAdminPanel() {
  teardownApp();
  pubOff?.();
  store.stop();
  root().innerHTML = '<div id="admin-root"></div>';
  const mod = await import('./views/admin.js');
  currentCleanup = mod.mount($('#admin-root'), {
    enter: async (id) => { showBoot(); sessionStorage.setItem('sc_view_tenant', id); location.hash = '#/inicio'; await enterTenant(id); },
    logout: () => logout()
  });
  hideBoot();
}

// ======================================================================
// ESTRUCTURA
// ======================================================================
function navItems() {
  const groups = {};
  for (const [id, r] of Object.entries(ROUTES)) if (!r.hidden) (groups[r.group] ||= []).push([id, r]);
  return Object.entries(groups).map(([g, items]) => `
    <div class="sb-section">${g}</div>
    ${items.map(([id, r]) => `<button class="nav-item" data-nav="${id}">${icon(r.icon)}<span>${r.title}</span><span class="nav-badge" data-badge="${id}" hidden></span></button>`).join('')}
  `).join('') + `<button class="nav-item" id="sb-help">${icon('info')}<span>Ayuda y recorridos</span></button>`;
}
function planWarning() {
  const t = store.tenant;
  if (!t?.paidUntil || session.isSuper) return '';
  const days = Math.ceil((tsMillis(t.paidUntil) - Date.now()) / 86400000);
  if (days > 5) return '';
  return `<div class="banner offline-banner"><span>${icon('clock')} Tu plan vence ${days <= 0 ? 'hoy' : `en ${days} día(s)`} (${fmtDate(paidUntilISO(t))}).</span><a class="btn btn-sm btn-whatsapp" href="${salesWa('Hola, quiero renovar mi plan de SanoCondominio.')}" target="_blank" rel="noopener">${icon('whatsapp')} Renovar</a></div>`;
}
const bldSwitch = (id) => store.liveBuildings.length > 1
  ? `<label class="bld-switch" title="Edificio con el que trabajas">${icon('building')}<select id="${id}">${buildingOptions(store.building, { all: true })}</select></label>` : '';

function renderShell() {
  teardownApp();
  const tName = store.tenant?.name || store.businessName;
  root().innerHTML = `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="sb-brand"><img src="/assets/logo.svg" alt=""><div><b>SanoCondominio</b><small>Administración de condominios</small></div></div>
        <div class="sb-tenant"><div class="xs">Administración</div><b id="sb-tenant-name">${esc(tName)}</b>${bldSwitch('sb-bld')}<div class="sb-live" id="sb-live"></div></div>
        <button class="sb-search" id="sb-search">${icon('search')}<span>Buscar unidad, propietario, recibo…</span><kbd>Ctrl K</kbd></button>
        <nav class="sb-nav">${navItems()}</nav>
        <div class="sb-foot">
          <button class="rate-pill" id="sb-rate" title="País y moneda de trabajo"><span>${flagImg(loc().code)} ${esc(loc().name)}</span><b id="sb-rate-val">${esc(loc().cur)} · ${esc(loc().sym)}</b></button>
          <div class="between">
            <div class="sb-status"><span class="dot" id="sb-dot"></span><span id="sb-net">En línea</span></div>
            <div class="row">
              ${isStandalone() ? '' : `<button class="sb-btn" data-install title="Instalar la app en este equipo">${icon('install')} Instalar</button>`}
              <button class="sb-btn" id="sb-theme" title="Cambiar tema" style="padding:6px 8px">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button>
            </div>
          </div>
          <div class="sb-user"><span title="${esc(session.user?.email || '')}">${esc(session.user?.isAnonymous ? 'Invitado (demo)' : usernameOf(session.user?.email))}</span><button class="sb-btn" id="sb-logout">${icon('logout')} Salir</button></div>
        </div>
      </aside>
      <div class="sidebar-backdrop" id="sb-backdrop"></div>
      <div class="main">
        ${session.isSuper ? `<div class="banner admin-banner"><span>${icon('shield')} Modo administrador · <b>${esc(tName)}</b></span><button id="ab-back">← Volver al panel de sedes</button></div>` : ''}
        ${store.isDemo ? `<div class="banner demo-banner"><span>${icon('sparkle')} <b>Modo demo</b><span class="hide-sm"> · datos de ejemplo, se borran al terminar</span> · PIN <b>1234</b></span><span class="demo-clock">${icon('clock')} <b id="demo-left">30:00</b><button id="demo-end">Terminar</button></span></div>` : ''}
        ${planWarning()}
        <div id="announce"></div>
        <div class="offline-banner" id="offline-banner" hidden>Sin conexión: puedes seguir trabajando, se sincroniza al volver internet.</div>
        <header class="topbar">
          <button class="btn btn-ghost btn-icon" id="tb-menu" aria-label="Menú">${icon('menu')}</button>
          <img src="/assets/logo.svg" alt="">
          <div class="grow" style="min-width:0"><div class="tb-title ellipsis" id="tb-title">SanoCondominio</div><div class="tb-sub ellipsis" id="tb-sub">${esc(store.bld(store.building)?.name || tName)}</div></div>
          ${store.liveBuildings.length > 1 ? `<button class="btn btn-ghost btn-icon" id="tb-bld" aria-label="Cambiar edificio" title="Cambiar edificio">${icon('building')}</button>` : ''}
          <button class="btn btn-ghost btn-icon" id="tb-search" aria-label="Buscar">${icon('search')}</button>
          ${isStandalone() ? '' : `<button class="btn btn-ghost btn-icon hide-xs" data-install aria-label="Instalar app" title="Instalar app">${icon('install')}</button>`}
          <button class="rate-mini" id="tb-rate" title="${esc(loc().name)}">${rateChip()}</button>
        </header>
        <main class="content" id="view"></main>
      </div>
      <nav class="bottom-nav">
        <button data-nav="inicio">${icon('home')}Inicio</button>
        <button data-nav="cobranza">${icon('wallet')}Cobranza<span class="bn-badge" data-badge-m="cobranza" hidden></span></button>
        <button data-nav="gastos">${icon('receipt')}Gastos</button>
        <button data-nav="recibos">${icon('file')}Recibos</button>
        <button data-nav="unidades">${icon('building')}Unidades</button>
        <button id="bn-more">${icon('menu')}Más<span class="bn-badge" data-badge-m="solicitudes" hidden></span></button>
      </nav>
    </div>`;

  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => { navigate(b.dataset.nav); closeSidebar(); }));
  $('#tb-menu').onclick = openSidebar;
  $('#sb-help').onclick = () => { closeSidebar(); import('./tour.js').then((t) => t.openHelp()); };
  $('#bn-more').onclick = openSidebar;
  $('#sb-backdrop').onclick = closeSidebar;
  const pickCountry = async () => { const { requirePin } = await import('./auth.js'); if (!(await requirePin('Cambiar el país y la moneda'))) return; if (await openCountryPicker()) { renderShell(); navigate(currentRoute || 'inicio', { replace: true, force: true }); } };
  $('#sb-rate').onclick = pickCountry;
  $('#tb-rate').onclick = pickCountry;
  $('#sb-search').onclick = () => { closeSidebar(); openSearch(); };
  $('#tb-search').onclick = openSearch;
  const changeBld = (id) => { store.setBuilding(id); renderShell(); navigate(currentRoute || 'inicio', { replace: true, force: true }); toast(id ? `Trabajando en ${store.bldName(id)}` : 'Viendo todos los edificios', 'info'); };
  $('#sb-bld')?.addEventListener('change', (e) => changeBld(e.target.value));
  $('#tb-bld')?.addEventListener('click', () => {
    const m = openModal({ title: 'Edificio de trabajo', size: 'sm', body: `<div class="list">${[['', 'Todos los edificios'], ...store.liveBuildings.map((b) => [b.id, b.name])].map(([id, n]) => `<button class="list-item linkish ${store.building === id ? 'on' : ''}" data-b="${id}" style="width:100%;text-align:left"><span class="kpi-icon tone-brand" style="width:34px;height:34px">${icon('building')}</span><b class="grow">${esc(n)}</b>${store.building === id ? icon('check') : ''}</button>`).join('')}</div>` });
    m.el.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { m.close(); changeBld(b.dataset.b); });
  });
  $('#sb-logout').onclick = async () => {
    if (store.isDemo) { if (await confirmDialog({ title: 'Terminar demo', message: 'Se cerrará la sesión y se borrarán los datos de esta demo.', confirmText: 'Terminar', danger: true })) endDemo(false); return; }
    if (await confirmDialog({ title: 'Cerrar sesión', message: '¿Deseas salir de SanoCondominio en este dispositivo?', confirmText: 'Salir' })) logout();
  };
  $('#sb-theme').onclick = toggleTheme;
  if (store.isDemo) $('#demo-end').onclick = async () => {
    if (await confirmDialog({ title: 'Terminar demo', message: 'Se cerrará la sesión y se borrarán los datos de esta demo.', confirmText: 'Terminar', danger: true })) endDemo(false);
  };
  if (session.isSuper) $('#ab-back').onclick = () => { sessionStorage.removeItem('sc_view_tenant'); location.hash = ''; showBoot(); renderAdminPanel(); };
  bindInstallButtons(root());

  storeUnsub = store.on('*', (evt) => {
    if (evt === 'settings' || evt === 'rate') {
      $('#sb-rate-val') && ($('#sb-rate-val').textContent = `${loc().cur} · ${loc().sym}`);
      $('#tb-rate') && ($('#tb-rate').innerHTML = rateChip());
    }
    if (evt === 'tenant') {
      $('#sb-tenant-name') && ($('#sb-tenant-name').textContent = store.tenant?.name || store.businessName);
      const st = tenantState(store.tenant);
      if (st !== 'ok' && !session.isSuper && !store.isDemo) renderBlocked(store.tenant, st);
    }
    if (evt === 'buildings') {
      const want = store.liveBuildings.length > 1;
      if (want !== !!$('#sb-bld')) { renderShell(); navigate(currentRoute || 'inicio', { replace: true, force: true }); return; }
    }
    if (evt === 'building' || evt === 'buildings') {
      const sel = $('#sb-bld'); if (sel && sel.value !== store.building) sel.value = store.building;
      $('#tb-sub') && ($('#tb-sub').textContent = store.bld(store.building)?.name || store.tenant?.name || store.businessName);
    }
    if (['units', 'inbox', 'bookings', 'settings', 'building'].includes(evt)) updateBadges();
    if (evt === 'inbox') notifyInbox();
    if (evt === 'announcement') renderAnnouncement();
    if (evt === 'denied' && !session.isSuper) toast('Acceso denegado a los datos del condominio.', 'danger', 5000);
  });
  updateBadges();
  renderAnnouncement();
  updateNetwork();
}

function setBadge(id, n, cls = '') {
  const b = document.querySelector(`[data-badge="${id}"]`);
  if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; b.className = 'nav-badge ' + cls; }
  const m = document.querySelector(`[data-badge-m="${id}"]`);
  if (m) { m.hidden = !n; m.textContent = n > 99 ? '99+' : n; }
}
function updateBadges() {
  setBadge('cobranza', store.reportedPayments.length, 'info');
  setBadge('solicitudes', store.newRequests.length, 'warn');
  setBadge('reservas', store.bookingRequests.length, 'info');
  setBadge('asambleas', store.openVotes.length, 'info');
  const live = $('#sb-live');
  if (live) live.innerHTML = `<span class="live-dot"></span>${store.scopeUnits.length} unidades · ${store.solventPct}% solventes`;
}

let seenInbox = null;
function notifyInbox() {
  const fresh = store.inbox.filter((x) => x.status === 'nueva' && x.type !== 'voto');
  const ids = new Set(fresh.map((r) => r.id));
  if (seenInbox) {
    const n = fresh.filter((r) => !seenInbox.has(r.id));
    if (n.length) {
      const x = n[0];
      const txt = x.type === 'pago' ? `Pago reportado por ${x.unitCode}` : x.type === 'reserva' ? `Solicitud de reserva de ${x.unitCode}` : `Nueva solicitud de ${x.unitCode}`;
      toast(txt + (n.length > 1 ? ` y ${n.length - 1} más` : ''), 'info', 7000);
    }
  }
  seenInbox = ids;
}

function renderAnnouncement() {
  const el = $('#announce');
  if (!el) return;
  const a = store.announcement;
  let dismissed = '';
  try { dismissed = localStorage.getItem('sc_announce') || ''; } catch (_) {}
  if (!a?.active || !a.text || dismissed === a.updatedAt) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="banner announce-banner"><span>${icon('bell')} ${esc(a.text)}</span><button id="an-x" aria-label="Cerrar aviso">${icon('x')}</button></div>`;
  $('#an-x').onclick = () => { try { localStorage.setItem('sc_announce', a.updatedAt); } catch (_) {} el.innerHTML = ''; };
}

function openSidebar() { $('#sidebar')?.classList.add('open'); $('#sb-backdrop')?.classList.add('open'); }
function closeSidebar() { $('#sidebar')?.classList.remove('open'); $('#sb-backdrop')?.classList.remove('open'); }

function teardownApp() {
  if (currentCleanup) { try { currentCleanup(); } catch (e) { console.error(e); } }
  currentCleanup = null; currentRoute = null;
  if (storeUnsub) { storeUnsub(); storeUnsub = null; }
  closeAllModals();
}

function openSearch() { import('./views/search.js').then((m) => m.openSearch()); }

// ======================================================================
// NAVEGACIÓN
// ======================================================================
let navToken = 0;
export async function navigate(id, { replace = false, force = false, params = {} } = {}) {
  if (!ROUTES[id]) id = 'inicio';
  if (!document.getElementById('view')) return;
  if (id === currentRoute && !force && !Object.keys(params).length) return;
  const route = ROUTES[id];
  if (route.pin) {
    const { requirePin } = await import('./auth.js');
    if (!(await requirePin(`Acceder a ${route.title}`))) {
      if (!currentRoute) navigate('inicio', { replace: true });
      else history.replaceState(null, '', '#/' + currentRoute);
      return;
    }
  }
  const token = ++navToken;
  closeAllModals();
  if (currentCleanup) { try { currentCleanup(); } catch (e) { console.error(e); } currentCleanup = null; }
  currentRoute = id;
  routeParams = params;
  const url = '#/' + id;
  if (replace) history.replaceState(null, '', url); else if (location.hash !== url) history.pushState(null, '', url);
  $$('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === id));
  const tt = $('#tb-title'); if (tt) tt.textContent = route.title;
  document.title = `${route.title} · SanoCondominio`;
  const view = $('#view');
  view.className = 'content';
  view.closest('.main')?.classList.remove('main-fixed');
  view.innerHTML = '<div class="empty"><div class="spinner" style="margin:40px auto"></div></div>';
  try {
    const mod = await route.load();
    if (token !== navToken) return;
    view.innerHTML = '';
    window.scrollTo(0, 0);
    // Cada vista vive en su propio contenedor: si algo asíncrono termina después de salir, no toca la vista nueva
    const host = document.createElement('div');
    host.className = 'view-host';
    view.appendChild(host);
    currentCleanup = mod.mount(host, { navigate, params: routeParams }) || null;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card">${esc('No se pudo cargar la sección: ' + (e?.message || e))}</div>`;
  }
}

window.addEventListener('popstate', () => {
  const id = location.hash.replace(/^#\/?/, '');
  if (document.getElementById('view') && ROUTES[id] && id !== currentRoute) navigate(id, { replace: true });
});
window.addEventListener('keydown', (e) => {
  if (!document.getElementById('view')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
  if (e.key === 'F1') { e.preventDefault(); import('./unit.js').then((m) => m.paymentModal()); }
  if (e.key === 'F2') { e.preventDefault(); navigate('gastos'); }
  if (e.key === 'F3') { e.preventDefault(); navigate('unidades'); }
  if (e.key === 'F4') { e.preventDefault(); navigate('cobranza'); }
});

// ======================================================================
// RED, PWA
// ======================================================================
function updateNetwork() {
  const on = navigator.onLine;
  const dot = $('#sb-dot'); const net = $('#sb-net'); const ban = $('#offline-banner');
  if (dot) dot.classList.toggle('off', !on);
  if (net) net.textContent = on ? 'En línea' : 'Sin conexión';
  if (ban) ban.hidden = on;
}
window.addEventListener('online', () => { updateNetwork(); toast('Conexión restablecida. Sincronizando…', 'info'); });
window.addEventListener('offline', updateNetwork);

if ('serviceWorker' in navigator && !sessionStorage.getItem('sc_emu')) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg.update().catch(() => {});
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Actualizando a la nueva versión…', 'info', 4000);
      });
    });
    // Revisa si hay versión nueva al volver a la app y cada 30 minutos
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 30 * 60000);
  }).catch((e) => console.warn('SW', e));
  // Versión nueva activa: recarga una sola vez (si hay un formulario abierto, espera a que se cierre)
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    const go = () => { if (reloading) return; reloading = true; location.reload(); };
    if (!document.querySelector('#modals .modal-backdrop, #modals .modal')) { go(); return; }
    const t = setInterval(() => { if (!document.querySelector('#modals .modal-backdrop, #modals .modal')) { clearInterval(t); go(); } }, 1500);
  });
}
