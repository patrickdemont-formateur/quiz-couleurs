// Génère le bloc « QUESTIONS » à coller dans gas/Code.gs à partir de data/questions.json.
// Usage : node tools/generer-mapping.js
// À relancer (et à recoller dans Code.gs) à chaque modification de questions.json.
"use strict";
const fs = require('fs'), path = require('path');
const q = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'questions.json'), 'utf8'));
const code = { Rouge: 'R', Jaune: 'J', Vert: 'V', Bleu: 'B' };
const rows = q.questions.map(x => `['${code[x.left.color]}','${code[x.right.color]}']`);
const lines = [];
for (let i = 0; i < rows.length; i += 6) lines.push('  ' + rows.slice(i, i + 6).join(','));
const out = [
  `// === BLOC GÉNÉRÉ PAR tools/generer-mapping.js (questionnaire version ${q.version}) ===`,
  `var QUESTIONNAIRE_VERSION = '${q.version}';`,
  `var QUESTIONS = [ // [couleur de A, couleur de B] pour chaque question, dans l'ordre`,
  lines.join(',\n'),
  `];`,
  `var POINTS_A = ${JSON.stringify(q.scale.leftPoints)};  // position 1..3 -> points pour la couleur de A`,
  `var POINTS_B = ${JSON.stringify(q.scale.rightPoints)};  // position 4..6 -> points pour la couleur de B`,
  `// === FIN DU BLOC GÉNÉRÉ ===`
].join('\n');
console.log(out);
