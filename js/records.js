import { inRange, inventorySummary } from './analytics.js';
import { customerDetails, customerForm, productDetails, productForm, saleDetails, saleForm, stockForm } from './forms.js';
import { dateLabel, dateTime, fold, localDay, money, movementLabels, quantity, stockStatus } from './model.js';
import { entityStatus, idLabel, movementStatus, saleStatus } from './reports.js';
import { actions, button, el, filterControl, heading, label, metric, pagedTable, periodControl, searchControl } from './ui.js';

const compare = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true });
const activeChoices = [['', 'Todos'], ['active', 'Ativos'], ['archived', 'Arquivados']];
const saleChoices = [['', 'Todas'], ...Object.entries(saleStatus)];
const stockChoices = [['', 'Todos'], ...Object.entries(movementStatus)];
const matches = (query, fields) => {
  const needle = fold(query).trim();
  return !needle || fields.some(value => fold(value).includes(needle));
};
const matchesActive = (item, value) => !value || item.active === (value === 'active');
const categoryList = products => [['', 'Todas'], ...[...new Set(products.map(item => item.category))].sort(compare).map(value => [value, value])];

function stockBadge(product) {
  const alert = stockStatus(product);
  return label(quantity(product.stock) + ' · ' + movementStatus[alert], alert === 'empty' ? 'bad' : alert === 'ok' ? 'good' : 'warn');
}

const details = (item, action) => button('Detalhes', { id: 'details-' + item.id, kind: 'secondary small',
  'aria-label': 'Detalhes de ' + (item.name ?? idLabel(item.id)), action: () => action(item) });

export function productsView(ctx) {
  const prefs = ctx.filters.products;
  const state = ctx.state;
  const dataset = el('div');
  const panels = el('section', { class: 'panel table-shell' });
  function draw() {
    const list = state.products.filter(item => matches(prefs.query, [item.name, item.sku, item.category]) &&
      matchesActive(item, prefs.status) && (!prefs.category || item.category === prefs.category) &&
      (!prefs.selectedOnly || ctx.productSelection.has(item.id)));
    const order = prefs.sort === 'price' ? (a, b) => b.price - a.price : prefs.sort === 'stock' ? (a, b) => a.stock - b.stock : (a, b) => compare(a.name, b.name);
    list.sort(order);
    pagedTable(dataset, { list, paging: prefs, size: state.settings.pageSize, name: 'Produtos', extra: () => ' · ' + ctx.productSelection.size + ' selecionado(s)',
      headers: ['Selecionar', 'Produto', 'SKU', 'Categoria', 'Preço', 'Estoque', 'Status', 'Ações'],
      rows: item => {
        const input = el('input', { type: 'checkbox', id: 'product-pick-' + item.id, checked: ctx.productSelection.has(item.id), 'aria-label': 'Selecionar ' + item.name });
        input.addEventListener('change', () => {
          if (input.checked) ctx.productSelection.add(item.id); else ctx.productSelection.delete(item.id);
          draw();
        });
        return [input, el('strong', {}, item.name), item.sku, item.category, money(item.price), stockBadge(item),
          label(entityStatus(item.active), item.active ? 'good' : ''), details(item, record => productDetails(ctx, record))];
      } });
  }
  const toggle = button(prefs.selectedOnly ? 'Mostrar todos' : 'Ver selecionados', { id: 'selected-products', 'aria-pressed': String(Boolean(prefs.selectedOnly)),
    action: () => {
      prefs.selectedOnly = !prefs.selectedOnly;
      prefs.page = 0;
      toggle.textContent = prefs.selectedOnly ? 'Mostrar todos' : 'Ver selecionados';
      toggle.setAttribute('aria-pressed', String(prefs.selectedOnly));
      draw();
    } });
  const clear = button('Limpar seleção', { action: () => { ctx.productSelection.clear(); draw(); } });
  panels.append(el('div', { class: 'toolbar' }, searchControl(prefs, draw, 'Nome, SKU ou categoria'),
    filterControl(prefs, 'category', 'Categoria', categoryList(state.products), draw),
    filterControl(prefs, 'status', 'Status', activeChoices, draw),
    filterControl(prefs, 'sort', 'Ordenar', [['name', 'Nome'], ['price', 'Maior preço'], ['stock', 'Menor estoque']], draw),
    toggle, clear), dataset);
  draw();
  return [heading('Produtos', 'Gerencie o catálogo, os preços e a disponibilidade.', button('Cadastrar produto', { id: 'new-product', kind: 'primary', symbol: 'plus', action: () => productForm(ctx) })), panels];
}

export function customersView(ctx) {
  const prefs = ctx.filters.customers;
  const state = ctx.state;
  const dataset = el('div');
  const counts = new Map();
  for (const sale of state.sales) {
    if (sale.status === 'completed' && sale.customerId) counts.set(sale.customerId, (counts.get(sale.customerId) ?? 0) + 1);
  }
  function draw() {
    const list = state.customers.filter(item => matches(prefs.query, [item.name, item.email, item.phone]) &&
      matchesActive(item, prefs.status) && (!prefs.city || item.city === prefs.city));
    list.sort(prefs.sort === 'recent' ? (a, b) => b.createdAt.localeCompare(a.createdAt) : (a, b) => compare(a.name, b.name));
    pagedTable(dataset, { list, name: 'Clientes', paging: prefs, size: state.settings.pageSize,
      headers: ['Cliente', 'E-mail', 'Telefone', 'Cidade', 'Vendas', 'Status', 'Ações'], rows: item =>
        [el('strong', {}, item.name), item.email || '—', item.phone || '—', item.city || '—', String(counts.get(item.id) ?? 0),
          label(entityStatus(item.active), item.active ? 'good' : ''), details(item, record => customerDetails(ctx, record))] });
  }
  const cities = [...new Set(state.customers.map(item => item.city).filter(Boolean))].sort(compare);
  draw();
  return [heading('Clientes', 'Organize cadastros e consulte o histórico de compras.', button('Cadastrar cliente', { id: 'new-customer', kind: 'primary', symbol: 'plus', action: () => customerForm(ctx) })),
    el('section', { class: 'panel table-shell' }, el('div', { class: 'toolbar' }, searchControl(prefs, draw, 'Nome, e-mail ou telefone'),
      filterControl(prefs, 'city', 'Cidade', [['', 'Todas'], ...cities.map(value => [value, value])], draw),
      filterControl(prefs, 'status', 'Status', activeChoices, draw),
      filterControl(prefs, 'sort', 'Ordenar', [['name', 'Nome'], ['recent', 'Mais recentes']], draw)), dataset)];
}

export function inventoryView(ctx) {
  const prefs = ctx.filters.inventory;
  const movePrefs = ctx.filters.movements;
  const state = ctx.state;
  const data = inventorySummary(state);
  const active = new Map(state.products.map(product => [product.id, product]));
  const entries = el('div');
  const ledger = el('div');
  function drawStock() {
    const list = state.products.filter(item => matches(prefs.query, [item.name, item.sku, item.category]) &&
      (!prefs.stock || stockStatus(item) === prefs.stock) && matchesActive(item, prefs.status))
      .sort((a, b) => a.stock - b.stock || compare(a.name, b.name));
    pagedTable(entries, { list, name: 'Saldos de estoque', paging: prefs, size: state.settings.pageSize,
      headers: ['Produto', 'SKU', 'Saldo', 'Mínimo', 'Valor ao custo', 'Status', 'Ações'], rows: item =>
        [el('strong', {}, item.name), item.sku, stockBadge(item), quantity(item.minimum), item.cost === null ? '—' : money(item.stock * item.cost),
          entityStatus(item.active), button('Movimentar', { id: 'move-' + item.id, kind: 'secondary small', disabled: !item.active, action: () => stockForm(ctx, item) })] });
  }

  function drawLedger() {
    const list = state.movements.filter(item => inRange(localDay(item.when), movePrefs.range) &&
      (!movePrefs.type || item.type === movePrefs.type) && (!movePrefs.product || item.productId === movePrefs.product)).reverse();
    pagedTable(ledger, { list, name: 'Movimentações', paging: movePrefs, size: state.settings.pageSize,
      headers: ['Data', 'Produto', 'Tipo', 'Unidades', 'Antes', 'Depois', 'Motivo', 'Origem'],
      rows: item => [dateTime(item.when), item.name + ' · ' + item.sku,
        label(movementLabels[item.type], item.after > item.before ? 'good' : 'warn'),
        (item.after > item.before ? '+' : '−') + item.quantity, item.before, item.after, item.reason, item.ref ? idLabel(item.ref) : 'Manual'] });
  }
  const switchPeriod = () => ctx.render();
  drawStock();
  drawLedger();
  return [heading('Estoque', 'Confira saldos e rastreie cada mudança de inventário.', button('Movimentar estoque', { id: 'new-movement', kind: 'primary', symbol: 'plus', action: () => stockForm(ctx) })),
    el('div', { class: 'metrics' }, metric('Produtos', quantity(data.products), 'box'), metric('Unidades em estoque', quantity(data.units), 'inventory'),
      metric('Sem estoque', quantity(data.empty), 'alert', 'Produtos ativos', 'amber'), metric('No mínimo ou abaixo', quantity(data.low), 'alert', 'Com saldo positivo', 'amber'),
      metric('Próximos do mínimo', quantity(data.near), 'inventory'), metric('Valor estimado ao custo',
        data.withCosts ? money(data.value) : '—', 'wallet', data.withCosts + ' produto(s) com custo cadastrado')),
    el('section', { class: 'panel table-shell' }, el('div', { class: 'toolbar' }, searchControl(prefs, drawStock, 'Nome, SKU ou categoria'),
      filterControl(prefs, 'stock', 'Alerta', stockChoices, drawStock), filterControl(prefs, 'status', 'Status', activeChoices, drawStock)), entries),
    el('h2', { class: 'section-title' }, 'Histórico de movimentações'),
    periodControl(movePrefs, switchPeriod),
    el('section', { class: 'panel table-shell' }, el('div', { class: 'toolbar' },
      filterControl(movePrefs, 'type', 'Tipo de movimento', [['', 'Todos'], ...Object.entries(movementLabels)], drawLedger),
      filterControl(movePrefs, 'product', 'Produto', [['', 'Todos'], ...[...active.values()].sort((a, b) => compare(a.name, b.name)).map(item => [item.id, item.name])], drawLedger)), ledger)];
}

export function salesView(ctx) {
  const prefs = ctx.filters.sales;
  const state = ctx.state;
  const dataset = el('div');
  function draw() {
    const list = state.sales.filter(item => matches(prefs.query, [item.id, item.customerName, item.day, dateLabel(item.day), saleStatus[item.status]]) &&
      (!prefs.status || item.status === prefs.status) && (!prefs.customer || item.customerId === prefs.customer) && inRange(item.day, prefs.range));
    list.sort(prefs.sort === 'total' ? (a, b) => b.total - a.total : (a, b) => b.when.localeCompare(a.when));
    pagedTable(dataset, { list, name: 'Vendas', paging: prefs, size: state.settings.pageSize,
      headers: ['Venda', 'Data', 'Cliente', 'Itens', 'Total', 'Status', 'Ações'],
      rows: sale => [el('strong', {}, idLabel(sale.id)), dateLabel(sale.day), sale.customerName || 'Venda avulsa', quantity(sale.units),
        money(sale.total), label(saleStatus[sale.status], sale.status === 'completed' ? 'good' : 'bad'), details(sale, record => saleDetails(ctx, record))] });
  }
  draw();
  return [heading('Vendas', 'Registre operações, consulte comprovantes e gerencie cancelamentos.',
    button('Nova venda', { id: 'new-sale', kind: 'primary', symbol: 'plus', action: () => saleForm(ctx) })),
    periodControl(prefs, ctx.render),
    el('section', { class: 'panel table-shell' }, el('div', { class: 'toolbar' }, searchControl(prefs, draw, 'ID, cliente, data ou status'),
      filterControl(prefs, 'status', 'Status de venda', saleChoices, draw),
      filterControl(prefs, 'customer', 'Cliente', [['', 'Todos'], ...state.customers.map(item => [item.id, item.name])], draw),
      filterControl(prefs, 'sort', 'Ordenar', [['recent', 'Mais recentes'], ['total', 'Maior total']], draw)), dataset)];
}
