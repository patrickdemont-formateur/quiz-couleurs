"use strict";
/* Interface FORMATEUR : groupes, QR code, suivi, résultats individuels, déblocage, synthèse collective. */
(function () {
  var C = window.Core, $ = function (s) { return document.querySelector(s); }, esc = C.esc;
  var KEYSTORE = 'fmCle';
  var VIEWS = ['Login', 'Groups', 'Group'];
  var S = { key: '', q: null, groups: [], gid: null, dash: null, mask: false, timer: null, busy: false };

  /* ---------- Utilitaires ---------- */
  function show(v) { VIEWS.forEach(function (n) { $('#view' + n).hidden = (n !== v); }); stopTimer(); if (v === 'Group') startTimer(); try { window.scrollTo(0, 0); } catch (e) { } }
  function setErr(sel, m) { var e = $(sel); e.textContent = m || ''; e.style.display = m ? 'block' : 'none'; }
  function fmt(ms, withTime) {
    if (!ms) return '–'; var d = new Date(ms);
    var o = { day: '2-digit', month: '2-digit' }; if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleString('fr-FR', o);
  }
  function label(p) { return S.mask ? p.pid : p.display; }

  async function call(action, payload) {
    var r = await C.api(action, Object.assign({ key: S.key }, payload || {}));
    if (!r.ok && (r.code === 'UNAUTHORIZED' || r.code === 'LOCKED' || r.code === 'NOT_CONFIGURED')) logout(C.errMsg(r));
    return r;
  }
  function logout(msg) {
    S.key = ''; try { sessionStorage.removeItem(KEYSTORE); } catch (e) { }
    show('Login'); setErr('#loginError', msg || '');
  }

  /* ---------- Bandeau de contrôle de la purge ---------- */
  function purgeBanner(p) {
    if (!p) return '';
    var cls = 'ok', txt;
    var staleMs = (p.staleAfterDays || 8) * 86400000;
    if (p.triggerOk === false) { cls = 'bad'; txt = 'Aucun déclencheur de purge automatique n’est installé : lancez installer() dans Apps Script. En attendant, les données expirées ne sont plus lisibles mais restent stockées jusqu’à la prochaine ouverture de cet espace.'; }
    else if (!p.lastAt) { cls = 'warn'; txt = 'Purge automatique : aucune exécution enregistrée pour l’instant (le déclencheur s’exécute chaque lundi). Vous pouvez lancer une vérification avec testerPurge() dans Apps Script.'; }
    else if (p.lastOk === false) { cls = 'bad'; txt = 'La dernière purge automatique (' + fmt(p.lastAt, true) + ') a échoué. Ouvrez Apps Script et lancez testerPurge().'; }
    else if (Date.now() - p.lastAt > staleMs) { cls = 'warn'; txt = 'La dernière purge automatique date du ' + fmt(p.lastAt, true) + ' : vérifiez le déclencheur dans Apps Script.'; }
    else txt = 'Purge automatique en service – dernière exécution le ' + fmt(p.lastAt, true) + ' (' + p.lastDeleted + ' enregistrement(s) supprimé(s)). Durée de conservation : ' + p.retentionDays + ' jours.';
    return '<div class="banner ' + cls + '" role="status">' + esc(txt) + '</div>';
  }

  /* ---------- Connexion ---------- */
  async function login() {
    var k = $('#keyInput').value.trim(); if (!k) return setErr('#loginError', 'Saisissez votre clé formateur.');
    S.key = k; $('#loginBtn').disabled = true; setErr('#loginError', '');
    var r = await C.api('adminLogin', { key: k });
    $('#loginBtn').disabled = false;
    if (!r.ok) { S.key = ''; return setErr('#loginError', C.errMsg(r)); }
    try { sessionStorage.setItem(KEYSTORE, k); } catch (e) { }
    $('#keyInput').value = '';
    loadGroups();
  }

  /* ---------- Liste des groupes ---------- */
  async function loadGroups() {
    var r = await call('groupsList'); if (!r.ok) { if (S.key) { setErr('#groupsError', C.errMsg(r)); show('Groups'); } return; }
    S.groups = r.groups; setErr('#groupsError', '');
    $('#purgeBanner1').innerHTML = purgeBanner(r.purge);
    renderGroups(); show('Groups');
  }
  function renderGroups() {
    var showArch = $('#showArchived').checked, tb = $('#groupsTable tbody'), rows = S.groups.filter(function (g) { return showArch || g.statut === 'actif'; });
    tb.innerHTML = rows.map(function (g) {
      var tag = g.statut === 'archive' ? '<span class="tag off">Archivé</span>' : (g.inscriptions === 'oui' ? '<span class="tag ok">Inscriptions ouvertes</span>' : '<span class="tag">Inscriptions fermées</span>');
      return '<tr class="clickable" data-id="' + esc(g.id) + '"><td><strong>' + esc(g.nom) + '</strong></td><td class="mono">' + esc(g.code) + '</td><td class="num">' + g.inscrits + '</td><td class="num">' + g.complets + '</td><td>' + tag + '</td><td class="acts"><button class="primary sm" data-open="' + esc(g.id) + '">Ouvrir</button></td></tr>';
    }).join('');
    $('#groupsEmpty').hidden = rows.length > 0;
  }
  async function newGroup() {
    $('#newGroupBtn').disabled = true;
    var r = await call('groupCreate'); $('#newGroupBtn').disabled = false;
    if (!r.ok) return setErr('#groupsError', C.errMsg(r));
    openGroup(r.group.id);
  }

  /* ---------- Tableau de bord d'un groupe ---------- */
  function participantUrl(code) {
    var base = (window.CFG && window.CFG.PARTICIPANT_URL) || new URL('index.html', location.href).href;
    var u = new URL(base); u.searchParams.set('g', code); return u.href;
  }
  function qrSvg(url) { var q = window.qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }

  async function openGroup(id) { S.gid = id; S.dash = null; await refresh(true); }
  async function refresh(first) {
    if (!S.gid || S.busy) return; S.busy = true;
    var r = await call('groupDashboard', { id: S.gid }); S.busy = false;
    if (!r.ok) { if (!S.key) return; if (first) { setErr('#groupsError', C.errMsg(r)); return loadGroups(); } return setErr('#gError', C.errMsg(r)); }
    S.dash = r; setErr('#gError', ''); renderGroup(); if (first) show('Group');
  }

  function renderGroup() {
    var d = S.dash, g = d.group, ps = d.participants;
    $('#purgeBanner2').innerHTML = purgeBanner(d.purge);
    $('#gName').textContent = g.nom; $('#gCode').textContent = g.code;
    var url = participantUrl(g.code); $('#gUrl').textContent = url;
    $('#qrSmall').innerHTML = qrSvg(url);
    $('#gTags').innerHTML = g.statut === 'archive' ? '<span class="tag off">Archivé</span>' : (g.inscriptions === 'oui' ? '<span class="tag ok">Inscriptions ouvertes</span>' : '<span class="tag">Inscriptions fermées</span>');
    $('#toggleRegBtn').textContent = g.inscriptions === 'oui' ? 'Fermer les inscriptions' : 'Rouvrir les inscriptions';
    $('#toggleRegBtn').disabled = g.statut !== 'actif';
    $('#archiveBtn').textContent = g.statut === 'archive' ? 'Réactiver le groupe' : 'Archiver le groupe';
    var complets = ps.filter(function (p) { return p.status === 'complet'; }).length, deb = ps.filter(function (p) { return p.released; }).length;
    $('#kInscrits').textContent = ps.length; $('#kComplets').textContent = complets; $('#kDebloques').textContent = deb;
    $('#kExpire').textContent = ps.length ? fmt(Math.min.apply(null, ps.map(function (p) { return p.expiresAt; }))) : '–';
    $('#pTable tbody').innerHTML = ps.map(function (p) {
      var av = p.status === 'complet' ? '<span class="tag ok">Complet · ' + fmt(p.validatedAt, true) + '</span>' : '<span class="tag wait">En cours</span>';
      var sy = p.released ? '<span class="tag ok">Débloquée</span>' : '<span class="tag">Verrouillée</span>';
      var act = p.status === 'complet'
        ? '<button class="secondary sm" data-act="' + (p.released ? 'lock' : 'unlock') + '" data-pid="' + esc(p.pid) + '">' + (p.released ? 'Verrouiller' : 'Débloquer') + '</button> ' : '';
      act += '<button class="danger sm" data-act="del" data-pid="' + esc(p.pid) + '" aria-label="Supprimer ce participant">Supprimer</button>';
      return '<tr class="clickable" data-pid="' + esc(p.pid) + '"><td><strong>' + esc(label(p)) + '</strong></td><td class="mono">' + esc(p.pid) + '</td><td>' + av + '</td><td>' + sy + '</td><td class="acts">' + act + '</td></tr>';
    }).join('');
    $('#pEmpty').hidden = ps.length > 0;
    renderCollective();
  }

  /* ---------- Synthèse collective (annexe) ---------- */
  function renderCollective() {
    var ps = S.dash.participants.filter(function (p) { return p.scores; }), box = $('#collBody');
    if (!ps.length) { box.innerHTML = '<p class="small">Aucun questionnaire complet pour le moment.</p>'; return; }
    var mean = {}, dom = {};
    C.NAMES.forEach(function (k) { mean[k] = ps.reduce(function (t, p) { return t + p.scores[k]; }, 0) / ps.length; dom[k] = 0; });
    ps.forEach(function (p) { C.analyse(p.scores).dominant.forEach(function (k) { dom[k]++; }); });
    var rows = C.NAMES.map(function (k) { return '<tr><td><span class="chip ' + k + '" style="background:' + C.HEX[k] + '">' + k + '</span></td><td class="num">' + C.fr(mean[k], 1) + '</td><td class="num">' + dom[k] + '</td></tr>'; }).join('');
    box.innerHTML = '<p class="small">Calculée sur ' + ps.length + ' questionnaire(s) complet(s). Les ex æquo comptent pour chaque couleur concernée. Le total des dominantes peut donc dépasser le nombre de participants.</p>' +
      '<div class="two"><div><table class="tbl"><thead><tr><th>Couleur</th><th class="num">Score moyen</th><th class="num">Dominante chez</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="hist-wrap" style="margin:0"><canvas id="collHisto" width="700" height="420" role="img" aria-label="Histogramme collectif"></canvas></div></div>';
    C.drawHistogram($('#collHisto'), mean, { decimals: 1, title: 'Score moyen du groupe : part de chaque couleur' });
  }

  /* ---------- Actions groupe ---------- */
  async function setReg() {
    var g = S.dash.group; var r = await call('groupSet', { id: g.id, inscriptions: g.inscriptions === 'oui' ? 'non' : 'oui' });
    if (!r.ok) return setErr('#gError', C.errMsg(r)); refresh();
  }
  async function toggleArchive() {
    var g = S.dash.group, arch = g.statut === 'archive';
    if (!arch && !confirm('Archiver ce groupe ? Les inscriptions seront fermées. Les données individuelles restent supprimées automatiquement au bout de 7 jours.')) return;
    var r = await call('groupSet', { id: g.id, statut: arch ? 'actif' : 'archive' });
    if (!r.ok) return setErr('#gError', C.errMsg(r)); refresh();
  }
  async function purgeGroup() {
    if (!confirm('Effacer maintenant tous les prénoms, réponses et résultats de ce groupe ? Cette action est définitive. Le groupe reste dans votre liste.')) return;
    var r = await call('groupPurgeData', { id: S.gid }); if (!r.ok) return setErr('#gError', C.errMsg(r)); refresh();
  }
  async function deleteGroup() {
    if (!confirm('Supprimer définitivement ce groupe ET toutes les données individuelles associées ?')) return;
    var r = await call('groupDelete', { id: S.gid }); if (!r.ok) return setErr('#gError', C.errMsg(r));
    S.gid = null; loadGroups();
  }
  async function releaseAll(value) {
    var msg = value ? 'Débloquer la synthèse de tous les participants ayant terminé ? Ils pourront la consulter sur leur téléphone.' : 'Verrouiller toutes les synthèses ?';
    if (!confirm(msg)) return;
    var r = await call('release', { id: S.gid, scope: 'all', value: value }); if (!r.ok) return setErr('#gError', C.errMsg(r)); refresh();
  }
  async function releaseOne(pid, value) {
    var r = await call('release', { id: S.gid, pid: pid, value: value }); if (!r.ok) return setErr('#gError', C.errMsg(r)); await refresh(); return r;
  }
  async function deleteOne(pid) {
    var p = S.dash.participants.filter(function (x) { return x.pid === pid; })[0];
    if (!confirm('Supprimer définitivement ' + (p ? p.display : pid) + ' (prénom, réponses, résultats) ?')) return;
    var r = await call('participantDelete', { id: S.gid, pid: pid }); if (!r.ok) return setErr('#gError', C.errMsg(r)); closeModal(); refresh();
  }

  /* ---------- Fenêtres ---------- */
  function openModal(html, cls) { var m = $('#modal'); m.className = 'modal' + (cls ? ' ' + cls : ''); m.innerHTML = html; $('#modalBg').hidden = false; var c = m.querySelector('.close'); if (c) c.focus(); }
  function closeModal() { $('#modalBg').hidden = true; $('#modal').innerHTML = ''; }

  function qrBig() {
    var g = S.dash.group;
    openModal('<button class="secondary close">Fermer</button><h2>' + esc(g.nom) + '</h2><p>Scannez pour vous inscrire ou saisissez le code :</p>' + qrSvg(participantUrl(g.code)) + '<div class="code-big">' + esc(g.code) + '</div>', 'qr-full');
  }

  var POS = ['', 'A · forte', 'A · moyenne', 'A · légère', 'B · légère', 'B · moyenne', 'B · forte'];
  async function openDetail(pid) {
    var r = await call('participantDetail', { id: S.gid, pid: pid }); if (!r.ok) return setErr('#gError', C.errMsg(r));
    var p = S.dash.participants.filter(function (x) { return x.pid === pid; })[0] || r, who = S.mask ? r.pid : r.display;
    var h = '<button class="secondary close">Fermer</button><h2>' + esc(who) + ' <span class="mono" style="font-size:.9rem">' + esc(r.pid) + '</span></h2>';
    if (r.status !== 'complet') {
      h += '<p>Inscrit le ' + fmt(r.createdAt, true) + ' – questionnaire non validé pour l’instant.</p>';
      openModal(h); return;
    }
    var a = C.analyse(r.scores), okCalc = true, calc = null;
    if (S.q) { calc = C.calc(r.answers, S.q); okCalc = C.NAMES.every(function (k) { return calc[k] === r.scores[k]; }); }
    h += '<p>' + C.dominanceHtml(a) + '</p>' + (S.q ? '<div class="verif ' + (okCalc ? 'ok' : 'bad') + '">' + (okCalc ? '✓ Calcul vérifié : le total recalculé ici est identique à celui du serveur.' : '✗ Écart entre le calcul local et celui du serveur : ne pas utiliser ce résultat.') + '</div>' : '');
    h += '<div class="score-grid">' + C.scoreGridHtml(r.scores) + '</div>';
    h += '<div class="two"><div class="radar-wrap" style="margin:8px 0"><canvas id="dRadar" width="700" height="700"></canvas></div><div class="hist-wrap" style="margin:8px 0"><canvas id="dHisto" width="700" height="420"></canvas></div></div>';
    h += '<div class="toolbar" style="margin:6px 0 12px"><button class="' + (r.released ? 'secondary' : 'primary') + '" id="dRel">' + (r.released ? 'Verrouiller la synthèse' : 'Débloquer la synthèse') + '</button><button class="danger" id="dDel">Supprimer ce participant</button></div>';
    h += '<h3>Réponses détaillées</h3><p class="small">Pour chaque situation : la préférence exprimée (A ou B), son intensité, et la couleur qui en découle avec les points attribués.</p>';
    if (S.q) {
      h += '<div class="table-wrap"><table class="tbl ans-table"><thead><tr><th>N°</th><th class="q">Préférence A</th><th class="q">Préférence B</th><th>Réponse</th><th>Couleur (points)</th></tr></thead><tbody>';
      S.q.questions.forEach(function (q, i) {
        var v = r.answers[i], left = v <= 3, color = left ? q.left.color : q.right.color, pts = left ? S.q.scale.leftPoints[String(v)] : S.q.scale.rightPoints[String(v)];
        h += '<tr><td>' + q.id + '</td><td class="q' + (left ? ' pick' : '') + '">' + esc(q.left.text) + '</td><td class="q' + (!left ? ' pick' : '') + '">' + esc(q.right.text) + '</td><td>' + POS[v] + '</td><td><span class="chip ' + color + '" style="background:' + C.HEX[color] + '">' + color + ' +' + pts + '</span></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    openModal(h);
    C.drawRadar($('#dRadar'), r.scores); C.drawHistogram($('#dHisto'), r.scores);
    $('#dRel').addEventListener('click', async function () { var rr = await releaseOne(pid, !r.released); if (rr && rr.ok) closeModal(); });
    $('#dDel').addEventListener('click', function () { deleteOne(pid); });
  }

  /* ---------- Actualisation périodique (onglet visible, vue groupe uniquement) ---------- */
  function startTimer() { stopTimer(); S.timer = setInterval(function () { if ($('#autoRefresh').checked && !document.hidden && $('#modalBg').hidden) refresh(); }, 30000); }
  function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }

  /* ---------- Liaison ---------- */
  function bind() {
    $('#loginBtn').addEventListener('click', login);
    $('#keyInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
    $('#logoutBtn').addEventListener('click', function () { logout(''); });
    $('#newGroupBtn').addEventListener('click', newGroup);
    $('#showArchived').addEventListener('change', renderGroups);
    $('#groupsTable').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr) openGroup(tr.dataset.id); });
    $('#backBtn').addEventListener('click', function () { S.gid = null; loadGroups(); });
    $('#refreshBtn').addEventListener('click', function () { refresh(); });
    $('#maskNames').addEventListener('change', function (e) { S.mask = e.target.checked; if (S.dash) renderGroup(); });
    $('#toggleRegBtn').addEventListener('click', setReg);
    $('#archiveBtn').addEventListener('click', toggleArchive);
    $('#purgeGroupBtn').addEventListener('click', purgeGroup);
    $('#deleteGroupBtn').addEventListener('click', deleteGroup);
    $('#releaseAllBtn').addEventListener('click', function () { releaseAll(true); });
    $('#lockAllBtn').addEventListener('click', function () { releaseAll(false); });
    $('#qrBigBtn').addEventListener('click', qrBig);
    $('#qrSmall').addEventListener('click', qrBig);
    $('#qrSmall').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); qrBig(); } });
    $('#copyBtn').addEventListener('click', function () { var u = $('#gUrl').textContent; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { $('#copyBtn').textContent = 'Lien copié'; setTimeout(function () { $('#copyBtn').textContent = 'Copier le lien'; }, 1800); }).catch(function () { window.prompt('Copiez ce lien :', u); }); });
    $('#pTable').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (b) { e.stopPropagation(); var pid = b.dataset.pid, a = b.dataset.act; if (a === 'del') deleteOne(pid); else releaseOne(pid, a === 'unlock'); return; }
      var tr = e.target.closest('tr[data-pid]'); if (tr) openDetail(tr.dataset.pid);
    });
    $('#modalBg').addEventListener('click', function (e) { if (e.target === $('#modalBg') || e.target.closest('.close')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#modalBg').hidden) closeModal(); });
  }

  async function init() {
    bind();
    try { var r = await fetch('data/questions.json', { cache: 'no-store' }); if (r.ok) S.q = await r.json(); } catch (e) { /* le détail des réponses sera réduit */ }
    var k = ''; try { k = sessionStorage.getItem(KEYSTORE) || ''; } catch (e) { }
    if (k) { S.key = k; loadGroups(); } else show('Login');
  }
  init();
})();
