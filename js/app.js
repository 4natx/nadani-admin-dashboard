import { reportsView, settingsView } from './admin.js';
import { periodFor } from './analytics.js';
import { applyCommand } from './business.js';
import { analyticsView, overviewView } from './dashboard.js';
import { makeDemo } from './demo.js';
import { saleForm } from './forms.js';
import { initialState, localDay } from './model.js';
import { customersView, inventoryView, productsView, salesView } from './records.js';
import { download } from './reports.js';
import { openDatabase, storeFor } from './storage.js';
import { $, button, el, icon, note, titles } from './ui.js';

const views = { overview: overviewView, products: productsView, inventory: inventoryView, customers: customersView,
  sales: salesView, analytics: analyticsView, reports: reportsView, settings: settingsView };
const screen = $('#screen');
const sidebar = $('#sidebar');
const toggle = $('#menu-toggle');
const modal = $('#modal');
const media = matchMedia('(prefers-color-scheme: dark)');
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nadani-admin-dashboard:workspace') : null;
const period = days => ({ mode: String(days), range: periodFor(days), page: 0 });
let state = initialState();
let repository;
let recovery = false;
let route;
let ready = false;
let busy = false;
let pendingRefresh = false;
let opener = null;
let toastTimer;
let productSelection = new Set();

const filters = { overview: period(30), products: {}, inventory: {}, movements: period(90), customers: {},
  sales: period(90), analytics: { ...period(30), status: 'completed' }, reports: period(90) };

const ctx = {
  get state() { return state; },
  get recovery() { return recovery; },
  get productSelection() { return productSelection; },
  filters, render, navigate, open, close, confirm, run, replace, rawBackup, seed, toast,
  clear(revision) { return replace(initialState(), revision, 'Dados locais apagados.'); },
  async start() { try { await run('start', {}, 'Espaço vazio preparado.'); } catch (error) { toast(error.message); } },
  showCustomerSales(id) { filters.sales.customer = id; filters.sales.page = 0; navigate('sales'); },
};

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 4700);
}

function renderTheme() {
  const configured = state.settings.theme;
  const dark = configured === 'dark' || configured === 'system' && media.matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.density = state.settings.density;
  const theme = $('#theme-toggle');
  theme.replaceChildren(icon(dark ? 'sun' : 'moon'));
  theme.setAttribute('aria-label', dark ? 'Ativar tema claro' : 'Ativar tema escuro');
}
media.addEventListener('change', renderTheme);
$('#theme-toggle').addEventListener('click', async () => {
  try { await run('settings', { theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }, 'Tema atualizado.'); }
  catch (error) { toast(error.message); }
});

function navState(open, focus = false) {
  sidebar.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  toggle.replaceChildren(icon(open ? 'close' : 'menu'));
  if (focus) (open ? sidebar.querySelector('[aria-current]') : toggle)?.focus();
}
toggle.addEventListener('click', () => navState(!sidebar.classList.contains('open'), true));
document.addEventListener('pointerdown', event => {
  if (sidebar.classList.contains('open') && !sidebar.contains(event.target) && !toggle.contains(event.target)) navState(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && sidebar.classList.contains('open') && !modal.open) navState(false, true);
});

function open(title, contents, target) {
  if (busy) return;
  if (!modal.open) opener = document.activeElement;
  $('#modal-title').textContent = title;
  $('#modal-body').replaceChildren(...contents.filter(Boolean));
  if (!modal.open) modal.showModal();
  (target || $('#modal-title')).focus();
}
function close() {
  if (modal.open && !busy) modal.close();
}
modal.addEventListener('click', event => { if (event.target.closest('[data-close]')) close(); });
modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
modal.addEventListener('close', () => {
  if (modal.open) return;
  $('#modal-body').replaceChildren();
  const target = opener?.isConnected ? opener : opener?.id ? document.getElementById(opener.id) : null;
  (target && !target.disabled ? target : $('#view-title') ?? $('#quick-sale')).focus({ preventScroll: true });
  opener = null;
});

function confirm(title, text, label, action) {
  const feedback = el('p', { class: 'error', role: 'alert', tabindex: '-1' });
  const back = button('Cancelar', { 'data-close': true });
  const yes = button(label, { kind: 'danger', id: 'confirm-action', action: async () => {
    yes.disabled = true;
    try { await action(); close(); }
    catch (error) { feedback.textContent = error.message; feedback.focus(); }
    finally { yes.disabled = false; }
  } });
  open(title, [note(text), feedback, el('div', { class: 'modal-actions' }, back, yes)], back);
}

function warning(message, revision) {
  recovery = true;
  if (revision !== undefined) state.revision = revision;
  const alert = $('#storage-alert');
  alert.textContent = message;
  alert.hidden = false;
}

function clearWarning() {
  recovery = false;
  $('#storage-alert').hidden = true;
}

async function sync() {
  if (!repository) return;
  if (busy) { pendingRefresh = true; return; }
  try {
    const next = await repository.read();
    if (next.revision >= state.revision) {
      const changed = next.revision !== state.revision || recovery;
      state = next;
      if (changed) { clearWarning(); render(); }
    }
  } catch (error) {
    const raw = await repository.raw().catch(() => null);
    warning(error.message + ' A cópia original foi preservada. Use Configurações para baixá-la ou recuperar o painel.', raw?.revision);
    render();
  }
}

channel?.addEventListener('message', () => sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

function ensureStorage() {
  if (!repository) throw new Error('O navegador não disponibilizou o IndexedDB. Recarregue após revisar as permissões.');
  if (busy) throw new Error('Aguarde a operação em andamento.');
}

async function perform(update, success, replaced = false) {
  ensureStorage();
  busy = true;
  screen.setAttribute('aria-busy', 'true');
  if (modal.open) modal.setAttribute('aria-busy', 'true');
  try {
    const next = await update();
    if (replaced) {
      productSelection = new Set();
      for (const filter of Object.values(filters)) {
        for (const key of ['query', 'status', 'city', 'category', 'customer', 'product', 'stock', 'type', 'selectedOnly']) delete filter[key];
        filter.page = 0;
      }
      filters.analytics.status = 'completed';
    }
    state = next;
    clearWarning();
    render();
    channel?.postMessage({ revision: state.revision });
    toast(success);
  } finally {
    busy = false;
    screen.removeAttribute('aria-busy');
    modal.removeAttribute('aria-busy');
    if (pendingRefresh) { pendingRefresh = false; sync(); }
  }
}

function run(command, data, message) {
  if (recovery) throw new Error('Restaure os dados em Configurações antes de gravar.');
  return perform(() => repository.update(previous => applyCommand(previous, command, data)), message);
}

function replace(next, revision, message) {
  return perform(() => repository.replace(next, revision), message, true);
}

async function seed(confirmed = false, revision = state.revision) {
  if (busy) return;
  const update = async () => replace(makeDemo(), revision, 'Demonstração pronta para explorar.');
  if (confirmed) return update();
  if (state.started || state.products.length || state.customers.length || recovery) {
    confirm('Carregar demonstração?', 'O conjunto sintético substituirá os registros atuais.', 'Carregar demonstração', update);
    return;
  }
  try { await update(); } catch (error) { toast(error.message); }
}

async function rawBackup() {
  try {
    const raw = await repository.raw();
    download('nadani-dados-originais-' + localDay() + '.json', JSON.stringify(raw), 'application/json');
    toast('Cópia original exportada.');
  } catch (error) { toast(error.message); }
}

function render() {
  renderTheme();
  $('#company-name').textContent = state.settings.company;
  if (!ready) return;
  const focused = screen.contains(document.activeElement) ? document.activeElement.id : '';
  const ids = new Set(state.products.map(item => item.id));
  for (const id of productSelection) if (!ids.has(id)) productSelection.delete(id);
  screen.replaceChildren(...views[route](ctx));
  if (focused && !modal.open) document.getElementById(focused)?.focus({ preventScroll: true });
}

function changeRoute(focus = false) {
  const hash = location.hash.slice(1);
  if (hash === 'main' && focus) return;
  route = Object.hasOwn(views, hash) ? hash : 'overview';
  $('#breadcrumb').textContent = titles[route];
  for (const link of sidebar.querySelectorAll('[data-route]')) {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  navState(false);
  render();
  if (focus) {
    window.scrollTo(0, 0);
    $('#view-title')?.focus({ preventScroll: true });
  }
}

function navigate(target) {
  if (location.hash === '#' + target) changeRoute(true);
  else location.hash = target;
}

$('#quick-sale').addEventListener('click', () => saleForm(ctx));
window.addEventListener('hashchange', () => changeRoute(true));

changeRoute();
try {
  repository = storeFor(await openDatabase());
  state = await repository.read();
} catch (error) {
  const raw = await repository?.raw().catch(() => null);
  warning(error.message + (raw ? ' A cópia original foi preservada. Acesse Configurações para recuperá-la.' : ''), raw?.revision);
} finally {
  ready = true;
  screen.removeAttribute('aria-busy');
  changeRoute();
}
