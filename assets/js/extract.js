// Извлечение текста из файлов прямо в браузере: PDF (pdf.js), DOCX (mammoth.js), TXT.
import { loadScript } from './util.js';

const PDFJS = 'assets/vendor/pdf.min.js';
const PDF_WORKER = 'assets/vendor/pdf.worker.min.js';
const MAMMOTH = 'assets/vendor/mammoth.browser.min.js';

export async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return extractPdf(file);
  if (name.endsWith('.docx')) return extractDocx(file);
  if (name.endsWith('.doc')) throw new Error('Старый формат .doc не поддерживается. Сохраните файл как .docx или PDF.');
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) return file.text();
  throw new Error('Поддерживаются PDF, DOCX и TXT.');
}

async function extractPdf(file) {
  await loadScript(PDFJS);
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(PDF_WORKER, document.baseURI).href;
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    const lines = [];
    for (const item of content.items) {
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; } else if (item.str && !item.str.endsWith(' ')) line += ' ';
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
  }
  const text = pages.join('\n\n');
  if (text.replace(/\s/g, '').length < 30 * pdf.numPages * 0.2) {
    throw new Error('В PDF почти нет текста — похоже, это скан. Распознавание (OCR) в прототипе не поддерживается: вставьте текст вручную или загрузите DOCX.');
  }
  return text;
}

async function extractDocx(file) {
  await loadScript(MAMMOTH);
  const res = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return res.value.replace(/\n{3,}/g, '\n\n').trim();
}
