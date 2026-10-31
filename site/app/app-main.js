/* Workspace events and bootstrap. Local edits use input/change. Groq calls go through TA methods only. */
(function () {
  var TA = window.TA;

  function fieldOf(st, id) {
    var S = TA.state();
    return S && S.fields[st] ? S.fields[st].filter(function (f) { return f.id === id; })[0] : null;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute('data-scrim') === '1') { TA.closeModal(); TA.render(); return; }
    var el = t.closest ? t.closest('[data-act]') : null;
    if (!el || el.disabled) return;
    var a = el.getAttribute('data-act');
    var d = el.dataset;
    switch (a) {
      case 'new': TA.newSession(); break;
      case 'recent': TA.toggleRecent(); break;
      case 'open': TA.select(d.id); break;
      case 'form': TA.openModal('form'); break;
      case 'closemodal': TA.closeModal(); break;
      case 'lang': TA.setLang(d.v); break;
      case 'jump': {
        var target = document.getElementById('st-' + d.k);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      case 'confirm': TA.confirm(d.k); break;
      case 'reopen': TA.reopen(d.k); break;
      case 'regen': TA.regenerate(d.k); break;
      case 'regenc': TA.regenerate('questions', d.cid); break;
      case 'undo': TA.undo(); break;
      case 'sub': TA.setSub(d.k, d.id); break;
      case 'step': TA.stepField(d.fst, d.fid, Number(d.d)); break;
      case 'toggle': TA.toggleChip(d.fst, d.fid, d.v); break;
      case 'switch': {
        var sf = fieldOf(d.fst, d.fid);
        if (sf) TA.setField(d.fst, d.fid, !sf.value, true);
        break;
      }
      case 'tile': TA.setField(d.fst, d.fid, d.v, true); break;
      case 'cadd': TA.addConstruct(); break;
      case 'cdel': TA.removeConstruct(d.cid); break;
      case 'qadd': TA.addQuestion(d.cid); break;
      case 'qdel': TA.removeQuestion(d.cid, d.qid); break;
      case 'optadd': TA.addOption(d.cid, d.qid); break;
      case 'optdel': TA.removeOption(d.cid, d.qid, Number(d.i)); break;
      case 'unreword': TA.unreword(d.cid, d.qid); break;
      default: return;
    }
    TA.render();
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    e.preventDefault();
    if (f.id === 'home-form') {
      var v = document.getElementById('obj').value;
      TA.start(v);
      TA.render();
      return;
    }
    if (f.id === 'plan-form') {
      TA.planChat(f.querySelector('input').value);
      TA.render();
      return;
    }
    if (f.classList.contains('sbar')) {
      TA.prompt(f.getAttribute('data-k'), f.querySelector('input').value);
      TA.render();
    }
  });

  function addCriterion(t) {
    var d = t.dataset, v = t.value.trim();
    if (!v) return;
    TA.addChipOption(d.fst, d.fid, v);
    TA.render();
    var again = document.querySelector('.chipadd[data-fid="' + d.fid + '"]');
    if (again) again.focus();
  }

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t.id === 'obj' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (t.value.trim()) document.getElementById('home-form').requestSubmit();
      return;
    }
    if (t.dataset && t.dataset.role === 'chipadd' && e.key === 'Enter') { e.preventDefault(); addCriterion(t); }
  });

  // Typing: update state only, no re-render, so focus stays.
  document.addEventListener('input', function (e) {
    var t = e.target, d = t.dataset;
    if (t.id === 'obj') {
      TA.autosize(t);
      var go = document.querySelector('.composer .go');
      if (go) go.classList.toggle('ready', !!t.value.trim());
      return;
    }
    if (!d.role) return;
    switch (d.role) {
      case 'field':
        if (d.kind === 'text') TA.setField(d.fst, d.fid, t.value, false);
        else if (d.kind === 'number' && t.value !== '') TA.setField(d.fst, d.fid, Number(t.value), false);
        break;
      case 'range': if (t.value !== '') TA.setRange(d.fst, d.fid, Number(d.i), Number(t.value), false); break;
      case 'cname': TA.setConstruct(d.cid, 'name', t.value, false); break;
      case 'cdesc': TA.setConstruct(d.cid, 'description', t.value, false); break;
      case 'qtext': TA.setQuestion(d.cid, d.qid, t.value, false); TA.autosize(t); break;
      case 'opt': TA.setOption(d.cid, d.qid, Number(d.i), t.value, false); TA.fitOpt(t); break;
      case 'pname': TA.setName(t.value); break;
      case 'pobj': TA.setObjective(t.value); break;
    }
  });

  // Commit on blur or selection: records history, applies rewording, re-renders.
  document.addEventListener('change', function (e) {
    var t = e.target, d = t.dataset;
    if (!d.role) return;
    switch (d.role) {
      case 'field':
        if (d.kind === 'select') TA.setField(d.fst, d.fid, t.value, true);
        else if (d.kind === 'number') {
          var nf = fieldOf(d.fst, d.fid);
          var n = Number(t.value);
          if (!nf) break;
          if (t.value === '' || !isFinite(n)) n = nf.value;
          TA.setField(d.fst, d.fid, Math.min(nf.max, Math.max(nf.min, Math.round(n))), true);
        }
        else TA.setField(d.fst, d.fid, t.value, true);
        break;
      case 'range': TA.setRange(d.fst, d.fid, Number(d.i), Number(t.value), true); break;
      case 'cname': TA.setConstruct(d.cid, 'name', t.value, true); break;
      case 'cdesc': TA.setConstruct(d.cid, 'description', t.value, true); break;
      case 'qtext': TA.setQuestion(d.cid, d.qid, t.value, true); break;
      case 'qtype': TA.setQuestionType(d.cid, d.qid, t.value); break;
      case 'opt': TA.setOption(d.cid, d.qid, Number(d.i), t.value, true); break;
      case 'chipadd': if (t.value.trim()) addCriterion(t); return;
      case 'pname': case 'pobj': return;
      default: return;
    }
    TA.render();
  });

  // Home prompt: example objectives typed one by one into the placeholder. Stops while the user types.
  var EXAMPLES = [
    'Understanding AI usage for projects at Qatar University',
    'Screen time and sleep among secondary students in Doha',
    "Teachers' readiness for inclusive classrooms in Qatar",
    'Barriers to diabetes screening in primary care clinics',
    'Reading habits of grade 4 pupils in Arabic and English',
    'Job satisfaction among nurses in public hospitals'
  ];
  (function typePlaceholder() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var ex = 0, pos = 0, dir = 1, hold = 0;
    function tick() {
      var el = document.getElementById('obj');
      if (!el) return setTimeout(tick, 400);
      if (reduce) { el.placeholder = EXAMPLES[0]; return setTimeout(tick, 1000); }
      if (el.value) return setTimeout(tick, 300);
      var full = EXAMPLES[ex];
      if (hold > 0) { hold--; return setTimeout(tick, 100); }
      pos += dir;
      el.placeholder = full.slice(0, pos) + (dir > 0 && pos < full.length ? '▍' : '');
      if (pos >= full.length) { dir = -1; hold = 18; }
      else if (pos <= 0) { dir = 1; ex = (ex + 1) % EXAMPLES.length; hold = 3; }
      setTimeout(tick, dir > 0 ? 38 + Math.random() * 40 : 14);
    }
    tick();
  })();

  // Bootstrap. ?demo=1 opens the demo plan. Otherwise the home prompt.
  var params = new URLSearchParams(window.location.search);
  TA.init({ demo: params.get('demo') === '1' });
  document.getElementById('top').outerHTML = window.TC.topbar({ home: '/' });
  TA.render();
})();
