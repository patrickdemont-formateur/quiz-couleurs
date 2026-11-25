"use strict";
/* Noyau commun participant / formateur : calcul, analyse, graphiques, appels au serveur.
   Le calcul (calc) est celui de la V1, inchangé. */
(function (root) {
  var HEX = { Rouge: '#d93b3b', Jaune: '#e5ad00', Vert: '#2d9b69', Bleu: '#2f6fc2' };
  var NAMES = ['Rouge', 'Jaune', 'Vert', 'Bleu'];
  var SANS = 'Segoe UI, Arial, sans-serif';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fr(n, d) { return Number(n).toFixed(d || 0).replace('.', ','); }

  /* ---------- Calcul (identique V1) ---------- */
  function calc(answers, qcfg) {
    var s = { Rouge: 0, Jaune: 0, Vert: 0, Bleu: 0 }, z = qcfg.scale;
    qcfg.questions.forEach(function (q, i) {
      var v = answers[i];
      if (v <= 3) s[q.left.color] += Number(z.leftPoints[String(v)]);
      else s[q.right.color] += Number(z.rightPoints[String(v)]);
    });
    return s;
  }

  /* ---------- Analyse : dominante / secondaire, avec gestion des ex æquo ---------- */
  function analyse(scores) {
    var rows = NAMES.map(function (k) { return { name: k, score: scores[k] }; })
      .sort(function (a, b) { return b.score - a.score; });
    var total = rows.reduce(function (t, r) { return t + r.score; }, 0) || 1;
    var max = rows[0].score;
    var dominant = rows.filter(function (r) { return r.score === max; }).map(function (r) { return r.name; });
    var rest = rows.filter(function (r) { return r.score < max; });
    var secondary = rest.length ? rest.filter(function (r) { return r.score === rest[0].score; }).map(function (r) { return r.name; }) : [];
    return { rows: rows, total: total, dominant: dominant, secondary: secondary, gap: rest.length ? max - rest[0].score : 0 };
  }
  function joinNames(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' et ' + a[a.length - 1]; }
  function colored(name) { return '<strong style="color:' + HEX[name] + '">' + name + '</strong>'; }

  function dominanceHtml(a) {
    if (a.dominant.length === 4) return 'Profil équilibré : les quatre couleurs sont à égalité';
    var d = a.dominant.map(colored).join(' et ');
    var out = (a.dominant.length > 1 ? 'Dominantes (ex æquo) : ' : 'Dominante : ') + d;
    if (a.secondary.length) out += ' · ' + (a.secondary.length > 1 ? 'Secondaires (ex æquo) : ' : 'Secondaire : ') + a.secondary.map(colored).join(' et ');
    return out;
  }
  function dominanceText(a) {      // version texte brut (PDF)
    if (a.dominant.length === 4) return 'Profil equilibre : les quatre couleurs sont a egalite';
    var out = (a.dominant.length > 1 ? 'Dominantes (ex aequo) : ' : 'Dominante : ') + joinNames(a.dominant);
    if (a.secondary.length) out += ' | ' + (a.secondary.length > 1 ? 'Secondaires (ex aequo) : ' : 'Secondaire : ') + joinNames(a.secondary);
    return out;
  }
  function readingText(a) {
    var D = a.dominant, S = a.secondary, g = a.gap;
    if (D.length === 4) return 'Les quatre couleurs obtiennent le même score : le profil est parfaitement équilibré.';
    if (D.length === 1 && S.length === 1) // texte V1, inchangé
      return 'Le profil fait ressortir une préférence dominante ' + D[0] + ' et une tendance secondaire ' + S[0] + '. L’écart est de ' + g + ' point(s).';
    if (D.length > 1) return 'Le profil fait ressortir plusieurs préférences dominantes à égalité : ' + joinNames(D) + '.' +
      (S.length ? ' La tendance suivante est ' + joinNames(S) + ', à ' + g + ' point(s) d’écart.' : '');
    return 'Le profil fait ressortir une préférence dominante ' + D[0] + ' et des tendances secondaires à égalité : ' + joinNames(S) + '. L’écart est de ' + g + ' point(s).';
  }
  function scoreGridHtml(scores) {
    var t = NAMES.reduce(function (s, k) { return s + scores[k]; }, 0) || 1;
    return NAMES.map(function (k) {
      return '<div class="score ' + k + '"><span>' + k + '</span><strong>' + scores[k] + '</strong><small>' + fr(100 * scores[k] / t, 1) + ' %</small></div>';
    }).join('');
  }

  /* ---------- Graphiques canvas ---------- */
  function ctxOf(canvas) { return canvas && canvas.getContext ? canvas.getContext('2d') : null; }

  function drawRadar(canvas, s) { // identique V1 (échelle adaptative conservée)
    var x = ctxOf(canvas); if (!x) return;
    var L = NAMES, cx = 350, cy = 350, R = 235;
    var maxScore = Math.max.apply(null, L.map(function (k) { return s[k]; })), axisMax = Math.max(10, Math.ceil(maxScore / 5) * 5);
    x.clearRect(0, 0, canvas.width, canvas.height); x.textAlign = 'center'; x.textBaseline = 'middle';
    for (var z = 1; z <= 5; z++) {
      var rr = R * z / 5; x.beginPath();
      L.forEach(function (_, i) { var an = -Math.PI / 2 + i * Math.PI / 2, px = cx + Math.cos(an) * rr, py = cy + Math.sin(an) * rr; i ? x.lineTo(px, py) : x.moveTo(px, py); });
      x.closePath(); x.strokeStyle = '#dbe4ee'; x.lineWidth = 1; x.stroke();
      x.fillStyle = '#7a8795'; x.font = '12px ' + SANS; x.fillText(String(Math.round(axisMax * z / 5)), cx + 10, cy - rr + 10);
    }
    L.forEach(function (l, i) {
      var an = -Math.PI / 2 + i * Math.PI / 2; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R);
      x.strokeStyle = '#c8d2de'; x.stroke(); x.fillStyle = HEX[l]; x.font = 'bold 22px ' + SANS;
      x.fillText(l, cx + Math.cos(an) * (R + 48), cy + Math.sin(an) * (R + 48));
    });
    x.beginPath();
    L.forEach(function (l, i) { var an = -Math.PI / 2 + i * Math.PI / 2, pr = R * s[l] / axisMax, px = cx + Math.cos(an) * pr, py = cy + Math.sin(an) * pr; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.closePath(); x.fillStyle = '#2563eb3d'; x.fill(); x.strokeStyle = '#2563eb'; x.lineWidth = 5; x.stroke();
    L.forEach(function (l, i) {
      var an = -Math.PI / 2 + i * Math.PI / 2, pr = R * s[l] / axisMax;
      x.beginPath(); x.arc(cx + Math.cos(an) * pr, cy + Math.sin(an) * pr, 7, 0, Math.PI * 2); x.fillStyle = HEX[l]; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke();
    });
  }

  /* Histogramme : part de chaque couleur dans le total des points (somme = 100 %), repère à 25 % = équilibre. */
  function drawHistogram(canvas, scores, opts) {
    var x = ctxOf(canvas); if (!x) return;
    opts = opts || {}; var dec = opts.decimals || 0;
    var W = canvas.width, H = canvas.height, L = 64, Rm = 24, T = 52, B = 62, pw = W - L - Rm, ph = H - T - B;
    var total = NAMES.reduce(function (t, k) { return t + scores[k]; }, 0) || 1;
    var pcts = NAMES.map(function (k) { return 100 * scores[k] / total; });
    var axisMax = Math.max(40, Math.ceil(Math.max.apply(null, pcts) / 10) * 10);
    var yOf = function (p) { return T + ph - ph * p / axisMax; };
    x.clearRect(0, 0, W, H); x.textBaseline = 'middle';
    x.font = '13px ' + SANS; x.fillStyle = '#526173'; x.textAlign = 'left';
    x.fillText(opts.title || 'Part de chaque couleur dans le total des points', L, 16);
    x.fillText('Pointillés : 25 % = répartition équilibrée entre les quatre couleurs', L, 34);
    x.textAlign = 'right';
    for (var g = 0; g <= axisMax; g += 10) {
      x.beginPath(); x.moveTo(L, yOf(g)); x.lineTo(W - Rm, yOf(g)); x.strokeStyle = g === 0 ? '#8895a5' : '#e3eaf2'; x.lineWidth = g === 0 ? 2 : 1; x.stroke();
      x.fillStyle = '#7a8795'; x.fillText(g + ' %', L - 10, yOf(g));
    }
    x.save(); x.setLineDash([7, 6]); x.beginPath(); x.moveTo(L, yOf(25)); x.lineTo(W - Rm, yOf(25)); x.strokeStyle = '#17324d'; x.lineWidth = 2; x.stroke(); x.restore();
    var slot = pw / 4, bw = slot * 0.54;
    NAMES.forEach(function (k, i) {
      var bx = L + slot * i + (slot - bw) / 2, h = ph * pcts[i] / axisMax, by = T + ph - h;
      x.fillStyle = HEX[k]; x.fillRect(bx, by, bw, h);
      x.textAlign = 'center';
      x.fillStyle = '#172033'; x.font = 'bold 15px ' + SANS; x.fillText(fr(scores[k], dec) + (opts.unit === false ? '' : ' pts'), bx + bw / 2, by - 24);
      x.font = '13px ' + SANS; x.fillStyle = '#526173'; x.fillText(fr(pcts[i], 1) + ' %', bx + bw / 2, by - 8);
      x.font = 'bold 17px ' + SANS; x.fillStyle = HEX[k]; x.fillText(k, bx + bw / 2, H - B + 28);
    });
  }

  /* ---------- Appels au serveur Apps Script ---------- */
  var MESSAGES = {
    NETWORK: 'Connexion impossible avec le serveur. Vérifiez votre réseau puis réessayez.',
    NOT_CONFIGURED: 'L’application n’est pas encore configurée (adresse du serveur manquante dans js/config.js).',
    SERVER: 'Le serveur est momentanément occupé. Réessayez dans quelques secondes.',
    GROUP_NOT_FOUND: 'Ce code de groupe est inconnu. Vérifiez le code ou rescannez le QR code.',
    REGISTRATION_CLOSED: 'Les inscriptions sont fermées pour ce groupe. Demandez à votre formateur.',
    CAPACITY: 'Ce groupe est complet. Prévenez votre formateur.',
    BAD_NAME: 'Merci de saisir votre prénom.',
    LOCKED: 'Action impossible : votre synthèse a déjà été débloquée, les réponses ne peuvent plus être modifiées.',
    UNAUTHORIZED: 'Clé formateur incorrecte.'
  };
  function errMsg(r) { return (r && (MESSAGES[r.code] || r.message)) || MESSAGES.SERVER; }

  function api(action, payload, timeoutMs) {
    var cfg = root.CFG || {};
    if (!/^https:\/\/script\.google\.com\//.test(cfg.API_URL || '')) return Promise.resolve({ ok: false, code: 'NOT_CONFIGURED' });
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 25000) : null;
    var body = JSON.stringify(Object.assign({ action: action }, payload || {}));
    return fetch(cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
      .catch(function () { return { ok: false, code: 'NETWORK' }; })
      .then(function (r) { if (timer) clearTimeout(timer); return r; });
  }

  var Core = { HEX: HEX, NAMES: NAMES, esc: esc, fr: fr, calc: calc, analyse: analyse, joinNames: joinNames, dominanceHtml: dominanceHtml,
    dominanceText: dominanceText, readingText: readingText, scoreGridHtml: scoreGridHtml, drawRadar: drawRadar, drawHistogram: drawHistogram,
    api: api, errMsg: errMsg };
  root.Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
