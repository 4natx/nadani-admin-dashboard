import { dateLabel, localDay, lowStock, shiftDay, stockStatus, validDay } from './model.js';

export function periodFor(days, today = localDay()) {
  return { start: shiftDay(today, 1 - days), end: today };
}

export function validRange({ start, end }) {
  if (!validDay(start) || !validDay(end) || start > end) throw new Error('Selecione um intervalo de datas válido.');
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 365) throw new Error('Use um intervalo de até 366 dias.');
  return { start, end };
}

export function previousRange(range) {
  const duration = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86400000) + 1;
  return { start: shiftDay(range.start, -duration), end: shiftDay(range.start, -1) };
}

export const inRange = (day, range) => day >= range.start && day <= range.end;

export function summarize(state, range, { category = '', status = 'completed' } = {}) {
  validRange(range);
  const grouped = new Map();
  for (const item of state.items) {
    if (category && item.category !== category) continue;
    if (!grouped.has(item.saleId)) grouped.set(item.saleId, []);
    grouped.get(item.saleId).push(item);
  }
  const trend = new Map();
  for (let day = range.start; ; day = shiftDay(day, 1)) {
    trend.set(day, { day, revenue: 0, sales: 0 });
    if (day === range.end) break;
  }
  const products = new Map();
  const categories = new Map();
  const customers = new Map();
  let revenue = 0;
  let sales = 0;
  let units = 0;
  let recognizedSales = 0;
  let totalRevenue = 0;
  const currentCustomers = new Map(state.customers.map(customer => [customer.id, customer.name]));
  for (const sale of state.sales) {
    const complete = sale.status === 'completed';
    if (complete) totalRevenue += sale.total;
    if (!inRange(sale.day, range) || (status !== 'all' && sale.status !== status)) continue;
    const items = grouped.get(sale.id);
    if (!items?.length) continue;
    const point = trend.get(sale.day);
    point.sales++;
    sales++;
    if (complete) recognizedSales++;
    let saleRevenue = 0;
    for (const item of items) {
      const net = complete ? item.net : 0;
      const bucket = products.get(item.productId) ?? { name: item.name, sku: item.sku, units: 0, revenue: 0 };
      bucket.units += item.quantity;
      bucket.revenue += net;
      products.set(item.productId, bucket);
      categories.set(item.category, (categories.get(item.category) ?? 0) + item.quantity);
      units += item.quantity;
      saleRevenue += net;
    }
    point.revenue += saleRevenue;
    revenue += saleRevenue;
    if (complete && sale.customerId) {
      const buyer = customers.get(sale.customerId) ?? { name: currentCustomers.get(sale.customerId) ?? sale.customerName, sales: 0, revenue: 0 };
      buyer.sales++;
      buyer.revenue += saleRevenue;
      customers.set(sale.customerId, buyer);
    }
  }
  return { revenue, totalRevenue, sales, units, recognizedSales, ticket: recognizedSales ? Math.round(revenue / recognizedSales) : 0,
    trend: [...trend.values()], products: [...products.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, 'pt-BR')),
    categories: [...categories].sort((a, b) => b[1] - a[1]), customers: [...customers.values()].sort((a, b) => b.revenue - a.revenue),
    low: state.products.filter(lowStock).length, registeredProducts: state.products.length, registeredCustomers: state.customers.length };
}

export function periodChange(current, previous) {
  return previous > 0 ? Math.round((current / previous - 1) * 1000) / 10 : null;
}

export function inventorySummary(state) {
  const status = { empty: 0, low: 0, near: 0, ok: 0 };
  let units = 0;
  let value = 0;
  let withCosts = 0;
  for (const product of state.products) {
    if (product.active) status[stockStatus(product)]++;
    units += product.stock;
    if (product.cost !== null) {
      withCosts++;
      value += product.cost * product.stock;
    }
  }
  return { ...status, units, value, withCosts, products: state.products.length };
}

export function shortDate(value) { return dateLabel(value).slice(0, 5); }
