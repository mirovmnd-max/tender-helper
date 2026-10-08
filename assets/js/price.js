// Проверка ценового предложения. Детерминированная логика, без ИИ.

export const METHODS = {
  konkurs: { label: 'Конкурс', kz: 'конкурс', pct: 1 },
  auction: { label: 'Аукцион', kz: 'аукцион', pct: 1 },
  zcp: { label: 'Запрос ценовых предложений', kz: 'баға ұсыныстарын сұрату', pct: 3 },
  single: { label: 'Из одного источника', kz: 'бір көзден алу', pct: 0 },
  samruk: { label: 'Самрук-Казына (по документации)', kz: '«Самұрық-Қазына» сатып алуы', pct: null },
};

export function methodKeyFromText(t) {
  const s = String(t || '').toLowerCase();
  if (s.includes('ценов')) return 'zcp';
  if (s.includes('аукцион')) return 'auction';
  if (s.includes('одного источника')) return 'single';
  if (s.includes('самрук')) return 'samruk';
  if (s.includes('конкурс')) return 'konkurs';
  return null;
}

const r2 = (x) => Math.round(x * 100) / 100;
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const nearRel = (a, b, rel = 0.15) => b > 0 && Math.abs(a - b) / b <= rel;

/** Округление обеспечения заявки по правилам: < 50 тиын — вниз, ≥ 50 тиын — вверх до тенге. */
export function roundTenge(x) { return Math.floor(x + 0.5); }

/**
 * @param {object} p {vatMode:'without'|'with', vatRate, vatPayer, method, customPct, allocated, rows:[{name,unit,qty,planUnit,unitPrice,total}]}
 * @returns {{rows:Array, issues:Array, totals:object}}
 */
export function checkPrice(p) {
  const rate = (Number(p.vatRate) || 0) / 100;
  const withVat = p.vatMode === 'with' && p.vatPayer;
  const issues = [];
  const rows = (p.rows || []).map((row, i) => {
    const n = i + 1;
    const name = row.name || `Позиция ${n}`;
    const qty = Number(row.qty);
    const price = Number(row.unitPrice);
    const plan = Number(row.planUnit);
    const entered = row.total === '' || row.total == null ? NaN : Number(row.total);
    const net = r2(qty * price);
    const expected = withVat ? r2(net * (1 + rate)) : net;
    const flags = [];
    const add = (level, text) => { flags.push({ level, text }); issues.push({ level, text: `Строка ${n} «${name}»: ${text}` }); };

    if (!row.unit) add('warn', 'не указана единица измерения — она должна совпадать с единицей заказчика.');
    if (!(qty > 0)) add('error', 'количество должно быть больше нуля.');
    if (!(price > 0)) add('error', 'не указана цена за единицу.');

    if (qty > 0 && price > 0) {
      if (plan > 0) {
        if (qty > 1 && nearRel(price, plan * qty, 0.15)) {
          add('error', `цена за единицу (${fmt(price)}) почти равна плановой сумме за весь объём (${fmt(plan * qty)}). Похоже, указана сумма за весь объём вместо цены за единицу.`);
        } else if (price > plan + 0.005) {
          add('error', `цена за единицу ${fmt(price)} выше плановой цены заказчика ${fmt(plan)}. Такая заявка будет отклонена.`);
        } else if (price < plan * 0.3) {
          add('warn', `цена за единицу ниже плановой более чем на 70%. Проверьте единицу измерения (например, м² вместо месяца) и требования о демпинге.`);
        }
      }
      if (Number.isFinite(entered)) {
        if (qty > 1 && near(entered, price) && !near(entered, expected)) {
          add('error', `сумма в заявке равна цене за единицу. Похоже, цену не умножили на количество (${qty}). Должно быть ${fmt(expected)}.`);
        } else if (withVat && near(entered, net, Math.max(1, net * 0.0005)) && rate > 0) {
          add('error', `сумма ${fmt(entered)} не включает НДС ${p.vatRate}%. С НДС должно быть ${fmt(expected)}.`);
        } else if (!withVat && rate > 0 && p.vatPayer && near(entered, r2(net * (1 + rate)), Math.max(1, net * 0.0005))) {
          add('warn', `сумма ${fmt(entered)} уже содержит НДС, а в выбранном режиме цены указываются без НДС (НДС добавится в договор). Должно быть ${fmt(expected)}.`);
        } else if (!near(entered, expected)) {
          add('error', `арифметика не сходится: ${qty} × ${fmt(price)}${withVat ? ` + НДС ${p.vatRate}%` : ''} = ${fmt(expected)}, а в заявке ${fmt(entered)}.`);
        }
      }
    }
    return { ...row, n, net, expected, flags };
  });

  const net = r2(rows.reduce((a, r) => a + (Number.isFinite(r.net) ? r.net : 0), 0));
  const vat = p.vatPayer ? r2(net * rate) : 0;
  const gross = r2(net + vat);
  const allocated = Number(p.allocated) || 0;
  const compare = p.vatMode === 'with' ? gross : net;
  const m = METHODS[p.method] || METHODS.konkurs;
  const pct = m.pct == null ? Number(p.customPct) || 0 : m.pct;
  const security = roundTenge((allocated * pct) / 100);

  if (allocated > 0 && rows.length) {
    if (compare > allocated + 0.005) {
      issues.push({ level: 'error', text: `Итоговая цена ${fmt(compare)} ${p.vatMode === 'with' ? 'с НДС' : 'без НДС'} превышает выделенную сумму ${fmt(allocated)} на ${fmt(compare - allocated)}. Заявка будет отклонена.` });
    } else if (compare < allocated * 0.7) {
      issues.push({ level: 'warn', text: `Итоговая цена ниже выделенной суммы на ${Math.round((1 - compare / allocated) * 100)}%. Проверьте условия о демпинге в документации и реалистичность расчёта.` });
    } else {
      issues.push({ level: 'ok', text: `Итоговая цена не превышает выделенную сумму (экономия заказчика ${fmt(allocated - compare)}).` });
    }
  } else if (!allocated) {
    issues.push({ level: 'warn', text: 'Не указана выделенная сумма лота — сравнение и расчёт обеспечения заявки невозможны.' });
  }
  if (p.vatPayer && p.vatMode === 'without' && rate > 0) {
    issues.push({ level: 'info', text: `С 2026 года суммы в планах госзакупок указываются без НДС; портал сам добавит НДС ${p.vatRate}% к договору плательщика НДС (${fmt(vat)}). Сверьте с условиями конкретной закупки.` });
  }
  if (Number(p.vatRate) === 12) {
    issues.push({ level: 'warn', text: 'Ставка 12% действовала до 2026 года. С 01.01.2026 стандартная ставка НДС в РК — 16%.' });
  }
  if (rows.length && !issues.some((x) => x.level === 'error')) {
    issues.unshift({ level: 'ok', text: 'Ошибок в арифметике и ценах за единицу не найдено.' });
  }

  return {
    rows,
    issues,
    totals: { net, vat, gross, compare, allocated, pct, security, method: m, errors: issues.filter((x) => x.level === 'error').length },
  };
}

function fmt(n) {
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u202f/g, '\u00a0') + ' ₸';
}
