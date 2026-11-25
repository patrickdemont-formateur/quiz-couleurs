// Parité du calcul client (core.js, V1) / serveur (Code.gs) + gestion des ex æquo.
"use strict";
const assert = require('assert'), Core = require('../js/core.js'), { makeEnv } = require('./harness');
const Q = require('../data/questions.json'), E = makeEnv();
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; } };
const same = (a, b) => ['Rouge', 'Jaune', 'Vert', 'Bleu'].every(k => a[k] === b[k]);

t('2000 jeux de réponses aléatoires : scores identiques client / serveur', () => {
  for (let i = 0; i < 2000; i++) { const a = Q.questions.map(() => 1 + Math.floor(Math.random() * 6)); assert.ok(same(Core.calc(a, Q), E.ctx.calcScores_(a)), JSON.stringify(a)); }
});
t('cas limites : tout 1, tout 6, alternance', () => {
  [Q.questions.map(() => 1), Q.questions.map(() => 6), Q.questions.map((_, i) => (i % 2 ? 1 : 6))].forEach(a => assert.ok(same(Core.calc(a, Q), E.ctx.calcScores_(a))));
});
t('chaque couleur apparaît 18 fois (conception équilibrée de la V1 préservée)', () => {
  const c = { Rouge: 0, Jaune: 0, Vert: 0, Bleu: 0 }; Q.questions.forEach(q => { c[q.left.color]++; c[q.right.color]++; });
  assert.deepEqual(c, { Rouge: 18, Jaune: 18, Vert: 18, Bleu: 18 });
});
t('total des points : entre 36 et 108', () => { const lo = Core.calc(Q.questions.map(() => 3), Q), hi = Core.calc(Q.questions.map(() => 1), Q); const s = o => Object.values(o).reduce((a, b) => a + b, 0); assert.equal(s(lo), 36); assert.equal(s(hi), 108); });
t('sans ex æquo : texte de lecture identique à la V1', () => {
  const a = Core.analyse({ Rouge: 30, Jaune: 20, Vert: 15, Bleu: 10 });
  assert.equal(Core.readingText(a), 'Le profil fait ressortir une préférence dominante Rouge et une tendance secondaire Jaune. L’écart est de 10 point(s).');
  assert.equal(Core.dominanceHtml(a).replace(/<[^>]+>/g, ''), 'Dominante : Rouge · Secondaire : Jaune');
});
t('ex æquo en tête : les deux couleurs sont annoncées', () => {
  const a = Core.analyse({ Rouge: 25, Jaune: 25, Vert: 15, Bleu: 10 });
  assert.deepEqual(a.dominant, ['Rouge', 'Jaune']); assert.deepEqual(a.secondary, ['Vert']);
  assert.match(Core.readingText(a), /plusieurs préférences dominantes à égalité : Rouge et Jaune.*Vert.*10 point/);
  assert.match(Core.dominanceHtml(a).replace(/<[^>]+>/g, ''), /Dominantes \(ex æquo\) : Rouge et Jaune · Secondaire : Vert/);
});
t('ex æquo en seconde position, trois en tête, quatre à égalité', () => {
  assert.match(Core.readingText(Core.analyse({ Rouge: 30, Jaune: 20, Vert: 20, Bleu: 10 })), /dominante Rouge et des tendances secondaires à égalité : Jaune et Vert/);
  assert.deepEqual(Core.analyse({ Rouge: 20, Jaune: 20, Vert: 20, Bleu: 5 }).dominant, ['Rouge', 'Jaune', 'Vert']);
  assert.match(Core.readingText(Core.analyse({ Rouge: 18, Jaune: 18, Vert: 18, Bleu: 18 })), /parfaitement équilibré/);
});
t('fréquence des ex æquo sur 20 000 profils aléatoires (information)', () => {
  let ties = 0; for (let i = 0; i < 20000; i++) { const a = Q.questions.map(() => 1 + Math.floor(Math.random() * 6)); if (Core.analyse(Core.calc(a, Q)).dominant.length > 1) ties++; }
  console.log('    → ' + (100 * ties / 20000).toFixed(1) + ' % des profils aléatoires ont au moins deux couleurs en tête');
});
console.log('\n' + n + ' tests réussis');
