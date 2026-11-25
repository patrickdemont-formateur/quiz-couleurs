"use strict";
const assert = require('assert'), { makeEnv } = require('./harness');
const Q = require('../data/questions.json');
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); process.exitCode = 1; } };
const tok = () => { const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 24; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
const ans = (f) => Array.from({ length: 36 }, (_, i) => f(i));

const E = makeEnv(); E.setKey('cle-formateur-test');
const A = (action, p = {}) => E.call(Object.assign({ action, key: 'cle-formateur-test' }, p));

console.log('Accès formateur');
t('refuse sans clé / mauvaise clé', () => { assert.equal(E.call({ action: 'groupsList' }).code, 'UNAUTHORIZED'); assert.equal(E.call({ action: 'groupsList', key: 'x' }).code, 'UNAUTHORIZED'); });
t('accepte la bonne clé', () => assert.ok(A('adminLogin').ok));
t('verrouille après 8 échecs, puis la bonne clé reste refusée (10 min)', () => {
  for (let i = 0; i < 8; i++) E.call({ action: 'groupsList', key: 'zz' });
  assert.equal(A('groupsList').code, 'LOCKED');
  delete E.cacheStore.fails;            // simule l'expiration du cache (10 min)
  assert.ok(A('groupsList').ok);
});
t('clé non configurée', () => { const E2 = makeEnv(); assert.equal(E2.call({ action: 'groupsList', key: 'a' }).code, 'NOT_CONFIGURED'); });

console.log('Groupes');
let g1, g2;
t('création : nom automatique, code 6 car., unicité', () => {
  g1 = A('groupCreate').group; g2 = A('groupCreate').group;
  assert.match(g1.nom, /^\d{4}-\d{2}-\d{2} – Groupe 1$/); assert.match(g2.nom, /Groupe 2$/);
  assert.match(g1.code, /^[A-HJKMNP-Z2-9]{6}$/); assert.notEqual(g1.code, g2.code);
  assert.equal(g1.statut, 'actif'); assert.equal(g1.inscriptions, 'oui');
});
t('liste des groupes', () => assert.equal(A('groupsList').groups.length, 2));
t('groupInfo public', () => { const r = E.call({ action: 'groupInfo', code: g1.code.toLowerCase() }); assert.ok(r.ok && r.open && r.name === g1.nom); assert.equal(E.call({ action: 'groupInfo', code: 'ZZZZZZ' }).code, 'GROUP_NOT_FOUND'); });

console.log('Inscription');
const P = {};   // participants de test
const reg = (g, prenom, token = tok()) => ({ r: E.call({ action: 'register', code: g.code, prenom, token }), token });
t('inscription : identifiant technique P-xxxx', () => { const x = reg(g1, 'Marie'); assert.ok(x.r.ok); assert.match(x.r.pid, /^P-\d{4}$/); assert.equal(x.r.display, 'Marie'); P.marie = { pid: x.r.pid, token: x.token }; });
t('homonymes : Marie (2), marie accent/casse (3)', () => { const x = reg(g1, ' MARIE '); assert.equal(x.r.display, 'MARIE (2)'); P.marie2 = { pid: x.r.pid, token: x.token }; const y = reg(g1, 'Marié'); assert.equal(y.r.display, 'Marié (3)'); });
t('même prénom dans un AUTRE groupe : pas de suffixe', () => { assert.equal(reg(g2, 'Marie').r.display, 'Marie'); });
t('rejeu (même jeton) : pas de doublon, même identifiant', () => { const x = reg(g1, 'Paul'); const y = E.call({ action: 'register', code: g1.code, prenom: 'Paul', token: x.token }); assert.equal(y.pid, x.r.pid); assert.equal(A('groupDashboard', { id: g1.id }).participants.filter(p => p.display === 'Paul').length, 1); P.paul = { pid: x.r.pid, token: x.token }; });
t('prénom vide / nettoyé', () => { assert.equal(reg(g1, '   ').r.code, 'BAD_NAME'); assert.equal(reg(g1, '<b>Zoé</b>').r.display, 'bZoé/b'); });
t('jeton trop court refusé', () => assert.equal(E.call({ action: 'register', code: g1.code, prenom: 'X', token: 'court' }).code, 'BAD_REQUEST'));
t('inscriptions fermées : refus, mais rejeu autorisé', () => {
  assert.ok(A('groupSet', { id: g1.id, inscriptions: 'non' }).ok);
  assert.equal(reg(g1, 'Tardif').r.code, 'REGISTRATION_CLOSED');
  assert.equal(E.call({ action: 'register', code: g1.code, prenom: 'Paul', token: P.paul.token }).pid, P.paul.pid);
  assert.ok(A('groupSet', { id: g1.id, inscriptions: 'oui' }).ok);
});
t('limite de groupe', () => { const E3 = makeEnv(); E3.setKey('k'); const g = E3.call({ action: 'groupCreate', key: 'k' }).group; let last; for (let i = 0; i < 61; i++) last = E3.call({ action: 'register', code: g.code, prenom: 'P' + i, token: tok() }); assert.equal(last.code, 'CAPACITY'); });

console.log('Questionnaire');
const toks = Q.questions;
t('refuse un envoi incomplet / valeur hors échelle / mauvais jeton', () => {
  assert.equal(E.call({ action: 'submit', ...P.marie, answers: [1, 2] }).code, 'BAD_REQUEST');
  assert.equal(E.call({ action: 'submit', ...P.marie, answers: ans(() => 7) }).code, 'BAD_REQUEST');
  assert.equal(E.call({ action: 'submit', ...P.marie, answers: ans(() => 2.5) }).code, 'BAD_REQUEST');
  assert.equal(E.call({ action: 'submit', pid: P.marie.pid, token: tok(), answers: ans(() => 1) }).code, 'NOT_FOUND');
});
t('envoi valide : le serveur recalcule le profil', () => {
  const a = ans(i => (i % 6) + 1);
  assert.ok(E.call({ action: 'submit', ...P.marie, answers: a }).ok);
  const d = A('participantDetail', { id: g1.id, pid: P.marie.pid });
  assert.deepEqual(d.answers, a);
  const exp = { Rouge: 0, Jaune: 0, Vert: 0, Bleu: 0 };
  toks.forEach((q, i) => { const v = a[i]; if (v <= 3) exp[q.left.color] += 4 - v; else exp[q.right.color] += v - 3; });
  assert.deepEqual(d.scores, exp);
});
t('rejeu du même envoi : ok, sans doublon', () => assert.ok(E.call({ action: 'submit', ...P.marie, answers: ans(i => (i % 6) + 1) }).ok));
t('renvoi modifié avant déblocage : accepté', () => assert.ok(E.call({ action: 'submit', ...P.marie, answers: ans(() => 1) }).ok));

console.log('Déblocage et isolation');
t('avant déblocage : aucun score renvoyé au participant', () => { const s = E.call({ action: 'status', ...P.marie }); assert.ok(s.ok); assert.equal(s.status, 'complet'); assert.equal(s.released, false); assert.equal(s.scores, undefined); assert.equal(JSON.stringify(s).includes('Rouge'), false); });
t('déblocage individuel', () => { assert.ok(A('release', { id: g1.id, pid: P.marie.pid, value: true }).ok); const s = E.call({ action: 'status', ...P.marie }); assert.ok(s.released && s.scores); });
t('un participant ne voit que sa propre synthèse (jeton d\'un autre refusé)', () => { assert.equal(E.call({ action: 'status', pid: P.marie.pid, token: P.paul.token }).code, 'NOT_FOUND'); });
t('modification interdite après déblocage', () => assert.equal(E.call({ action: 'submit', ...P.marie, answers: ans(() => 6) }).code, 'LOCKED'));
t('« Débloquer tous » ne touche que les questionnaires complets', () => {
  E.call({ action: 'submit', ...P.paul, answers: ans(() => 3) });
  const r = A('release', { id: g1.id, scope: 'all', value: true });
  assert.ok(r.ok);
  const d = A('groupDashboard', { id: g1.id }).participants;
  d.forEach(p => assert.equal(p.released, p.status === 'complet'));
  assert.equal(A('release', { id: g1.id, pid: P.marie2.pid, value: true }).code, 'NOT_COMPLETE');
});
t('verrouiller tous', () => { A('release', { id: g1.id, scope: 'all', value: false }); assert.ok(A('groupDashboard', { id: g1.id }).participants.every(p => !p.released)); assert.equal(E.call({ action: 'status', ...P.paul }).scores, undefined); });
t('détail participant : refusé depuis un autre groupe', () => assert.equal(A('participantDetail', { id: g2.id, pid: P.marie.pid }).code, 'NOT_FOUND'));
t('tableau de bord : compteurs, aucun jeton ni empreinte exposés', () => { const d = A('groupDashboard', { id: g1.id }); const s = JSON.stringify(d); assert.ok(!/"h"|token|hash/i.test(s)); assert.ok(d.participants.length >= 4); });
t('suppression d\'un participant', () => { const x = reg(g1, 'Jetable'); assert.ok(A('participantDelete', { id: g1.id, pid: x.r.pid }).ok); assert.equal(E.call({ action: 'status', pid: x.r.pid, token: x.token }).code, 'NOT_FOUND'); });

console.log('Archivage et suppression de groupe');
t('archiver : inscriptions fermées, ligne administrative conservée', () => { const r = A('groupSet', { id: g2.id, statut: 'archive' }); assert.equal(r.group.statut, 'archive'); assert.equal(r.group.inscriptions, 'non'); assert.equal(A('groupSet', { id: g2.id, inscriptions: 'oui' }).code, 'BAD_REQUEST'); });
t('réactiver ne rouvre pas les inscriptions', () => { const r = A('groupSet', { id: g2.id, statut: 'actif' }); assert.equal(r.group.statut, 'actif'); assert.equal(r.group.inscriptions, 'non'); });
t('effacer les données individuelles d\'un groupe (la ligne reste)', () => { const before = A('groupDashboard', { id: g2.id }).participants.length; assert.ok(before > 0); assert.equal(A('groupPurgeData', { id: g2.id }).deletedParticipants, before); assert.equal(A('groupDashboard', { id: g2.id }).participants.length, 0); assert.equal(A('groupsList').groups.length, 2); });
t('supprimer un groupe supprime ses participants', () => { const g3 = A('groupCreate').group; const x = reg(g3, 'Eva'); E.call({ action: 'submit', pid: x.r.pid, token: x.token, answers: ans(() => 2) }); assert.ok(A('groupDelete', { id: g3.id }).ok); assert.equal(E.call({ action: 'status', pid: x.r.pid, token: x.token }).code, 'NOT_FOUND'); assert.ok(!Object.keys(E.store).some(k => k.startsWith('P:') && JSON.parse(E.store[k]).g === g3.id)); });

console.log('Purge et durée de conservation');
t('installer() : feuille + déclencheur hebdomadaire unique (idempotent)', () => { E.ctx.installer(); E.ctx.installer(); assert.equal(E.triggers.length, 1); assert.equal(E.triggers[0].fn, 'purgeAuto'); });
t('testerPurge() réussit', () => assert.equal(E.ctx.testerPurge(), true));
t('à J+6 : données accessibles', () => { E.advanceDays(6); assert.ok(E.call({ action: 'status', ...P.marie }).ok); });
t('à J+8 : accès refusé (EXPIRED) et données supprimées — sans aucune activité formateur', () => {
  E.advanceDays(2);
  assert.equal(E.call({ action: 'status', ...P.paul }).code, 'EXPIRED');
  assert.equal(E.call({ action: 'status', ...P.paul }).code, 'NOT_FOUND');   // déjà supprimé
});
t('purge hebdomadaire (déclencheur) supprime tout ce qui est expiré, sans toucher aux groupes', () => {
  const avant = Object.keys(E.store).filter(k => k.startsWith('P:')).length;
  assert.ok(avant > 0);
  E.ctx.purgeAuto();
  assert.equal(Object.keys(E.store).filter(k => k.startsWith('P:')).length, 0);
  const info = JSON.parse(E.store.LAST_PURGE); assert.ok(info.ok && info.deleted === avant);
  assert.equal(A('groupsList').groups.length, 2);
});
t('plus aucune donnée individuelle nulle part (propriétés, cache)', () => {
  const dump = JSON.stringify(E.store) + JSON.stringify(E.cacheStore);
  assert.ok(!/Marie|Paul|"a":"|"sc"/.test(dump));
});
t('échec de purge : e-mail d\'alerte + statut en échec', () => {
  const E4 = makeEnv(); E4.setKey('k');
  const orig = E4.ctx.PropertiesService.getScriptProperties;
  let calls = 0;
  E4.ctx.PropertiesService.getScriptProperties = () => { const p = orig(); return { ...p, getProperties: () => { if (calls++ === 0) throw new Error('panne'); return p.getProperties(); } }; };
  E4.ctx.purgeAuto();
  assert.equal(E4.mails.length, 1); assert.equal(JSON.parse(E4.store.LAST_PURGE).ok, false);
});
t('ouverture de l\'espace formateur : purge opportuniste', () => {
  const E5 = makeEnv(); E5.setKey('k'); const g = E5.call({ action: 'groupCreate', key: 'k' }).group;
  const x = E5.call({ action: 'register', code: g.code, prenom: 'Lou', token: tok() });
  E5.advanceDays(8);
  assert.ok(Object.keys(E5.store).some(k => k.startsWith('P:')));
  E5.call({ action: 'groupsList', key: 'k' });
  assert.ok(!Object.keys(E5.store).some(k => k.startsWith('P:')));
});

console.log('\n' + n + ' tests réussis' + (process.exitCode ? ' — DES ÉCHECS ONT ÉTÉ DÉTECTÉS' : ''));
