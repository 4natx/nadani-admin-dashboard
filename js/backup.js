import { buildSettings, canonicalSKU, caps, emailFormat, validDay, validInt, version } from './model.js';

export const backupLimit = 32 * 1024 * 1024;
const fail = label => { throw new Error('Backup inválido: ' + label + '.'); };
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || Boolean(value.trim()));
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const stock = value => validInt(value, 0, caps.units);
const cost = value => validInt(value, 0, caps.unitPrice);
const amount = value => validInt(value, 0, caps.total);
const record = (entry, keys) => Object.fromEntries(keys.split(' ').map(key => [key, entry[key]]));

function matchList(input, cap, validate, keys, label, seenIds) {
  if (!Array.isArray(input) || input.length > cap) fail(label);
  return input.map(entry => {
    if (!entry || !id(entry.id) || seenIds.has(entry.id) || !validate(entry)) fail(label);
    seenIds.add(entry.id);
    return record(entry, keys);
  });
}

export function validateState(raw) {
  if (raw?.version !== version || !validInt(raw.revision, 0, Number.MAX_SAFE_INTEGER - 2) || typeof raw.started !== 'boolean' ||
      !raw.settings || typeof raw.settings.pageSize !== 'number') fail('versão ou estrutura incompatível');
  const seenIds = new Set();
  const skus = new Set();
  const common = item => text(item.name, 100, true) && typeof item.active === 'boolean' && iso(item.createdAt) &&
    iso(item.updatedAt) && item.updatedAt >= item.createdAt;
  const products = matchList(raw.products, caps.products, item => {
    if (!common(item) || !text(item.sku, 45, true) || skus.has(canonicalSKU(item.sku)) || !text(item.description, 600) ||
        !text(item.category, 60, true) || !cost(item.price) || (item.cost !== null && !cost(item.cost)) ||
        !stock(item.minimum) || !stock(item.stock)) return false;
    skus.add(canonicalSKU(item.sku));
    return true;
  }, 'id name sku description category price cost minimum active stock createdAt updatedAt', 'produtos ou SKUs inválidos', seenIds);
  const customers = matchList(raw.customers, caps.customers, item => common(item) && text(item.email, 160) &&
    (!item.email || emailFormat.test(item.email)) && text(item.phone, 30) && (!item.phone || /^[+()\d\s.-]+$/.test(item.phone) &&
    item.phone.replace(/\D/g, '').length >= 7) && text(item.city, 80) && text(item.notes, 600),
    'id name email phone city notes active createdAt updatedAt', 'clientes inválidos', seenIds);
  const customerIds = new Set(customers.map(item => item.id));
  const productMap = new Map(products.map(item => [item.id, item]));
  const sales = matchList(raw.sales, caps.sales, sale => (sale.customerId === null ? sale.customerName === '' :
    customerIds.has(sale.customerId) && text(sale.customerName, 100, true)) && amount(sale.subtotal) && amount(sale.discount) && amount(sale.total) &&
    sale.subtotal - sale.discount === sale.total && validInt(sale.units, 1, 50 * caps.units) && iso(sale.when) && validDay(sale.day) &&
    (sale.status === 'completed' && sale.cancelledAt === null && sale.reason === '' ||
      sale.status === 'cancelled' && iso(sale.cancelledAt) && sale.cancelledAt >= sale.when && text(sale.reason, 220)),
    'id customerId customerName subtotal discount total units when day status cancelledAt reason', 'vendas inválidas', seenIds);
  const saleMap = new Map(sales.map(sale => [sale.id, { sale, totals: [0, 0, 0], products: new Set() }]));
  const expected = new Map();
  const expect = (saleId, productId, type, units, when) => expected.set([saleId, productId, type].join('|'), [units, when]);
  const items = matchList(raw.items, caps.movements, item => {
    const group = saleMap.get(item.saleId);
    if (!group || !productMap.has(item.productId) || group.products.has(item.productId) || group.products.size >= 50 ||
        !text(item.name, 100, true) || !text(item.sku, 45, true) || !text(item.category, 60, true) ||
        !validInt(item.quantity, 1, caps.units) || !cost(item.price) || item.gross !== item.quantity * item.price ||
        !validInt(item.net, 0, item.gross)) return false;
    group.products.add(item.productId);
    group.totals[0] += item.gross;
    group.totals[1] += item.net;
    group.totals[2] += item.quantity;
    expect(item.saleId, item.productId, 'SALE', item.quantity, group.sale.when);
    if (group.sale.status === 'cancelled') expect(item.saleId, item.productId, 'SALE_REVERSAL', item.quantity, group.sale.cancelledAt);
    return true;
  }, 'id saleId productId name sku category quantity price gross net', 'itens ou referências de venda inválidos', seenIds);
  for (const { sale, totals, products: sold } of saleMap.values()) {
    if (!sold.size || sale.subtotal !== totals[0] || sale.total !== totals[1] || sale.units !== totals[2]) fail('totais da venda não correspondem aos itens');
  }
  const balances = new Map();
  const lastTimes = new Map();
  const movements = matchList(raw.movements, caps.movements, move => {
    if (!productMap.has(move.productId) || !text(move.name, 100, true) || !text(move.sku, 45, true) ||
        !text(move.reason, 220, true) || !iso(move.when) || move.when < (lastTimes.get(move.productId) ?? productMap.get(move.productId).createdAt) ||
        !stock(move.before) || !stock(move.after) || move.before !== (balances.get(move.productId) ?? 0)) return false;
    const delta = move.after - move.before;
    if (!delta || Math.abs(delta) !== move.quantity) return false;
    if (move.type === 'SALE' || move.type === 'SALE_REVERSAL') {
      const key = [move.ref, move.productId, move.type].join('|');
      const reference = expected.get(key);
      if (!reference || reference[0] !== move.quantity || reference[1] !== move.when || (move.type === 'SALE') !== (delta < 0)) return false;
      expected.delete(key);
    } else if (move.ref !== null || !['IN', 'OUT', 'ADJUSTMENT'].includes(move.type) ||
        (move.type === 'IN' && delta < 0) || (move.type === 'OUT' && delta > 0)) return false;
    balances.set(move.productId, move.after);
    lastTimes.set(move.productId, move.when);
    return true;
  }, 'id productId name sku type quantity before after when reason ref', 'movimentações ou saldo histórico inconsistentes', seenIds);
  if (expected.size || products.some(product => (balances.get(product.id) ?? 0) !== product.stock ||
      product.updatedAt < (lastTimes.get(product.id) ?? product.createdAt))) fail('estoque final ou estorno incompatível');
  const activity = matchList(raw.activity, caps.activity, log => ['product', 'customer', 'stock', 'sale', 'cancel'].includes(log.type) &&
    text(log.label, 180, true) && iso(log.when), 'id type label when', 'histórico inválido', seenIds);
  if (activity.some((log, index) => index && log.when > activity[index - 1].when)) fail('ordem do histórico inválida');
  return { version, revision: raw.revision, started: raw.started, products, customers, sales, items, movements, activity, settings: buildSettings(raw.settings) };
}

export function parseBackup(textValue) {
  let parsed;
  try { parsed = JSON.parse(textValue); } catch { fail('JSON malformado'); }
  return validateState(parsed);
}

export const encodeBackup = state => JSON.stringify(state);

