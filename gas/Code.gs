/**
 * QUESTIONNAIRE COULEURS – V2 – Serveur Google Apps Script
 * --------------------------------------------------------------------------
 * - Données ADMINISTRATIVES des groupes : feuille « Groupes » (conservables).
 * - Données INDIVIDUELLES (prénom, réponses, résultats) : PropertiesService
 *   (pas d'historique de versions -> la suppression est définitive).
 * - Durée de conservation : 7 jours après l'inscription (CFG.RETENTION_DAYS).
 *   Lecture refusée dès l'expiration ; suppression physique par le déclencheur
 *   hebdomadaire (purgeAuto) et, en filet de sécurité, à l'ouverture de l'espace formateur.
 * - AUCUN journal ne doit contenir de prénom, de réponse ou de score.
 *
 * Mise en place : voir GUIDE.md (propriété ADMIN_KEY, installer(), déploiement web).
 */

var CFG = {
  RETENTION_DAYS: 7,
  SHEET_GROUPES: 'Groupes',
  PREFIX: 'P:',
  MAX_PER_GROUP: 60,
  MAX_TOTAL: 800,
  CODE_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  MAX_FAILS: 8,            // tentatives de clé formateur erronées avant blocage (10 min)
  PURGE_STALE_DAYS: 8      // alerte si la dernière purge a plus de 8 jours
};
var HEAD = ['id', 'code', 'nom', 'creation', 'statut', 'inscriptions'];
var COLORS = { R: 'Rouge', J: 'Jaune', V: 'Vert', B: 'Bleu' };

// === BLOC GÉNÉRÉ PAR tools/generer-mapping.js (questionnaire version 4.0) ===
var QUESTIONNAIRE_VERSION = '4.0';
var QUESTIONS = [ // [couleur de A, couleur de B] pour chaque question, dans l'ordre
  ['V','R'],['V','J'],['J','R'],['B','V'],['J','R'],['R','V'],
  ['J','B'],['R','B'],['V','B'],['B','R'],['V','B'],['V','J'],
  ['R','B'],['B','J'],['B','R'],['R','V'],['R','B'],['R','V'],
  ['B','J'],['B','V'],['J','B'],['R','J'],['J','V'],['B','R'],
  ['J','V'],['V','B'],['R','J'],['B','J'],['R','J'],['B','V'],
  ['V','R'],['J','R'],['J','B'],['J','V'],['V','R'],['V','J']
];
var POINTS_A = {"1":3,"2":2,"3":1};  // position 1..3 -> points pour la couleur de A
var POINTS_B = {"4":1,"5":2,"6":3};  // position 4..6 -> points pour la couleur de B
// === FIN DU BLOC GÉNÉRÉ ===

/* ===================== Point d'entrée web ===================== */

function doGet() {
  return ContentService.createTextOutput('Questionnaire Couleurs V2 - serveur actif')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = handle_(req);
  } catch (err) {
    // On ne journalise jamais le message (il pourrait citer des données saisies).
    console.error('doPost: erreur ' + (err && err.name));
    out = fail_('SERVER', 'Le serveur est momentanément occupé. Réessayez dans quelques secondes.');
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  var a = req && req.action;
  switch (a) {
    // --- participant ---
    case 'groupInfo': return groupInfo_(req);
    case 'register': return register_(req);
    case 'submit': return submit_(req);
    case 'status': return status_(req);
    // --- formateur (clé obligatoire) ---
    case 'adminLogin': case 'groupsList': case 'groupCreate': case 'groupSet': case 'groupDelete':
    case 'groupPurgeData': case 'groupDashboard': case 'participantDetail': case 'release':
    case 'participantDelete': case 'purgeNow':
      var bad = adminCheck_(req.key);
      if (bad) return bad;
      return admin_(a, req);
    default: return fail_('BAD_REQUEST', 'Action inconnue.');
  }
}

function admin_(a, req) {
  switch (a) {
    case 'adminLogin': purgeExpired_(); return ok_({ purge: purgeInfo_() });
    case 'groupsList': purgeExpired_(); return groupsList_();
    case 'groupCreate': return groupCreate_();
    case 'groupSet': return groupSet_(req);
    case 'groupDelete': return groupDelete_(req);
    case 'groupPurgeData': return groupPurgeData_(req);
    case 'groupDashboard': return groupDashboard_(req);
    case 'participantDetail': return participantDetail_(req);
    case 'release': return release_(req);
    case 'participantDelete': return participantDelete_(req);
    case 'purgeNow': return purgeNow_();
  }
  return fail_('BAD_REQUEST', 'Action inconnue.');
}

/* ===================== Utilitaires ===================== */

function ok_(o) { o = o || {}; o.ok = true; return o; }
function fail_(code, message) { return { ok: false, code: code, message: message || code }; }
function props_() { return PropertiesService.getScriptProperties(); }

function hex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) { var b = bytes[i]; if (b < 0) b += 256; s += ('0' + b.toString(16)).slice(-2); }
  return s;
}
function hash_(t) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(t), Utilities.Charset.UTF_8));
}
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function normCode_(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function cleanName_(s) {
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}
function nameKey_(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function randomFrom_(alphabet, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return s;
}

/* ===================== Calcul du profil (identique à core.js) ===================== */

function calcScores_(answers) {
  var s = { Rouge: 0, Jaune: 0, Vert: 0, Bleu: 0 };
  for (var i = 0; i < QUESTIONS.length; i++) {
    var v = answers[i];
    if (v <= 3) s[COLORS[QUESTIONS[i][0]]] += POINTS_A[String(v)];
    else s[COLORS[QUESTIONS[i][1]]] += POINTS_B[String(v)];
  }
  return s;
}

/* ===================== Accès formateur ===================== */

function adminCheck_(key) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= CFG.MAX_FAILS) return fail_('LOCKED', 'Trop de tentatives. Réessayez dans 10 minutes.');
  var real = props_().getProperty('ADMIN_KEY');
  if (!real) return fail_('NOT_CONFIGURED', 'La clé formateur n\'est pas configurée côté serveur (propriété ADMIN_KEY).');
  if (!safeEqual_(hash_(String(key || '')), hash_(real))) {
    cache.put('fails', String(fails + 1), 600);
    return fail_('UNAUTHORIZED', 'Clé incorrecte.');
  }
  if (fails) cache.remove('fails');
  return null;
}

/* ===================== Groupes (feuille « Groupes ») ===================== */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CFG.SHEET_GROUPES);
  if (!sh) {
    sh = ss.insertSheet(CFG.SHEET_GROUPES);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  }
  return sh;
}
function readGroups_() {
  var sh = sheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, HEAD.length).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0]) continue;
    out.push({
      id: String(r[0]), code: String(r[1]), nom: String(r[2]),
      creation: (r[3] instanceof Date) ? r[3].toISOString() : String(r[3]),
      statut: String(r[4]), inscriptions: String(r[5]), row: i + 2
    });
  }
  return out;
}
function writeGroup_(sh, row, g) {
  var rg = sh.getRange(row, 1, 1, HEAD.length);
  rg.setNumberFormat('@');                       // texte : évite toute conversion automatique
  rg.setValues([[g.id, g.code, g.nom, g.creation, g.statut, g.inscriptions]]);
}
function findGroup_(id) {
  var gs = readGroups_();
  for (var i = 0; i < gs.length; i++) if (gs[i].id === String(id)) return gs[i];
  return null;
}
function findGroupByCode_(code) {
  var gs = readGroups_();
  for (var i = 0; i < gs.length; i++) if (gs[i].code === code) return gs[i];
  return null;
}
function publicGroup_(g) {
  return { id: g.id, code: g.code, nom: g.nom, creation: g.creation, statut: g.statut, inscriptions: g.inscriptions };
}

/* ===================== Participants (PropertiesService) ===================== */

function getRec_(pid) {
  var v = props_().getProperty(CFG.PREFIX + pid);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function putRec_(rec) { props_().setProperty(CFG.PREFIX + rec.p, JSON.stringify(rec)); }
function delRec_(pid) { props_().deleteProperty(CFG.PREFIX + pid); }
function allRecs_() {
  var all = props_().getProperties(), out = [];
  for (var k in all) {
    if (k.indexOf(CFG.PREFIX) !== 0) continue;
    try { out.push(JSON.parse(all[k])); } catch (e) { /* entrée corrompue : ignorée ici, supprimée par la purge */ }
  }
  return out;
}
function liveRecs_(groupId) {
  var now = Date.now();
  return allRecs_().filter(function (r) { return r.e > now && (!groupId || r.g === groupId); });
}
function auth_(req) {
  var pid = String(req.pid || ''), token = String(req.token || '');
  if (!/^P-\d{4}$/.test(pid) || !/^[A-Za-z0-9]{24,64}$/.test(token)) return { err: fail_('NOT_FOUND', 'Inscription introuvable.') };
  var rec = getRec_(pid);
  if (!rec || !safeEqual_(rec.h, hash_(token))) return { err: fail_('NOT_FOUND', 'Inscription introuvable.') };
  if (!(rec.e > Date.now())) { delRec_(pid); return { err: fail_('EXPIRED', 'Les données ont été supprimées (durée de conservation dépassée).') }; }
  return { rec: rec };
}

/* ===================== API participant ===================== */

function groupInfo_(req) {
  var g = findGroupByCode_(normCode_(req.code));
  if (!g) return fail_('GROUP_NOT_FOUND', 'Code de groupe inconnu.');
  return ok_({ name: g.nom, open: g.statut === 'actif' && g.inscriptions === 'oui' });
}

function register_(req) {
  var code = normCode_(req.code), token = String(req.token || ''), name = cleanName_(req.prenom);
  if (!/^[A-Za-z0-9]{24,64}$/.test(token)) return fail_('BAD_REQUEST', 'Requête invalide.');
  if (!name) return fail_('BAD_NAME', 'Merci de saisir votre prénom.');
  return withLock_(function () {
    var g = findGroupByCode_(code);
    if (!g) return fail_('GROUP_NOT_FOUND', 'Code de groupe inconnu.');
    var h = hash_(token), now = Date.now(), live = liveRecs_();
    // Rejeu d'une inscription déjà enregistrée (réponse perdue) : on renvoie l'existante, pas de doublon.
    for (var i = 0; i < live.length; i++) {
      if (live[i].h === h) {
        if (live[i].g !== g.id) return fail_('BAD_REQUEST', 'Requête invalide.');
        return ok_({ pid: live[i].p, display: live[i].d, expiresAt: live[i].e, groupName: g.nom, status: live[i].s });
      }
    }
    if (g.statut !== 'actif' || g.inscriptions !== 'oui') return fail_('REGISTRATION_CLOSED', 'Les inscriptions sont fermées pour ce groupe.');
    var inGroup = live.filter(function (r) { return r.g === g.id; });
    if (inGroup.length >= CFG.MAX_PER_GROUP) return fail_('CAPACITY', 'Ce groupe est complet.');
    if (live.length >= CFG.MAX_TOTAL) return fail_('CAPACITY', 'Capacité du serveur atteinte. Prévenez votre formateur.');
    // Homonymes : « Marie », « Marie (2) », « Marie (3) »...
    var taken = {};
    inGroup.forEach(function (r) { taken[nameKey_(r.d)] = true; });
    var display = name, n = 2;
    while (taken[nameKey_(display)]) { display = name + ' (' + n + ')'; n++; }
    // Identifiant technique unique
    var used = {};
    allRecs_().forEach(function (r) { used[r.p] = true; });
    var pid;
    do { pid = 'P-' + (1000 + Math.floor(Math.random() * 9000)); } while (used[pid]);
    var rec = { p: pid, g: g.id, n: name, d: display, h: h, c: now, e: now + CFG.RETENTION_DAYS * 86400000, s: 'inscrit', rel: false };
    putRec_(rec);
    return ok_({ pid: pid, display: display, expiresAt: rec.e, groupName: g.nom, status: 'inscrit' });
  });
}

function submit_(req) {
  var au = auth_(req);
  if (au.err) return au.err;
  var rec = au.rec, a = req.answers;
  if (!Array.isArray(a) || a.length !== QUESTIONS.length) return fail_('BAD_REQUEST', 'Réponses incomplètes.');
  for (var i = 0; i < a.length; i++) {
    if (typeof a[i] !== 'number' || a[i] % 1 !== 0 || a[i] < 1 || a[i] > 6) return fail_('BAD_REQUEST', 'Réponse invalide à la question ' + (i + 1) + '.');
  }
  var str = a.join('');
  if (rec.s === 'complet') {
    if (rec.a === str) return ok_({ status: 'complet' });          // rejeu : pas de doublon
    if (rec.rel) return fail_('LOCKED', 'Votre synthèse a déjà été débloquée : les réponses ne peuvent plus être modifiées.');
  }
  rec.a = str;
  rec.sc = calcScores_(a);
  rec.s = 'complet';
  rec.v = Date.now();
  rec.qv = QUESTIONNAIRE_VERSION;
  putRec_(rec);
  return ok_({ status: 'complet' });
}

function status_(req) {
  var au = auth_(req);
  if (au.err) return au.err;
  var rec = au.rec, g = findGroup_(rec.g);
  var out = { pid: rec.p, display: rec.d, status: rec.s, released: !!rec.rel, expiresAt: rec.e, groupName: g ? g.nom : '' };
  if (rec.rel && rec.s === 'complet') out.scores = rec.sc;           // jamais avant le déblocage
  return ok_(out);
}

/* ===================== API formateur ===================== */

function groupsList_() {
  var live = liveRecs_(), counts = {};
  live.forEach(function (r) {
    var c = counts[r.g] || (counts[r.g] = { inscrits: 0, complets: 0 });
    c.inscrits++; if (r.s === 'complet') c.complets++;
  });
  var gs = readGroups_().map(function (g) {
    var o = publicGroup_(g), c = counts[g.id] || { inscrits: 0, complets: 0 };
    o.inscrits = c.inscrits; o.complets = c.complets;
    return o;
  });
  gs.sort(function (a, b) { return a.creation < b.creation ? 1 : -1; });
  return ok_({ groups: gs, purge: purgeInfo_() });
}

function groupCreate_() {
  return withLock_(function () {
    var sh = sheet_(), gs = readGroups_();
    var day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var names = {}, codes = {};
    gs.forEach(function (g) { names[g.nom] = true; codes[g.code] = true; });
    var n = 1;
    while (names[day + ' – Groupe ' + n]) n++;
    var code;
    do { code = randomFrom_(CFG.CODE_ALPHABET, 6); } while (codes[code]);
    var g = { id: 'G' + randomFrom_('abcdefghjkmnpqrstuvwxyz23456789', 8), code: code, nom: day + ' – Groupe ' + n,
              creation: new Date().toISOString(), statut: 'actif', inscriptions: 'oui' };
    writeGroup_(sh, sh.getLastRow() + 1, g);
    return ok_({ group: publicGroup_(g) });
  });
}

function groupSet_(req) {
  return withLock_(function () {
    var g = findGroup_(req.id);
    if (!g) return fail_('NOT_FOUND', 'Groupe introuvable.');
    if (req.statut !== undefined) {
      if (req.statut !== 'actif' && req.statut !== 'archive') return fail_('BAD_REQUEST', 'Statut invalide.');
      g.statut = req.statut;
      if (g.statut === 'archive') g.inscriptions = 'non';
    }
    if (req.inscriptions !== undefined) {
      if (req.inscriptions !== 'oui' && req.inscriptions !== 'non') return fail_('BAD_REQUEST', 'Valeur invalide.');
      if (req.inscriptions === 'oui' && g.statut !== 'actif') return fail_('BAD_REQUEST', 'Réactivez le groupe avant de rouvrir les inscriptions.');
      g.inscriptions = req.inscriptions;
    }
    writeGroup_(sheet_(), g.row, g);
    return ok_({ group: publicGroup_(g) });
  });
}

function groupDelete_(req) {
  return withLock_(function () {
    var g = findGroup_(req.id);
    if (!g) return fail_('NOT_FOUND', 'Groupe introuvable.');
    var n = deleteGroupRecs_(g.id);
    sheet_().deleteRow(g.row);
    return ok_({ deletedParticipants: n });
  });
}

function deleteGroupRecs_(groupId) {
  var n = 0;
  allRecs_().forEach(function (r) { if (r.g === groupId) { delRec_(r.p); n++; } });
  return n;
}

function groupPurgeData_(req) {
  return withLock_(function () {
    var g = findGroup_(req.id);
    if (!g) return fail_('NOT_FOUND', 'Groupe introuvable.');
    return ok_({ deletedParticipants: deleteGroupRecs_(g.id) });
  });
}

function groupDashboard_(req) {
  var g = findGroup_(req.id);
  if (!g) return fail_('NOT_FOUND', 'Groupe introuvable.');
  var recs = liveRecs_(g.id).sort(function (a, b) { return a.c - b.c; });
  var list = recs.map(function (r) {
    var o = { pid: r.p, display: r.d, status: r.s, released: !!r.rel, createdAt: r.c, validatedAt: r.v || null, expiresAt: r.e };
    if (r.s === 'complet') o.scores = r.sc;
    return o;
  });
  return ok_({ group: publicGroup_(g), participants: list, purge: purgeInfo_(), serverNow: Date.now() });
}

function participantDetail_(req) {
  var rec = getRec_(String(req.pid || ''));
  if (!rec || rec.g !== String(req.id) || !(rec.e > Date.now())) return fail_('NOT_FOUND', 'Participant introuvable.');
  var out = { pid: rec.p, display: rec.d, status: rec.s, released: !!rec.rel, createdAt: rec.c, validatedAt: rec.v || null, expiresAt: rec.e, version: rec.qv || null };
  if (rec.s === 'complet') {
    out.answers = rec.a.split('').map(Number);
    out.scores = rec.sc;
  }
  return ok_(out);
}

function release_(req) {
  return withLock_(function () {
    var g = findGroup_(req.id);
    if (!g) return fail_('NOT_FOUND', 'Groupe introuvable.');
    var value = req.value !== false, n = 0;
    if (req.scope === 'all') {
      liveRecs_(g.id).forEach(function (r) {
        if (value && r.s !== 'complet') return;       // « Débloquer tous » ne concerne que les questionnaires complets
        if (!!r.rel !== value) { r.rel = value; putRec_(r); n++; }
      });
      return ok_({ changed: n });
    }
    var rec = getRec_(String(req.pid || ''));
    if (!rec || rec.g !== g.id || !(rec.e > Date.now())) return fail_('NOT_FOUND', 'Participant introuvable.');
    if (value && rec.s !== 'complet') return fail_('NOT_COMPLETE', 'Ce participant n\'a pas encore validé son questionnaire.');
    rec.rel = value; putRec_(rec);
    return ok_({ changed: 1 });
  });
}

function participantDelete_(req) {
  return withLock_(function () {
    var rec = getRec_(String(req.pid || ''));
    if (!rec || rec.g !== String(req.id)) return fail_('NOT_FOUND', 'Participant introuvable.');
    delRec_(rec.p);
    return ok_({});
  });
}

/* ===================== Purge automatique ===================== */

/** Supprime toute entrée individuelle expirée (ou illisible). Retourne le nombre supprimé. */
function purgeExpired_() {
  var p = props_(), all = p.getProperties(), now = Date.now(), deleted = 0;
  for (var k in all) {
    if (k.indexOf(CFG.PREFIX) !== 0) continue;
    var rec = null;
    try { rec = JSON.parse(all[k]); } catch (e) { rec = null; }
    if (!rec || !(rec.e > now)) { p.deleteProperty(k); deleted++; }
  }
  return deleted;
}

/** Fonction appelée par le déclencheur hebdomadaire. */
function purgeAuto() {
  try {
    var n = purgeExpired_();
    p_setLast_({ at: Date.now(), deleted: n, ok: true });
  } catch (e) {
    p_setLast_({ at: Date.now(), deleted: 0, ok: false });
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Questionnaire Couleurs : échec de la purge automatique',
        'La purge hebdomadaire des données individuelles a échoué. Ouvrez l\'éditeur Apps Script et lancez testerPurge().');
    } catch (e2) { /* rien de plus à faire */ }
  }
}
function p_setLast_(o) { props_().setProperty('LAST_PURGE', JSON.stringify(o)); }

function purgeNow_() {
  var n = purgeExpired_();
  p_setLast_({ at: Date.now(), deleted: n, ok: true });
  return ok_({ deleted: n, purge: purgeInfo_() });
}

function purgeInfo_() {
  var last = null, trig = null;
  try { last = JSON.parse(props_().getProperty('LAST_PURGE') || 'null'); } catch (e) { last = null; }
  try {
    trig = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'purgeAuto'; });
  } catch (e) { trig = null; }
  var now = Date.now();
  var expiredLeft = allRecs_().filter(function (r) { return !(r.e > now); }).length;
  return {
    lastAt: last ? last.at : null, lastDeleted: last ? last.deleted : null, lastOk: last ? last.ok : null,
    triggerOk: trig, expiredLeft: expiredLeft, retentionDays: CFG.RETENTION_DAYS,
    staleAfterDays: CFG.PURGE_STALE_DAYS
  };
}

/* ===================== Installation et vérifications (à lancer depuis l'éditeur) ===================== */

/** À lancer UNE fois : crée la feuille « Groupes » et le déclencheur hebdomadaire de purge. */
function installer() {
  if (!props_().getProperty('ADMIN_KEY')) {
    throw new Error('Définissez d\'abord la propriété de script ADMIN_KEY (Paramètres du projet > Propriétés du script).');
  }
  sheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'purgeAuto') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('purgeAuto').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
  Logger.log('Installation terminée : feuille « Groupes » prête, purge automatique chaque lundi vers 3 h.');
}

/** Contrôle l'état du dispositif de purge (sans données personnelles). */
function verifierPurge() {
  var i = purgeInfo_();
  Logger.log('Déclencheur de purge présent : ' + i.triggerOk);
  Logger.log('Dernière purge : ' + (i.lastAt ? new Date(i.lastAt).toISOString() : 'jamais') + ' (supprimés : ' + i.lastDeleted + ', succès : ' + i.lastOk + ')');
  Logger.log('Enregistrements expirés encore présents : ' + i.expiredLeft);
  return i;
}

/**
 * Test de bout en bout de la purge : crée 3 enregistrements factices déjà expirés (dont un illisible)
 * et 1 enregistrement valide, lance la purge, vérifie le résultat, puis nettoie.
 */
function testerPurge() {
  var p = props_(), now = Date.now(), jour = 86400000;
  p.setProperty(CFG.PREFIX + 'P-T001', JSON.stringify({ p: 'P-T001', g: 'TEST', d: 'Test', h: 'x', c: now - 9 * jour, e: now - 2 * jour, s: 'complet' }));
  p.setProperty(CFG.PREFIX + 'P-T002', JSON.stringify({ p: 'P-T002', g: 'TEST', d: 'Test', h: 'x', c: now - 30 * jour, e: now - 23 * jour, s: 'inscrit' }));
  p.setProperty(CFG.PREFIX + 'P-T003', '{illisible');
  p.setProperty(CFG.PREFIX + 'P-T004', JSON.stringify({ p: 'P-T004', g: 'TEST', d: 'Test', h: 'x', c: now, e: now + 7 * jour, s: 'inscrit' }));
  purgeAuto();
  var restant = [1, 2, 3, 4].map(function (n) { return p.getProperty(CFG.PREFIX + 'P-T00' + n) !== null; });
  var attendu = [false, false, false, true];
  var reussi = JSON.stringify(restant) === JSON.stringify(attendu);
  p.deleteProperty(CFG.PREFIX + 'P-T004');
  Logger.log(reussi ? 'TEST PURGE : RÉUSSI (3 entrées expirées supprimées, l\'entrée valide conservée).'
                    : 'TEST PURGE : ÉCHEC ' + JSON.stringify(restant));
  verifierPurge();
  return reussi;
}
