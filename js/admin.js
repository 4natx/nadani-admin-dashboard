import { backupLimit, encodeBackup, parseBackup } from './backup.js';
import { dateLabel, localDay, movementLabels } from './model.js';
import { download, getReport, movementStatus, reportTypes, saleStatus, serializeCSV } from './reports.js';
import { actions, button, el, field, filterControl, heading, input, note, pagedTable, panel, periodControl, printDocument, select, submit, table, textField, valuesOf } from './ui.js';

export function reportsView(ctx) {
  const state = ctx.state;
  const config = ctx.filters.reports;
  const type = config.type ?? 'sales';
  const usesPeriod = ['sales', 'movements'].includes(type);
  const categories = [...new Set((type === 'sales' ? state.items : state.products).map(item => item.category))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const statuses = type === 'sales' ? Object.entries(saleStatus) : type === 'inventory' ? Object.entries(movementStatus) :
    type === 'movements' ? Object.entries(movementLabels) : [['active', 'Ativos'], ['archived', 'Arquivados']];
  const target = el('div', { id: 'report-preview' });
  let report;
  function draw() {
    report = getReport(state, type, config);
    pagedTable(target, { list: report.rows, rows: row => row, headers: report.headers, name: 'Prévia de ' + reportTypes[type],
      paging: config, size: state.settings.pageSize });
  }
  const kind = select('report', Object.entries(reportTypes), type, { id: 'filter-type' });
  kind.addEventListener('change', () => { Object.assign(config, { type: kind.value, status: '', category: '', page: 0 }); ctx.render(); });
  const toolbar = el('div', { class: 'toolbar' }, field('Tipo de relatório', kind),
    type === 'customers' ? null : filterControl(config, 'category', 'Categoria', [['', 'Todas'], ...categories.map(value => [value, value])], draw),
    filterControl(config, 'status', type === 'movements' ? 'Tipo de movimento' : type === 'inventory' ? 'Alerta de saldo' : 'Status', [['', 'Todos'], ...statuses], draw));
  const name = 'nadani-' + type + '-' + localDay();
  const subtitle = state.settings.company + ' · Relatório demonstrativo' + (usesPeriod ? ' · ' + dateLabel(config.range.start) + ' a ' + dateLabel(config.range.end) : '');
  const out = actions(
    button('Exportar CSV', { id: 'report-csv', symbol: 'download', action: () => { download(name + '.csv', serializeCSV(report), 'text/csv;charset=utf-8'); ctx.toast('Relatório CSV exportado.'); } }),
    button('Exportar JSON', { id: 'report-json', symbol: 'download', action: () => { download(name + '.json',
      JSON.stringify({ report: type, period: usesPeriod ? config.range : null, category: config.category || null,
        status: config.status || null, ...report }, null, 2), 'application/json'); ctx.toast('Relatório JSON exportado.'); } }),
    button('Imprimir', { id: 'report-print', symbol: 'report', action: () =>
      printDocument(reportTypes[type], [table(report.headers, report.rows, reportTypes[type])], subtitle) }));
  draw();
  return [heading('Relatórios', 'Prévia, exportação e impressão dos dados da operação.', out),
    usesPeriod ? periodControl(config, ctx.render) : null, el('section', { class: 'panel table-shell' }, toolbar, target)].filter(Boolean);
}

export function settingsView(ctx) {
  const state = ctx.state;
  const settings = state.settings;
  const save = submit('Salvar preferências', 'save-settings');
  const status = el('p', { class: 'error', role: 'alert' });
  const preferences = el('form', { id: 'preferences' }, el('div', { class: 'form-grid' },
    textField('company', 'Nome demonstrativo da empresa', settings.company, { maxlength: 65, required: true }, true),
    field('Tema', select('theme', [['system', 'Acompanhar sistema'], ['light', 'Claro'], ['dark', 'Escuro']], settings.theme, { id: 'theme-choice' })),
    field('Linhas por página', select('pageSize', [[10, '10'], [20, '20'], [50, '50']], settings.pageSize)),
    field('Densidade da tabela', select('density', [['regular', 'Regular'], ['compact', 'Compacta']], settings.density))),
    note('Moeda BRL · Datas em português brasileiro'), status, save);
  preferences.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try { await ctx.run('settings', valuesOf(preferences), 'Preferências salvas.'); }
    catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  });

  const upload = input('backup', { id: 'backup-file', type: 'file', accept: '.json,application/json', hidden: true });
  const choose = button('Importar backup', { id: 'import-backup', action: () => upload.click() });
  const feedback = el('p', { id: 'backup-message', class: 'error', role: 'alert' });
  upload.addEventListener('change', async () => {
    const file = upload.files[0];
    upload.value = '';
    if (!file) return;
    const revision = ctx.state.revision;
    choose.disabled = true;
    feedback.textContent = '';
    try {
      if (file.size > backupLimit || !/\.json$/i.test(file.name)) throw new Error('Use um arquivo JSON de até 32 MiB.');
      const content = await file.text();
      if (!choose.isConnected) return;
      const next = parseBackup(content);
      ctx.confirm('Restaurar o backup?', next.products.length + ' produto(s), ' + next.customers.length + ' cliente(s) e ' + next.sales.length +
        ' venda(s) substituirão os dados atuais deste navegador.', 'Restaurar backup', () => ctx.replace(next, revision, 'Backup restaurado.'));
    } catch (error) {
      feedback.textContent = error.message;
    } finally { choose.disabled = false; }
  });
  const backup = button('Exportar backup JSON', { id: 'export-backup', symbol: 'download', disabled: ctx.recovery,
    action: () => { download('nadani-backup-' + localDay() + '.json', encodeBackup(state), 'application/json'); ctx.toast('Backup JSON exportado.'); } });
  const raw = ctx.recovery ? button('Baixar dados originais', { id: 'raw-backup', symbol: 'download', action: () => ctx.rawBackup() }) : null;
  const seed = button('Restaurar demonstração', { id: 'reset-demo',
    action: () => ctx.confirm('Restaurar a demonstração?', 'Os dados atuais do painel serão substituídos pelo conjunto sintético da Nadani Commerce.',
      'Restaurar demonstração', () => ctx.seed(true, state.revision)) });
  const clear = button('Apagar dados locais', { id: 'clear-data',
    action: () => ctx.confirm('Apagar todos os dados locais?', 'Cadastros, registros, movimentações e preferências serão removidos. Exporte um backup se quiser guardá-los.',
      'Apagar dados', () => ctx.clear(state.revision)) });
  return [heading('Configurações', 'Personalize o painel e gerencie os dados do seu navegador.'),
    el('div', { class: 'settings-grid' },
      panel('Preferências', preferences),
      panel('Backup e restauração', note('O backup leva cadastros, vendas, estoque, histórico e preferências. Uma restauração validada substitui o conjunto de dados.'),
        upload, actions(backup, choose, raw), feedback),
      panel('Dados locais', note('Use dados sintéticos na demonstração. O conteúdo fica neste navegador e perfil.'), actions(seed, clear)),
      panel('Sobre o painel', note('Nadani Commerce é uma empresa fictícia. A demonstração funciona sem autenticação, pagamentos, integração fiscal ou sincronização em nuvem.'),
        el('p', {}, el('a', { href: 'https://nadani.space' }, 'Developed by Nadani Productions'))))];
}
