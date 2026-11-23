export const version = 1;
export const caps = { products: 1000, customers: 5000, sales: 10000, movements: 40000, activity: 200, units: 100000, unitPrice: 10000000, total: 10000000000 };
export const movementLabels = { IN: 'Entrada', OUT: 'Saída', ADJUSTMENT: 'Ajuste', SALE: 'Venda', SALE_REVERSAL: 'Estorno de venda' };
export const defaultSettings = { company: 'Nadani Commerce', theme: 'system', pageSize: 10, density: 'regular' };

export function initialState(started = false) {
  return { version, revision: 0, started, products: [], customers: [], sales: [], items: [], movements: [], activity: [], settings: { ...defaultSettings } };
}

export const validInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export function integer(value, min, max, label) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value.trim())) ||
      !validInt(Number(value), min, max)) throw new Error(label + ' deve ser um inteiro de ' + min + ' a ' + max + '.');
  return Number(value);
}

export function textValue(value, label, max, optional = false) {
  if (typeof value !== 'string') throw new Error(label + ' inválido.');
  const clean = value.trim();
  if (!optional && !clean || clean.length > max) throw new Error(label + ' deve conter ' + (optional ? 'até ' : 'de 1 a ') + max + ' caracteres.');
  return clean;
}

export function cents(value, label, optional = false, max = caps.unitPrice) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw && optional && typeof value === 'string') return null;
  if (!/^\d{1,12}([,.]\d{1,2})?$/.test(raw)) throw new Error(label + ' deve ser um valor sem separador de milhar, com até duas casas decimais.');
  const [units, decimals = ''] = raw.split(/[,.]/);
  const amount = Number(units) * 100 + Number(decimals.padEnd(2, '0'));
  if (!validInt(amount, 0, max)) throw new Error(label + ' excede o limite permitido.');
  return amount;
}

export const moneyInput = value => value === null ? '' : (value / 100).toFixed(2).replace('.', ',');
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = value => currency.format(value / 100);
export const quantity = value => Number(value).toLocaleString('pt-BR');
export const fold = value => String(value ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase('pt-BR');

export function localDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || value < '1900-01-01') return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
}

export function shiftDay(day, offset) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export const dateLabel = value => (value || '').slice(0, 10).split('-').reverse().join('/') || '—';
export const dateTime = value => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const emailFormat = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;
export const canonicalSKU = value => fold(value.trim());
export const stockStatus = product => product.stock === 0 ? 'empty' : product.stock <= product.minimum ? 'low' :
  product.stock <= product.minimum + Math.max(1, Math.ceil(product.minimum * .3)) ? 'near' : 'ok';
export const lowStock = product => product.active && product.stock <= product.minimum;

export const uid = () => crypto.randomUUID();
export const byId = (list, id, label) => {
  const item = list.find(entry => entry.id === id);
  if (!item) throw new Error(label + ' não está disponível. Atualize a tela e tente novamente.');
  return item;
};

export function buildSettings(input) {
  const company = textValue(input.company, 'Nome da empresa', 65);
  if (!['system', 'light', 'dark'].includes(input.theme) || !['regular', 'compact'].includes(input.density) ||
      ![10, 20, 50].includes(Number(input.pageSize))) throw new Error('Preferência inválida.');
  return { company, theme: input.theme, pageSize: Number(input.pageSize), density: input.density };
}
