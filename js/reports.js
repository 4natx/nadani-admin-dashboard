import { inRange } from './analytics.js';
import { dateLabel, dateTime, moneyInput, movementLabels, stockStatus } from './model.js';

export const reportTypes = { products: 'Produtos', inventory: 'Estoque', sales: 'Vendas', customers: 'Clientes', movements: 'Movimentações de estoque' };
export const movementStatus = { empty: 'Sem estoque', low: 'No mínimo ou abaixo', near: 'Próximo do mínimo', ok: 'Regular' };
export const saleStatus = { completed: 'Concluída', cancelled: 'Cancelada' };
export const entityStatus = active => active ? 'Ativo' : 'Arquivado';
const idLabel = id => id.slice(0, 8);

export function getReport(state, type, { range, category = '', status = '' }) {
  const byCategory = product => !category || product.category === category;
  const entityFilter = item => !status || item.active === (status === 'active');
  if (type === 'products') {
    return { headers: ['Produto', 'SKU', 'Categoria', 'Preço (BRL)', 'Custo (BRL)', 'Status'],
      rows: state.products.filter(product => byCategory(product) && entityFilter(product)).map(product =>
        [product.name, product.sku, product.category, moneyInput(product.price), product.cost === null ? '' : moneyInput(product.cost), entityStatus(product.active)]) };
  }
  if (type === 'inventory') {
    return { headers: ['Produto', 'SKU', 'Estoque', 'Mínimo', 'Alerta', 'Custo do saldo (BRL)'],
      rows: state.products.filter(product => byCategory(product) && (!status || stockStatus(product) === status)).map(product =>
        [product.name, product.sku, product.stock, product.minimum, movementStatus[stockStatus(product)],
          product.cost === null ? '' : moneyInput(product.stock * product.cost)]) };
  }
  if (type === 'customers') {
    return { headers: ['Cliente', 'E-mail', 'Telefone', 'Cidade', 'Cadastro', 'Status'],
      rows: state.customers.filter(entityFilter).map(customer => [customer.name, customer.email, customer.phone, customer.city,
        dateLabel(customer.createdAt), entityStatus(customer.active)]) };
  }
  if (type === 'sales') {
    const filteredItems = new Map();
    for (const item of state.items) {
      if (!byCategory(item)) continue;
      const group = filteredItems.get(item.saleId) ?? [0, 0, 0];
      group[0] += item.quantity; group[1] += item.gross; group[2] += item.net;
      filteredItems.set(item.saleId, group);
    }
    return { headers: ['Venda', 'Data', 'Cliente', 'Unidades', 'Subtotal (BRL)', 'Desconto (BRL)', 'Total (BRL)', 'Receita reconhecida (BRL)', 'Status'],
      rows: state.sales.filter(sale => inRange(sale.day, range) && (!status || sale.status === status) && filteredItems.has(sale.id)).reverse().map(sale => {
        const [units, gross, net] = filteredItems.get(sale.id);
        return [sale.id, dateLabel(sale.day), sale.customerName || 'Venda avulsa', units, moneyInput(gross),
          moneyInput(gross - net), moneyInput(net), moneyInput(sale.status === 'completed' ? net : 0), saleStatus[sale.status]];
      }) };
  }
  const products = new Map(state.products.map(product => [product.id, product]));
  return { headers: ['Movimentação', 'Data', 'Produto', 'SKU', 'Tipo', 'Quantidade', 'Antes', 'Depois', 'Motivo', 'Referência'],
    rows: state.movements.filter(move => inRange(localMovementDay(move.when), range) && (!status || move.type === status) &&
      byCategory(products.get(move.productId))).reverse().map(move => [move.id, dateTime(move.when), move.name, move.sku,
        movementLabels[move.type], move.quantity, move.before, move.after, move.reason, move.ref || '']) };
}

function localMovementDay(timestamp) {
  const date = new Date(timestamp);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function serializeCSV({ headers, rows }) {
  const cell = value => {
    let text = String(value ?? '');
    if (typeof value === 'string' && (/^[\s\p{Cf}\u0000-\u001f\u007f]*[=+@\-＝＋＠－]/u.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [headers, ...rows].map(row => row.map(cell).join(';')).join('\r\n');
}

export function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { idLabel };
