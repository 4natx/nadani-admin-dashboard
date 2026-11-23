import { customerSales, quoteSale } from './business.js';
import { caps, dateLabel, dateTime, money, moneyInput, stockStatus } from './model.js';
import { idLabel, movementStatus, saleStatus } from './reports.js';
import { actions, area, button, el, facts, field, input, label, note, printDocument, select, submit, table, textField, valuesOf } from './ui.js';

const text = (name, title, value, max, required = false) => textField(name, title, value ?? '', { maxlength: max, required });
const qty = (name, title, value = 0, min = 0) => textField(name, title, value, { type: 'number', min, max: caps.units, step: 1, required: true });
const amount = (name, title, value = null, needed = false) => textField(name, title, moneyInput(value), { inputmode: 'decimal', placeholder: '0,00', maxlength: 15, required: needed });
const cancel = () => button('Cancelar', { 'data-close': true });
const dialogActions = (...items) => el('div', { class: 'modal-actions' }, items);

function editForm(ctx, title, fields, label, save, id) {
  const error = el('p', { class: 'error', role: 'alert', id: 'form-error', tabindex: '-1' });
  const commit = submit(label, id);
  const form = el('form', {}, el('div', { class: 'form-grid' }, fields), error, dialogActions(cancel(), commit));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (commit.disabled) return;
    commit.disabled = true;
    error.textContent = '';
    try {
      await save(valuesOf(form));
      ctx.close();
    } catch (problem) {
      if (error.isConnected) { error.textContent = problem.message; error.focus(); }
    } finally {
      commit.disabled = false;
    }
  });
  ctx.open(title, [form], form.querySelector('input, select, textarea'));
}

export function productForm(ctx, product) {
  editForm(ctx, product ? 'Editar produto' : 'Cadastrar produto', [
    text('name', 'Nome', product?.name, 100, true), text('sku', 'SKU', product?.sku, 45, true),
    text('category', 'Categoria', product?.category, 60, true),
    amount('price', 'Preço de venda (BRL)', product?.price ?? null, true), amount('cost', 'Custo unitário (opcional)', product?.cost ?? null),
    qty('minimum', 'Estoque mínimo', product?.minimum ?? 5),
    product ? null : qty('initial', 'Estoque inicial'), area('description', 'Descrição', product?.description),
  ], 'Salvar produto', raw => ctx.run('saveProduct', { ...raw, id: product?.id, expected: product?.updatedAt },
    product ? 'Produto atualizado.' : 'Produto cadastrado.'), 'save-product');
}

export function customerForm(ctx, customer) {
  editForm(ctx, customer ? 'Editar cliente' : 'Cadastrar cliente', [
    text('name', 'Nome', customer?.name, 100, true),
    textField('email', 'E-mail (opcional)', customer?.email ?? '', { type: 'email', maxlength: 160 }),
    textField('phone', 'Telefone (opcional)', customer?.phone ?? '', { type: 'tel', maxlength: 30 }),
    text('city', 'Cidade (opcional)', customer?.city, 80), area('notes', 'Observações (opcional)', customer?.notes),
  ], 'Salvar cliente', raw => ctx.run('saveCustomer', { ...raw, id: customer?.id, expected: customer?.updatedAt },
    customer ? 'Cliente atualizado.' : 'Cliente cadastrado.'), 'save-customer');
}

function entityActions(ctx, entity, item) {
  const isProduct = entity === 'product';
  const dependent = isProduct ? ctx.state.movements.some(move => move.productId === item.id) :
    ctx.state.sales.some(sale => sale.customerId === item.id);
  const edit = button('Editar', { id: 'edit-entity', kind: 'primary', action: () => isProduct ? productForm(ctx, item) : customerForm(ctx, item) });
  const mode = item.active ? 'archive' : 'restore';
  const status = item.active ? 'Arquivar' : 'Reativar';
  const change = (action, success) => ctx.run('changeEntity', { entity, action, id: item.id, expected: item.updatedAt }, success);
  const archive = button(status, { id: 'toggle-entity', action: () => ctx.confirm(status + ' cadastro?', item.name,
    status, () => change(mode, item.active ? 'Cadastro arquivado.' : 'Cadastro reativado.')) });
  const remove = dependent ? null : button('Excluir', { id: 'delete-entity', action: () => ctx.confirm('Excluir cadastro?',
    'O cadastro de ' + item.name + ' será excluído definitivamente.', 'Excluir', () => change('delete', 'Cadastro excluído.')) });
  return [...(dependent ? [note('O histórico vinculado a este cadastro pode ser preservado por arquivamento.')] : []), dialogActions(remove, archive, edit)];
}

export function productDetails(ctx, product) {
  ctx.open(product.name, [facts([
    ['SKU', product.sku], ['Categoria', product.category], ['Preço', money(product.price)], ['Custo', product.cost === null ? '—' : money(product.cost)],
    ['Em estoque', String(product.stock)], ['Estoque mínimo', String(product.minimum)], ['Alerta', movementStatus[stockStatus(product)]],
    ['Status', product.active ? 'Ativo' : 'Arquivado'], ['Criado em', dateTime(product.createdAt)], ['Atualizado em', dateTime(product.updatedAt)],
  ]), el('p', { class: 'muted' }, product.description || 'Sem descrição.'), ...entityActions(ctx, 'product', product)]);
}

export function customerDetails(ctx, customer) {
  const history = customerSales(ctx.state, customer.id);
  const page = history.related.slice(0, 20);
  ctx.open(customer.name, [facts([
    ['E-mail', customer.email || '—'], ['Telefone', customer.phone || '—'], ['Cidade', customer.city || '—'],
    ['Status', customer.active ? 'Ativo' : 'Arquivado'], ['Vendas concluídas', String(history.count)], ['Total de compras', money(history.total)],
    ['Última compra válida', history.latest ? dateLabel(history.latest) : '—'],
    ['Cadastro', dateTime(customer.createdAt)], ['Última atualização', dateTime(customer.updatedAt)],
  ]), el('p', { class: 'muted' }, customer.notes || 'Sem observações.'), el('h3', { class: 'section-title' }, 'Histórico de vendas'),
  page.length ? table(['Venda', 'Data', 'Total', 'Status'], page.map(sale =>
    [button(idLabel(sale.id), { kind: 'secondary small', action: () => saleDetails(ctx, sale) }), dateLabel(sale.day), money(sale.total), saleStatus[sale.status]]), 'Histórico do cliente') : note('Nenhuma venda vinculada.'),
  history.related.length > 20 ? button('Ver todas as vendas deste cliente', { action: () => { ctx.close(); ctx.showCustomerSales(customer.id); } }) : null,
  ...entityActions(ctx, 'customer', customer)]);
}

export function stockForm(ctx, selected) {
  const products = ctx.state.products.filter(product => product.active);
  if (!products.length) { ctx.open('Movimentar estoque', [note('Cadastre ou reative um produto para movimentar o estoque.')]); return; }
  const control = select('productId', products.map(item => [item.id, item.name + ' · ' + item.stock + ' un.']), selected?.id, { id: 'move-product' });
  const type = select('type', [['IN', 'Entrada'], ['OUT', 'Saída manual'], ['ADJUSTMENT', 'Ajuste para novo saldo']], undefined, { id: 'move-type' });
  editForm(ctx, 'Movimentar estoque', [
    field('Produto e estoque atual', control), field('Tipo', type),
    qty('amount', 'Quantidade ou novo saldo', 1), text('reason', 'Motivo', '', 220, true),
  ], 'Registrar movimentação', raw => ctx.run('move', { ...raw, expected: products.find(product => product.id === raw.productId)?.updatedAt },
    'Movimentação registrada.'), 'save-movement');
}

export function saleForm(ctx) {
  const products = ctx.state.products.filter(product => product.active && product.stock > 0);
  if (!products.length) {
    ctx.open('Nova venda', [note('Cadastre um produto ativo e registre uma entrada de estoque para começar.'),
      dialogActions(button('Cadastrar produto', { kind: 'primary', action: () => productForm(ctx) }))]);
    return;
  }
  const quoteState = { products };
  const customers = ctx.state.customers.filter(customer => customer.active);
  const customer = select('customerId', [['', 'Venda avulsa'], ...customers.map(item => [item.id, item.name])], '', { id: 'sale-customer' });
  const discount = input('discount', { inputmode: 'decimal', value: '0,00', maxlength: 15, id: 'sale-discount' });
  const host = el('div', { id: 'sale-lines' });
  const totals = el('div', { id: 'sale-totals', 'aria-live': 'polite' });
  const error = el('p', { class: 'error', role: 'alert', tabindex: '-1', id: 'sale-error' });
  const commit = submit('Confirmar venda', 'save-sale');
  const add = button('Adicionar produto', { id: 'add-line', symbol: 'plus', action: () => addLine(true) });
  const form = el('form', { id: 'sale-form' },
    el('div', { class: 'form-grid' }, field('Cliente (opcional)', customer), field('Desconto em BRL', discount)),
    host, actions(add), totals, error, dialogActions(cancel(), commit));

  function lines() {
    return [...host.querySelectorAll('.sale-line')].map(row => {
      const productId = row.querySelector('select').value;
      return { productId, quantity: row.querySelector('input').value, expectedPrice: products.find(product => product.id === productId)?.price };
    });
  }
  function updateQuote() {
    error.textContent = '';
    for (const row of host.children) {
      const product = products.find(item => item.id === row.querySelector('select').value);
      row.querySelector('.line-price').textContent = product ? money(product.price) + ' por unidade · ' + product.stock + ' em estoque' : 'Escolha o produto.';
    }
    try {
      const preview = quoteSale(quoteState, lines(), discount.value);
      totals.replaceChildren(facts([['Subtotal', money(preview.subtotal)], ['Desconto', money(preview.discount)], ['Total', money(preview.total)]], 'sale-totals'));
      commit.disabled = false;
    } catch (problem) {
      totals.replaceChildren(note(problem.message));
      commit.disabled = true;
    }
    const rows = [...host.querySelectorAll('.sale-line')];
    rows.forEach((row, index) => {
      const field = row.querySelector('select');
      const taken = new Set(rows.filter(other => row !== other).map(other => other.querySelector('select').value));
      for (const option of field.options) option.disabled = taken.has(option.value);
      row.querySelector('input').setAttribute('aria-label', 'Quantidade da linha ' + (index + 1));
    });
    add.disabled = rows.length >= Math.min(products.length, 50);
  }
  function addLine(focus) {
    const taken = new Set(lines().map(line => line.productId));
    const available = products.find(product => !taken.has(product.id));
    if (!available) return;
    const control = select('product', products.map(product => [product.id, product.name + ' · ' + product.sku]), available.id);
    const units = input('quantity', { type: 'number', min: 1, max: caps.units, value: 1, required: true });
    const remove = button('Remover', { kind: 'secondary small', action: () => { row.remove(); updateQuote(); add.focus(); } });
    const row = el('div', { class: 'sale-line' }, field('Produto', control), field('Quantidade', units), remove, el('p', { class: 'line-price fine' }));
    host.append(row);
    updateQuote();
    if (focus) control.focus();
  }
  form.addEventListener('input', updateQuote);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (commit.disabled) return;
    commit.disabled = true;
    const controls = [...form.elements];
    controls.forEach(control => { if (control !== commit && !control.disabled) control.dataset.saving = '1', control.disabled = true; });
    try {
      await ctx.run('sell', { customerId: customer.value, discount: discount.value, lines: lines() }, 'Venda registrada e estoque atualizado.');
      ctx.close();
      ctx.navigate('sales');
    } catch (problem) {
      for (const control of controls) {
        if (control.dataset.saving) { control.disabled = false; delete control.dataset.saving; }
      }
      updateQuote();
      error.textContent = problem.message;
      error.focus();
    }
  });
  addLine(false);
  ctx.open('Nova venda', [note('Registro demonstrativo em BRL.'), form], customer);
}

function saleContent(state, sale) {
  const items = state.items.filter(item => item.saleId === sale.id);
  return [facts([
    ['Identificador', sale.id], ['Data', dateTime(sale.when)], ['Cliente', sale.customerName || 'Venda avulsa'],
    ['Status', saleStatus[sale.status]], ['Subtotal', money(sale.subtotal)], ['Desconto', money(sale.discount)], ['Total', money(sale.total)],
    ...(sale.cancelledAt ? [['Cancelada em', dateTime(sale.cancelledAt)], ['Motivo', sale.reason || 'Não informado']] : []),
  ]), el('h3', { class: 'section-title' }, 'Itens'), table(['Produto', 'SKU', 'Qtd.', 'Unitário', 'Subtotal', 'Líquido'],
    items.map(item => [item.name, item.sku, String(item.quantity), money(item.price), money(item.gross), money(item.net)]), 'Itens da venda', 'sales-detail-table')];
}

export function saleDetails(ctx, sale) {
  const print = button('Imprimir comprovante', { id: 'print-receipt', symbol: 'report', action: () => {
    const contents = saleContent(ctx.state, sale);
    const wrapper = contents.at(-1);
    wrapper.querySelector('table').removeAttribute('id');
    printDocument('Comprovante demonstrativo · ' + idLabel(sale.id), contents, ctx.state.settings.company + ' · Sem validade fiscal.');
  } });
  const refund = sale.status === 'completed' ? button('Cancelar venda', { id: 'cancel-sale', kind: 'danger', action: () => editForm(ctx,
    'Cancelar venda e devolver estoque?', [area('reason', 'Motivo (opcional)')], 'Confirmar cancelamento',
    raw => ctx.run('cancel', { id: sale.id, reason: raw.reason }, 'Venda cancelada. As unidades voltaram ao estoque.'), 'confirm-cancel-sale') }) : null;
  ctx.open('Venda · ' + idLabel(sale.id), [label('Comprovante demonstrativo · sem validade fiscal', 'info'),
    ...saleContent(ctx.state, sale), dialogActions(refund, print)]);
}
