// Смоук-тест прототипа в headless Chrome (playwright-core).
// Запуск: npm i -D playwright-core && node tests/smoke.mjs
// Переменные: BASE_URL (по умолчанию http://localhost:8765/tender-helper/), CHROME (путь к Chrome), OUT (папка для артефактов)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8765/tender-helper/';
const OUT = process.env.OUT || '/tmp/tender-helper-test';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const log = (...a) => console.log('•', ...a);
const assert = (c, m) => { if (!c) { throw new Error('ASSERT: ' + m); } log('ok:', m); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, locale: 'ru-RU' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
page.on('dialog', (d) => d.accept());
page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });

async function grabDownload(click, name) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const p = path.join(OUT, name || dl.suggestedFilename());
  await dl.saveAs(p);
  return p;
}

// ---------- Демо-режим ----------
await page.goto(BASE);
await page.waitForSelector('#view-lot:not([hidden])');
assert(await page.isVisible('#demo-banner'), 'демо-баннер виден без ключа');
await page.click('#btn-load-sample');
assert((await page.inputValue('#lot-text')).startsWith('ПРИМЕР'), 'пример лота загружен и помечен');
await page.screenshot({ path: path.join(OUT, '01-lot.png'), fullPage: true });
await page.click('#btn-extract');
await page.waitForSelector('#view-requirements:not([hidden]) .req');
const reqCount = await page.locator('.req').count();
assert(reqCount === 15, `извлечено 15 требований (${reqCount})`);
assert(await page.isVisible('#warnings'), 'показаны предупреждения');
await page.screenshot({ path: path.join(OUT, '02-requirements.png'), fullPage: true });

await page.click('#btn-gen-spec');
await page.waitForSelector('#view-spec:not([hidden]) #spec-table tbody tr[data-i]');
assert((await page.locator('#spec-table tbody tr[data-i]').count()) === 15, 'техспецификация RU: 15 строк');
await page.screenshot({ path: path.join(OUT, '03-spec-ru.png'), fullPage: true });
const specRuDocx = await grabDownload(() => page.click('#btn-spec-docx'), 'spec-ru.docx');

await page.click('#lang-toggle button[data-lang="kz"]');
await page.waitForSelector('#spec-table tbody tr[data-i]');
const kzText = await page.textContent('#spec-table tbody');
assert(/[әғқңөұүһі]/i.test(kzText), 'техспецификация KZ содержит казахские буквы');
await page.screenshot({ path: path.join(OUT, '04-spec-kz.png'), fullPage: true });
const specKzDocx = await grabDownload(() => page.click('#btn-spec-docx'), 'spec-kz.docx');

// PDF: подменяем window.print, затем печатаем страницу в режиме print
await page.evaluate(() => { window.print = () => {}; window.__keepPrintMode = true; });
await page.click('#btn-spec-pdf');
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: path.join(OUT, 'spec-kz.pdf'), format: 'A4' });
await page.emulateMedia({ media: 'screen' });
await page.evaluate(() => document.body.classList.remove('printing'));

// Цена
await page.click('a[data-view="price"]');
await page.waitForSelector('#view-price:not([hidden]) #price-issues li');
const issues = await page.textContent('#price-issues');
assert(issues.includes('вместо цены за единицу'), 'найдена путаница цены за единицу и суммы');
assert(issues.includes('превышает выделенную сумму'), 'найдено превышение выделенной суммы');
assert((await page.textContent('#price-totals')).includes('288'), 'обеспечение заявки 288 000 ₸');
await page.screenshot({ path: path.join(OUT, '05-price.png'), fullPage: true });
// исправляем ошибку и проверяем, что ошибки ушли
const unit = page.locator('#price-table tbody tr[data-i="1"] input[data-k="unitPrice"]');
await unit.fill('880000');
await page.locator('#price-table tbody tr[data-i="1"] input[data-k="total"]').fill('1760000');
assert((await page.textContent('#price-issues')).includes('Ошибок в арифметике'), 'после исправления ошибок нет');

// Чек-лист
await page.click('a[data-view="checklist"]');
await page.waitForSelector('#checklist .cl-item');
for (const id of ['techspec', 'price', 'qualification', 'experience', 'staff', 'deposit']) await page.check(`#checklist input[data-id="${id}"]`);
await page.fill('#cl-ecp', '2027-03-01');
await page.reload();
await page.click('a[data-view="checklist"]');
await page.waitForSelector('#checklist .cl-item');
assert(await page.isChecked('#checklist input[data-id="techspec"]'), 'отметки чек-листа сохраняются после перезагрузки');
await page.screenshot({ path: path.join(OUT, '06-checklist.png'), fullPage: true });

// Документы
await page.click('a[data-view="docs"]');
await page.waitForSelector('#doc-preview .doc-page');
assert((await page.inputValue('[data-co="bin"]')) === '190440001237', 'реквизиты-примеры подставлены');
const docs = {};
for (const d of ['guarantee', 'cover', 'proposal']) {
  await page.click(`#doc-tabs button[data-doc="${d}"]`);
  const t = await page.textContent('#doc-preview');
  assert(t.includes('Пример Клининг') || t.includes('Пример'), `предпросмотр ${d} (KZ)`);
  docs[d] = await grabDownload(() => page.click('#btn-doc-docx'), `${d}-kz.docx`);
}
await page.screenshot({ path: path.join(OUT, '07-docs-kz.png'), fullPage: true });
await page.click('#lang-toggle button[data-lang="ru"]');
await page.click('#doc-tabs button[data-doc="proposal"]');
assert((await page.textContent('#doc-preview')).includes('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ'), 'КП на русском');
const proposalRu = await grabDownload(() => page.click('#btn-doc-docx'), 'proposal-ru.docx');
await page.click('#doc-tabs button[data-doc="guarantee"]');
await page.screenshot({ path: path.join(OUT, '08-docs-ru.png'), fullPage: true });
await page.evaluate(() => { window.print = () => {}; window.__keepPrintMode = true; });
await page.click('#btn-doc-pdf');
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: path.join(OUT, 'guarantee-ru.pdf'), format: 'A4' });
await page.emulateMedia({ media: 'screen' });
await page.evaluate(() => document.body.classList.remove('printing'));

// ---------- Загрузка файлов: DOCX (mammoth) и PDF (pdf.js) ----------
await page.click('a[data-view="lot"]');
await page.setInputFiles('#file-input', specRuDocx);
await page.waitForFunction(() => document.querySelector('#lot-text').value.includes('4 850'));
log('ok: DOCX прочитан через mammoth');
await page.setInputFiles('#file-input', path.join(OUT, 'guarantee-ru.pdf'));
await page.waitForFunction(() => document.querySelector('#lot-text').value.includes('ГАРАНТИЙНОЕ'));
log('ok: PDF прочитан через pdf.js');

// ---------- Режим с ИИ (ответ API подменён) ----------
await page.route('**/v1/chat/completions', async (route) => {
  const body = JSON.parse(route.request().postData());
  const isSpec = body.messages[1].content.includes('техническую спецификацию');
  const content = isSpec
    ? JSON.stringify({ title: 'ТС', rows: [{ id: 'R1', requirement: 'Поставка бумаги А4 — 100 пачек', response: 'Будет поставлено 100 пачек бумаги А4 [указать марку]', note: '' }] })
    : JSON.stringify({ lot: { number: 'L-1', name: 'Бумага', customer: 'ГУ Тест', method: 'запрос ценовых предложений', amount: 250000, amountIncludesVat: false, deadline: '01.12.2026 10:00' }, requirements: [{ id: 'R1', category: 'Количество', text: 'Поставка бумаги А4 — 100 пачек', value: '100 пачек', critical: true }], positions: [{ name: 'Бумага А4', unit: 'пачка', qty: 100, planUnitPrice: 2500 }], warnings: ['Тест'] });
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content } }] }) });
});
await page.click('a[data-view="settings"]');
await page.fill('#s-key', 'sk-test-123');
assert(!(await page.isVisible('#demo-banner')), 'с ключом демо выключается');
await page.click('a[data-view="lot"]');
await page.fill('#lot-text', 'Запрос ценовых предложений. Бумага А4, 100 пачек, сумма 250 000 тенге.');
await page.click('#btn-extract');
await page.waitForSelector('#view-requirements:not([hidden]) .req');
assert((await page.locator('.req').count()) === 1, 'ИИ-путь: требования из ответа API');
await page.click('#btn-gen-spec');
await page.waitForSelector('#spec-table mark');
log('ok: ИИ-путь: спецификация с подсвеченным плейсхолдером');
await page.click('a[data-view="price"]');
await page.waitForSelector('#view-price:not([hidden])');
await page.waitForFunction(() => /7\s500/.test(document.querySelector('#price-totals').textContent), null, { timeout: 5000 }).catch(() => {});
assert(/7\s500/.test(await page.textContent('#price-totals')), 'ЗЦП: обеспечение 3% = 7 500 ₸');

// ---------- Мобильная вёрстка ----------
await page.setViewportSize({ width: 390, height: 844 });
await page.click('a[data-view="docs"]');
await page.screenshot({ path: path.join(OUT, '09-mobile-docs.png'), fullPage: false });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert(overflow <= 1, `нет горизонтальной прокрутки на мобильном (${overflow}px)`);

await browser.close();
const real = errors.filter((e) => !/favicon/.test(e));
if (real.length) { console.error('ОШИБКИ:\n' + real.join('\n')); process.exit(1); }
console.log('\nВСЁ ОК. Артефакты:', OUT);
console.log(JSON.stringify({ specRuDocx, specKzDocx, proposalRu, ...docs }, null, 1));
