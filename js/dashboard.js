import { periodChange, previousRange, shortDate, summarize } from './analytics.js';
import { dateLabel, dateTime, money, quantity, validDay } from './model.js';
import { saleStatus } from './reports.js';
import { actions, button, el, filterControl, heading, icon, metric, note, periodControl, select, field, svg } from './ui.js';

const palette = ['#238b73', '#5f8dbf', '#a37ac6', '#c27a39', '#5b9bab', '#b95370'];
const compactCurrency = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const compact = value => compactCurrency.format(value);

function panel(title, description, ...body) {
  return el('section', { class: 'panel chart-panel' }, el('h2', {}, title), note(description), body);
}

function chartTime(data, name, symbol, mode) {
  const isMoney = mode === 'revenue';
  const description = isMoney ? 'Vendas concluídas, após desconto' : 'Quantidade por dia no período';
  if (!data.some(point => point[mode])) return panel(name, description, el('p', { class: 'empty' }, 'Sem valores para este recorte.'));
  const width = 620;
  const graph = { left: 54, top: 12, right: width - 15, bottom: 167 };
  const graphWidth = graph.right - graph.left;
  const graphHeight = graph.bottom - graph.top;
  const max = Math.max(...data.map(point => point[mode]));
  const barWidth = graphWidth / data.length;
  const y = value => graph.bottom - value / max * graphHeight;
  const x = index => graph.left + barWidth * (index + .5);
  const plot = svg('svg', { class: 'plot', viewBox: `0 0 ${width} 199`, 'aria-hidden': 'true' });
  const fill = isMoney ? 'var(--accent)' : 'var(--blue)';
  for (let step = 0; step < 5; step++) {
    const value = max / 4 * step;
    const coord = y(value);
    plot.append(svg('line', { x1: graph.left, y1: coord, x2: graph.right, y2: coord, stroke: 'var(--line)', 'stroke-dasharray': step ? '4 4' : '0' }));
    if (isMoney || Number.isInteger(value) || step === 4) {
      const axis = svg('text', { x: graph.left - 7, y: coord + 4, 'text-anchor': 'end' });
      axis.textContent = isMoney ? 'R$ ' + compact(value / 100) : compact(value);
      plot.append(axis);
    }
  }
  const marks = [0, Math.floor((data.length - 1) / 2), data.length - 1];
  for (const index of new Set(marks)) {
    const axis = svg('text', { x: x(index), y: 188, 'text-anchor': 'middle' });
    axis.textContent = shortDate(data[index].day);
    plot.append(axis);
  }
  if (isMoney) {
    const points = data.map((point, index) => x(index) + ',' + y(point.revenue)).join(' ');
    plot.append(svg('polygon', { points: x(0) + ',' + graph.bottom + ' ' + points + ' ' + x(data.length - 1) + ',' + graph.bottom, fill, opacity: '.13' }),
      svg('polyline', { points, stroke: fill, 'stroke-width': '2.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' }));
  } else {
    data.forEach((point, index) => {
      const w = Math.max(.8, barWidth * .56);
      if (point.sales) plot.append(svg('rect', { x: x(index) - w / 2, y: y(point.sales), width: w,
        height: graph.bottom - y(point.sales), fill, rx: Math.min(3, w / 2), opacity: '.76' }));
    });
  }
  const marker = svg('line', { y1: graph.top, y2: graph.bottom, stroke: fill, 'stroke-width': 1.8, 'stroke-dasharray': '4 4', 'pointer-events': 'none' });
  const point = svg('circle', { fill, r: 4, 'pointer-events': 'none' });
  plot.append(marker, point);
  const options = data.map((value, index) => [index, dateLabel(value.day)]);
  const control = select('day', options, data.findLastIndex(item => item[mode] > 0), { id: 'chart-' + mode });
  const output = el('output', { for: control.id, 'aria-live': 'polite' });
  function choose(index) {
    control.value = String(index);
    marker.setAttribute('x1', x(index));
    marker.setAttribute('x2', x(index));
    point.setAttribute('cx', x(index));
    point.setAttribute('cy', y(data[index][mode]));
    output.textContent = isMoney ? money(data[index][mode]) : quantity(data[index][mode]) + ' venda(s)';
  }
  control.addEventListener('change', () => choose(Number(control.value)));
  plot.style.cursor = 'crosshair';
  plot.addEventListener('click', event => {
    const bounds = plot.getBoundingClientRect();
    const pos = (event.clientX - bounds.left) / bounds.width * width;
    choose(Math.max(0, Math.min(data.length - 1, Math.floor((pos - graph.left) / barWidth))));
  });
  choose(Number(control.value));
  return panel(name, description, plot, el('div', { class: 'chart-controls' }, field('Consultar dia', control), output));
}

function donut(groups) {
  if (!groups.length) return panel('Vendas por categoria', 'Distribuição por unidades', el('p', { class: 'empty' }, 'Sem categorias com vendas para este recorte.'));
  const groupsWithOther = groups.length > 6 ? [...groups.slice(0, 5), ['Outras categorias', groups.slice(5).reduce((sum, [, units]) => sum + units, 0)]] : groups;
  const total = groupsWithOther.reduce((sum, [, units]) => sum + units, 0);
  const chart = svg('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' });
  const circle = { cx: 60, cy: 60, r: 46, fill: 'none', 'stroke-width': 12, pathLength: 100 };
  chart.append(svg('circle', { ...circle, stroke: 'var(--line)' }));
  const legend = el('ul', { class: 'legend' });
  let offset = 0;
  groupsWithOther.forEach(([name, units], index) => {
    const share = units / total * 100;
    const gap = Math.min(1.2, share / 3);
    const length = units === total ? 100 : share - gap;
    const color = palette[index % palette.length];
    chart.append(svg('circle', { ...circle, stroke: color, 'stroke-dasharray': length + ' ' + (100 - length),
      'stroke-dashoffset': -offset, transform: 'rotate(-90 60 60)' }));
    offset += share;
    const swatch = el('i', { 'aria-hidden': 'true' });
    swatch.style.background = color;
    legend.append(el('li', {}, el('span', {}, swatch, name), el('strong', {}, quantity(units) + ' · ' + quantity(Math.round(share * 10) / 10) + '%')));
  });
  const center = svg('text', { x: 60, y: 63, 'text-anchor': 'middle' });
  center.style.font = '700 18px system-ui';
  center.style.fill = 'var(--text)';
  center.textContent = quantity(total);
  chart.append(center);
  return panel('Vendas por categoria', 'Distribuição por unidades', el('div', { class: 'donut-wrap' }, chart, legend));
}

function ranking(title, groups, monetary = false, description = monetary ? 'Receita reconhecida por cliente' : 'Classificação por unidades vendidas') {
  const rows = groups.slice(0, 6);
  if (!rows.length) return panel(title, description, el('p', { class: 'empty' }, 'Sem registros para este recorte.'));
  const key = monetary ? 'revenue' : 'units';
  const max = Math.max(1, ...rows.map(item => item[key]));
  return panel(title, description, el('div', { class: 'ranking' }, rows.map((item, index) => {
    const chart = svg('svg', { viewBox: '0 0 100 7', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    chart.append(svg('rect', { width: 100, height: 7, fill: 'var(--line)' }),
      svg('rect', { width: 100 * item[key] / max, height: 7, fill: index ? palette[1] : palette[0] }));
    return el('div', { class: 'rank-row' }, el('span', {}, item.name), chart, el('strong', {}, monetary ? money(item[key]) : quantity(item[key])));
  })));
}

function welcome(ctx) {
  const draw = svg('svg', { class: 'welcome-art', viewBox: '0 0 260 150', 'aria-hidden': 'true' });
  draw.append(svg('rect', { x: 27, y: 17, width: 206, height: 116, rx: 16, fill: '#28574e', stroke: '#80bcae', transform: 'rotate(-5 130 75)' }),
    svg('path', { d: 'M56 50h147M56 76h147M56 102h147', stroke: '#659789' }),
    svg('path', { d: 'M57 101 87 79 105 93 137 55 162 72 206 39', stroke: '#92fbd6', fill: 'none', 'stroke-width': 4, 'stroke-linecap': 'round' }),
    svg('circle', { cx: 206, cy: 39, r: 6, fill: '#b5ffe6' }));
  return el('section', { class: 'welcome' }, el('div', {}, el('h2', {}, 'Prepare seu espaço de gestão'),
    el('p', {}, 'Experimente a operação de uma loja fictícia ou comece com os próprios cadastros. Os dados ficam neste navegador.'),
    actions(button('Carregar demonstração', { id: 'load-demo', kind: 'primary', symbol: 'plus', action: () => ctx.seed() }),
      button('Começar vazio', { id: 'start-empty', action: () => ctx.start() }))), draw);
}

function compareLine(value) {
  if (value === null) return 'Sem base de comparação no período anterior';
  return (value > 0 ? '+' : '') + quantity(value) + '% vs. período anterior';
}

export function overviewView(ctx) {
  const state = ctx.state;
  const config = ctx.filters.overview;
  const summary = summarize(state, config.range);
  const prior = previousRange(config.range);
  const previous = validDay(prior.start) ? summarize(state, prior) : null;
  const variation = periodChange(summary.revenue, previous?.revenue);
  const variationSales = periodChange(summary.sales, previous?.sales);
  const nodes = [heading('Visão geral', 'Acompanhe o desempenho comercial e os alertas de estoque.',
    el('a', { class: 'button secondary', href: '#reports' }, icon('report'), 'Abrir relatórios'))];
  if (!state.started) nodes.push(welcome(ctx));
  nodes.push(periodControl(config, ctx.render),
    el('div', { class: 'metrics' },
      metric('Receita total', money(summary.totalRevenue), 'wallet', 'Vendas concluídas em todo o histórico'),
      metric('Receita no período', money(summary.revenue), 'analytics', compareLine(variation)),
      metric('Vendas concluídas', quantity(summary.sales), 'cart', compareLine(variationSales), 'blue'),
      metric('Ticket médio', money(summary.ticket), 'wallet', 'Receita / vendas concluídas'),
      metric('Clientes cadastrados', quantity(summary.registeredCustomers), 'people', null, 'blue'),
      metric('Produtos cadastrados', quantity(summary.registeredProducts), 'box'),
      metric('Estoque baixo', quantity(summary.low), 'alert', 'Ativos no mínimo ou abaixo', 'amber'),
      metric('Itens vendidos', quantity(summary.units), 'inventory', 'Unidades no período')),
    el('div', { class: 'chart-grid' },
      chartTime(summary.trend, 'Receita ao longo do tempo', 'wallet', 'revenue'),
      donut(summary.categories),
      chartTime(summary.trend, 'Vendas por dia', 'cart', 'sales'),
      ranking('Produtos mais vendidos', summary.products)),
    el('section', { class: 'panel padded activity' }, el('h2', {}, 'Atividades recentes'),
      state.activity.length ? el('ul', {}, state.activity.slice(0, 6).map(event => el('li', {},
        el('span', { class: 'tile' }, icon({ product: 'box', customer: 'people', stock: 'inventory', sale: 'cart', cancel: 'clock' }[event.type])),
        el('span', {}, event.label), el('time', { class: 'fine', datetime: event.when }, dateTime(event.when))))) :
        el('p', { class: 'empty' }, 'As atividades aparecem depois dos primeiros cadastros e operações.')));
  return nodes;
}

export function analyticsView(ctx) {
  const state = ctx.state;
  const config = ctx.filters.analytics;
  const category = [['', 'Todas'], ...[...new Set(state.items.map(item => item.category))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(item => [item, item])];
  const statuses = [['all', 'Todas'], ...Object.entries(saleStatus)];
  const summary = summarize(state, config.range, { category: config.category, status: config.status || 'completed' });
  return [heading('Análises', 'Explore vendas, categorias e clientes no recorte escolhido.'),
    periodControl(config, ctx.render, [filterControl(config, 'category', 'Categoria histórica', category, ctx.render),
      filterControl(config, 'status', 'Status de venda', statuses, ctx.render)]),
    el('div', { class: 'metrics metrics-analytics' }, metric('Receita reconhecida', money(summary.revenue), 'wallet', 'Exclui vendas canceladas'),
      metric('Vendas no filtro', quantity(summary.sales), 'cart'), metric('Itens no filtro', quantity(summary.units), 'inventory'),
      metric('Ticket médio', money(summary.ticket), 'wallet', 'Somente vendas concluídas'),
      metric('Estoque baixo', quantity(summary.low), 'alert', 'Saldo atual de ativos', 'amber')),
    el('div', { class: 'chart-grid' }, chartTime(summary.trend, 'Evolução do faturamento', 'wallet', 'revenue'),
      donut(summary.categories), chartTime(summary.trend, 'Vendas por dia', 'cart', 'sales'), ranking('Produtos com maior volume', summary.products, false,
        'Unidades nas vendas do recorte'), ranking('Clientes com maior volume em reais', summary.customers, true))];
}
