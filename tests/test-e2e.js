// Test de bout en bout : vraies pages (jsdom) <-> vrai Code.gs (faux Apps Script en mémoire).
"use strict";
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeEnv } = require('./harness');
const ROOT = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const QJSON = read('data/questions.json'), Q = JSON.parse(QJSON);
const API = 'https://script.google.com/macros/s/TEST/exec';
const E = makeEnv(); E.setKey('cle-test');
let n = 0, failNext = 0, lostReply = 0;
const t = async (name, fn) => { try { await fn(); n++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + String(e.stack || e).split('\n').slice(0, 5).join('\n    ')); process.exitCode = 1; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return; } catch (e) { } await sleep(10); } throw new Error('Délai dépassé : ' + label); }

function page(file, url, storage) {
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); }); vc.on('error', m => errors.push(String(m)));
  const dom = new JSDOM(read(file), { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  if (!w.crypto || !w.crypto.getRandomValues) w.crypto = require('crypto').webcrypto;
  w.Element.prototype.scrollIntoView = () => { };
  w.confirm = () => true; w.prompt = () => null;
  (storage || {}).local && Object.entries(storage.local).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.fetch = async (u, o) => {
    if (String(u).includes('data/questions.json')) return { ok: true, json: async () => JSON.parse(QJSON) };
    if (String(u) === API) {
      if (failNext > 0) { failNext--; throw new Error('réseau coupé'); }
      const body = JSON.parse(o.body); const out = E.call(body);
      if (lostReply > 0) { lostReply--; throw new Error('réponse perdue après traitement serveur'); }
      return { ok: true, json: async () => out };
    }
    throw new Error('URL inattendue ' + u);
  };
  w.eval(read('js/config.js').replace(/API_URL: '[^']*'/, "API_URL: '" + API + "'"));
  w.eval(read('js/core.js'));
  if (file === 'formateur.html') w.eval(read('js/vendor-qrcode.js'));
  w.eval(read(file === 'index.html' ? 'js/participant.js' : 'js/formateur.js'));
  w.errors = errors; return w;
}
const visible = (w, id) => !w.document.querySelector(id).hidden;
const adm = (action, p = {}) => E.call(Object.assign({ action, key: 'cle-test' }, p));
const pattern = i => ((i * 5) % 6) + 1;

(async () => {
  const g = adm('groupCreate').group;
  let stored;

  console.log('Parcours participant');
  const w = page('index.html', 'https://x.github.io/app/index.html?g=' + g.code);
  await t('QR scanné : page d\'inscription avec nom du groupe et notice RGPD', async () => {
    await until(() => visible(w, '#viewRegister'), 'vue inscription');
    assert.equal(w.document.querySelector('#groupName').textContent, g.nom);
    assert.match(w.document.querySelector('.privacy').textContent, /7 jours/);
  });
  await t('inscription : arrive sur le questionnaire avec identifiant', async () => {
    w.document.querySelector('#firstName').value = 'Léa'; w.document.querySelector('#regBtn').click();
    await until(() => visible(w, '#viewQuiz'), 'questionnaire');
    assert.match(w.document.querySelector('#whoami').textContent, /Léa.*P-\d{4}/);
    assert.equal(w.document.querySelectorAll('.question').length, 36);
  });
  await t('envoi refusé tant que le questionnaire est incomplet', async () => {
    w.document.querySelector('#resultBtn').click(); await sleep(30);
    assert.match(w.document.querySelector('#error').textContent, /répondre aux questions : 1, 2/);
  });
  await t('saisie des 36 réponses ; brouillon conservé localement', async () => {
    Q.questions.forEach((q, i) => w.document.querySelector(`.dot[data-i="${i}"][data-v="${pattern(i)}"]`).click());
    assert.equal(w.document.querySelector('#progressText').textContent, '36 / 36 réponses');
    assert.equal(JSON.parse(w.localStorage.getItem('profilCouleursV30')).draft.length, 36);
  });
  await t('coupure réseau pendant l\'envoi : message explicite, réponses conservées', async () => {
    failNext = 1; w.document.querySelector('#resultBtn').click();
    await until(() => /Connexion impossible/.test(w.document.querySelector('#error').textContent), 'message réseau');
    assert.equal(w.document.querySelector('#resultBtn').textContent, 'Réessayer l’envoi');
    assert.ok(visible(w, '#viewQuiz'));
  });
  await t('nouvel essai : réussi, sans doublon, passage à l\'attente, brouillon effacé', async () => {
    w.document.querySelector('#resultBtn').click();
    await until(() => visible(w, '#viewWait'), 'vue attente');
    assert.equal(JSON.parse(w.localStorage.getItem('profilCouleursV30')).draft, undefined);
    assert.equal(adm('groupDashboard', { id: g.id }).participants.length, 1);
  });
  await t('avant déblocage : aucun accès à la synthèse', async () => {
    w.document.querySelector('#checkBtn').click();
    await until(() => /pas encore/i.test(w.document.querySelector('#waitError').textContent), 'message pas encore');
    assert.ok(!visible(w, '#viewResult'));
    assert.ok(!/Rouge|score/i.test(w.localStorage.getItem('profilCouleursV30')));   // aucun résultat sur le téléphone
  });
  await t('formateur débloque : le participant voit radar + histogramme + scores corrects', async () => {
    const pid = adm('groupDashboard', { id: g.id }).participants[0].pid;
    assert.ok(adm('release', { id: g.id, pid, value: true }).ok);
    w.document.querySelector('#checkBtn').click();
    await until(() => visible(w, '#viewResult'), 'synthèse');
    const exp = require('../js/core.js').calc(Q.questions.map((_, i) => pattern(i)), Q);
    const shown = [...w.document.querySelectorAll('#scoreGrid .score strong')].map(e => +e.textContent);
    assert.deepEqual(shown, ['Rouge', 'Jaune', 'Vert', 'Bleu'].map(k => exp[k]));
    assert.match(w.document.querySelector('#resultIdentity').textContent, /Léa/);
    assert.ok(w.document.querySelector('#radar') && w.document.querySelector('#histo'));
    assert.equal(w.errors.length, 0, w.errors.join(' | '));
    stored = w.localStorage.getItem('profilCouleursV30');
  });
  await t('réouverture du lien plus tard (même téléphone) : reprise directe sur la synthèse', async () => {
    const w2 = page('index.html', 'https://x.github.io/app/index.html?g=' + g.code, { local: { profilCouleursV30: stored } });
    await until(() => visible(w2, '#viewResult'), 'reprise');
  });
  await t('page sans code et sans jeton : saisie manuelle du code', async () => {
    const w3 = page('index.html', 'https://x.github.io/app/index.html');
    await until(() => visible(w3, '#viewLanding'), 'accueil');
    w3.document.querySelector('#codeInput').value = g.code.toLowerCase(); w3.document.querySelector('#codeBtn').click();
    await until(() => visible(w3, '#viewRegister'), 'inscription via code saisi');
  });
  await t('code inconnu / inscriptions fermées : messages clairs', async () => {
    const w4 = page('index.html', 'https://x.github.io/app/index.html?g=ZZZZZZ');
    await until(() => visible(w4, '#viewMessage'), 'message'); assert.match(w4.document.querySelector('#msgTitle').textContent, /inconnu/i);
    adm('groupSet', { id: g.id, inscriptions: 'non' });
    const w5 = page('index.html', 'https://x.github.io/app/index.html?g=' + g.code);
    await until(() => visible(w5, '#viewMessage'), 'fermé'); assert.match(w5.document.querySelector('#msgTitle').textContent, /fermées/i);
    adm('groupSet', { id: g.id, inscriptions: 'oui' });
  });
  await t('homonyme : second « Léa » reçoit « Léa (2) »', async () => {
    const w6 = page('index.html', 'https://x.github.io/app/index.html?g=' + g.code);
    await until(() => visible(w6, '#viewRegister'), 'inscription'); w6.document.querySelector('#firstName').value = 'Lea'; w6.document.querySelector('#regBtn').click();
    await until(() => visible(w6, '#viewQuiz'), 'quiz'); assert.match(w6.document.querySelector('#whoami').textContent, /Lea \(2\)/);
  });
  await t('inscription avec coupure réseau puis nouvel essai : un seul participant créé', async () => {
    const before = adm('groupDashboard', { id: g.id }).participants.length;
    const w7 = page('index.html', 'https://x.github.io/app/index.html?g=' + g.code);
    await until(() => visible(w7, '#viewRegister'), 'inscription'); w7.document.querySelector('#firstName').value = 'Noé';
    failNext = 1; w7.document.querySelector('#regBtn').click();
    await until(() => /sans risque de doublon/.test(w7.document.querySelector('#regError').textContent), 'erreur réseau');
    w7.document.querySelector('#regBtn').click(); await until(() => visible(w7, '#viewQuiz'), 'quiz');
    assert.equal(adm('groupDashboard', { id: g.id }).participants.length, before + 1);
  });

  await t('RÉPONSE PERDUE après traitement serveur (inscription puis envoi) : nouvel essai sans doublon', async () => {
    const before = adm('groupDashboard', { id: g.id }).participants.length;
    const w10 = page('index.html', 'https://x.github.io/app/index.html?g=' + g.code);
    await until(() => visible(w10, '#viewRegister'), 'inscription'); w10.document.querySelector('#firstName').value = 'Ines';
    lostReply = 1; w10.document.querySelector('#regBtn').click();
    await until(() => /sans risque de doublon/.test(w10.document.querySelector('#regError').textContent), 'erreur réseau');
    assert.equal(adm('groupDashboard', { id: g.id }).participants.length, before + 1);   // le serveur avait bien enregistré
    w10.document.querySelector('#regBtn').click(); await until(() => visible(w10, '#viewQuiz'), 'quiz');
    assert.equal(adm('groupDashboard', { id: g.id }).participants.length, before + 1);   // toujours un seul
    Q.questions.forEach((q, i) => w10.document.querySelector(`.dot[data-i="${i}"][data-v="2"]`).click());
    lostReply = 1; w10.document.querySelector('#resultBtn').click();
    await until(() => /Connexion impossible/.test(w10.document.querySelector('#error').textContent), 'envoi perdu');
    w10.document.querySelector('#resultBtn').click(); await until(() => visible(w10, '#viewWait'), 'attente');
    const ps = adm('groupDashboard', { id: g.id }).participants.filter(p => p.display === 'Ines');
    assert.equal(ps.length, 1); assert.equal(ps[0].status, 'complet');
  });

  console.log('Espace formateur');
  const f = page('formateur.html', 'https://x.github.io/app/formateur.html');
  await t('mauvaise clé refusée, bonne clé acceptée', async () => {
    await until(() => visible(f, '#viewLogin'), 'connexion');
    f.document.querySelector('#keyInput').value = 'mauvaise'; f.document.querySelector('#loginBtn').click();
    await until(() => /incorrecte/.test(f.document.querySelector('#loginError').textContent), 'refus');
    f.document.querySelector('#keyInput').value = 'cle-test'; f.document.querySelector('#loginBtn').click();
    await until(() => visible(f, '#viewGroups'), 'liste des groupes');
    assert.match(f.document.querySelector('#groupsTable tbody').textContent, new RegExp(g.code));
  });
  await t('bandeau de purge : alerte tant que le déclencheur n\'est pas installé, puis OK', async () => {
    assert.match(f.document.querySelector('#purgeBanner1').textContent, /Aucun déclencheur/);
    E.ctx.installer(); E.ctx.purgeAuto();
    f.document.querySelector('#backBtn') && 0;
    f.document.querySelector('#logoutBtn').click(); f.document.querySelector('#keyInput').value = 'cle-test'; f.document.querySelector('#loginBtn').click();
    await until(() => /Purge automatique en service/.test(f.document.querySelector('#purgeBanner1').textContent), 'bandeau OK');
  });
  await t('nouveau groupe : nom automatique, QR code SVG, code, lien d\'inscription', async () => {
    f.document.querySelector('#newGroupBtn').click(); await until(() => visible(f, '#viewGroup'), 'dashboard');
    assert.match(f.document.querySelector('#gName').textContent, /Groupe 2$/);
    assert.ok(f.document.querySelector('#qrSmall svg'));
    const code = f.document.querySelector('#gCode').textContent; assert.match(code, /^[A-Z2-9]{6}$/);
    assert.equal(f.document.querySelector('#gUrl').textContent, 'https://x.github.io/app/index.html?g=' + code);
  });
  await t('ouvrir le groupe 1 : tableau de bord avec participants, compteurs, « complet »', async () => {
    f.document.querySelector('#backBtn').click(); await until(() => visible(f, '#viewGroups'), 'liste');
    f.document.querySelector(`tr[data-id="${g.id}"]`).click(); await until(() => visible(f, '#viewGroup') && f.document.querySelector('#gName').textContent === g.nom, 'groupe 1');
    assert.equal(f.document.querySelector('#kInscrits').textContent, '4'); assert.equal(f.document.querySelector('#kComplets').textContent, '2'); assert.equal(f.document.querySelector('#kDebloques').textContent, '1');
    assert.match(f.document.querySelector('#pTable tbody').textContent, /Léa/);
  });
  await t('détail : qui a répondu quoi (36 lignes), calcul vérifié, radar + histogramme', async () => {
    f.document.querySelector('#pTable tr[data-pid]').click(); await until(() => visible(f, '#modalBg') && f.document.querySelector('.ans-table'), 'détail');
    assert.equal(f.document.querySelectorAll('.ans-table tbody tr').length, 36);
    assert.match(f.document.querySelector('.verif').textContent, /Calcul vérifié/);
    assert.ok(f.document.querySelector('#dRadar') && f.document.querySelector('#dHisto'));
    f.document.querySelector('#modal .close').click(); assert.ok(!visible(f, '#modalBg'));
  });
  await t('mode projection : prénoms masqués (identifiants affichés)', async () => {
    const cb = f.document.querySelector('#maskNames'); cb.checked = true; cb.dispatchEvent(new f.Event('change'));
    assert.ok(!/Léa/.test([...f.document.querySelectorAll('#pTable tbody tr td:first-child')].map(x => x.textContent).join(' ')));
    cb.checked = false; cb.dispatchEvent(new f.Event('change'));
  });
  await t('synthèse collective (annexe) : moyennes et dominantes', async () => {
    assert.match(f.document.querySelector('#collBody').textContent, /2 questionnaire/);
    assert.equal(f.document.querySelectorAll('#collBody tbody tr').length, 4);
  });
  await t('verrouiller / débloquer tout', async () => {
    f.document.querySelector('#lockAllBtn').click(); await until(() => f.document.querySelector('#kDebloques').textContent === '0', 'verrouillé');
    f.document.querySelector('#releaseAllBtn').click(); await until(() => f.document.querySelector('#kDebloques').textContent === '2', 'débloqué (2 complets seulement)');
  });
  await t('fermer les inscriptions, archiver, effacer les données du groupe', async () => {
    f.document.querySelector('#toggleRegBtn').click(); await until(() => /Rouvrir/.test(f.document.querySelector('#toggleRegBtn').textContent), 'fermé');
    f.document.querySelector('#archiveBtn').click(); await until(() => /Réactiver/.test(f.document.querySelector('#archiveBtn').textContent), 'archivé');
    f.document.querySelector('#purgeGroupBtn').click(); await until(() => f.document.querySelector('#kInscrits').textContent === '0', 'données effacées');
    assert.match(f.document.querySelector('#gName').textContent, /Groupe 1$/);
  });
  await t('suppression du groupe : retour à la liste, groupe disparu', async () => {
    f.document.querySelector('#deleteGroupBtn').click(); await until(() => visible(f, '#viewGroups') && !new RegExp(g.code).test(f.document.querySelector('#groupsTable tbody').textContent) , 'groupe supprimé');
  });
  await t('aucune erreur JavaScript levée dans les pages', async () => assert.equal(f.errors.length, 0, f.errors.join(' | ')));

  console.log('Expiration vue du participant');
  await t('après 8 jours sans activité : « données supprimées » et jeton local effacé', async () => {
    const g2 = adm('groupCreate').group;
    const w8 = page('index.html', 'https://x.github.io/app/index.html?g=' + g2.code);
    await until(() => visible(w8, '#viewRegister'), 'inscription'); w8.document.querySelector('#firstName').value = 'Sam'; w8.document.querySelector('#regBtn').click();
    await until(() => visible(w8, '#viewQuiz'), 'quiz'); const st = w8.localStorage.getItem('profilCouleursV30');
    E.advanceDays(8);
    const w9 = page('index.html', 'https://x.github.io/app/index.html?g=' + g2.code, { local: { profilCouleursV30: st } });
    await until(() => visible(w9, '#viewMessage'), 'message'); assert.match(w9.document.querySelector('#msgText').textContent, /supprimées/);
    assert.equal(w9.localStorage.getItem('profilCouleursV30'), null);
  });

  console.log('\n' + n + ' tests de bout en bout réussis' + (process.exitCode ? ' — DES ÉCHECS ONT ÉTÉ DÉTECTÉS' : ''));
})();
