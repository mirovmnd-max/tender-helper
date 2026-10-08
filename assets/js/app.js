// Тендер-помощник — прототип. Всё работает в браузере, без сервера.
import { store, esc, money, parseNum, parseDate, checkBin, todayStr } from './util.js';
import { PROVIDERS, extractRequirements, generateSpec, testConnection } from './ai.js';
import { extractText } from './extract.js';
import { checkPrice, METHODS, methodKeyFromText } from './price.js';
import { CHECKLIST, ALL_ITEMS } from './checklist.js';
import { guaranteeLetter, coverLetter, commercialProposal, techSpecDoc } from './letters.js';
import { renderModelHTML, printModel, exportDocx } from './export.js';
import { SAMPLE_LOT_TEXT, SAMPLE_FILE_NAME, SAMPLE_EXTRACTED, SAMPLE_SPEC, SAMPLE_PRICE, SAMPLE_COMPANY } from './demo-data.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------------- Состояние ----------------
const settings = store.get('settings', null) || {
  provider: 'openai', baseUrl: PROVIDERS.openai.baseUrl, model: PROVIDERS.openai.model, apiKey: '', demo: true, lang: 'ru',
};
const project = store.get('project', null) || { lotText: '', isSample: false, files: [], extracted: null, meta: {}, spec: { ru: null, kz: null } };
let price = store.get('price', null) || { vatMode: 'without', vatRate: 16, vatPayer: true, method: 'konkurs', customPct: 1, allocated: '', rows: [emptyRow()] };
const company = store.get('company', null) || {};
const cl = store.get('checklist', null) || { checked: {}, deadline: '', ecp: '' };
let currentDoc = 'guarantee';

const save = {
  settings: () => store.set('settings', settings),
  project: () => store.set('project', project),
  price: () => store.set('price', price),
  company: () => store.set('company', company),
  cl: () => store.set('checklist', cl),
};

function emptyRow() { return { name: '', unit: '', qty: '', planUnit: '', unitPrice: '', total: '' }; }
const isDemo = () => settings.demo || !settings.apiKey;
const lang = () => settings.lang || 'ru';

// ---------------- UI-помощники ----------------
let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), kind === 'error' ? 7000 : 3500);
}
async function withBusy(text, fn) {
  $('#busy-text').textContent = text;
  $('#busy').hidden = false;
  try { return await fn(); } finally { $('#busy').hidden = true; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Роутинг ----------------
const VIEWS = ['lot', 'requirements', 'spec', 'price', 'checklist', 'docs', 'settings'];
function route() {
  const v = (location.hash || '#lot').slice(1);
  const view = VIEWS.includes(v) ? v : 'lot';
  VIEWS.forEach((x) => ($('#view-' + x).hidden = x !== view));
  $$('#steps a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  const render = { requirements: renderRequirements, spec: renderSpec, price: renderPriceAll, checklist: renderChecklist, docs: renderDocs, settings: renderSettings }[view];
  if (render) render();
  updateStepMarks();
  window.scrollTo({ top: 0 });
}
function updateStepMarks() {
  const done = {
    lot: !!project.lotText.trim(),
    requirements: !!project.extracted?.requirements?.length,
    spec: !!project.spec?.[lang()]?.rows?.length,
    price: price.rows.some((r) => parseNum(r.unitPrice) > 0) && checkPrice(priceInput()).totals.errors === 0,
    checklist: ALL_ITEMS.every((i) => cl.checked[i.id]),
    docs: !!company.name,
  };
  $$('#steps a').forEach((a) => a.classList.toggle('done', !!done[a.dataset.view]));
}

// ---------------- Шапка: язык и демо ----------------
function renderHeader() {
  $$('#lang-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang()));
  $$('[data-lang-badge]').forEach((b) => (b.textContent = lang() === 'kz' ? 'қазақша' : 'на русском'));
  $('#demo-toggle').checked = isDemo();
  $('#demo-banner').hidden = !isDemo();
  document.body.classList.toggle('demo-mode', isDemo());
}
$('#lang-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lang]');
  if (!b) return;
  settings.lang = b.dataset.lang;
  save.settings();
  renderHeader();
  route();
});
$('#demo-toggle').addEventListener('change', (e) => {
  if (!e.target.checked && !settings.apiKey) {
    e.target.checked = true;
    toast('Чтобы выключить демо, добавьте API-ключ в Настройках.', 'warn');
    location.hash = '#settings';
    return;
  }
  settings.demo = e.target.checked;
  save.settings();
  renderHeader();
});

// ---------------- 1. Лот ----------------
const lotText = $('#lot-text');
function renderLot() {
  lotText.value = project.lotText;
  $('#char-count').textContent = `${project.lotText.length.toLocaleString('ru-RU')} символов`;
  $('#sample-note').hidden = !project.isSample;
  $('#file-status').innerHTML = project.files?.length ? project.files.map((f) => `<span class="chip">📎 ${esc(f)}</span>`).join('') : '';
}
lotText.addEventListener('input', () => {
  project.lotText = lotText.value;
  if (project.isSample && !lotText.value.startsWith('ПРИМЕР')) project.isSample = false;
  $('#char-count').textContent = `${project.lotText.length.toLocaleString('ru-RU')} символов`;
  $('#sample-note').hidden = !project.isSample;
  save.project();
});

async function handleFiles(files) {
  if (!files?.length) return;
  const parts = [];
  const names = [];
  await withBusy('Читаю файлы…', async () => {
    for (const f of files) {
      try {
        const t = await extractText(f);
        parts.push(`===== ${f.name} =====\n${t}`);
        names.push(f.name);
      } catch (err) {
        toast(`${f.name}: ${err.message}`, 'error');
      }
    }
  });
  if (!parts.length) return;
  project.lotText = parts.join('\n\n');
  project.files = names;
  project.isSample = false;
  save.project();
  renderLot();
  toast(`Текст извлечён: ${names.length} файл(ов), ${project.lotText.length.toLocaleString('ru-RU')} символов.`, 'ok');
}
$('#file-input').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (e) => handleFiles([...e.dataTransfer.files]));

function loadSampleLot() {
  project.lotText = SAMPLE_LOT_TEXT;
  project.files = [SAMPLE_FILE_NAME];
  project.isSample = true;
  save.project();
  renderLot();
}
$('#btn-load-sample').addEventListener('click', () => { loadSampleLot(); toast('Загружен пример лота (вымышленные данные).'); });
$('#btn-clear-lot').addEventListener('click', () => {
  if (project.lotText && !confirm('Очистить документацию, требования и техспецификацию?')) return;
  Object.assign(project, { lotText: '', isSample: false, files: [], extracted: null, meta: {}, spec: { ru: null, kz: null } });
  save.project();
  renderLot();
  updateStepMarks();
});

$('#btn-extract').addEventListener('click', async () => {
  if (!project.lotText.trim()) {
    if (isDemo()) loadSampleLot();
    else return toast('Загрузите файл или вставьте текст документации.', 'warn');
  }
  try {
    let data;
    if (isDemo()) {
      if (!project.isSample) {
        if (!confirm('Демо-режим: ИИ не подключён, поэтому свой документ обработать нельзя.\n\nПоказать результат для примера лота? (Чтобы обработать свой документ, добавьте API-ключ в Настройках.)')) return;
        loadSampleLot();
      }
      data = await withBusy('Демо: разбираю пример лота…', async () => { await sleep(600); return clone(SAMPLE_EXTRACTED); });
    } else {
      data = await withBusy('ИИ извлекает требования… Обычно 20–60 секунд.', () => extractRequirements(settings, project.lotText));
    }
    applyExtraction(data);
    location.hash = '#requirements';
    toast(`Найдено требований: ${data.requirements.length}.`, 'ok');
  } catch (err) {
    console.error(err);
    toast('Ошибка: ' + err.message, 'error');
  }
});

function applyExtraction(data) {
  project.extracted = data;
  const lot = data.lot || {};
  project.meta = {
    number: lot.number || '', name: lot.name || '', customer: lot.customer || '',
    methodKey: methodKeyFromText(lot.method) || 'konkurs',
    amount: lot.amount ?? '', deadline: lot.deadline || '', term: lot.term || '', place: lot.place || '',
  };
  project.spec = { ru: null, kz: null };
  save.project();
  // Цена: переносим выделенную сумму, способ и позиции из документации.
  if (project.isSample) {
    price = clone(SAMPLE_PRICE);
  } else {
    price.allocated = lot.amount ?? price.allocated;
    price.method = project.meta.methodKey;
    if (lot.amountIncludesVat === true) price.vatMode = 'with';
    if (lot.amountIncludesVat === false) price.vatMode = 'without';
    if (data.positions?.length) {
      price.rows = data.positions.map((p) => ({ name: p.name || '', unit: p.unit || '', qty: p.qty ?? '', planUnit: p.planUnitPrice ?? '', unitPrice: '', total: '' }));
    }
  }
  save.price();
  if (!cl.deadline && lot.deadline) {
    const d = parseDate(lot.deadline);
    if (d) { cl.deadline = toLocalInput(d); save.cl(); }
  }
  if (project.isSample && !company.name) { Object.assign(company, SAMPLE_COMPANY); save.company(); }
}

// ---------------- 2. Требования ----------------
function renderRequirements() {
  const meta = project.meta || {};
  $$('#lot-meta [data-meta]').forEach((el) => {
    const k = el.dataset.meta;
    el.value = k === 'amount' && meta.amount !== '' && meta.amount != null ? money(meta.amount) : meta[k] ?? (k === 'methodKey' ? 'konkurs' : '');
  });
  const w = project.extracted?.warnings || [];
  $('#warnings').hidden = !w.length;
  $('#warnings').innerHTML = w.length ? `<h2>⚠ На что обратить внимание</h2><ul>${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const reqs = project.extracted?.requirements || [];
  $('#req-count').textContent = reqs.length ? reqs.length : '';
  $('#req-list').innerHTML = reqs.length
    ? reqs.map((r, i) => `
      <article class="req ${r.critical ? 'critical' : ''}" data-i="${i}">
        <header>
          <span class="rid">${esc(r.id)}</span>
          <span class="tag">${esc(r.category)}</span>
          ${r.critical ? '<span class="tag red" title="Несоответствие приведёт к отклонению">критично</span>' : ''}
          ${r.source ? `<span class="muted small">${esc(r.source)}</span>` : ''}
          <span class="grow"></span>
          <button type="button" class="x" data-del="${i}" title="Удалить">✕</button>
        </header>
        <div class="req-text" contenteditable="true" data-edit="${i}">${esc(r.text)}</div>
        ${r.value ? `<div class="req-val">Ключевое значение: <b>${esc(r.value)}</b></div>` : ''}
      </article>`).join('')
    : '<p class="empty">Пока пусто. Загрузите документацию на шаге 1 и нажмите «Извлечь требования».</p>';
}
$('#lot-meta').addEventListener('input', (e) => {
  const k = e.target.dataset.meta;
  if (!k) return;
  project.meta = project.meta || {};
  project.meta[k] = k === 'amount' ? parseNum(e.target.value) || '' : e.target.value;
  if (k === 'amount') { price.allocated = project.meta.amount; save.price(); }
  if (k === 'methodKey') { price.method = e.target.value; save.price(); }
  save.project();
});
$('#req-list').addEventListener('input', (e) => {
  const i = e.target.dataset.edit;
  if (i == null) return;
  project.extracted.requirements[i].text = e.target.innerText.trim();
  save.project();
});
$('#req-list').addEventListener('click', (e) => {
  const i = e.target.dataset.del;
  if (i == null) return;
  project.extracted.requirements.splice(+i, 1);
  save.project();
  renderRequirements();
});
$('#btn-add-req').addEventListener('click', () => {
  project.extracted = project.extracted || { lot: {}, requirements: [], warnings: [] };
  const n = project.extracted.requirements.length + 1;
  project.extracted.requirements.push({ id: 'R' + n, category: 'Прочее', text: 'Новое требование — введите текст', value: '', critical: false, source: 'добавлено вручную' });
  save.project();
  renderRequirements();
});

async function makeSpec(force = false) {
  const reqs = project.extracted?.requirements || [];
  if (!reqs.length) { toast('Сначала извлеките требования.', 'warn'); location.hash = '#requirements'; return; }
  const L = lang();
  if (project.spec[L] && !force) { location.hash = '#spec'; return; }
  try {
    let spec;
    if (isDemo()) {
      if (!project.isSample) return toast('В демо-режиме спецификация есть только для примера лота. Добавьте API-ключ в Настройках.', 'warn');
      spec = await withBusy('Демо: готовлю техспецификацию…', async () => { await sleep(600); return clone(SAMPLE_SPEC[L]); });
    } else {
      spec = await withBusy(`ИИ пишет техспецификацию (${L === 'kz' ? 'қазақша' : 'на русском'})… Обычно 30–90 секунд.`, () =>
        generateSpec(settings, { requirements: reqs, lot: project.meta, company, lang: L }));
    }
    project.spec[L] = spec;
    save.project();
    if (location.hash === '#spec') renderSpec(); else location.hash = '#spec';
    toast('Техспецификация готова. Проверьте и заполните плейсхолдеры в [скобках].', 'ok');
  } catch (err) {
    console.error(err);
    toast('Ошибка: ' + err.message, 'error');
  }
}
$('#btn-gen-spec').addEventListener('click', () => makeSpec(false));
$('#btn-regen-spec').addEventListener('click', () => makeSpec(true));

// ---------------- 3. Техспецификация ----------------
const RISKY = ['или эквивалент', 'или аналог', 'примерно', 'по возможности', 'и т.д', 'и т. д', 'около ', 'не менее', 'не более'];
function renderSpec() {
  const L = lang();
  const spec = project.spec?.[L];
  const tbody = $('#spec-table tbody');
  $('#btn-regen-spec').textContent = spec ? 'Сгенерировать заново' : `Сформировать ${L === 'kz' ? 'на казахском' : 'на русском'}`;
  if (!spec && isDemo() && project.isSample && project.extracted) {
    project.spec[L] = clone(SAMPLE_SPEC[L]);
    save.project();
    return renderSpec();
  }
  if (!spec) {
    const other = project.spec?.[L === 'kz' ? 'ru' : 'kz'];
    tbody.innerHTML = `<tr><td colspan="4" class="empty">${project.extracted ? `Спецификация ${L === 'kz' ? 'на казахском' : 'на русском'} ещё не сформирована${other ? ' (есть версия на другом языке)' : ''}. Нажмите «Сформировать».` : 'Сначала извлеките требования (шаг 2).'}</td></tr>`;
    $('#spec-check').innerHTML = '';
    return;
  }
  tbody.innerHTML = spec.rows.map((r, i) => `
    <tr data-i="${i}">
      <td class="num">${i + 1}</td>
      <td class="req-col" contenteditable="true" data-f="requirement">${esc(r.requirement)}</td>
      <td class="resp-col" contenteditable="true" data-f="response">${highlightPlaceholders(r.response)}</td>
      <td class="note-col">${r.note ? esc(r.note) : '<span class="muted">—</span>'}</td>
    </tr>`).join('');
  renderSpecCheck();
}
function highlightPlaceholders(t) { return esc(t).replace(/\[([^\]]+)\]/g, '<mark>[$1]</mark>'); }
function renderSpecCheck() {
  const spec = project.spec?.[lang()];
  if (!spec) return;
  const reqIds = (project.extracted?.requirements || []).map((r) => r.id);
  const specIds = new Set(spec.rows.map((r) => r.id));
  const missing = reqIds.filter((id) => !specIds.has(id));
  const placeholders = spec.rows.reduce((a, r) => a + ((r.response || '').match(/\[[^\]]+\]/g) || []).length, 0);
  const empty = spec.rows.filter((r) => !String(r.response || '').trim()).length;
  const risky = spec.rows.flatMap((r, i) => RISKY.filter((w) => (r.response || '').toLowerCase().includes(w)).map((w) => `п. ${i + 1}: «${w.trim()}»`));
  const items = [];
  items.push(missing.length ? `<li class="error">Нет ответа на требования: ${esc(missing.join(', '))}</li>` : `<li class="ok">Все ${reqIds.length} требований покрыты</li>`);
  if (empty) items.push(`<li class="error">Пустых ответов: ${empty}</li>`);
  items.push(placeholders ? `<li class="warn">Заполните плейсхолдеры в [скобках]: ${placeholders}</li>` : '<li class="ok">Плейсхолдеров не осталось</li>');
  if (risky.length) items.push(`<li class="warn">Размытые формулировки — замените конкретными значениями: ${esc(risky.join('; '))}</li>`);
  $('#spec-check').innerHTML = `<ul class="checks">${items.join('')}</ul>`;
}
$('#spec-table').addEventListener('input', (e) => {
  const td = e.target.closest('td[data-f]');
  if (!td) return;
  const i = +td.parentElement.dataset.i;
  project.spec[lang()].rows[i][td.dataset.f] = td.innerText.trim();
  save.project();
  renderSpecCheck();
});
function docCtx() {
  const pr = checkPrice(priceInput());
  return {
    company: Object.keys(company).length ? company : {},
    lot: project.meta || {},
    methodKey: project.meta?.methodKey || price.method,
    price: { ...pr, input: priceInput() },
    attachments: attachmentList(),
    outNo: company.outNo,
    date: todayStr(),
  };
}
function specModel() {
  const spec = project.spec?.[lang()];
  if (!spec) { toast('Сначала сформируйте техспецификацию.', 'warn'); return null; }
  return techSpecDoc(lang(), docCtx(), spec);
}
$('#btn-spec-docx').addEventListener('click', async () => { const m = specModel(); if (m) await safeExport(() => exportDocx(m)); });
$('#btn-spec-pdf').addEventListener('click', () => { const m = specModel(); if (m) printModel(m); });
async function safeExport(fn) {
  try { await withBusy('Готовлю DOCX…', fn); toast('DOCX скачан.', 'ok'); } catch (err) { console.error(err); toast('Не удалось создать DOCX: ' + err.message, 'error'); }
}

// ---------------- 4. Цена ----------------
function priceInput() {
  return {
    vatMode: price.vatMode, vatRate: Number(price.vatRate), vatPayer: !!price.vatPayer, method: price.method,
    customPct: parseNum(price.customPct) || 0, allocated: parseNum(price.allocated) || 0,
    rows: price.rows.map((r) => ({ name: r.name, unit: r.unit, qty: parseNum(r.qty), planUnit: parseNum(r.planUnit), unitPrice: parseNum(r.unitPrice), total: parseNum(r.total) })),
  };
}
const fmtIn = (v) => (v === '' || v == null || Number.isNaN(parseNum(v)) ? '' : money(parseNum(v), Number.isInteger(parseNum(v)) ? 0 : 2));
function renderPriceAll() {
  $('#p-allocated').value = fmtIn(price.allocated);
  $('#p-method').value = price.method;
  $('#p-custom-wrap').hidden = price.method !== 'samruk';
  $('#p-custom-pct').value = price.customPct ?? 1;
  $('#p-vat-mode').value = price.vatMode;
  $('#p-vat-rate').value = String(price.vatRate);
  $('#p-vat-payer').checked = !!price.vatPayer;
  $('#price-table tbody').innerHTML = price.rows.map((r, i) => `
    <tr data-i="${i}">
      <td class="num">${i + 1}</td>
      <td><input data-k="name" value="${esc(r.name)}" placeholder="Наименование"></td>
      <td><input data-k="unit" value="${esc(r.unit)}" placeholder="шт" class="w-unit"></td>
      <td><input data-k="qty" value="${esc(fmtIn(r.qty))}" inputmode="decimal" class="w-num"></td>
      <td><input data-k="planUnit" value="${esc(fmtIn(r.planUnit))}" inputmode="decimal" class="w-money" placeholder="—"></td>
      <td><input data-k="unitPrice" value="${esc(fmtIn(r.unitPrice))}" inputmode="decimal" class="w-money"></td>
      <td><input data-k="total" value="${esc(fmtIn(r.total))}" inputmode="decimal" class="w-money"></td>
      <td class="calc"></td>
      <td><button type="button" class="x" data-del="${i}" title="Удалить строку">✕</button></td>
    </tr>
    <tr class="msg-row" data-m="${i}" hidden><td></td><td colspan="8" class="msg"></td></tr>`).join('');
  renderPriceResults();
}
function renderPriceResults() {
  const res = checkPrice(priceInput());
  const t = res.totals;
  $$('#price-table tbody tr[data-i]').forEach((tr) => {
    const i = +tr.dataset.i;
    const r = res.rows[i];
    if (!r) return;
    const lvl = r.flags.some((f) => f.level === 'error') ? 'error' : r.flags.some((f) => f.level === 'warn') ? 'warn' : r.unitPrice > 0 ? 'ok' : '';
    tr.className = lvl;
    const filled = r.unitPrice > 0 && r.qty > 0;
    tr.querySelector('.calc').innerHTML = filled
      ? `<span class="calc-v">${money(r.expected)}</span><span class="flag ${lvl}">${r.flags.length ? (lvl === 'error' ? '✕ ошибка' : '! проверьте') : '✓ верно'}</span>`
      : '<span class="muted">—</span>';
    const mr = $(`#price-table tr[data-m="${i}"]`);
    mr.hidden = !r.flags.length;
    mr.className = 'msg-row ' + lvl;
    mr.querySelector('.msg').innerHTML = r.flags.map((f) => `<div class="flag ${f.level}">${esc(f.text)}</div>`).join('');
  });
  const vatLine = price.vatPayer
    ? `<tr><td>НДС ${esc(price.vatRate)}%${price.vatMode === 'without' ? ' (добавится в договор)' : ''}</td><td>${money(t.vat)} ₸</td></tr><tr class="b"><td>Итого с НДС</td><td>${money(t.gross)} ₸</td></tr>`
    : '<tr><td>НДС</td><td>не плательщик</td></tr>';
  const diff = t.allocated ? t.allocated - t.compare : null;
  $('#price-totals').innerHTML = `
    <h2>Итоги</h2>
    <table class="totals">
      <tr><td>Итого без НДС</td><td>${money(t.net)} ₸</td></tr>
      ${vatLine}
      <tr><td>Выделенная сумма (${price.vatMode === 'with' ? 'с НДС' : 'без НДС'})</td><td>${t.allocated ? money(t.allocated) + ' ₸' : '—'}</td></tr>
      ${diff != null ? `<tr class="${diff < 0 ? 'bad' : 'good'}"><td>${diff < 0 ? 'Превышение' : 'Ниже выделенной на'}</td><td>${money(Math.abs(diff))} ₸</td></tr>` : ''}
      <tr class="b"><td>Обеспечение заявки (${t.pct}%)</td><td>${t.pct ? money(t.security, 0) + ' ₸' : 'не требуется'}</td></tr>
    </table>
    <p class="muted small">Обеспечение: конкурс и аукцион — 1%, запрос ценовых предложений — 3% от суммы, выделенной для закупки (п. 104 Правил № 687). Округление до тенге.</p>`;
  $('#price-issues').innerHTML = `<h2>Проверка ${t.errors ? `<span class="tag red">${t.errors} ошиб.</span>` : '<span class="tag green">ок</span>'}</h2>
    <ul class="checks">${res.issues.map((x) => `<li class="${x.level}">${esc(x.text)}</li>`).join('')}</ul>`;
  updateStepMarks();
}
$('#price-table').addEventListener('input', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  const i = +e.target.closest('tr').dataset.i;
  price.rows[i][k] = ['name', 'unit'].includes(k) ? e.target.value : e.target.value.trim() === '' ? '' : parseNum(e.target.value);
  save.price();
  renderPriceResults();
});
$('#price-table').addEventListener('focusout', (e) => {
  const k = e.target.dataset?.k;
  if (k && !['name', 'unit'].includes(k)) e.target.value = fmtIn(price.rows[+e.target.closest('tr').dataset.i][k]);
});
$('#price-table').addEventListener('click', (e) => {
  const i = e.target.dataset.del;
  if (i == null) return;
  price.rows.splice(+i, 1);
  if (!price.rows.length) price.rows.push(emptyRow());
  save.price();
  renderPriceAll();
});
$('#btn-add-row').addEventListener('click', () => { price.rows.push(emptyRow()); save.price(); renderPriceAll(); });
$('#btn-price-sample').addEventListener('click', () => { price = clone(SAMPLE_PRICE); save.price(); renderPriceAll(); toast('Загружен пример ценового предложения с ошибками.'); });
function bindPriceSetting(sel, key, conv = (v) => v) {
  $(sel).addEventListener('input', (e) => {
    price[key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    if (key === 'method') { $('#p-custom-wrap').hidden = price.method !== 'samruk'; project.meta = { ...(project.meta || {}), methodKey: price.method }; save.project(); }
    if (key === 'allocated') { project.meta = { ...(project.meta || {}), amount: price.allocated }; save.project(); }
    save.price();
    renderPriceResults();
  });
}
bindPriceSetting('#p-allocated', 'allocated', (v) => parseNum(v) || '');
bindPriceSetting('#p-method', 'method');
bindPriceSetting('#p-custom-pct', 'customPct', (v) => parseNum(v) || 0);
bindPriceSetting('#p-vat-mode', 'vatMode');
bindPriceSetting('#p-vat-rate', 'vatRate', Number);
bindPriceSetting('#p-vat-payer', 'vatPayer', Boolean);
$('#p-allocated').addEventListener('focusout', (e) => (e.target.value = fmtIn(price.allocated)));

// ---------------- 5. Чек-лист ----------------
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderChecklist() {
  if (!cl.deadline && project.meta?.deadline) {
    const d = parseDate(project.meta.deadline);
    if (d) cl.deadline = toLocalInput(d);
  }
  $('#cl-deadline').value = cl.deadline || '';
  $('#cl-ecp').value = cl.ecp || '';
  $('#checklist').innerHTML = CHECKLIST.map((g) => `
    <div class="card cl-group">
      <h2>${esc(g.group)}</h2>
      ${g.items.map((it) => `
        <label class="cl-item ${cl.checked[it.id] ? 'checked' : ''}">
          <input type="checkbox" data-id="${it.id}" ${cl.checked[it.id] ? 'checked' : ''}>
          <span><b>${esc(it.ru)}</b>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>
        </label>`).join('')}
    </div>`).join('');
  renderChecklistStatus();
}
function renderChecklistStatus() {
  const total = ALL_ITEMS.length;
  const done = ALL_ITEMS.filter((i) => cl.checked[i.id]).length;
  $('#cl-bar').style.width = `${Math.round((done / total) * 100)}%`;
  $('#cl-progress').textContent = `Готово ${done} из ${total}`;
  const alerts = [];
  const now = new Date();
  const dl = cl.deadline ? new Date(cl.deadline) : null;
  const ecp = cl.ecp ? new Date(cl.ecp + 'T23:59') : null;
  if (dl) {
    const h = (dl - now) / 36e5;
    if (h < 0) alerts.push(['error', 'Срок приёма заявок уже истёк.']);
    else if (h < 48) alerts.push(['warn', `До окончания приёма заявок меньше 48 часов (${Math.floor(h)} ч). Не откладывайте подачу.`]);
    else alerts.push(['ok', `До окончания приёма заявок ${Math.floor(h / 24)} дн.`]);
  }
  if (ecp) {
    if (ecp < now) alerts.push(['error', 'ЭЦП уже истекла — подписать заявку не получится. Перевыпустите ключ в НУЦ РК.']);
    else if (dl && ecp < dl) alerts.push(['error', 'ЭЦП истекает до окончания приёма заявок.']);
    else if (dl && ecp < new Date(+dl + 30 * 864e5)) alerts.push(['warn', 'ЭЦП может истечь до подписания договора (≈30 дней после итогов). Лучше перевыпустить заранее.']);
    else alerts.push(['ok', 'Срок ЭЦП в порядке.']);
  } else alerts.push(['warn', 'Укажите срок действия ЭЦП — истёкший ключ частая причина сорванной подачи.']);
  const pr = checkPrice(priceInput());
  if (price.rows.some((r) => parseNum(r.unitPrice) > 0)) {
    alerts.push(pr.totals.errors ? ['error', `В ценовом предложении ошибок: ${pr.totals.errors}. Откройте шаг «Цена».`] : ['ok', 'Ценовое предложение прошло проверку.']);
  }
  $('#cl-alerts').innerHTML = `<ul class="checks">${alerts.map(([l, t]) => `<li class="${l}">${esc(t)}</li>`).join('')}</ul>`;
}
$('#checklist').addEventListener('change', (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  cl.checked[id] = e.target.checked;
  e.target.closest('.cl-item').classList.toggle('checked', e.target.checked);
  save.cl();
  renderChecklistStatus();
  updateStepMarks();
});
$('#cl-deadline').addEventListener('input', (e) => { cl.deadline = e.target.value; save.cl(); renderChecklistStatus(); });
$('#cl-ecp').addEventListener('input', (e) => { cl.ecp = e.target.value; save.cl(); renderChecklistStatus(); });
$('#btn-cl-reset').addEventListener('click', () => { cl.checked = {}; save.cl(); renderChecklist(); updateStepMarks(); });

// ---------------- 6. Документы ----------------
const DEFAULT_ATTACH = ['application', 'qualification', 'techspec', 'price', 'guarantee', 'deposit'];
function attachmentList() {
  const L = lang();
  const docItems = ALL_ITEMS.filter((i) => i.kz);
  let chosen = docItems.filter((i) => cl.checked[i.id]);
  if (!chosen.length) chosen = docItems.filter((i) => DEFAULT_ATTACH.includes(i.id));
  // Заявку формирует портал — в приложениях её не перечисляем.
  return chosen.filter((i) => i.id !== 'application').map((i) => (L === 'kz' ? i.kz : i.ruShort || i.ru));
}
function renderDocs() {
  $$('#company-form [data-co]').forEach((el) => (el.value = company[el.dataset.co] || ''));
  renderBinMsg();
  $$('#doc-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.doc === currentDoc));
  renderDocPreview();
}
function docModel() {
  const ctx = docCtx();
  return { guarantee: guaranteeLetter, cover: coverLetter, proposal: commercialProposal }[currentDoc](lang(), ctx);
}
function renderDocPreview() {
  const warns = [];
  if (!company.name) warns.push('Заполните реквизиты компании — пока в документе стоят плейсхолдеры.');
  if (!project.meta?.name) warns.push('Нет данных лота: извлеките требования на шаге 2 или заполните «Данные лота».');
  const pr = checkPrice(priceInput());
  if ((currentDoc === 'proposal' || currentDoc === 'cover') && pr.totals.errors) warns.push(`В ценовом предложении ошибок: ${pr.totals.errors}. Исправьте их на шаге «Цена» перед отправкой.`);
  if (currentDoc === 'cover' && !ALL_ITEMS.some((i) => i.kz && cl.checked[i.id])) warns.push('Список приложений взят по умолчанию. Отметьте документы в чек-листе, чтобы он был точным.');
  $('#doc-warn').innerHTML = warns.length ? `<ul class="checks">${warns.map((w) => `<li class="warn">${esc(w)}</li>`).join('')}</ul>` : '';
  $('#doc-preview').innerHTML = renderModelHTML(docModel());
}
function renderBinMsg() {
  const el = $('#bin-msg');
  if (!company.bin) { el.textContent = ''; return; }
  const r = checkBin(company.bin);
  el.textContent = r.ok ? '✓ контрольный разряд верный' : r.reason;
  el.className = 'field-msg ' + (r.ok ? 'ok' : 'error');
}
$('#company-form').addEventListener('input', (e) => {
  const k = e.target.dataset.co;
  if (!k) return;
  company[k] = e.target.value;
  save.company();
  if (k === 'bin') renderBinMsg();
  renderDocPreview();
  updateStepMarks();
});
$('#btn-co-sample').addEventListener('click', () => { Object.assign(company, SAMPLE_COMPANY); save.company(); renderDocs(); toast('Подставлены вымышленные реквизиты-примеры.'); });
$('#doc-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-doc]');
  if (!b) return;
  currentDoc = b.dataset.doc;
  renderDocs();
});
$('#btn-doc-docx').addEventListener('click', () => safeExport(() => exportDocx(docModel())));
$('#btn-doc-pdf').addEventListener('click', () => printModel(docModel()));

// ---------------- Настройки ----------------
function renderSettings() {
  $('#s-provider').innerHTML = Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
  $('#s-provider').value = settings.provider || 'custom';
  $('#s-base').value = settings.baseUrl || '';
  $('#s-model').value = settings.model || '';
  $('#s-key').value = settings.apiKey || '';
  $('#s-status').textContent = settings.apiKey ? 'Ключ сохранён в этом браузере.' : 'Ключ не задан — работает только демо-режим.';
}
$('#s-provider').addEventListener('change', (e) => {
  const p = PROVIDERS[e.target.value];
  settings.provider = e.target.value;
  if (p.baseUrl) settings.baseUrl = p.baseUrl;
  if (p.model) settings.model = p.model;
  save.settings();
  renderSettings();
});
$('#s-base').addEventListener('input', (e) => { settings.baseUrl = e.target.value.trim(); settings.provider = 'custom'; $('#s-provider').value = 'custom'; save.settings(); });
$('#s-model').addEventListener('input', (e) => { settings.model = e.target.value.trim(); save.settings(); });
$('#s-key').addEventListener('input', (e) => {
  const had = !!settings.apiKey;
  settings.apiKey = e.target.value.trim();
  if (!had && settings.apiKey) settings.demo = false; // ключ добавлен — переключаемся на реальный ИИ
  if (!settings.apiKey) settings.demo = true;
  save.settings();
  renderHeader();
  $('#s-status').textContent = settings.apiKey ? 'Ключ сохранён в этом браузере.' : 'Ключ не задан — работает только демо-режим.';
});
$('#btn-key-show').addEventListener('click', (e) => {
  const k = $('#s-key');
  k.type = k.type === 'password' ? 'text' : 'password';
  e.target.textContent = k.type === 'password' ? 'Показать' : 'Скрыть';
});
$('#btn-test-ai').addEventListener('click', async () => {
  if (!settings.apiKey) return toast('Сначала введите API-ключ.', 'warn');
  $('#s-status').textContent = 'Проверяю…';
  try {
    const out = await testConnection(settings);
    $('#s-status').textContent = `✓ Подключение работает (ответ модели: «${out}»).`;
  } catch (err) {
    $('#s-status').textContent = '✕ ' + err.message;
  }
});
$('#btn-del-key').addEventListener('click', () => { settings.apiKey = ''; settings.demo = true; save.settings(); renderSettings(); renderHeader(); toast('Ключ удалён из браузера.'); });
$('#btn-wipe').addEventListener('click', () => {
  if (!confirm('Удалить ключ, реквизиты, отметки и черновики из этого браузера?')) return;
  store.clearAll();
  location.hash = '#lot';
  location.reload();
});

// ---------------- Старт ----------------
window.addEventListener('hashchange', route);
renderHeader();
renderLot();
route();
