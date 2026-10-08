// Шаблоны документов (гарантийное и сопроводительное письма, коммерческое предложение, техспецификация)
// на русском и казахском. Возвращают «модель документа», из которой строятся предпросмотр, DOCX и PDF.
import { money, amountInWords } from './util.js';

const METHOD_PHRASE = {
  ru: { konkurs: 'способом конкурса', auction: 'способом аукциона', zcp: 'способом запроса ценовых предложений', single: 'способом из одного источника', samruk: '' },
  kz: { konkurs: 'конкурс тәсілімен', auction: 'аукцион тәсілімен', zcp: 'баға ұсыныстарын сұрату тәсілімен', single: 'бір көзден алу тәсілімен', samruk: '' },
};

const blank = (v, ph = '________') => (v && String(v).trim() ? String(v).trim() : ph);

const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function names(lang, c) {
  return {
    name: blank(lang === 'kz' ? c.nameKz || c.name : c.name, lang === 'kz' ? '[ұйымның атауы]' : '[наименование организации]'),
    position: blank(lang === 'kz' ? c.positionKz || c.position : c.position, lang === 'kz' ? 'Басшы' : 'Руководитель'),
    address: lang === 'kz' ? c.addressKz || c.address : c.address,
  };
}

function letterhead(lang, ctx) {
  const c = ctx.company || {};
  const n = names(lang, c);
  const L = lang === 'kz';
  const lines = [
    { t: 'p', text: n.name, bold: true },
    { t: 'p', text: `${L ? 'БСН' : 'БИН'}: ${blank(c.bin)}`, small: true },
  ];
  if (n.address) lines.push({ t: 'p', text: `${L ? 'Мекенжайы' : 'Адрес'}: ${n.address}`, small: true });
  const contacts = [c.phone && `${L ? 'Тел.' : 'Тел.'}: ${c.phone}`, c.email && `E-mail: ${c.email}`].filter(Boolean).join(', ');
  if (contacts) lines.push({ t: 'p', text: contacts, small: true });
  lines.push({ t: 'rule' });
  lines.push({ t: 'p', text: L ? `Шығыс № ${blank(ctx.outNo, '___')}, ${ctx.date}` : `Исх. № ${blank(ctx.outNo, '___')} от ${ctx.date}` });
  lines.push({ t: 'p', text: `${L ? 'Тапсырыс берушіге' : 'Заказчику'}: ${blank(ctx.lot?.customer, L ? '[тапсырыс берушінің атауы]' : '[наименование заказчика]')}`, align: 'right', bold: true });
  return lines;
}

function signature(lang, ctx) {
  const c = ctx.company || {};
  const n = names(lang, c);
  return [
    { t: 'sign', left: `${n.position}\n${n.name}`, right: `____________ ${blank(c.director, lang === 'kz' ? '[аты-жөні]' : '[ФИО]')}` },
    { t: 'p', text: lang === 'kz' ? 'М.О. (бар болса)' : 'М.П. (при наличии)', small: true },
  ];
}

function lotRef(lang, ctx) {
  const lot = ctx.lot || {};
  const L = lang === 'kz';
  const method = METHOD_PHRASE[lang][ctx.methodKey] ?? '';
  const num = blank(lot.number, '___');
  const name = blank(lot.name, L ? '[лоттың атауы]' : '[наименование лота]');
  const cust = blank(lot.customer, L ? '[тапсырыс беруші]' : '[заказчик]');
  if (L) return { method, num, name, cust, text: `${cust} тапсырыс берушінің ${method ? method + ' ' : ''}өткізілетін сатып алуының № ${num} «${name}» лоты` };
  return { method, num, name, cust, text: `закупки ${method ? method + ' ' : ''}по лоту № ${num} «${name}» (заказчик — ${cust})` };
}

function vatNote(lang, p) {
  const rate = p?.vatRate ?? 16;
  if (!p?.vatPayer) return lang === 'kz' ? 'ҚҚС салынбайды (өнім беруші ҚҚС төлеушісі емес)' : 'НДС не облагается (поставщик не является плательщиком НДС)';
  if (p.vatMode === 'with') return lang === 'kz' ? `ҚҚС ${rate}% ескерілген` : `с учётом НДС ${rate}%`;
  return lang === 'kz' ? `ҚҚС-сыз; ҚҚС ${rate}% шартта есептеледі` : `без учёта НДС; НДС ${rate}% начисляется в договоре`;
}

export function guaranteeLetter(lang, ctx) {
  const L = lang === 'kz';
  const c = ctx.company || {};
  const n = names(lang, c);
  const ref = lotRef(lang, ctx);
  const lot = ctx.lot || {};
  const term = blank(lot.term), place = blank(lot.place);
  const blocks = [...letterhead(lang, ctx), { t: 'title', text: L ? 'КЕПІЛДІК ХАТ' : 'ГАРАНТИЙНОЕ ПИСЬМО' }];
  if (L) {
    blocks.push({ t: 'p', text: `${n.name} (БСН ${blank(c.bin)}; басшысы — ${lc(n.position)} ${blank(c.director)}) осы хатпен ${ref.text} бойынша жеңімпаз деп танылған жағдайда мыналарға кепілдік береді:`, align: 'justify' });
    [
      'сатып алу нысанасы техникалық ерекшелікке, сатып алу туралы құжаттамаға және шарт талаптарына толық сәйкес жеткізіледі (қызметтер көрсетіледі, жұмыстар орындалады);',
      `мерзімі: ${term}; орны: ${place};`,
      'шартты орындау үшін өтінімде көрсетілген білікті персонал мен материалдық-техникалық ресурстар тартылады;',
      'өтінімде ұсынылған мәліметтер мен құжаттар анық болып табылады. Анық емес мәліметтерді ұсыну өтінімнің қабылданбауына және мемлекеттік сатып алудың жосықсыз қатысушыларының тізіліміне енгізуге әкеп соғатыны бізге белгілі;',
      'шарттың орындалуын қамтамасыз ету сатып алу туралы құжаттамада белгіленген мерзімде және тәртіппен енгізіледі.',
    ].forEach((x, i) => blocks.push({ t: 'p', text: `${i + 1}. ${x}`, align: 'justify', indent: true }));
  } else {
    blocks.push({ t: 'p', text: `${n.name} (БИН ${blank(c.bin)}; руководитель — ${lc(n.position)} ${blank(c.director)}) настоящим гарантирует, что в случае признания победителем ${ref.text}:`, align: 'justify' });
    [
      'предмет закупки будет поставлен (услуги оказаны, работы выполнены) в полном соответствии с технической спецификацией, документацией о закупке и условиями договора;',
      `срок: ${term}; место: ${place};`,
      'для исполнения договора будут задействованы квалифицированный персонал и материально-технические ресурсы, указанные в заявке;',
      'сведения и документы, представленные в заявке, являются достоверными. Нам известно, что представление недостоверных сведений влечёт отклонение заявки и включение в реестр недобросовестных участников государственных закупок;',
      'обеспечение исполнения договора будет внесено в сроки и порядке, установленные документацией о закупке.',
    ].forEach((x, i) => blocks.push({ t: 'p', text: `${i + 1}. ${x}`, align: 'justify', indent: true }));
  }
  blocks.push(...signature(lang, ctx));
  return { title: L ? 'Кепілдік хат' : 'Гарантийное письмо', fileBase: L ? 'Кепілдік_хат' : 'Гарантийное_письмо', blocks };
}

export function coverLetter(lang, ctx) {
  const L = lang === 'kz';
  const c = ctx.company || {};
  const n = names(lang, c);
  const ref = lotRef(lang, ctx);
  const pr = ctx.price;
  const blocks = [...letterhead(lang, ctx), { t: 'title', text: L ? 'ІЛЕСПЕ ХАТ' : 'СОПРОВОДИТЕЛЬНОЕ ПИСЬМО' }];
  blocks.push({ t: 'p', align: 'justify', text: L ? `${n.name} ${ref.text} бойынша қатысуға өтінімді жолдайды.` : `${n.name} направляет заявку на участие в ${ref.text}.` });
  if (pr && pr.totals.net > 0) {
    const sum = pr.input.vatMode === 'with' ? pr.totals.gross : pr.totals.net;
    blocks.push({ t: 'p', align: 'justify', text: L ? `Баға ұсынысы: ${money(sum)} ₸ (${amountInWords(sum, 'kz')}), ${vatNote('kz', pr.input)}.` : `Ценовое предложение: ${money(sum)} ₸ (${amountInWords(sum, 'ru')}), ${vatNote('ru', pr.input)}.` });
  }
  if (pr && pr.totals.security > 0) {
    blocks.push({ t: 'p', align: 'justify', text: L ? `Өтінімді қамтамасыз ету: ${money(pr.totals.security, 0)} ₸ (бөлінген соманың ${pr.totals.pct}%).` : `Обеспечение заявки: ${money(pr.totals.security, 0)} ₸ (${pr.totals.pct}% от выделенной суммы).` });
  }
  blocks.push({ t: 'p', align: 'justify', text: L ? 'Өтінімге басшының электрондық цифрлық қолтаңбасымен қол қойылды және ол мемлекеттік сатып алу веб-порталы арқылы беріледі.' : 'Заявка подписана электронной цифровой подписью руководителя и подаётся через веб-портал государственных закупок.' });
  const att = ctx.attachments?.length ? ctx.attachments : [];
  if (att.length) {
    blocks.push({ t: 'p', text: L ? 'Қосымшалар:' : 'Приложения:', bold: true });
    att.forEach((a, i) => blocks.push({ t: 'p', text: `${i + 1}. ${a}`, indent: true }));
  }
  const contact = [c.director, c.phone, c.email].filter(Boolean).join(', ');
  if (contact) blocks.push({ t: 'p', text: `${L ? 'Байланыс тұлғасы' : 'Контактное лицо'}: ${contact}.` });
  blocks.push(...signature(lang, ctx));
  return { title: L ? 'Ілеспе хат' : 'Сопроводительное письмо', fileBase: L ? 'Ілеспе_хат' : 'Сопроводительное_письмо', blocks };
}

export function commercialProposal(lang, ctx) {
  const L = lang === 'kz';
  const c = ctx.company || {};
  const n = names(lang, c);
  const lot = ctx.lot || {};
  const pr = ctx.price;
  const blocks = [...letterhead(lang, ctx), { t: 'title', text: L ? 'КОММЕРЦИЯЛЫҚ ҰСЫНЫС' : 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ' }];
  const num = blank(lot.number, '___'), name = blank(lot.name), cust = blank(lot.customer);
  blocks.push({ t: 'p', align: 'justify', text: L ? `${n.name} № ${num} «${name}» лоты бойынша (тапсырыс беруші — ${cust}) мынадай шарттарды ұсынады:` : `${n.name} предлагает по лоту № ${num} «${name}» (заказчик — ${cust}) следующие условия:` });
  const head = L ? ['№', 'Атауы', 'Өлшем бірлігі', 'Саны', 'Бірлік бағасы, ₸', 'Сомасы, ₸'] : ['№', 'Наименование', 'Ед. изм.', 'Кол-во', 'Цена за ед., ₸', 'Сумма, ₸'];
  const rows = (pr?.rows || []).map((r) => [String(r.n), blank(r.name, ''), blank(r.unit, ''), String(r.qty ?? ''), money(r.unitPrice), money(r.net)]);
  blocks.push({ t: 'table', head, rows: rows.length ? rows : [['1', '', '', '', '', '']], widths: [6, 38, 12, 10, 17, 17], numeric: [3, 4, 5] });
  if (pr) {
    const t = pr.totals, rate = pr.input.vatRate;
    if (pr.input.vatPayer) {
      blocks.push({ t: 'p', align: 'right', text: `${L ? 'ҚҚС-сыз барлығы' : 'Итого без НДС'}: ${money(t.net)} ₸` });
      blocks.push({ t: 'p', align: 'right', text: `${L ? 'ҚҚС' : 'НДС'} ${rate}%: ${money(t.vat)} ₸` });
      blocks.push({ t: 'p', align: 'right', bold: true, text: `${L ? 'ҚҚС-пен барлығы' : 'Всего с НДС'}: ${money(t.gross)} ₸` });
      blocks.push({ t: 'p', align: 'right', small: true, text: `(${amountInWords(t.gross, lang)})` });
    } else {
      blocks.push({ t: 'p', align: 'right', bold: true, text: `${L ? 'Барлығы' : 'Итого'}: ${money(t.net)} ₸` });
      blocks.push({ t: 'p', align: 'right', small: true, text: `(${amountInWords(t.net, lang)}), ${vatNote(lang, pr.input)}` });
    }
  }
  const terms = L
    ? [`Жеткізу (қызмет көрсету) мерзімі: ${blank(lot.term)}.`, `Орны: ${blank(lot.place)}.`, 'Төлем шарттары: шартқа сәйкес.', 'Баға міндеттемелерді орындауға байланысты барлық шығыстарды (материалдар, көлік, сақтандыру, салықтар және басқа да міндетті төлемдер) қамтиды.' + (pr?.input.vatPayer && pr.input.vatMode !== 'with' ? ' ҚҚС шартта есептеледі.' : '')]
    : [`Срок поставки (оказания услуг): ${blank(lot.term)}.`, `Место: ${blank(lot.place)}.`, 'Условия оплаты: в соответствии с договором.', 'Цена включает все расходы, связанные с исполнением обязательств (материалы, транспорт, страхование, налоги и другие обязательные платежи).' + (pr?.input.vatPayer && pr.input.vatMode !== 'with' ? ' НДС начисляется в договоре.' : '')];
  terms.forEach((x) => blocks.push({ t: 'p', text: x, align: 'justify' }));
  if (c.iik || c.bank) {
    blocks.push({ t: 'p', small: true, text: L ? `Банк деректемелері: ЖСК ${blank(c.iik)}, БСК ${blank(c.bik)}, ${blank(c.bank)}` : `Банковские реквизиты: ИИК ${blank(c.iik)}, БИК ${blank(c.bik)}, ${blank(c.bank)}` });
  }
  blocks.push(...signature(lang, ctx));
  return { title: L ? 'Коммерциялық ұсыныс' : 'Коммерческое предложение', fileBase: L ? 'Коммерциялық_ұсыныс' : 'Коммерческое_предложение', blocks };
}

export function techSpecDoc(lang, ctx, spec) {
  const L = lang === 'kz';
  const lot = ctx.lot || {};
  const c = ctx.company || {};
  const n = names(lang, c);
  const blocks = [
    { t: 'title', text: L ? 'ТЕХНИКАЛЫҚ ЕРЕКШЕЛІК' : 'ТЕХНИЧЕСКАЯ СПЕЦИФИКАЦИЯ' },
    { t: 'p', align: 'center', text: L ? `№ ${blank(lot.number, '___')} лот: «${blank(lot.name)}»` : `Лот № ${blank(lot.number, '___')}: «${blank(lot.name)}»` },
    { t: 'p', text: `${L ? 'Әлеуетті өнім беруші' : 'Потенциальный поставщик'}: ${n.name}, ${L ? 'БСН' : 'БИН'} ${blank(c.bin)}`, small: true },
    {
      t: 'table',
      head: L ? ['№', 'Тапсырыс берушінің талабы', 'Әлеуетті өнім берушінің ұсынысы'] : ['№', 'Требование заказчика', 'Предложение потенциального поставщика'],
      rows: (spec?.rows || []).map((r, i) => [String(i + 1), r.requirement || '', r.response || '']),
      widths: [6, 44, 50],
    },
    ...signature(lang, ctx),
  ];
  return { title: L ? 'Техникалық ерекшелік' : 'Техническая спецификация', fileBase: L ? 'Техникалық_ерекшелік' : 'Техническая_спецификация', blocks };
}
