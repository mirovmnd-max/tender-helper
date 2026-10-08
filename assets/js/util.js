// Общие помощники: localStorage, форматирование, суммы прописью, проверка БИН, загрузка скриптов.

const PREFIX = 'tender-helper:';

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { console.warn('localStorage недоступен', e); }
  },
  remove(key) { try { localStorage.removeItem(PREFIX + key); } catch {} },
  clearAll() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
    } catch {}
  },
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function money(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\u202f/g, '\u00a0');
}

export function parseNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  const s = String(v).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (s === '') return NaN;
  return Number(s);
}

export function todayStr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** Разбирает «12.11.2026 10:00», «2026-11-12» и т.п. в Date или null. */
export function parseDate(s) {
  if (!s) return null;
  let m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[^\d]+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 23), +(m[5] || 59));
  m = String(s).match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59));
  return null;
}

/** Проверка контрольного разряда ИИН/БИН (12 цифр). */
export function checkBin(bin) {
  const s = String(bin || '').replace(/\s/g, '');
  if (!/^\d{12}$/.test(s)) return { ok: false, reason: 'БИН должен состоять из 12 цифр' };
  const d = s.split('').map(Number);
  const w1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
  let c = w1.reduce((a, w, i) => a + w * d[i], 0) % 11;
  if (c === 10) {
    c = w2.reduce((a, w, i) => a + w * d[i], 0) % 11;
    if (c === 10) return { ok: false, reason: 'Некорректный контрольный разряд БИН' };
  }
  return c === d[11] ? { ok: true } : { ok: false, reason: 'Не сходится контрольный разряд БИН — проверьте цифры' };
}

const scriptCache = new Map();
export function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => { scriptCache.delete(src); reject(new Error('Не удалось загрузить ' + src)); };
      document.head.appendChild(el);
    }));
  }
  return scriptCache.get(src);
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFileName(s) {
  return String(s || 'документ').replace(/[\\/:*?"<>|«»]+/g, '').replace(/\s+/g, '_').slice(0, 80);
}

// ---------- Суммы прописью ----------
const RU = {
  units: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  unitsF: ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  teens: ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'],
  tens: ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'],
  hundreds: ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'],
  scales: [null, ['тысяча', 'тысячи', 'тысяч', true], ['миллион', 'миллиона', 'миллионов'], ['миллиард', 'миллиарда', 'миллиардов']],
};
function ruPlural(n, forms) {
  const n100 = n % 100, n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return forms[2];
  if (n10 === 1) return forms[0];
  if (n10 >= 2 && n10 <= 4) return forms[1];
  return forms[2];
}
function ruTriad(n, fem) {
  const out = [];
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  if (h) out.push(RU.hundreds[h]);
  if (t === 1) out.push(RU.teens[u]);
  else {
    if (t) out.push(RU.tens[t]);
    if (u) out.push((fem ? RU.unitsF : RU.units)[u]);
  }
  return out.join(' ');
}
const KZ = {
  units: ['', 'бір', 'екі', 'үш', 'төрт', 'бес', 'алты', 'жеті', 'сегіз', 'тоғыз'],
  tens: ['', 'он', 'жиырма', 'отыз', 'қырық', 'елу', 'алпыс', 'жетпіс', 'сексен', 'тоқсан'],
  scales: ['', 'мың', 'миллион', 'миллиард'],
};
function kzTriad(n) {
  const out = [];
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  if (h) out.push(KZ.units[h] + ' жүз');
  if (t) out.push(KZ.tens[t]);
  if (u) out.push(KZ.units[u]);
  return out.join(' ');
}

export function amountInWords(amount, lang = 'ru') {
  const n = Math.round(Number(amount) * 100);
  if (!Number.isFinite(n) || n < 0) return '';
  let whole = Math.floor(n / 100);
  const tiyn = String(n % 100).padStart(2, '0');
  if (whole === 0) return lang === 'kz' ? `Нөл теңге ${tiyn} тиын` : `Ноль тенге ${tiyn} тиын`;
  const parts = [];
  let scale = 0;
  while (whole > 0 && scale < 4) {
    const tri = whole % 1000;
    if (tri) {
      if (lang === 'kz') {
        parts.unshift([kzTriad(tri), KZ.scales[scale]].filter(Boolean).join(' '));
      } else {
        const sc = RU.scales[scale];
        const words = ruTriad(tri, sc && sc[3]);
        parts.unshift(sc ? `${words} ${ruPlural(tri, sc)}` : words);
      }
    }
    whole = Math.floor(whole / 1000);
    scale++;
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  const cap = text.charAt(0).toUpperCase() + text.slice(1);
  return lang === 'kz' ? `${cap} теңге ${tiyn} тиын` : `${cap} тенге ${tiyn} тиын`;
}
