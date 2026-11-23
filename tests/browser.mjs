import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { basePath, serve } from '../tools/serve.mjs';

const candidates = [
  process.env.BROWSER_PATH,
  join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/chromium', '/usr/bin/google-chrome',
];
const executable = candidates.find(path => path && existsSync(path));
if (!executable) throw new Error('Defina BROWSER_PATH para o executável do Chrome, Chromium ou Edge.');

const profileRoot = resolve(tmpdir());
const profile = await mkdtemp(join(profileRoot, 'nadani-browser-'));
const browser = spawn(executable, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
browser.on('error', error => console.error(error.message));
const problems = [];
let server;
let socket;
let cdp;

async function until(callback, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await callback();
    if (result) return result;
    await delay(45);
  }
  throw new Error(`Tempo excedido: ${description}`);
}

async function connect(port) {
  const [page] = await fetch(`http://127.0.0.1:${port}/json/list`).then(res => res.json());
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveConnection, reject) => {
    socket.addEventListener('open', resolveConnection, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const { id: messageId, method, params, result, error } = JSON.parse(data);
    if (pending.has(messageId)) {
      const { resolveCall, reject } = pending.get(messageId);
      pending.delete(messageId);
      if (error) reject(new Error(error.message));
      else resolveCall(result);
    }
    if (method === 'Runtime.exceptionThrown') {
      problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    }
    if (method === 'Log.entryAdded' && params.entry.level === 'error') problems.push(params.entry.text);
    if (method === 'Network.requestWillBeSent' && ['XHR', 'Fetch', 'Ping'].includes(params.type)) problems.push(params.request.url);
    if (method === 'Network.responseReceived' && params.response.status >= 400) {
      problems.push(`${params.response.status} ${params.response.url}`);
    }
  });
  return (method, params = {}) => new Promise((resolveCall, reject) => {
    pending.set(++id, { resolveCall, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? expression);
  return response.result.value;
}

async function key(name, code) {
  const args = { key: name, code: name, windowsVirtualKeyCode: code };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...args, text: name === 'Enter' ? '\r' : undefined });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...args });
}

async function capture(name) {
  if (!process.argv.includes('--screenshots')) return;
  await until(() => evaluate('document.querySelector("#toast").textContent === ""'), 'aguardar o aviso temporário antes da captura');
  await mkdir(new URL('../docs/screenshots/', import.meta.url), { recursive: true });
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(new URL(`../docs/screenshots/${name}.png`, import.meta.url), Buffer.from(data, 'base64'));
}

const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const focus = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
const value = (selector, text, event = 'input') => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  input.value = ${JSON.stringify(text)};
  input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
})()`);
const has = expression => until(() => evaluate(expression), expression);
const content = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
const stored = () => evaluate(`(async () => {
  const { openDatabase, storeFor } = await import('./js/storage.js');
  const db = await openDatabase();
  try { return await storeFor(db).read(); } finally { db.close(); }
})()`);

async function visit(route) {
  await evaluate(`location.hash = ${JSON.stringify(route)}`);
  await has(`document.querySelector('[data-route="${route}"]')?.hasAttribute('aria-current') && document.querySelector('#view-title')`);
}
async function viewport(width, height = 960) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
  await evaluate('window.scrollTo(0, 0)');
}
async function uploadBackup(path) {
  const { root } = await cdp('DOM.getDocument');
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '#backup-file' });
  await cdp('DOM.setFileInputFiles', { files: [path], nodeId });
}
async function fill(form, fields) {
  for (const [key, text] of Object.entries(fields)) await value(form + ' [name="' + key + '"]', text);
}
const closed = () => has('!document.querySelector("#modal").open');

try {
  server = await serve(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + basePath;
  const port = await until(async () => Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0]), 'inicializar Chromium');
  cdp = await connect(port);
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await cdp(`${domain}.enable`);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await viewport(1440);
  await cdp('Page.navigate', { url });
  await has('document.querySelector("#start-empty") && document.readyState === "complete"');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');
  await click('#start-empty');
  await has('!document.querySelector("#start-empty")');
  assert.equal((await stored()).products.length, 0);

  await visit('products');
  await focus('#new-product');
  await key('Enter', 13);
  assert.equal(await evaluate('document.activeElement.name'), 'name');
  await key('Escape', 27);
  await has('document.activeElement.id === "new-product"');
  await click('#new-product');
  await fill('#modal', { name: 'Caneca Teste', sku: 'TESTE-01', category: 'Casa', price: '29,95', cost: '12,50', minimum: '2', initial: '3' });
  await click('#save-product');
  await closed();
  const product = (await stored()).products[0];
  assert.equal(product.stock, 3);
  assert.equal(product.price, 2995);

  await click('#details-' + product.id);
  await click('#edit-entity');
  await fill('#modal', { name: 'Caneca Premium', description: '<strong>Descrição literal</strong>' });
  await click('#save-product');
  await closed();
  await value('#context-search', 'premium');
  await has('document.querySelector("table tbody tr")?.textContent.includes("Caneca Premium")');
  await click('#details-' + product.id);
  assert.equal(await evaluate('document.querySelector("#modal-body > p strong")'), null);
  assert.equal(await content('#modal-body > p'), '<strong>Descrição literal</strong>');
  assert.equal(await evaluate('document.querySelector("#delete-entity")'), null);
  await key('Escape', 27);
  await closed();
  await click('#product-pick-' + product.id);
  await click('#selected-products');
  assert.ok((await content('.pagination')).includes('1 selecionado'));

  await visit('customers');
  await click('#new-customer');
  await fill('#modal', { name: 'Cliente Exemplo', email: 'cliente@example.invalid', city: 'Recife' });
  await click('#save-customer');
  await closed();
  const person = (await stored()).customers[0];
  await visit('inventory');
  await click('#new-movement');
  await fill('#modal', { amount: '7', reason: 'Reposição demonstrativa' });
  await click('#save-movement');
  await closed();
  assert.equal((await stored()).products[0].stock, 10);
  assert.ok((await content('table[aria-label="Movimentações"]')).includes('Reposição demonstrativa'));
  console.log('Cadastro e edição de produto, cliente, estoque, pesquisa, seleção, foco no modal e conteúdo literal.');

  await click('#quick-sale');
  await value('#sale-customer', person.id);
  await value('#sale-lines input', '11');
  assert.equal(await evaluate('document.querySelector("#save-sale").disabled'), true);
  await value('#sale-lines input', '2');
  await value('#sale-discount', '2,90');
  assert.ok((await content('#sale-totals')).includes('57,00'));
  await evaluate('document.getElementById("save-sale").click(); document.getElementById("save-sale").click();');
  await closed();
  await has('location.hash === "#sales"');
  const confirmed = await stored();
  assert.equal(confirmed.sales.length, 1);
  assert.equal(confirmed.products[0].stock, 8);
  const sale = confirmed.sales[0];
  assert.equal(sale.total, 5700);
  assert.equal(confirmed.movements.at(-1).type, 'SALE');
  await visit('overview');
  assert.ok((await content('[data-metric="Receita no período"]')).includes('57,00'));
  await value('#chart-revenue', '0', 'change');
  assert.ok((await content('output[for="chart-revenue"]')).includes('0,00'));
  await visit('customers');
  await click('#details-' + person.id);
  assert.ok((await content('#modal')).includes('57,00'));
  await key('Escape', 27);
  await closed();

  await visit('sales');
  await click('#details-' + sale.id);
  await evaluate('window.print = () => { window.printRequested = true; }');
  await click('#print-receipt');
  assert.equal(await evaluate('window.printRequested'), true);
  assert.ok((await content('#print-area')).includes('Sem validade fiscal'));
  const pdf = await cdp('Page.printToPDF', { printBackground: true });
  assert.ok(Buffer.from(pdf.data, 'base64').subarray(0, 4).equals(Buffer.from('%PDF')));
  await evaluate('window.dispatchEvent(new Event("afterprint"))');
  await click('#cancel-sale');
  await value('#modal textarea[name="reason"]', 'Devolução demonstrativa');
  await click('#confirm-cancel-sale');
  await closed();
  const reversed = await stored();
  assert.equal(reversed.products[0].stock, 10);
  assert.equal(reversed.sales[0].status, 'cancelled');
  assert.equal(reversed.movements.at(-1).type, 'SALE_REVERSAL');
  await click('#details-' + sale.id);
  assert.equal(await evaluate('document.querySelector("#cancel-sale")'), null);
  await key('Escape', 27);
  await closed();
  await visit('overview');
  assert.ok((await content('[data-metric="Receita total"]')).includes('0,00'));
  console.log('Venda atômica, desconto, comprovante em PDF pelo Chrome, cancelamento e estorno verificados.');

  const folder = join(profile, 'downloads');
  await mkdir(folder);
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: folder });
  const today = await evaluate('new Date().toLocaleDateString("sv-SE")');
  await visit('reports');
  await value('#filter-status', 'cancelled', 'change');
  assert.ok((await content('#report-preview')).includes('Cancelada'));
  await click('#report-csv');
  await click('#report-json');
  const csv = await until(() => readFile(join(folder, 'nadani-sales-' + today + '.csv'), 'utf8').catch(() => ''), 'baixar CSV');
  const json = await until(() => readFile(join(folder, 'nadani-sales-' + today + '.json'), 'utf8').catch(() => ''), 'baixar JSON');
  assert.ok(csv.includes('Cancelada'));
  assert.equal(JSON.parse(json).rows.length, 1);
  await visit('settings');
  await click('#theme-toggle');
  await has('document.documentElement.dataset.theme === "dark"');
  await click('#export-backup');
  const backupPath = join(folder, 'nadani-backup-' + today + '.json');
  const backup = await until(() => readFile(backupPath, 'utf8').catch(() => ''), 'baixar backup');
  assert.equal(JSON.parse(backup).sales.length, 1);
  await cdp('Page.reload');
  await has('document.querySelector("#theme-choice") && document.documentElement.dataset.theme === "dark"');
  assert.equal((await stored()).products[0].stock, 10);
  const invalid = join(folder, 'invalid.json');
  await writeFile(invalid, '{incompleto');
  await uploadBackup(invalid);
  await has('document.querySelector("#backup-message").textContent.includes("malformado")');
  assert.equal((await stored()).sales.length, 1);
  await click('#clear-data');
  await click('#confirm-action');
  await closed();
  assert.equal((await stored()).products.length, 0);
  await uploadBackup(backupPath);
  await has('document.querySelector("#confirm-action")');
  await click('#confirm-action');
  await closed();
  assert.equal((await stored()).sales[0].status, 'cancelled');
  assert.equal((await stored()).products[0].stock, 10);
  console.log('Relatórios baixados, persistência do tema e dados, backup inválido, limpeza e restauração.');

  await visit('inventory');
  await click('#new-movement');
  await fill('#modal', { amount: '4', reason: 'Teste de falha no armazenamento' });
  await evaluate('window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new Error("Falha de gravação simulada."); };');
  await click('#save-movement');
  await has('document.querySelector("#form-error").textContent.includes("simulada")');
  await evaluate('IDBObjectStore.prototype.put = window.originalPut');
  assert.equal((await stored()).products[0].stock, 10);
  await key('Escape', 27);
  await closed();

  const concurrent = await evaluate(`(async () => {
    const { openDatabase, storeFor } = await import('./js/storage.js');
    const { applyCommand } = await import('./js/business.js');
    const first = await openDatabase(), second = await openDatabase();
    try {
      const results = await Promise.allSettled([first, second].map(db => storeFor(db).update(before =>
        applyCommand(before, 'sell', { lines: [{ productId: before.products[0].id, quantity: 6 }], discount: '0' }))));
      return results.map(item => item.status).sort();
    } finally { first.close(); second.close(); }
  })()`);
  assert.deepEqual(concurrent, ['fulfilled', 'rejected']);
  assert.equal((await stored()).products[0].stock, 4);
  await cdp('Page.reload');
  await has('document.querySelector("#new-movement")');
  await visit('settings');
  await click('#reset-demo');
  await click('#confirm-action');
  await closed();
  const dataset = await stored();
  assert.deepEqual([dataset.products.length, dataset.customers.length, dataset.sales.length], [30, 20, 60]);
  await visit('overview');
  assert.ok((await content('[data-metric="Produtos cadastrados"]')).includes('30'));
  await evaluate('document.activeElement.blur()');
  await capture('dashboard');
  await click('#theme-toggle');
  await has('document.documentElement.dataset.theme === "dark"');
  await visit('analytics');
  await value('#filter-category', 'Casa', 'change');
  await has('document.querySelector("#filter-category").value === "Casa"');
  await value('#period-mode', 'custom', 'change');
  await value('#period-start', today);
  await value('#period-end', today);
  await click('#apply-period');
  await has('document.querySelector("#period-mode").value === "custom" && !document.querySelector("#screen").getAttribute("aria-busy")');
  await value('#period-mode', '90', 'change');
  await evaluate('document.activeElement.blur()');
  await capture('analises');
  console.log('Rollback de falha de gravação, transações concorrentes, dados sintéticos, gráficos e períodos.');

  for (const width of [320, 375, 430, 768, 1024, 1440]) {
    await viewport(width);
    for (const route of ['overview', 'products', 'inventory', 'customers', 'sales', 'analytics', 'reports', 'settings']) {
      await visit(route);
      const size = await evaluate('({ viewport: innerWidth, layout: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })');
      assert.equal(size.viewport, width);
      assert.equal(size.scroll, size.layout, `Overflow em ${route} @ ${width}`);
    }
    await click('#quick-sale');
    assert.equal(await evaluate('document.querySelector("#modal").scrollWidth <= document.querySelector("#modal").clientWidth + 1'), true);
    await key('Escape', 27);
    await closed();
    if (width === 375) {
      await focus('#menu-toggle');
      await key('Enter', 13);
      await has('document.querySelector("#menu-toggle").getAttribute("aria-expanded") === "true"');
      await key('Escape', 27);
      await has('document.activeElement.id === "menu-toggle"');
      await visit('overview');
      await evaluate('document.activeElement.blur()');
      await capture('mobile');
    }
  }
  assert.deepEqual(problems, []);
  console.log('Oito áreas e modal em seis larguras, menu por teclado e carregamento estático sem erros no console.');
} finally {
  if (cdp && socket.readyState === WebSocket.OPEN) {
    await Promise.race([cdp('Browser.close').catch(() => {}), delay(700)]);
    socket.close();
  }
  if (browser.exitCode === null) {
    await Promise.race([new Promise(resolveExit => browser.once('exit', resolveExit)), delay(2000)]);
  }
  if (browser.exitCode === null) browser.kill();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  if (dirname(profile) === profileRoot) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
