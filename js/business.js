import { byId, buildSettings, canonicalSKU, caps, cents, emailFormat, integer, localDay, textValue, uid } from './model.js';

function recordActivity(state, type, label, when, id) {
  state.activity.unshift({ id: id(), type, label, when });
  state.activity.length = Math.min(state.activity.length, caps.activity);
}

function ensureRoom(list, cap, label) {
  if (list.length >= cap) throw new Error('Limite de ' + label + ' atingido.');
}

function movement(state, product, type, delta, reason, ref, ctx) {
  ensureRoom(state.movements, caps.movements, 'movimentações');
  const before = product.stock;
  const after = before + delta;
  if (after < 0) throw new Error('Estoque insuficiente para ' + product.name + '. Disponível: ' + before + '.');
  if (after > caps.units) throw new Error('O saldo excederia o limite de unidades de ' + product.name + '.');
  product.stock = after;
  product.updatedAt = ctx.when;
  state.movements.push({ id: ctx.id(), productId: product.id, name: product.name, sku: product.sku, type,
    quantity: Math.abs(delta), before, after, when: ctx.when, reason, ref });
}

function requireFresh(entity, expected) {
  if (expected !== undefined && entity.updatedAt !== expected) throw new Error('O registro mudou em outra operação. Reabra o formulário.');
}

function productFields(state, input, currentId) {
  const name = textValue(input.name, 'Nome', 100);
  const sku = textValue(input.sku, 'SKU', 45);
  if (state.products.some(item => item.id !== currentId && canonicalSKU(item.sku) === canonicalSKU(sku))) throw new Error('O SKU já está em uso.');
  return { name, sku, description: textValue(input.description ?? '', 'Descrição', 600, true),
    category: textValue(input.category, 'Categoria', 60), price: cents(input.price, 'Preço'), cost: cents(input.cost ?? '', 'Custo', true),
    minimum: integer(input.minimum, 0, caps.units, 'Estoque mínimo') };
}

function customerFields(input) {
  const email = textValue(input.email ?? '', 'E-mail', 160, true);
  const phone = textValue(input.phone ?? '', 'Telefone', 30, true);
  if (email && !emailFormat.test(email)) throw new Error('Informe um e-mail em formato válido.');
  if (phone && (!/^[+()\d\s.-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7)) throw new Error('Informe um telefone válido.');
  return { name: textValue(input.name, 'Nome', 100), email, phone, city: textValue(input.city ?? '', 'Cidade', 80, true),
    notes: textValue(input.notes ?? '', 'Observações', 600, true) };
}

export function quoteSale(state, lines, discountValue = '0') {
  if (!Array.isArray(lines) || !lines.length || lines.length > 50) throw new Error('Adicione de 1 a 50 produtos à venda.');
  const seen = new Set();
  let subtotal = 0;
  const items = lines.map(line => {
    const product = byId(state.products, line.productId, 'Produto');
    if (seen.has(product.id)) throw new Error('Use uma linha por produto. Ajuste a quantidade na linha existente.');
    if (!product.active) throw new Error('Produto arquivado: ' + product.name + '.');
    if (line.expectedPrice !== undefined && line.expectedPrice !== product.price) throw new Error('O preço de ' + product.name + ' mudou. Revise a venda.');
    seen.add(product.id);
    const units = integer(line.quantity, 1, caps.units, 'Quantidade');
    if (units > product.stock) throw new Error('Estoque insuficiente para ' + product.name + '. Disponível: ' + product.stock + '.');
    subtotal += units * product.price;
    return { productId: product.id, name: product.name, sku: product.sku, category: product.category,
      quantity: units, price: product.price, gross: units * product.price };
  });
  if (subtotal > caps.total) throw new Error('O subtotal excede o limite da venda.');
  const discount = cents(discountValue || '0', 'Desconto', false, caps.total);
  if (discount > subtotal) throw new Error('O desconto não pode exceder o subtotal.');
  let allocated = 0n;
  let gross = 0n;
  for (const item of items) {
    gross += BigInt(item.gross);
    const cumulative = subtotal ? gross * BigInt(discount) / BigInt(subtotal) : 0n;
    item.net = item.gross - Number(cumulative - allocated);
    allocated = cumulative;
  }
  return { items, subtotal, discount, total: subtotal - discount, units: items.reduce((sum, item) => sum + item.quantity, 0) };
}

const commands = {
  start(state) { state.started = true; },
  settings(state, data) { state.settings = buildSettings({ ...state.settings, ...data }); },
  saveProduct(state, data, ctx) {
    const existing = data.id ? byId(state.products, data.id, 'Produto') : null;
    const fields = productFields(state, data, existing?.id);
    if (existing) {
      requireFresh(existing, data.expected);
      Object.assign(existing, fields, { updatedAt: ctx.when });
    } else {
      ensureRoom(state.products, caps.products, 'produtos');
      const initial = integer(data.initial ?? 0, 0, caps.units, 'Estoque inicial');
      const product = { ...fields, id: ctx.id(), active: true, stock: 0, createdAt: ctx.when, updatedAt: ctx.when };
      state.products.push(product);
      if (initial) movement(state, product, 'IN', initial, 'Estoque inicial', null, ctx);
    }
    recordActivity(state, 'product', (existing ? 'Produto atualizado · ' : 'Produto cadastrado · ') + fields.name, ctx.when, ctx.id);
  },
  saveCustomer(state, data, ctx) {
    const existing = data.id ? byId(state.customers, data.id, 'Cliente') : null;
    const fields = customerFields(data);
    if (existing) {
      requireFresh(existing, data.expected);
      Object.assign(existing, fields, { updatedAt: ctx.when });
    } else {
      ensureRoom(state.customers, caps.customers, 'clientes');
      state.customers.push({ ...fields, id: ctx.id(), active: true, createdAt: ctx.when, updatedAt: ctx.when });
    }
    recordActivity(state, 'customer', (existing ? 'Cliente atualizado · ' : 'Cliente cadastrado · ') + fields.name, ctx.when, ctx.id);
  },
  changeEntity(state, data, ctx) {
    if (!['product', 'customer'].includes(data.entity) || !['delete', 'archive', 'restore'].includes(data.action)) throw new Error('Ação inválida.');
    const product = data.entity === 'product';
    const label = product ? 'Produto' : 'Cliente';
    const list = product ? state.products : state.customers;
    const entry = byId(list, data.id, label);
    requireFresh(entry, data.expected);
    if (data.action === 'delete') {
      const used = product ? state.movements.some(move => move.productId === entry.id) || state.items.some(item => item.productId === entry.id) :
        state.sales.some(sale => sale.customerId === entry.id);
      if (used) throw new Error('Este registro possui histórico. Arquive-o para preservar a referência.');
      list.splice(list.indexOf(entry), 1);
    } else {
      entry.active = data.action === 'restore';
      entry.updatedAt = ctx.when;
    }
    const action = { delete: 'Exclusão', archive: 'Arquivamento', restore: 'Reativação' }[data.action];
    recordActivity(state, data.entity, action + ' · ' + entry.name, ctx.when, ctx.id);
  },
  move(state, data, ctx) {
    const product = byId(state.products, data.productId, 'Produto');
    requireFresh(product, data.expected);
    if (!['IN', 'OUT', 'ADJUSTMENT'].includes(data.type)) throw new Error('Tipo de movimentação inválido.');
    if (!product.active) throw new Error('Reative o produto antes de movimentar o estoque manualmente.');
    const adjustment = data.type === 'ADJUSTMENT';
    const amount = integer(data.amount, adjustment ? 0 : 1, caps.units, 'Quantidade');
    const delta = adjustment ? amount - product.stock : data.type === 'OUT' ? -amount : amount;
    if (!delta) throw new Error('O saldo já é igual à quantidade informada.');
    movement(state, product, data.type, delta, textValue(data.reason, 'Motivo', 220), null, ctx);
    recordActivity(state, 'stock', 'Estoque atualizado · ' + product.name, ctx.when, ctx.id);
  },
  sell(state, data, ctx) {
    ensureRoom(state.sales, caps.sales, 'vendas');
    const customer = data.customerId ? byId(state.customers, data.customerId, 'Cliente') : null;
    if (customer && !customer.active) throw new Error('Selecione um cliente ativo.');
    const quote = quoteSale(state, data.lines, data.discount);
    const id = ctx.id();
    const { items, ...amounts } = quote;
    state.sales.push({ ...amounts, id, customerId: customer?.id ?? null, customerName: customer?.name ?? '',
      status: 'completed', when: ctx.when, day: localDay(ctx.when), cancelledAt: null, reason: '' });
    for (const item of items) {
      state.items.push({ ...item, id: ctx.id(), saleId: id });
      movement(state, byId(state.products, item.productId, 'Produto'), 'SALE', -item.quantity, 'Venda registrada', id, ctx);
    }
    recordActivity(state, 'sale', 'Venda registrada · ' + id.slice(0, 8), ctx.when, ctx.id);
  },
  cancel(state, data, ctx) {
    const sale = byId(state.sales, data.id, 'Venda');
    if (sale.status !== 'completed') throw new Error('Esta venda já foi cancelada.');
    sale.status = 'cancelled';
    sale.cancelledAt = ctx.when;
    sale.reason = textValue(data.reason ?? '', 'Motivo do cancelamento', 220, true);
    for (const item of state.items.filter(item => item.saleId === sale.id)) {
      movement(state, byId(state.products, item.productId, 'Produto'), 'SALE_REVERSAL', item.quantity, 'Cancelamento de venda', sale.id, ctx);
    }
    recordActivity(state, 'cancel', 'Venda cancelada · ' + sale.id.slice(0, 8), ctx.when, ctx.id);
  },
};

export function applyCommand(previous, type, data = {}, { now = new Date(), id = uid } = {}) {
  if (!Object.hasOwn(commands, type)) throw new Error('Operação desconhecida.');
  const next = structuredClone(previous);
  const stamps = [next.activity[0]?.when, next.movements.at(-1)?.when,
    ...next.products.map(item => item.updatedAt), ...next.customers.map(item => item.updatedAt)];
  const latest = stamps.reduce((stamp, value) => value && value > stamp ? value : stamp, '');
  const when = latest && latest >= now.toISOString() ? new Date(Date.parse(latest) + 1).toISOString() : now.toISOString();
  commands[type](next, data, { when, id });
  if (type !== 'settings') next.started = true;
  next.revision = previous.revision + 1;
  return next;
}

export function customerSales(state, id) {
  const related = state.sales.filter(sale => sale.customerId === id).sort((a, b) => b.when.localeCompare(a.when));
  const valid = related.filter(sale => sale.status === 'completed');
  return { related, count: valid.length, total: valid.reduce((sum, sale) => sum + sale.total, 0), latest: valid[0]?.day };
}
