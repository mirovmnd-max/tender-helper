// Вызов OpenAI-совместимого API (OpenAI, xAI, OpenRouter и др.) прямо из браузера.
// Ключ хранится только в localStorage этого браузера и отправляется только на указанный base URL.

export const PROVIDERS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4-mini' },
  xai: { label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.4-mini' },
  custom: { label: 'Другой (OpenAI-совместимый)', baseUrl: '', model: '' },
};

const MAX_DOC_CHARS = 60000;

const EXPERT = 'Ты — эксперт по государственным закупкам Республики Казахстан (Закон РК «О государственных закупках», Правила осуществления государственных закупок, утверждённые приказом Министра финансов РК № 687) и закупкам АО «Самрук-Қазына». Ты помогаешь потенциальному поставщику готовить заявку. Никогда не выдумывай факты: если данных нет — null или плейсхолдер в квадратных скобках.';

async function chat(settings, messages, { json = true, signal } = {}) {
  const base = (settings.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Не указан base URL API в Настройках.');
  if (!settings.apiKey) throw new Error('Не указан API-ключ в Настройках.');
  const body = { model: settings.model, messages };
  if (json) body.response_format = { type: 'json_object' };
  const call = async (b) => {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.apiKey },
      body: JSON.stringify(b),
      signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || text.slice(0, 300);
      const err = new Error(`API ответил ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('API вернул пустой ответ.');
    return content;
  };
  try {
    return await call(body);
  } catch (e) {
    // Некоторые провайдеры/модели не поддерживают response_format — пробуем без него.
    if (json && e.status === 400 && /response_format|json/i.test(e.message)) {
      delete body.response_format;
      return call(body);
    }
    if (e instanceof TypeError) throw new Error('Не удалось связаться с API (сеть или CORS). Проверьте base URL; некоторые провайдеры не разрешают запросы из браузера.');
    throw e;
  }
}

export function parseJson(text) {
  let s = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('Модель вернула ответ не в формате JSON. Попробуйте ещё раз или другую модель.');
}

export async function testConnection(settings) {
  const out = await chat(settings, [{ role: 'user', content: 'Ответь одним словом: ok' }], { json: false });
  return out.trim().slice(0, 60);
}

export async function extractRequirements(settings, lotText, opts = {}) {
  const doc = lotText.length > MAX_DOC_CHARS ? lotText.slice(0, MAX_DOC_CHARS) + '\n[...документ обрезан...]' : lotText;
  const schema = `{
  "lot": {"number": "номер лота или объявления | null", "name": "наименование лота | null", "customer": "заказчик | null",
          "method": "конкурс | аукцион | запрос ценовых предложений | из одного источника | Самрук-Казына | null",
          "amount": число — сумма, выделенная для закупки, в тенге | null, "amountIncludesVat": true | false | null,
          "deadline": "окончание приёма заявок, ДД.ММ.ГГГГ ЧЧ:ММ | null", "term": "срок поставки/оказания | null", "place": "место | null"},
  "requirements": [{"id": "R1", "category": "Объём услуг | Технические характеристики | Количество | Сроки и место | Персонал | Оборудование | Материалы | Квалификация | Документы | Нормативы | Оплата | Прочее",
                    "text": "требование близко к тексту документации, со всеми числами и единицами измерения",
                    "value": "ключевое значение с единицей, кратко", "critical": true, "source": "пункт/раздел документации или пусто"}],
  "positions": [{"name": "позиция из расчёта выделенной суммы", "unit": "ед. изм.", "qty": число, "planUnitPrice": число — цена заказчика за единицу | null}],
  "warnings": ["конкретные риски и ловушки для поставщика: что подготовить заранее, сроки, обеспечение, медкнижки, лицензии, товарные знаки без слова «аналог» и т.п."]
}`;
  const messages = [
    { role: 'system', content: EXPERT + ' Отвечай строго одним JSON-объектом без пояснений.' },
    {
      role: 'user',
      content: `Извлеки из документации лота все требования заказчика к предмету закупки (технические характеристики, объём, количество, единицы измерения, сроки, место) и к поставщику (квалификация, персонал, оборудование, документы, лицензии). Каждое требование — отдельный элемент; не объединяй разные требования. Не пропускай числа и единицы измерения. critical=true, если несоответствие приведёт к отклонению заявки.\n\nФормат ответа:\n${schema}\n\nДокументация лота:\n<<<\n${doc}\n>>>`,
    },
  ];
  const data = parseJson(await chat(settings, messages, opts));
  if (!Array.isArray(data.requirements)) throw new Error('В ответе модели нет списка требований.');
  data.requirements = data.requirements.map((r, i) => ({ id: r.id || 'R' + (i + 1), category: r.category || 'Прочее', text: r.text || '', value: r.value || '', critical: !!r.critical, source: r.source || '' }));
  data.lot = data.lot || {};
  data.warnings = Array.isArray(data.warnings) ? data.warnings : [];
  data.positions = Array.isArray(data.positions) ? data.positions : [];
  return data;
}

export async function generateSpec(settings, { requirements, lot, company, lang }, opts = {}) {
  const langName = lang === 'kz' ? 'казахском (мемлекеттік тіл; используй официальную деловую лексику госзакупок РК, например «техникалық ерекшелік», «тапсырыс беруші», «әлеуетті өнім беруші»)' : 'русском';
  const messages = [
    { role: 'system', content: EXPERT + ' Отвечай строго одним JSON-объектом без пояснений.' },
    {
      role: 'user',
      content: `Составь техническую спецификацию потенциального поставщика пункт в пункт с требованиями заказчика.

Правила:
1. Одна строка на КАЖДОЕ требование, в том же порядке, с тем же id. Ничего не пропускай.
2. Используй те же числа и единицы измерения, что у заказчика. Значения — не хуже требуемых; вместо «не менее» пиши конкретное значение.
3. Пиши утвердительно и конкретно («будет оказано», «предоставляется», «имеется»). Не используй «или эквивалент», «примерно», «по возможности».
4. Не добавляй характеристики, которых нет в требованиях: лишние характеристики могут стать причиной отклонения.
5. Если заказчик указал товарный знак без слова «аналог», отметь риск в note.
6. Если требование подтверждается документом (лицензия, договоры, акты, ЭСФ, медкнижки, сертификаты) — в note укажи, что приложить.
7. Если не хватает данных поставщика — оставь плейсхолдер в квадратных скобках, например [указать модель].
8. requirement и response пиши на ${langName} языке. note — на русском, это подсказка для поставщика.

Формат ответа: {"title": "заголовок", "rows": [{"id": "R1", "requirement": "требование заказчика", "response": "предложение поставщика", "note": "подсказка или пустая строка"}]}

Лот: ${JSON.stringify(lot || {})}
Поставщик: ${company?.name || '[наименование поставщика]'}
Требования заказчика (JSON):
${JSON.stringify(requirements)}`,
    },
  ];
  const data = parseJson(await chat(settings, messages, opts));
  if (!Array.isArray(data.rows)) throw new Error('В ответе модели нет строк спецификации.');
  data.rows = data.rows.map((r, i) => ({ id: r.id || requirements[i]?.id || 'R' + (i + 1), requirement: r.requirement || requirements[i]?.text || '', response: r.response || '', note: r.note || '' }));
  return data;
}
