// Экспорт «модели документа» в HTML (предпросмотр и печать в PDF) и DOCX (docx.js).
import { esc, loadScript, download, safeFileName } from './util.js';

const DOCX_SRC = 'assets/vendor/docx.iife.js';

export function renderModelHTML(model) {
  return `<div class="doc-page">${model.blocks.map(blockHTML).join('')}</div>`;
}

function blockHTML(b) {
  switch (b.t) {
    case 'title': return `<h2 class="doc-title">${esc(b.text)}</h2>`;
    case 'rule': return '<hr class="doc-rule">';
    case 'p': {
      const cls = ['doc-p', b.bold && 'b', b.small && 'small', b.indent && 'indent', b.align && 'al-' + b.align].filter(Boolean).join(' ');
      return `<p class="${cls}">${esc(b.text)}</p>`;
    }
    case 'table': {
      const w = b.widths ? `<colgroup>${b.widths.map((x) => `<col style="width:${x}%">`).join('')}</colgroup>` : '';
      const num = new Set(b.numeric || []);
      return `<table class="doc-table">${w}<thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c, i) => `<td class="${num.has(i) ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
    }
    case 'sign': return `<div class="doc-sign"><div>${esc(b.left).replace(/\n/g, '<br>')}</div><div>${esc(b.right)}</div></div>`;
    default: return '';
  }
}

/** Печать в PDF через системный диалог браузера: кириллица и казахские буквы берутся из шрифтов системы. */
export function printModel(model) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  root.innerHTML = renderModelHTML(model);
  const prevTitle = document.title;
  document.title = safeFileName(model.fileBase || model.title);
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    document.title = prevTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // Некоторые мобильные браузеры не присылают afterprint
  setTimeout(() => { if (document.body.classList.contains('printing') && !window.__keepPrintMode) done(); }, 1500);
}

export async function modelToDocxBlob(model) {
  await loadScript(DOCX_SRC);
  const d = window.docx;
  const FONT = 'Times New Roman';
  const PAGE_W = 11906, ML = 1701, MR = 850; // A4, поля 3 см / 1,5 см
  const TEXT_W = PAGE_W - ML - MR;
  const AL = { center: d.AlignmentType.CENTER, right: d.AlignmentType.RIGHT, justify: d.AlignmentType.JUSTIFIED, left: d.AlignmentType.LEFT };

  const runs = (text, opts = {}) =>
    String(text).split('\n').map((line, i) => new d.TextRun({ text: line, break: i > 0 ? 1 : 0, font: FONT, ...opts }));

  const para = (text, o = {}) =>
    new d.Paragraph({
      alignment: AL[o.align] || AL.left,
      spacing: { after: o.after ?? 80, line: 276 },
      indent: o.indent ? { firstLine: 0, left: 360 } : undefined,
      children: runs(text, { bold: !!o.bold, size: o.size || (o.small ? 20 : 24) }),
    });

  const none = { style: d.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const children = [];
  for (const b of model.blocks) {
    if (b.t === 'title') children.push(para(b.text, { align: 'center', bold: true, size: 28, after: 200 }));
    else if (b.t === 'p') children.push(para(b.text, b));
    else if (b.t === 'rule') children.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: '888888', space: 1 } }, spacing: { after: 160 }, children: [] }));
    else if (b.t === 'table') {
      const widths = (b.widths || b.head.map(() => 100 / b.head.length)).map((p) => Math.round((TEXT_W * p) / 100));
      const num = new Set(b.numeric || []);
      const cell = (text, w, header, i) =>
        new d.TableCell({
          width: { size: w, type: d.WidthType.DXA },
          shading: header ? { fill: 'EDEFF2', type: d.ShadingType.CLEAR, color: 'auto' } : undefined,
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [new d.Paragraph({ alignment: header ? AL.center : num.has(i) ? AL.right : AL.left, children: runs(text, { bold: header, size: 20 }) })],
        });
      children.push(
        new d.Table({
          width: { size: TEXT_W, type: d.WidthType.DXA },
          columnWidths: widths,
          rows: [
            new d.TableRow({ tableHeader: true, children: b.head.map((h, i) => cell(h, widths[i], true, i)) }),
            ...b.rows.map((r) => new d.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], false, i)) })),
          ],
        }),
      );
      children.push(para('', { after: 120 }));
    } else if (b.t === 'sign') {
      const w = Math.round(TEXT_W * 0.42);
      children.push(para('', { after: 200 }));
      children.push(
        new d.Table({
          width: { size: TEXT_W, type: d.WidthType.DXA },
          columnWidths: [w, TEXT_W - w],
          borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
          rows: [
            new d.TableRow({
              children: [
                new d.TableCell({ width: { size: w, type: d.WidthType.DXA }, borders: { top: none, bottom: none, left: none, right: none }, children: [new d.Paragraph({ children: runs(b.left, { size: 24 }) })] }),
                new d.TableCell({ width: { size: TEXT_W - w, type: d.WidthType.DXA }, borders: { top: none, bottom: none, left: none, right: none }, verticalAlign: d.VerticalAlign.BOTTOM, children: [new d.Paragraph({ alignment: AL.right, children: runs(b.right, { size: 24 }) })] }),
              ],
            }),
          ],
        }),
      );
    }
  }

  const doc = new d.Document({
    creator: 'Тендер-помощник (прототип)',
    title: model.title,
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{ properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 1134, bottom: 1134, left: ML, right: MR } } }, children }],
  });
  return d.Packer.toBlob(doc);
}

export async function exportDocx(model) {
  const blob = await modelToDocxBlob(model);
  download(blob, safeFileName(model.fileBase || model.title) + '.docx');
  return blob;
}
