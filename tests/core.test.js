import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inventorySummary, periodChange, periodFor, previousRange, summarize } from '../js/analytics.js';
import { encodeBackup, parseBackup, validateState } from '../js/backup.js';
import { applyCommand, customerSales, quoteSale } from '../js/business.js';
import { makeDemo } from '../js/demo.js';
import { cents, initialState, localDay, stockStatus } from '../js/model.js';
import { getReport, serializeCSV } from '../js/reports.js';

const now = new Date(2026, 10, 23, 11, 30);
const today = localDay(now);
let seq = 0;
const id = () => 'id-' + ++seq;
const run = (state, op, data) => applyCommand(state, op, data, { now, id });
const create = (state = initialState(), fields = {}) => run(state, 'saveProduct', {
  name: 'Caneca Exemplo', sku: 'SKU-001', category: 'Casa', price: '19,99', cost: '7,50', minimum: 2, initial: 12, ...fields,
});
const customer = state => run(state, 'saveCustomer', { name: 'Rui Exemplo', email: 'rui@example.invalid', phone: '(00) 0000-0000', city: 'Recife' });
const sold = (state, discount = '1,50') => run(state, 'sell', { customerId: state.customers[0]?.id ?? '',
  lines: [{ productId: state.products[0].id, quantity: 3 }], discount });

test('creates a product with integer cents and a matching opening movement', () => {
  const state = create();
  const [product] = state.products;
  assert.equal(product.price, 1999);
  assert.equal(product.stock, 12);
  assert.equal(product.cost, 750);
  assert.deepEqual(state.movements.map(({ type, before, after }) => [type, before, after]), [['IN', 0, 12]]);
  assert.equal(state.started, true);
  assert.deepEqual(validateState(state), state);
});

test('edits product fields without directly replacing stock', () => {
  const state = create();
  const product = state.products[0];
  const next = create(state, { id: product.id, name: 'Nova Caneca', price: '25,00', initial: 99 });
  assert.equal(next.products[0].stock, 12);
  assert.equal(next.products[0].name, 'Nova Caneca');
  assert.equal(next.products[0].createdAt, product.createdAt);
  assert.ok(next.products[0].updatedAt > product.updatedAt);
});

test('rejects canonical SKU collisions and stale edits', () => {
  const state = create();
  assert.throws(() => create(state, { sku: '  sku-001  ' }), /SKU já/);
  assert.throws(() => create(state, { id: state.products[0].id, expected: 'stale' }), /mudou/);
});

test('rejects negative prices, costs, stock and invalid quantity strings', () => {
  for (const fields of [{ price: '-1' }, { cost: '-2' }, { minimum: '-1' }, { initial: '-1' }, { initial: 1.5 }, { initial: '1e1' }]) {
    assert.throws(() => create(initialState(), fields));
  }
  assert.equal(cents('0,01', 'Preço'), 1);
  assert.throws(() => cents('1.000,50', 'Preço'), /separador/);
});

test('deletes only unused products and archives records with historical references', () => {
  const state = create();
  const product = state.products[0];
  assert.throws(() => run(state, 'changeEntity', { entity: 'product', id: product.id, action: 'delete' }), /histórico/);
  const archived = run(state, 'changeEntity', { entity: 'product', id: product.id, action: 'archive' });
  assert.equal(archived.products[0].active, false);
  const unused = create(initialState(), { initial: 0 });
  assert.equal(run(unused, 'changeEntity', { entity: 'product', id: unused.products[0].id, action: 'delete' }).products.length, 0);
});

test('records entries, outgoing units and inventory adjustments in order', () => {
  let state = create();
  const productId = state.products[0].id;
  for (const [type, amount] of [['IN', 8], ['OUT', 3], ['ADJUSTMENT', 4], ['ADJUSTMENT', 0]]) {
    state = run(state, 'move', { productId, type, amount, reason: 'Conferência de teste' });
  }
  assert.deepEqual(state.movements.map(row => [row.before, row.after]), [[0, 12], [12, 20], [20, 17], [17, 4], [4, 0]]);
  assert.equal(stockStatus(state.products[0]), 'empty');
  assert.equal(inventorySummary(state).value, 0);
  assert.deepEqual(validateState(state), state);
});

test('blocks negative inventory and leaves the previous state intact', () => {
  const previous = create();
  const data = { productId: previous.products[0].id, type: 'OUT', amount: 13, reason: 'Teste' };
  assert.throws(() => run(previous, 'move', data), /insuficiente/);
  assert.equal(previous.products[0].stock, 12);
  assert.equal(previous.movements.length, 1);
});

test('creates and edits customers and validates optional contact fields', () => {
  const state = customer(initialState());
  const [{ id }] = state.customers;
  const next = run(state, 'saveCustomer', { id, name: 'Rui Atualizado', city: 'Salvador' });
  assert.equal(next.customers[0].city, 'Salvador');
  assert.throws(() => run(state, 'saveCustomer', { name: '', email: 'a@b' }), /e-mail/);
  assert.throws(() => run(state, 'saveCustomer', { name: 'Rui', phone: 'abc' }), /telefone/);
});

test('preserves customer snapshots and reconciles customer history after cancellation', () => {
  const state = sold(customer(create()));
  const [{ id: customerId }] = state.customers;
  const updated = run(state, 'saveCustomer', { id: customerId, name: 'Outro nome' });
  assert.equal(updated.sales[0].customerName, 'Rui Exemplo');
  assert.equal(customerSales(updated, customerId).total, 5847);
  assert.throws(() => run(updated, 'changeEntity', { entity: 'customer', id: customerId, action: 'delete' }), /histórico/);
  const reversed = run(updated, 'cancel', { id: updated.sales[0].id });
  assert.equal(customerSales(reversed, customerId).count, 0);
  assert.equal(customerSales(reversed, customerId).related.length, 1);
});

test('records sale lines, discount, stock and reference as a single state change', () => {
  const previous = create();
  const state = sold(previous);
  const [sale] = state.sales;
  assert.equal(sale.subtotal, 5997);
  assert.equal(sale.discount, 150);
  assert.equal(sale.total, 5847);
  assert.equal(state.products[0].stock, 9);
  assert.equal(state.items[0].sku, 'SKU-001');
  assert.equal(state.movements[1].ref, sale.id);
  assert.equal(previous.sales.length, 0);
  assert.deepEqual(validateState(state), state);
});

test('allocates cent discounts exactly across historical categories', () => {
  const state = create(create(initialState(), { price: '0,03' }), { sku: 'SKU-002', category: 'Soma', price: '0,02' });
  const quote = quoteSale(state, state.products.map(product => ({ productId: product.id, quantity: 1 })), '0,02');
  assert.equal(quote.total, 3);
  assert.deepEqual(quote.items.map(item => item.net), [2, 1]);
});

test('rejects overselling, duplicate items, changed prices and invalid discounts', () => {
  const state = create();
  const productId = state.products[0].id;
  const line = { productId, quantity: 1 };
  assert.throws(() => quoteSale(state, [{ ...line, quantity: 13 }]), /insuficiente/);
  assert.throws(() => quoteSale(state, [line, line]), /uma linha/);
  assert.throws(() => quoteSale(state, [{ ...line, expectedPrice: 10 }]), /preço.*mudou/);
  assert.throws(() => quoteSale(state, [line], '20,00'), /desconto/);
});

test('reverses stock for cancelled sales once and keeps both ledger entries', () => {
  const state = sold(create());
  const next = run(state, 'cancel', { id: state.sales[0].id, reason: 'Devolução informada' });
  assert.equal(next.sales[0].status, 'cancelled');
  assert.equal(next.products[0].stock, 12);
  assert.deepEqual(next.movements.map(move => move.type), ['IN', 'SALE', 'SALE_REVERSAL']);
  assert.equal(next.items.length, 1);
  assert.throws(() => run(next, 'cancel', { id: state.sales[0].id }), /já foi cancelada/);
  assert.deepEqual(validateState(next), next);
});

test('counts valid revenue, ticket, customers, units and products in a chosen window', () => {
  let data = sold(customer(create()));
  data = sold(data, '0');
  data = run(data, 'cancel', { id: data.sales[1].id });
  const range = periodFor(7, today);
  const summary = summarize(data, range);
  assert.equal(summary.sales, 1);
  assert.equal(summary.revenue, 5847);
  assert.equal(summary.totalRevenue, 5847);
  assert.equal(summary.units, 3);
  assert.equal(summary.ticket, 5847);
  assert.equal(summary.products[0].units, 3);
  assert.equal(summary.customers[0].revenue, 5847);
  assert.equal(summarize(data, range, { status: 'cancelled' }).revenue, 0);
  assert.equal(summarize(data, previousRange(range)).revenue, 0);
  assert.equal(periodChange(5847, 0), null);
  assert.equal(summarize(data, { start: '9999-12-31', end: '9999-12-31' }).trend.length, 1);
});

test('inventory valuations use cost instead of retail price', () => {
  const data = create(create(), { sku: 'SKU-002', cost: '' });
  assert.equal(inventorySummary(data).value, 9000);
  assert.equal(inventorySummary(data).withCosts, 1);
});

test('reports filter by date, status, category and distinguish recognised revenue', () => {
  const state = sold(customer(create()));
  const range = periodFor(7, today);
  const result = getReport(state, 'sales', { range, category: 'Casa', status: 'completed' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0][7], '58,47');
  assert.equal(getReport(state, 'sales', { range, category: 'Tecnologia' }).rows.length, 0);
  const cancelled = run(state, 'cancel', { id: state.sales[0].id });
  assert.equal(getReport(cancelled, 'sales', { range }).rows[0][7], '0,00');
});

test('CSV escapes quotes and newlines and neutralizes formula-like strings', () => {
  const csv = serializeCSV({ headers: ['Nome', 'Vlr'], rows: [['=1+1', -2], ['  +3', 'a;"b"\nà']] });
  assert.equal(csv, "\uFEFF\"Nome\";\"Vlr\"\r\n\"'=1+1\";\"-2\"\r\n\"'  +3\";\"a;\"\"b\"\"\nà\"");
});

test('round-trips backup metadata, ledgers and preferences', () => {
  const state = sold(customer(create()));
  const next = run(state, 'settings', { company: 'Exemplo', density: 'compact', theme: 'dark', pageSize: 20 });
  assert.deepEqual(parseBackup(encodeBackup(next)), next);
});

test('rejects corrupt backups, colliding IDs and missing sale postings', () => {
  const state = sold(customer(create()));
  assert.throws(() => parseBackup('{bad'), /malformado/);
  assert.throws(() => validateState({ ...state, version: 10 }), /versão/);
  assert.throws(() => validateState({ ...state, movements: state.movements.slice(0, 1) }), /estorno/);
  assert.throws(() => validateState({ ...state, items: [{ ...state.items[0], saleId: 'absent' }] }), /referências/);
  assert.throws(() => validateState({ ...state, customers: [{ ...state.customers[0], id: state.products[0].id }] }), /clientes/);
  assert.equal(state.sales.length, 1);
});

test('generates 30 products, 20 synthetic customers and 60 reconciled sales', () => {
  const state = makeDemo(now);
  assert.equal(state.products.length, 30);
  assert.equal(state.customers.length, 20);
  assert.equal(state.sales.length, 60);
  assert.equal(state.sales.filter(item => item.status === 'cancelled').length, 3);
  assert.ok(state.customers.every(item => item.email.endsWith('@example.invalid')));
  assert.ok(summarize(state, periodFor(90, today)).low > 0);
  assert.deepEqual(validateState(state), state);
});
