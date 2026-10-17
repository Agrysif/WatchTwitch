// Проверка перевода интерфейса без запуска приложения.
//
//   node tests/i18n-check.cjs                 — сводка, код 1 при пропусках
//   node tests/i18n-check.cjs --file <путь>   — подробно по файлам (можно несколько)
//   node tests/i18n-check.cjs --strict        — код 1 и при невёрнутом русском тексте
//
// Что проверяется:
//   1. у каждого tr('…') и форм plural(n, 'одна', 'две', 'много') есть
//      английская строка в renderer/js/locales/en/*.js;
//   2. внутри tr() нет шаблона с ${…} — нужны подстановки {имя};
//   3. словари не дают одной русской строке два разных перевода;
//   4. русский текст в коде и разметке, не обёрнутый в tr() (кроме
//      console.*, комментариев и строк с пометкой i18n-ignore).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const only = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) only.push(path.resolve(root, args[++i]));
}
const CYR = /[А-Яа-яЁё]/;

// ─── словари ────────────────────────────────────────────────────────
const localeDir = path.join(root, 'renderer/js/locales/en');
const dict = {};
const owner = {};
const conflicts = [];
for (const file of fs.readdirSync(localeDir).filter(f => f.endsWith('.js')).sort()) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(localeDir, file), 'utf8'), sandbox, { filename: file });
  const part = sandbox.window.I18N_EN || {};
  for (const [key, value] of Object.entries(part)) {
    if (typeof value !== 'string') conflicts.push(`${file}: не строка у «${key}»`);
    else if (key in dict && dict[key] !== value) conflicts.push(`«${key}»: ${owner[key]} → «${dict[key]}», ${file} → «${value}»`);
    dict[key] = value;
    owner[key] = file;
  }
}

// ─── разбор JS на токены ────────────────────────────────────────────
function tokenize(src, lineBase = 1) {
  const tokens = [];
  let i = 0;
  let line = lineBase;
  let lastSig = '';
  let lastWord = '';
  const push = (t) => {
    tokens.push(t);
    if (t.type === 'punc') { lastSig = t.value; lastWord = ''; }
    else if (t.type === 'ident') { lastSig = 'a'; lastWord = t.value; }
    else { lastSig = 'a'; lastWord = ''; }
  };
  const regexAllowed = () => !lastSig || '(,=:[!&|?{};+-*%<>~^'.includes(lastSig) ||
    ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do'].includes(lastWord);

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      line += (src.slice(i, stop).match(/\n/g) || []).length;
      i = stop;
      continue;
    }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      push({ type: 'str', raw: src.slice(i, j + 1), line });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let quasi = '';
      let hasExpr = false;
      const startLine = line;
      const inner = [];
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { quasi += src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          hasExpr = true;
          quasi += '${}';
          let depth = 1;
          let k = j + 2;
          // до парной скобки, пропуская строки и вложенные шаблоны
          while (k < src.length && depth > 0) {
            const ch = src[k];
            if (ch === '\'' || ch === '"') {
              k++;
              while (k < src.length && src[k] !== ch) k += src[k] === '\\' ? 2 : 1;
            } else if (ch === '`') {
              k++;
              let d = 0;
              while (k < src.length && !(src[k] === '`' && d === 0)) {
                if (src[k] === '\\') { k += 2; continue; }
                if (src[k] === '$' && src[k + 1] === '{') { d++; k += 2; continue; }
                if (src[k] === '}' && d > 0) d--;
                k++;
              }
            } else if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (depth > 0) k++;
          }
          const expr = src.slice(j + 2, k);
          inner.push(...tokenize(expr, line));
          // разделитель: соседние ${…} одного шаблона — разные выражения
          inner.push({ type: 'punc', value: ';', line });
          line += (expr.match(/\n/g) || []).length;
          j = k + 1;
          continue;
        }
        if (src[j] === '\n') line++;
        quasi += src[j];
        j++;
      }
      push({ type: 'tpl', raw: src.slice(i, j + 1), quasi, hasExpr, line: startLine, inner });
      i = j + 1;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j++;
      }
      j++;
      while (/[a-z]/i.test(src[j] || '')) j++;
      push({ type: 'regex', raw: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[A-Za-z_$Ѐ-ӿ]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w$Ѐ-ӿ]/.test(src[j])) j++;
      push({ type: 'ident', value: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w.]/.test(src[j])) j++;
      push({ type: 'num', line });
      i = j;
      continue;
    }
    push({ type: 'punc', value: c, line });
    i++;
  }
  return tokens;
}

function literalValue(token) {
  try {
    return vm.runInNewContext(token.raw);
  } catch (error) {
    return token.raw.slice(1, -1);
  }
}

const TR_NAMES = new Set(['tr', 'window.tr', 'globalThis.tr']);
const KEYWORDS = new Set(['return', 'typeof', 'case', 'await', 'new', 'void', 'in', 'of', 'else', 'do', 'throw', 'yield', 'delete', 'instanceof']);

/** Обход токенов с учётом вызовов: какие строки — прямые аргументы tr/plural. */
function analyze(tokens, lines, report, file, names = TR_NAMES) {
  const stack = [];
  const lineIgnored = (n) => /i18n-ignore/.test(lines[n - 1] || '');
  const inConsole = () => stack.some(f => f.name.startsWith('console.'));

  const handleString = (tok, value, isTemplate) => {
    const top = stack[stack.length - 1];
    if (inConsole()) return;
    if (top && top.kind === '(' && names.has(top.name) && top.arg === 0) {
      if (isTemplate && tok.hasExpr) report.errors.push(`${file}:${tok.line} tr() с \${…} — нужна подстановка {имя}: ${tok.raw.slice(0, 80)}`);
      else report.keys.push({ key: value, file, line: tok.line });
      return;
    }
    if (top && top.kind === '(' && /(^|\.)plural$/.test(top.name) && top.arg >= 1 && top.arg <= 3) {
      if (top.arg !== 2) report.keys.push({ key: value, file, line: tok.line, plural: true });
      return;
    }
    if (CYR.test(isTemplate ? tok.quasi : value) && !lineIgnored(tok.line)) {
      report.unwrapped.push({ file, line: tok.line, text: (isTemplate ? tok.raw : value).replace(/\s+/g, ' ').slice(0, 100) });
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'punc' && tok.value === '(') {
      // имя вызова: a.b.c( или a?.b( — идентификаторы склеиваются только
      // через точку: иначе `return tr(` читалось как return.tr, а
      // `cond ? tr(` — как cond.tr, и ключи таких вызовов не проверялись
      let name = '';
      let k = i - 1;
      let afterDot = true;
      while (k >= 0) {
        const t = tokens[k];
        if (t.type === 'ident' && afterDot && !KEYWORDS.has(t.value)) {
          name = t.value + (name ? '.' + name : '');
          afterDot = false;
          k--;
        } else if (t.type === 'punc' && t.value === '.' && name && !afterDot) {
          afterDot = true;
          k -= tokens[k - 1]?.type === 'punc' && tokens[k - 1].value === '?' ? 2 : 1;
        } else break;
      }
      stack.push({ kind: '(', name, arg: 0 });
    } else if (tok.type === 'punc' && (tok.value === '[' || tok.value === '{')) {
      stack.push({ kind: tok.value, name: '', arg: 0 });
    } else if (tok.type === 'punc' && (tok.value === ')' || tok.value === ']' || tok.value === '}')) {
      stack.pop();
    } else if (tok.type === 'punc' && tok.value === ',') {
      const top = stack[stack.length - 1];
      if (top) top.arg++;
    } else if (tok.type === 'str') {
      handleString(tok, literalValue(tok), false);
    } else if (tok.type === 'tpl') {
      handleString(tok, tok.hasExpr ? tok.quasi : literalValue(tok), true);
      if (tok.inner.length) analyze(tok.inner, lines, report, file, names);
    }
  }
}

// ─── разметка ───────────────────────────────────────────────────────
function scanHtml(src, file, report) {
  const lines = src.split(/\r?\n/);
  const lineOf = (index) => src.slice(0, index).split('\n').length;
  let html = src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  // встроенные скрипты — как JS
  html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (m, code, offset) => {
    if (code.trim()) analyze(tokenize(code, lineOf(offset)), lines, report, file);
    return m.replace(/[^\n]/g, ' ');
  });
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, m => m.replace(/[^\n]/g, ' '));
  html = html.replace(/<(\w+)\b[^>]*\bdata-no-tr\b[^>]*>[\s\S]*?<\/\1>/g, m => m.replace(/[^\n]/g, ' '));
  html = html.replace(/<(\w+)\b[^>]*\bdata-tr\b[^>]*>([\s\S]*?)<\/\1>/g, (m, tag, inner, offset) => {
    const key = inner.replace(/\s+/g, ' ').trim();
    if (CYR.test(key)) report.keys.push({ key, file, line: lineOf(offset), html: true });
    return m.replace(/[^\n]/g, ' ');
  });
  const textRe = />([^<>]+)</g;
  let m;
  while ((m = textRe.exec(html))) {
    const key = m[1].replace(/\s+/g, ' ').trim();
    if (key && CYR.test(key)) report.keys.push({ key, file, line: lineOf(m.index), html: true });
  }
  const attrRe = /\s(title|placeholder|aria-label|data-tooltip|alt)="([^"]*)"/g;
  while ((m = attrRe.exec(html))) {
    const key = m[2].replace(/\s+/g, ' ').trim();
    if (key && CYR.test(key)) report.keys.push({ key, file, line: lineOf(m.index), html: true });
  }
}

// ─── обход ──────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const SKIP = [
  path.join(root, 'renderer/js/locales'),
  path.join(root, 'renderer/js/i18n.js')
];
const files = walk(path.join(root, 'renderer'))
  .filter(f => /\.(js|html)$/.test(f))
  .filter(f => !SKIP.some(s => f === s || f.startsWith(s + path.sep)));

const report = { keys: [], errors: [], unwrapped: [] };
for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.html')) scanHtml(src, rel, report);
  else analyze(tokenize(src), src.split(/\r?\n/), report, rel);
}

// ─── главный процесс ────────────────────────────────────────────────
// Трей, заставка, окна ошибок, тексты для окна: словарь — EN из
// i18n-main.js, перевод — trMain (в main и globalThis.tr = trMain).
// dropText — обёртка trMain для окна о награде
const MAIN_NAMES = new Set(['trMain', 'tr', 'globalThis.tr', 'dropText']);
const mainDict = require(path.join(root, 'i18n-main.js')).EN;
const mainReport = { keys: [], errors: [], unwrapped: [] };
// rate-limit.js main подключает к себе: его пояснение уходит окну причиной отказа
for (const rel of ['main.js', 'preload.js', 'preload-notification.js', 'renderer/js/core/rate-limit.js']) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  analyze(tokenize(src), src.split(/\r?\n/), mainReport, rel, MAIN_NAMES);
}
{
  // У заставки свой словарь EN в её же скрипте: разметка проверяется по нему
  const rel = 'splash.html';
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const own = src.match(/var EN = (\{[\s\S]*?\});/);
  const splashDict = own ? vm.runInNewContext('(' + own[1] + ')') : {};
  const part = { keys: [], errors: [], unwrapped: [] };
  scanHtml(src, rel, part);
  for (const k of part.keys) if (!(k.key in splashDict)) mainReport.keys.push({ ...k, missingIn: 'splash' });
  mainReport.errors.push(...part.errors);
  mainReport.unwrapped.push(...part.unwrapped);
}
const mainMissing = mainReport.keys.filter(k => k.missingIn === 'splash' || !(k.key in mainDict));

const wanted = (f) => !only.length || only.some(o => path.resolve(root, f) === o);
const missing = report.keys.filter(k => !(k.key in dict));
const missingShown = missing.filter(k => wanted(k.file));
const unwrappedShown = report.unwrapped.filter(u => wanted(u.file));
const errorsShown = report.errors.filter(e => wanted(e.split(':')[0]));

const byFile = (list) => list.reduce((acc, x) => { acc[x.file] = (acc[x.file] || 0) + 1; return acc; }, {});

const mainMissingShown = mainMissing.filter(k => wanted(k.file));
const mainErrorsShown = mainReport.errors.filter(e => wanted(e.split(':')[0]));
const mainUnwrappedShown = mainReport.unwrapped.filter(u => wanted(u.file));

if (only.length) {
  for (const k of [...missingShown, ...mainMissingShown]) console.log(`НЕТ ПЕРЕВОДА ${k.file}:${k.line} «${k.key}»`);
  for (const e of [...errorsShown, ...mainErrorsShown]) console.log('ОШИБКА ' + e);
  for (const u of [...unwrappedShown, ...mainUnwrappedShown]) console.log(`БЕЗ tr ${u.file}:${u.line} ${u.text}`);
}
for (const c of conflicts) console.log('КОНФЛИКТ ' + c);

const usedKeys = new Set(report.keys.map(k => k.key));
const unused = Object.keys(dict).filter(k => !usedKeys.has(k));
const mainUsed = new Set(mainReport.keys.map(k => k.key));
const mainUnused = Object.keys(mainDict).filter(k => !mainUsed.has(k));
// --unused: записи словаря без tr('…') в коде. Часть из них законна —
// строки, которые переводятся по значению (tr(error) для ответов main)
if (args.includes('--unused')) {
  for (const k of unused) console.log(`НЕ ИСПОЛЬЗУЕТСЯ ${owner[k]} «${k}»`);
  for (const k of mainUnused) console.log(`НЕ ИСПОЛЬЗУЕТСЯ i18n-main.js «${k}»`);
}

console.log(JSON.stringify({
  dictionary: Object.keys(dict).length,
  keysInCode: usedKeys.size,
  missing: missing.length,
  errors: report.errors.length,
  conflicts: conflicts.length,
  unwrapped: report.unwrapped.length,
  unusedEntries: unused.length,
  missingByFile: byFile(missing),
  unwrappedByFile: byFile(report.unwrapped),
  main: {
    dictionary: Object.keys(mainDict).length,
    missing: mainMissing.length,
    errors: mainReport.errors.length,
    unwrapped: mainReport.unwrapped.length,
    unusedEntries: mainUnused.length,
    unwrappedByFile: byFile(mainReport.unwrapped)
  }
}, null, 2));

const failed = missing.length || report.errors.length || conflicts.length ||
  mainMissing.length || mainReport.errors.length ||
  (strict && (report.unwrapped.length || mainReport.unwrapped.length));
process.exit(failed ? 1 : 0);
