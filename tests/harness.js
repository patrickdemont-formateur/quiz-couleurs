// Charge gas/Code.gs dans un « faux Apps Script » (mémoire) pour tester la logique serveur dans Node.
"use strict";
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function makeEnv() {
  const store = {};                       // PropertiesService (script)
  const cacheStore = {};                  // CacheService
  const mails = [];
  const triggers = [];
  const sheets = {};
  let clock = Date.now();
  let lockBusy = false;

  class Range {
    constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
    getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push((this.sh.rows[this.r - 1 + i] || [])[this.c - 1 + j] ?? ''); o.push(row); } return o; }
    setValues(v) { for (let i = 0; i < v.length; i++) { const R = this.r - 1 + i; this.sh.rows[R] = this.sh.rows[R] || []; for (let j = 0; j < v[i].length; j++) this.sh.rows[R][this.c - 1 + j] = v[i][j]; } return this; }
    setNumberFormat() { return this; }
  }
  class Sheet {
    constructor(n) { this.name = n; this.rows = []; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    getLastRow() { let l = 0; this.rows.forEach((r, i) => { if (r && r.some(x => x !== '' && x !== undefined)) l = i + 1; }); return l; }
    deleteRow(n) { this.rows.splice(n - 1, 1); }
  }
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new Sheet(n))
  };

  const ctx = {
    console, Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } },
    Math, JSON, String, Number, Array, Object, RegExp, Error, parseInt,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
      deleteProperty: k => { delete store[k]; },
      getProperties: () => Object.assign({}, store)
    }) },
    CacheService: { getScriptCache: () => ({
      get: k => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = String(v); },
      remove: k => { delete cacheStore[k]; }
    }) },
    LockService: { getScriptLock: () => ({
      waitLock: () => { if (lockBusy) throw new Error('lock timeout'); lockBusy = true; },
      releaseLock: () => { lockBusy = false; }
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)), // octets signés comme Apps Script
      formatDate: (d, tz, f) => d.toISOString().slice(0, 10),
      getUuid: () => crypto.randomUUID()
    },
    Session: { getScriptTimeZone: () => 'Europe/Paris', getEffectiveUser: () => ({ getEmail: () => 'formateur@example.org' }) },
    MailApp: { sendEmail: (to, s, b) => mails.push({ to, s, b }) },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput: s => ({ content: s, setMimeType() { return this; } })
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ScriptApp: {
      WeekDay: { MONDAY: 'MONDAY' },
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: fn => { const t = { fn, getHandlerFunction: () => fn }; const b = { timeBased: () => b, onWeekDay: () => b, atHour: () => b, create: () => { triggers.push(t); return t; } }; return b; }
    },
    Logger: { log: () => {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });

  const call = (req) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).content);
  return { ctx, store, cacheStore, mails, triggers, sheets, call,
    setKey: k => { store.ADMIN_KEY = k; },
    advanceDays: d => { clock += d * 86400000; },
    nowMs: () => clock,
    lock: b => { lockBusy = b; } };
}
module.exports = { makeEnv };
