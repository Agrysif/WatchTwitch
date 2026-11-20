'use strict';
/**
 * Перенос входа в Twitch при переходе с Electron 28 на новый Electron.
 *
 * Electron 28 хранит cookie сессии Twitch (persist:twitch) в базе формата
 * 19, значения — открытым текстом. Новый Chromium при первом открытии
 * переводит базу на формат 24 и все такие записи удаляет: после
 * обновления у каждого пропадал вход в Twitch (так было и при пробе
 * Electron 44 — проверено на копии профиля: 13 cookie → 0).
 *
 * Поэтому до того, как Chromium откроет базу, читаем её сами (node:sqlite,
 * только чтение) и запоминаем cookie Twitch. После запуска, когда база уже
 * переведена и пуста, возвращаем их штатным cookies.set. Отметка в
 * cookie-migration.json — перенос делается один раз.
 *
 * Значения cookie никуда не пишутся и не логируются: только число.
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'cookie-migration.json';
// Время Chromium — микросекунды от 1601-01-01
const CHROME_EPOCH_OFFSET_S = 11644473600;
const SAME_SITE = { '-1': 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' };

function cookieDbPath(userData) {
  return path.join(userData, 'Partitions', 'twitch', 'Network', 'Cookies');
}

function markerPath(userData) {
  return path.join(userData, MARKER);
}

function writeMarker(userData, info) {
  try {
    fs.writeFileSync(markerPath(userData), JSON.stringify({ ...info, at: new Date().toISOString() }));
  } catch (e) { /* без отметки перенос повторится — вреда нет */ }
}

/**
 * Прочитать cookie Twitch из базы старого формата. Звать до app.whenReady
 * (до того, как Chromium откроет базу). null — переносить нечего.
 */
function stash(userData, log = () => {}) {
  if (fs.existsSync(markerPath(userData))) return null;
  const file = cookieDbPath(userData);
  if (!fs.existsSync(file)) {
    // Новая установка — переносить нечего и больше не придётся
    writeMarker(userData, { done: true, reason: 'no-db' });
    return null;
  }
  let db = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    const version = Number(db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value) || 0;
    if (version >= 24) {
      writeMarker(userData, { done: true, reason: 'already-new', version });
      return null;
    }
    const nowS = Date.now() / 1000;
    // Времена Chromium — микросекунды от 1601 года: больше 2^53, поэтому
    // числа читаем как BigInt (иначе node:sqlite отказывается их отдавать)
    const query = db.prepare(`SELECT host_key, name, value, path, expires_utc, is_secure,
      is_httponly, has_expires, is_persistent, samesite FROM cookies`);
    query.setReadBigInts(true);
    const rows = query.all();
    const cookies = [];
    let skipped = 0;
    for (const row of rows) {
      // Зашифрованные значения (Electron 28 их не шифрует) без ключа не вернуть
      const plain = typeof row.value === 'string' && row.value.length > 0;
      const expires = Number(row.expires_utc) > 0 ? Number(row.expires_utc) / 1e6 - CHROME_EPOCH_OFFSET_S : 0;
      if (!plain || (expires && expires <= nowS)) { skipped++; continue; }
      cookies.push({
        host: String(row.host_key || ''),
        name: String(row.name || ''),
        value: row.value,
        path: String(row.path || '/'),
        secure: !!row.is_secure,
        httpOnly: !!row.is_httponly,
        expires: row.has_expires && row.is_persistent && expires ? Math.floor(expires) : 0,
        sameSite: SAME_SITE[String(row.samesite)] || 'unspecified'
      });
    }
    log('[Вход] Старая база cookie (формат ' + version + '): к переносу ' + cookies.length + ', пропущено ' + skipped);
    return { version, cookies };
  } catch (e) {
    log('[Вход] Старую базу cookie прочитать не удалось: ' + e.message);
    return null;
  } finally {
    try { db?.close(); } catch (e) { /* уже закрыта */ }
  }
}

/**
 * Вернуть запомненные cookie в сессию Twitch. Звать после app.whenReady,
 * до окон и плееров. Возвращает число перенесённых.
 */
async function restore(userData, twitchSession, stashed, log = () => {}) {
  if (!stashed) return 0;
  const store = twitchSession.cookies;
  // Если вход в новой базе уже есть (база не обнулилась) — не трогаем
  const existing = await store.get({ url: 'https://www.twitch.tv', name: 'auth-token' }).catch(() => []);
  if (existing.length > 0) {
    writeMarker(userData, { done: true, reason: 'kept', version: stashed.version });
    return 0;
  }
  let restored = 0;
  for (const cookie of stashed.cookies) {
    const hostOnly = !cookie.host.startsWith('.');
    const host = cookie.host.replace(/^\./, '');
    const details = {
      url: (cookie.secure ? 'https://' : 'http://') + host + (cookie.path || '/'),
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite
    };
    if (!hostOnly) details.domain = cookie.host;
    if (cookie.expires) details.expirationDate = cookie.expires;
    try {
      await store.set(details);
      restored++;
    } catch (e) { /* одна cookie не встала — остальные переносим */ }
  }
  await store.flushStore().catch(() => {});
  writeMarker(userData, { done: true, reason: 'restored', version: stashed.version, restored, total: stashed.cookies.length });
  log('[Вход] Перенесено cookie Twitch в новую базу: ' + restored + ' из ' + stashed.cookies.length);
  return restored;
}

module.exports = { stash, restore, cookieDbPath, MARKER };
