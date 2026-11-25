"use strict";
/* Interface PARTICIPANT : inscription, questionnaire (V1 conservé), attente, synthèse. */
(function () {
  var C = window.Core, $ = function (s) { return document.querySelector(s); };
  var KEY = 'profilCouleursV30';
  var VIEWS = ['Landing', 'Register', 'Quiz', 'Wait', 'Result', 'Message'];
  var S = { q: null, a: [], st: null, code: '', sending: false, lastCheck: 0, scores: null, display: '', msgAction: null };

  /* ---------- Stockage local : jeton opaque + brouillon (jamais de résultat) ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function persist() { try { if (S.st) localStorage.setItem(KEY, JSON.stringify(S.st)); else localStorage.removeItem(KEY); } catch (e) { /* stockage refusé : on continue */ } }
  function wipe() { S.st = null; S.a = []; persist(); }
  function newToken() {
    var abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = new Uint8Array(24);
    crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return abc[x % abc.length]; }).join('');
  }
  function cleanCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  /* ---------- Vues ---------- */
  function show(name) {
    VIEWS.forEach(function (v) { $('#view' + v).hidden = (v !== name); });
    try { window.scrollTo(0, 0); } catch (e) { /* ignoré */ }
  }
  function message(title, text, label, action) {
    $('#msgTitle').textContent = title; $('#msgText').textContent = text;
    var b = $('#msgBtn'); S.msgAction = action || null;
    b.hidden = !action; b.textContent = label || '';
    show('Message');
  }
  function setErr(sel, m) { var e = $(sel); e.textContent = m || ''; e.style.display = m ? 'block' : 'none'; }

  /* ---------- Démarrage ---------- */
  async function init() {
    bind();
    try {
      var r = await fetch('data/questions.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      S.q = await r.json();
    } catch (e) {
      message('Chargement impossible', 'Impossible de charger les questions. Utilisez GitHub Pages ou un serveur local.');
      return;
    }
    buildQuestions();
    S.code = cleanCode(new URLSearchParams(location.search).get('g'));
    S.st = load();
    if (S.st && S.st.pid && S.st.token && (!S.code || S.code === S.st.code)) return resume();
    if (S.code) return openGroup(S.code);
    show('Landing');
  }

  function bind() {
    $('#codeBtn').addEventListener('click', function () { var c = cleanCode($('#codeInput').value); if (c) { try { history.replaceState(null, '', '?g=' + c); } catch (e) { } S.code = c; openGroup(c); } });
    $('#regBtn').addEventListener('click', register);
    $('#firstName').addEventListener('keydown', function (e) { if (e.key === 'Enter') register(); });
    $('#resultBtn').addEventListener('click', submit);
    $('#checkBtn').addEventListener('click', function () { check(false); });
    $('#msgBtn').addEventListener('click', function () { if (S.msgAction) S.msgAction(); });
    $('#printBtn').addEventListener('click', function () { window.print(); });
    $('#pdfBtn').addEventListener('click', pdf);
    document.querySelectorAll('.wipeBtn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (confirm('Effacer les données de ce téléphone ? Vous ne pourrez plus consulter votre synthèse depuis cet appareil.')) {
          wipe(); message('Données effacées', 'Les informations enregistrées sur ce téléphone ont été supprimées. Les données du serveur sont supprimées automatiquement au bout de 7 jours.');
        }
      });
    });
    document.addEventListener('visibilitychange', function () {   // au retour sur la page d'attente : une vérification, sans scrutation permanente
      if (!document.hidden && !$('#viewWait').hidden && Date.now() - S.lastCheck > 20000) check(true);
    });
  }

  /* ---------- Groupe et inscription ---------- */
  async function openGroup(code) {
    var r = await C.api('groupInfo', { code: code });
    if (!r.ok) {
      if (r.code === 'GROUP_NOT_FOUND') return message('Code inconnu', C.errMsg(r), 'Saisir un autre code', function () { try { history.replaceState(null, '', location.pathname); } catch (e) { } S.code = ''; show('Landing'); });
      return message('Connexion impossible', C.errMsg(r), 'Réessayer', function () { openGroup(code); });
    }
    if (!r.open) return message('Inscriptions fermées', 'Les inscriptions sont fermées pour ce groupe. Demandez à votre formateur.');
    $('#groupName').textContent = r.name;
    setErr('#regError', '');
    show('Register');
  }

  async function register() {
    var name = $('#firstName').value.trim();
    if (!name) return setErr('#regError', 'Merci de saisir votre prénom.');
    if (S.sending) return;
    // Le jeton est créé et conservé AVANT l'envoi : un nouvel essai ne peut pas créer de doublon.
    if (!S.st || S.st.code !== S.code || S.st.pid) S.st = { code: S.code, token: newToken() };
    persist();
    S.sending = true; $('#regBtn').disabled = true; $('#regBtn').textContent = 'Inscription en cours…'; setErr('#regError', '');
    var r = await C.api('register', { code: S.code, prenom: name, token: S.st.token });
    S.sending = false; $('#regBtn').disabled = false; $('#regBtn').textContent = 'J’ai lu ces informations, je m’inscris';
    if (!r.ok) return setErr('#regError', C.errMsg(r) + (r.code === 'NETWORK' || r.code === 'SERVER' ? ' Vous pouvez réessayer sans risque de doublon.' : ''));
    S.st.pid = r.pid; S.st.display = r.display; S.st.status = r.status; persist();
    if (r.status === 'complet') return resume();
    enterQuiz();
  }

  /* ---------- Reprise après fermeture de la page ---------- */
  async function resume() {
    var r = await C.api('status', { pid: S.st.pid, token: S.st.token });
    S.lastCheck = Date.now();
    if (!r.ok) {
      if (r.code === 'NOT_FOUND' || r.code === 'EXPIRED') return gone(r.code);
      return message('Connexion impossible', C.errMsg(r), 'Réessayer', resume);
    }
    S.st.display = r.display; persist();
    if (r.status === 'inscrit') return enterQuiz();
    if (r.released && r.scores) return showResult(r.display, r.scores);
    show('Wait');
  }
  function gone(code) {
    var had = S.code;
    wipe();
    var txt = code === 'EXPIRED'
      ? 'Vos données ont été supprimées automatiquement (durée de conservation de 7 jours dépassée).'
      : 'Votre inscription est introuvable sur le serveur : elle a pu être supprimée par votre formateur ou expirer.';
    message('Données supprimées', txt, had ? 'M’inscrire de nouveau' : '', had ? function () { openGroup(had); } : null);
  }

  /* ---------- Questionnaire (affichage et saisie identiques à la V1) ---------- */
  function buildQuestions() {
    var b = $('#questions'); if (b.children.length) return;
    S.q.questions.forEach(function (q, i) {
      var a = document.createElement('article'); a.className = 'question'; a.id = 'q' + q.id;
      var left = [1, 2, 3].map(function (v) { return dot(i, v, q.id); }).join(''), right = [4, 5, 6].map(function (v) { return dot(i, v, q.id); }).join('');
      a.innerHTML = '<div class="qhead"><span>Question ' + q.id + '</span><span class="badge">Non répondu</span></div><div class="qbody"><div class="choices"><div><span class="choice-letter">A</span>' + C.esc(q.left.text) + '</div><div><span class="choice-letter">B</span>' + C.esc(q.right.text) + '</div></div><div class="choice-scale"><div class="rail" aria-hidden="true"></div><div class="scale" role="group" aria-label="Échelle de préférence de A vers B">' + left + '<span class="neutral" role="img" aria-label="Point neutre non sélectionnable, bascule entre A et B"></span>' + right + '</div><div class="legend-grid" aria-hidden="true"><span>Forte</span><span>Moyenne</span><span>Légère</span><span class="switch">Point<br>neutre</span><span>Légère</span><span>Moyenne</span><span>Forte</span></div><div class="preference-labels"><span>Préférence A</span><span>Préférence B</span></div></div><div class="value">Sélectionnez une position</div></div>';
      b.appendChild(a);
    });
    b.addEventListener('click', function (e) { var x = e.target.closest('.dot'); if (x) select(+x.dataset.i, +x.dataset.v, true); });
    b.addEventListener('keydown', function (e) {
      var x = e.target.closest('.dot'); if (!x || ['ArrowLeft', 'ArrowRight'].indexOf(e.key) < 0) return;
      e.preventDefault();
      var i = +x.dataset.i, v = +x.dataset.v, n = Math.max(1, Math.min(6, v + (e.key === 'ArrowRight' ? 1 : -1)));
      var t = document.querySelector('.dot[data-i="' + i + '"][data-v="' + n + '"]'); if (t) { t.focus(); select(i, n, true); }
    });
  }
  function dot(i, v, q) {
    var intensity = v === 1 || v === 6 ? 'forte' : v === 2 || v === 5 ? 'moyenne' : 'légère', pref = v <= 3 ? 'A' : 'B';
    return '<button type="button" class="dot" data-i="' + i + '" data-v="' + v + '" aria-label="Préférence ' + pref + ', intensité ' + intensity + ', question ' + q + '" aria-pressed="false"></button>';
  }
  function select(i, v, save) {
    S.a[i] = v;
    var card = $('#q' + S.q.questions[i].id);
    card.querySelectorAll('.dot').forEach(function (d) { var on = +d.dataset.v === v; d.classList.toggle('selected', on); d.setAttribute('aria-pressed', String(on)); });
    card.classList.add('answered'); card.querySelector('.badge').textContent = 'Répondu'; card.querySelector('.value').textContent = 'Choix enregistré';
    progress();
    if (save && S.st) { S.st.draft = S.a.slice(); persist(); }
  }
  function progress() {
    var n = S.a.filter(Number.isInteger).length;
    $('#progressText').textContent = n + ' / ' + S.q.questions.length + ' réponses';
    $('#progressFill').style.width = 100 * n / S.q.questions.length + '%';
  }
  function enterQuiz() {
    S.a = Array(S.q.questions.length).fill(null);
    document.querySelectorAll('.question').forEach(function (c) { c.classList.remove('answered'); c.querySelector('.badge').textContent = 'Non répondu'; c.querySelector('.value').textContent = 'Sélectionnez une position'; c.querySelectorAll('.dot').forEach(function (d) { d.classList.remove('selected'); d.setAttribute('aria-pressed', 'false'); }); });
    $('#whoami').textContent = 'Participant : ' + S.st.display + ' · identifiant ' + S.st.pid;
    var d = S.st.draft || [];
    d.forEach(function (v, i) { if (Number.isInteger(v) && v >= 1 && v <= 6 && i < S.a.length) select(i, v, false); });
    progress(); setErr('#error', ''); show('Quiz');
  }

  async function submit() {
    if (S.sending) return;
    var m = S.a.map(function (v, i) { return v === null ? i + 1 : null; }).filter(Boolean);
    if (m.length) { setErr('#error', 'Veuillez répondre aux questions : ' + m.join(', ')); $('#q' + m[0]).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    setErr('#error', '');
    S.sending = true; var btn = $('#resultBtn'); btn.disabled = true; btn.textContent = 'Envoi en cours…';
    var r = await C.api('submit', { pid: S.st.pid, token: S.st.token, answers: S.a });
    S.sending = false; btn.disabled = false; btn.textContent = 'Envoyer mes réponses';
    if (!r.ok) {
      if (r.code === 'NOT_FOUND' || r.code === 'EXPIRED') return gone(r.code);
      btn.textContent = 'Réessayer l’envoi';
      return setErr('#error', C.errMsg(r) + (r.code === 'NETWORK' || r.code === 'SERVER' ? ' Vos réponses sont conservées sur ce téléphone : appuyez sur « Réessayer l’envoi » (aucun doublon possible).' : ''));
    }
    delete S.st.draft; S.st.status = 'complet'; persist();      // le brouillon de réponses n'est plus gardé sur le téléphone
    $('#waitError').style.display = 'none';
    show('Wait');
    check(true);
  }

  /* ---------- Attente et synthèse ---------- */
  async function check(silent) {
    var r = await C.api('status', { pid: S.st.pid, token: S.st.token });
    S.lastCheck = Date.now();
    if (!r.ok) {
      if (r.code === 'NOT_FOUND' || r.code === 'EXPIRED') return gone(r.code);
      if (!silent) setErr('#waitError', C.errMsg(r));
      return;
    }
    if (r.released && r.scores) return showResult(r.display, r.scores);
    if (!silent) setErr('#waitError', 'Pas encore : votre formateur n’a pas encore autorisé la consultation. Réessayez un peu plus tard.');
    else setErr('#waitError', '');
  }

  function showResult(display, scores) {
    S.scores = scores; S.display = display;
    var a = C.analyse(scores);
    $('#resultIdentity').textContent = 'Profil de ' + display;
    $('#dominance').innerHTML = C.dominanceHtml(a);
    $('#scoreGrid').innerHTML = C.scoreGridHtml(scores);
    $('#readingText').textContent = C.readingText(a);
    setErr('#pdfError', '');
    show('Result');
    C.drawRadar($('#radar'), scores);
    C.drawHistogram($('#histo'), scores);
  }

  /* ---------- PDF (V1 + histogramme) ---------- */
  function pdf() {
    if (!S.scores) return setErr('#pdfError', 'Affichez d’abord votre profil.');
    if (!window.jspdf) return setErr('#pdfError', 'Le module PDF est indisponible. Vérifiez votre connexion.');
    var jsPDF = window.jspdf.jsPDF, d = new jsPDF(), n = S.display || 'Anonyme', s = S.scores, a = C.analyse(s);
    d.setFillColor(23, 50, 77); d.rect(0, 0, 210, 33, 'F'); d.setTextColor(255); d.setFontSize(20);
    d.text('Profil de management par les couleurs', 105, 15, { align: 'center' });
    d.setFontSize(11); d.text('Participant : ' + n, 105, 24, { align: 'center' });
    d.setTextColor(30); d.setFontSize(13); d.text(C.dominanceText(a), 20, 46);
    d.setFontSize(14); var y = 62;
    C.NAMES.forEach(function (k) { d.text(k + ' : ' + s[k] + ' (' + (100 * s[k] / a.total).toFixed(1) + ' %)', 20, y); y += 10; });
    d.addImage($('#radar').toDataURL(), 'PNG', 92, 52, 100, 100);
    d.addImage($('#histo').toDataURL(), 'PNG', 25, 160, 160, 96);
    d.setFontSize(9);
    d.text(d.splitTextToSize('Outil pedagogique de sensibilisation aux preferences comportementales. Il ne constitue ni un diagnostic psychologique ni un test psychometrique valide. Donnees supprimees automatiquement du serveur 7 jours apres l\'inscription.', 170), 20, 270);
    d.save('profil-couleurs-' + (n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'anonyme') + '.pdf');
  }

  init();
})();
