import { applyCommand } from './business.js';
import { initialState } from './model.js';

const families = [
  ['Papelaria', ['Caderno Horizonte', 'Planner Semanal', 'Caneta Nébula', 'Estojo Linho', 'Bloco Aurora', 'Kit Marcadores']],
  ['Casa', ['Caneca Atlas', 'Vela Cedro', 'Bandeja Duna', 'Vaso Argila', 'Pote Nórdico', 'Toalha Brisa']],
  ['Tecnologia', ['Hub Órbita', 'Suporte Lumen', 'Cabo Trançado', 'Mouse Prisma', 'Luminária Pixel', 'Organizador de Mesa']],
  ['Acessórios', ['Bolsa Mosaico', 'Garrafa Térmica', 'Ecobag Terracota', 'Chaveiro Polar', 'Necessaire Maré', 'Carteira Delta']],
  ['Bem-estar', ['Difusor Sereno', 'Almofada Nuvem', 'Escova Bambu', 'Máscara Lunar', 'Tapete Fluido', 'Rolo de Massagem']],
];
const firstNames = ['Marina', 'Caio', 'Bia', 'João', 'Helena', 'Nina', 'Miguel', 'Lívia', 'Rafael', 'Iara', 'Theo', 'Débora', 'Bruno', 'Luísa', 'Eva', 'Sofia', 'Paulo', 'Ana', 'Aline', 'Luca'];

export function makeDemo(today = new Date()) {
  let next = initialState(true);
  const ago = days => {
    const date = new Date(today);
    date.setDate(date.getDate() - days);
    date.setHours(10, 30, 0, 0);
    if (date > today) return new Date(today);
    return date;
  };
  const run = (type, data, days) => { next = applyCommand(next, type, data, { now: ago(days) }); };
  for (const [category, names] of families) {
    for (const name of names) {
      const i = next.products.length;
      run('saveProduct', { name, sku: 'NDC-' + String(i + 1).padStart(3, '0'), description: 'Produto demonstrativo do catálogo Nadani Commerce.',
        category, price: String(19 + i * 7) + ',90', cost: i % 7 === 0 ? '' : String(10 + i * 3), initial: 48 + i % 8 * 7, minimum: i % 5 + 4 }, 92);
    }
  }
  for (const [i, name] of firstNames.entries()) {
    run('saveCustomer', { name: name + ' Exemplo', email: 'cliente' + (i + 1) + '@example.invalid',
      city: ['Recife', 'Salvador', 'Curitiba', 'São Paulo', 'Belo Horizonte'][i % 5], notes: 'Cadastro sintético.' }, 90);
  }
  for (let i = 0; i < 60; i++) {
    const days = 89 - Math.floor(Math.pow(i / 59, .72) * 89);
    const first = (i * 13 + Math.floor(i / 4) * 5) % 30;
    const second = (first + 3 + i % 6) % 30;
    run('sell', { customerId: i % 8 === 0 ? '' : next.customers[i * 7 % 20].id, discount: i % 5 === 0 ? '8,00' : '0',
      lines: [{ productId: next.products[first].id, quantity: 1 + i % 4 },
        ...(i % 3 ? [{ productId: next.products[second].id, quantity: 1 + i % 2 }] : [])] }, days);
  }
  for (const index of [5, 28, 43]) run('cancel', { id: next.sales[index].id, reason: 'Cancelamento demonstrativo.' }, 0);
  [0, 1, 7, 12, 19].forEach((index, n) => run('move', { productId: next.products[index].id,
    type: 'ADJUSTMENT', amount: [0, 2, 3, 5, 8][n], reason: 'Conferência física demonstrativa.' }, 0));
  return next;
}
