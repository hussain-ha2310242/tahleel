/* Workspace rendering. Pure functions of TA.state(). Re-rendered on explicit actions only, so typing keeps focus. */
(function () {
  var TC = window.TC, TA = window.TA, ic = window.TI.ic, esc = TC.esc;

  var PROMPTS = {
    population: 'Set the fields, or describe a different population below.',
    design: 'Choose the study type and sampling method. Each part has its own options.',
    constructs: 'Confirm the constructs. Questions are generated after you confirm.',
    questions: 'Review each question. Response types and time update as you edit.',
    flags: 'Items to review before you open the plan.'
  };
  var PH = {
    population: 'Describe a different population, or change one field',
    design: 'For example: cluster sample by course section',
    constructs: 'Add a construct on trust, or remove one',
    questions: 'Make the questions shorter, or change a response type',
    flags: 'Ask about a flag, or regenerate the flags'
  };
  var CAT_ICON = { wording: 'type', sampling: 'layers', statistics: 'hash', risk: 'flag' };
  var CAT_LABEL = { wording: 'Wording', sampling: 'Sampling', statistics: 'Statistics', risk: 'Risk' };
  var DOTS = '<span class="dots"><span></span><span></span><span></span></span>';

  function dv(v) {
    if (Array.isArray(v)) return v.length === 2 && typeof v[0] === 'number' ? v[0] + ' – ' + v[1] : v.join(', ');
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  }
  function getF(S, st, id) { return (S.fields[st] || []).filter(function (f) { return f.id === id; })[0] || { id: '', value: '' }; }
  function shorten(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n).trim() + '…' : s; }
  function flagsAll(S) { return S.aiFlags.concat(TC.localFlags(S)); }

  var SOON = [['hash', 'Sample size'], ['shuffle', 'Random draw'], ['upload', 'Data upload'], ['pulse', 'Monitor responses'], ['bars', 'Analyse results'], ['target', 'Reliability'], ['file', 'Report export'], ['shield', 'Ethics pack'], ['download', 'PDF export']];

  // Coming features drift past slowly; the second copy makes the loop seamless and is hidden from screen readers.
  function soonChips(copy) {
    return SOON.map(function (x) {
      return '<span class="soonchip" aria-disabled="true"' + (copy ? ' aria-hidden="true"' : '') + ' title="Coming soon">' + ic(x[0]) + '<span>' + esc(x[1]) + '</span><i>Soon</i></span>';
    }).join('');
  }

  function homeView() {
    return '<div class="home rise">' +
      '<h1 class="home-title">What is your research objective?</h1>' +
      '<form class="composer" id="home-form">' +
      '<textarea id="obj" rows="1" aria-label="Research objective"></textarea>' +
      '<button type="submit" class="go" aria-label="Start" title="Start">' + ic('arrowUp') + '</button></form>' +
      '<div class="soon-row" aria-label="Coming soon"><div class="soon-track">' + soonChips(false) + soonChips(true) + '</div></div></div>';
  }

  function progressBar(S) {
    var cur = TC.STAGES.indexOf(S.stage);
    var done = TC.STAGES.filter(function (k) { return S.confirmed[k]; }).length;
    var steps = TC.STAGES.map(function (k, i) {
      var cls = (S.confirmed[k] ? ' done' : '') + (i === cur ? ' cur' : '') + (i > cur ? ' future' : '');
      var mark = S.confirmed[k] ? ic('check') : '<b>' + (i + 1) + '</b>';
      return '<button class="rstep' + cls + '" data-act="jump" data-k="' + k + '"' + (i > cur ? ' disabled' : '') + '>' + mark + '<span>' + esc(TC.STAGE_SHORT[k]) + '</span></button>';
    }).join('');
    return '<div class="progress"><nav class="rsteps" aria-label="Steps">' + steps + '</nav>' +
      '<div class="pbar"><i style="width:' + (done / TC.STAGES.length * 100) + '%"></i></div></div>';
  }

  function summary(S, k) {
    if (k === 'population') return dv(getF(S, 'population', 'who').value) + ' · ' + dv(getF(S, 'population', 'size').value) + ' responses';
    if (k === 'design') return dv(getF(S, 'design', 'studyType').value) + ' · ' + dv(getF(S, 'design', 'method').value);
    if (k === 'constructs') return S.constructs.length + ' constructs';
    if (k === 'questions') return TC.countQuestions(S.constructs) + ' questions · ' + TC.fmtTime(TC.totalSeconds(S.constructs));
    return flagsAll(S).length + ' items';
  }

  // Short option lists show as pills (one click). Long lists stay a dropdown.
  function asPills(f) {
    if (f.type === 'tiles') return true;
    return f.type === 'select' && f.options.length <= 6 && f.options.every(function (o) { return String(o).length <= 34; });
  }

  function fieldHTML(f) {
    var attrs = 'data-fid="' + f.id + '" data-fst="' + f.stage + '"';
    var lab = esc(f.label);
    var ctl = '';
    if (f.type === 'text') ctl = '<input class="ctl" data-role="field" data-kind="text" ' + attrs + ' value="' + esc(f.value) + '" aria-label="' + lab + '">';
    else if (f.type === 'number') ctl = '<input class="ctl num" type="number" data-role="field" data-kind="number" ' + attrs + ' value="' + esc(f.value) + '" min="' + f.min + '" max="' + f.max + '" aria-label="' + lab + '">';
    else if (f.type === 'stepper') ctl = '<div class="stepper"><button type="button" data-act="step" ' + attrs + ' data-d="-1" aria-label="Decrease ' + lab + '">−</button>' +
      '<input class="sv" type="number" data-role="field" data-kind="number" ' + attrs + ' value="' + esc(f.value) + '" min="' + f.min + '" max="' + f.max + '" aria-label="' + lab + '">' +
      '<button type="button" data-act="step" ' + attrs + ' data-d="1" aria-label="Increase ' + lab + '">+</button></div>';
    else if (asPills(f)) ctl = '<div class="pills" role="radiogroup" aria-label="' + lab + '">' + f.options.map(function (o) {
      var on = o === f.value;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="popt' + (on ? ' on' : '') + '" data-act="tile" ' + attrs + ' data-v="' + esc(o) + '">' + esc(o) + '</button>';
    }).join('') + '</div>';
    else if (f.type === 'select') ctl = '<select class="ctl" data-role="field" data-kind="select" ' + attrs + ' aria-label="' + lab + '">' + f.options.map(function (o) { return '<option' + (o === f.value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    else if (f.type === 'chips' || f.type === 'multiselect') ctl = '<div class="chips">' + f.options.map(function (o) {
      var on = f.value.indexOf(o) > -1;
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="toggle" ' + attrs + ' data-v="' + esc(o) + '">' + esc(o) + '</button>';
    }).join('') + (f.type === 'chips' ? '<input class="chipadd" data-role="chipadd" ' + attrs + ' placeholder="+ Add" aria-label="Add to ' + lab + '" size="6">' : '') + '</div>';
    else if (f.type === 'range') ctl = '<div class="rng"><input class="ctl rn" type="number" data-role="range" data-i="0" ' + attrs + ' min="' + f.min + '" max="' + f.max + '" value="' + f.value[0] + '" aria-label="' + lab + ' from">' +
      '<span class="mute">to</span><input class="ctl rn" type="number" data-role="range" data-i="1" ' + attrs + ' min="' + f.min + '" max="' + f.max + '" value="' + f.value[1] + '" aria-label="' + lab + ' to">' +
      (f.id === 'age' ? '<span class="mute">years</span>' : '') + '</div>';
    else if (f.type === 'toggle') ctl = '<button type="button" class="switch' + (f.value ? ' on' : '') + '" data-act="switch" ' + attrs + ' role="switch" aria-checked="' + !!f.value + '" aria-label="' + lab + '"><span></span></button>';
    return '<div class="frow"><div class="flab">' + lab + '</div><div class="fctl">' + ctl + '</div></div>';
  }

  function questionRow(c, q, n) {
    var r = TC.RESPONSE[q.responseType];
    var ids = 'data-cid="' + c.id + '" data-qid="' + q.id + '"';
    var sel = '<select class="qtype" data-role="qtype" ' + ids + ' aria-label="Response type">' + TC.RESPONSE_KEYS.map(function (k) {
      return '<option value="' + k + '"' + (k === q.responseType ? ' selected' : '') + '>' + esc(TC.RESPONSE[k].label) + '</option>';
    }).join('') + '</select>';
    var mark = q.reworded ? '<span class="reword">Reworded · <button type="button" class="link" data-act="unreword" ' + ids + '>Undo</button></span>' : '';
    var opts = '';
    if (r.choice) {
      opts = '<div class="qopts">' + q.options.map(function (o, i) {
        return '<span class="oc"><input class="oin" data-role="opt" data-i="' + i + '" ' + ids + ' value="' + esc(o) + '" size="' + Math.max(3, String(o).length) + '" aria-label="Option ' + (i + 1) + '">' +
          '<button type="button" class="ox" data-act="optdel" data-i="' + i + '" ' + ids + ' aria-label="Remove option ' + (i + 1) + '">' + ic('x') + '</button></span>';
      }).join('') + '<button type="button" class="oc oadd" data-act="optadd" ' + ids + ' aria-label="Add option">' + ic('plus') + '</button></div>';
    } else if (r.opts) {
      opts = '<div class="qscale">' + esc(q.options.join(' · ')) + '</div>';
    }
    return '<div class="q"><span class="qn">' + n + '</span><div class="qb">' +
      '<textarea class="qtext" rows="1" data-role="qtext" ' + ids + ' aria-label="Question ' + n + '">' + esc(q.text) + '</textarea>' +
      '<div class="qmeta">' + sel + '<span class="time">' + TC.estSeconds(q) + ' sec</span>' + mark + '<span class="grow"></span>' +
      '<button type="button" class="icon-btn sm qdel" data-act="qdel" ' + ids + ' aria-label="Remove question ' + n + '" title="Remove">' + ic('trash') + '</button></div>' +
      opts + '</div></div>';
  }

  // Number of questions Groq writes for this construct (1 to 6). Local only until the next Groq call.
  function countStepper(c) {
    var n = TA.qCount(c);
    return '<span class="qcount" title="Questions to generate">' +
      '<button type="button" data-act="qcount" data-cid="' + c.id + '" data-d="-1"' + (n <= 1 ? ' disabled' : '') + ' aria-label="Fewer questions for ' + esc(c.name) + '">−</button>' +
      '<b>' + n + '</b><span>' + (n === 1 ? 'question' : 'questions') + '</span>' +
      '<button type="button" data-act="qcount" data-cid="' + c.id + '" data-d="1"' + (n >= 6 ? ' disabled' : '') + ' aria-label="More questions for ' + esc(c.name) + '">+</button></span>';
  }

  function constructsEditor(S) {
    return '<div class="clist">' + S.constructs.map(function (c, i) {
      return '<div class="crow"><span class="qn">' + (i + 1) + '</span><div class="cb">' +
        '<input class="cname" data-role="cname" data-cid="' + c.id + '" value="' + esc(c.name) + '" aria-label="Construct name">' +
        '<input class="cdesc" data-role="cdesc" data-cid="' + c.id + '" value="' + esc(c.description) + '" placeholder="One-line description" aria-label="Description"></div>' +
        countStepper(c) +
        '<button type="button" class="icon-btn sm qdel" data-act="cdel" data-cid="' + c.id + '" aria-label="Remove ' + esc(c.name) + '" title="Remove">' + ic('trash') + '</button></div>';
    }).join('') + '</div><button type="button" class="text-btn" data-act="cadd">' + ic('plus') + ' Construct</button>';
  }

  // One block per construct: name, description, numbered questions. Used in the questions stage and the plan.
  function constructBlocks(S, removable) {
    var n = 0;
    return S.constructs.map(function (c) {
      return '<div class="cblock"><div class="chead">' +
        '<input class="cname" data-role="cname" data-cid="' + c.id + '" value="' + esc(c.name) + '" aria-label="Construct name">' +
        (c.busy ? DOTS : '') + '<span class="grow"></span>' + countStepper(c) +
        '<button type="button" class="icon-btn sm" data-act="regenc" data-cid="' + c.id + '" title="Regenerate questions" aria-label="Regenerate questions for ' + esc(c.name) + '">' + ic('refresh') + '</button>' +
        (removable ? '<button type="button" class="icon-btn sm" data-act="cdel" data-cid="' + c.id + '" title="Remove construct" aria-label="Remove ' + esc(c.name) + '">' + ic('trash') + '</button>' : '') + '</div>' +
        '<input class="cdesc" data-role="cdesc" data-cid="' + c.id + '" value="' + esc(c.description) + '" placeholder="One-line description" aria-label="Description">' +
        '<div class="qlist">' + c.questions.map(function (q) { n++; return questionRow(c, q, n); }).join('') + '</div>' +
        '<button type="button" class="text-btn" data-act="qadd" data-cid="' + c.id + '">' + ic('plus') + ' Question</button></div>';
    }).join('') + (removable ? '<button type="button" class="text-btn" data-act="cadd">' + ic('plus') + ' Construct</button>' : '');
  }

  function flagsView(S) {
    var all = flagsAll(S);
    var h = '';
    ['wording', 'sampling', 'statistics', 'risk'].forEach(function (cat) {
      var items = all.filter(function (f) { return f.category === cat; });
      if (!items.length) return;
      h += '<div class="fgroup"><div class="fghead">' + ic(CAT_ICON[cat]) + '<span>' + CAT_LABEL[cat] + '</span><span class="count">' + items.length + '</span></div>' +
        items.map(function (f) {
          return '<div class="flag"><div class="ft"><b>' + esc(f.title) + '</b>' + (f.construct ? '<span class="fc">' + esc(f.construct) + '</span>' : '') + '</div><p>' + esc(f.detail) + '</p></div>';
        }).join('') + '</div>';
    });
    return h;
  }

  function stageBody(S, k) {
    if (k === 'population' || k === 'design') {
      var subs = S.subSteps[k] || [];
      var active = S.subActive[k] || (subs[0] && subs[0].id);
      var tabs = subs.length ? '<div class="subtabs" role="tablist">' + subs.map(function (s, i) {
        return '<button type="button" role="tab" class="subtab' + (s.id === active ? ' on' : '') + '" data-act="sub" data-k="' + k + '" data-id="' + s.id + '"><span class="sx">' + (i + 1) + '</span>' + esc(s.label) + '</button>';
      }).join('') + '</div>' : '';
      var fs = (S.fields[k] || []).filter(function (f) { return !subs.length || f.sub === active; });
      return tabs + (fs.length ? '<div class="fstack">' + fs.map(fieldHTML).join('') + '</div>' : '<p class="mute small">No fields in this part.</p>');
    }
    if (k === 'constructs') return constructsEditor(S);
    if (k === 'questions') return constructBlocks(S, false);
    return flagsView(S);
  }

  function promptBar(S, k) {
    return '<form class="sbar" data-k="' + k + '"><input name="t" placeholder="' + esc(PH[k]) + '" autocomplete="off" aria-label="Request a change">' +
      '<button type="button" class="icon-btn" data-act="regen" data-k="' + k + '" title="Regenerate" aria-label="Regenerate">' + ic('refresh') + '</button>' +
      (S.undo.length ? '<button type="button" class="icon-btn" data-act="undo" title="Undo last AI change" aria-label="Undo">' + ic('undo') + '</button>' : '') +
      '<button type="submit" class="icon-btn solid" aria-label="Send" title="Send">' + ic('arrowUp') + '</button></form>';
  }

  function stageCard(S, k) {
    var title = TC.STAGE_TITLE[k], n = TC.STAGES.indexOf(k) + 1;
    var editing = S.editing === k;
    if (S.confirmed[k] && !editing) {
      return '<section class="sdone rise" id="st-' + k + '"><div class="srow"><span class="tickc">' + ic('check') + '</span><b>' + esc(title) + '</b><span class="sum">' + esc(summary(S, k)) + '</span><span class="grow"></span>' +
        '<button type="button" class="icon-btn" data-act="reopen" data-k="' + k + '" aria-label="Edit ' + esc(title) + '" title="Edit">' + ic('pencil') + '</button></div></section>';
    }
    var busy = S.busy === k;
    var body = busy
      ? '<div class="skel"><i></i><i></i><i class="s"></i></div><p class="busytxt">Working on the next step ' + DOTS + '</p>'
      : stageBody(S, k);
    var note = !busy && S.notes[k] ? '<p class="note">' + esc(S.notes[k]) + '</p>' : '';
    var subs = (k === 'population' || k === 'design') ? (S.subSteps[k] || []) : [];
    var nav = '';
    if (!busy && subs.length > 1) {
      var at = Math.max(0, subs.map(function (x) { return x.id; }).indexOf(S.subActive[k] || subs[0].id));
      nav = '<div class="subnav" role="group" aria-label="Sub-sections">' +
        '<button type="button" class="icon-btn sm" data-act="subnav" data-k="' + k + '" data-d="-1"' + (at === 0 ? ' disabled' : '') + ' aria-label="Previous part" title="Previous part">' + ic('chevronL') + '</button>' +
        '<span class="subpos">' + (at + 1) + '/' + subs.length + '</span>' +
        '<button type="button" class="icon-btn sm" data-act="subnav" data-k="' + k + '" data-d="1"' + (at === subs.length - 1 ? ' disabled' : '') + ' aria-label="Next part" title="Next part">' + ic('chevronR') + '</button></div>';
    }
    var conf = busy ? DOTS : '<button type="button" class="icon-btn solid" data-act="confirm" data-k="' + k + '" aria-label="' + (editing ? 'Save' : 'Confirm and continue') + '" title="' + (editing ? 'Save' : (k === 'flags' ? 'Confirm and open the plan' : 'Confirm and continue')) + '">' + ic('check') + '</button>';
    return '<section class="stage rise" id="st-' + k + '"><div class="shead"><span class="num">' + n + '</span><h2>' + esc(title) + '</h2><span class="grow"></span>' + nav + conf + '</div>' +
      '<p class="lead">' + esc(PROMPTS[k]) + '</p>' + body + note + (busy ? '' : promptBar(S, k)) + '</section>';
  }

  function flowView(S) {
    var idx = TC.STAGES.indexOf(S.stage);
    var cards = TC.STAGES.filter(function (k, i) { return i <= idx; }).map(function (k) { return stageCard(S, k); }).join('');
    return progressBar(S) + '<div class="flow"><div class="you rise">' + esc(S.objective) + '</div>' + cards +
      '<p class="foot">Confirm each step to continue. Edit any step later.</p></div>';
  }

  function planView(S) {
    var head = '<header class="phead"><div class="phl"><div class="crumb">Survey plan</div>' +
      '<input class="ptitle" data-role="pname" value="' + esc(S.name) + '" aria-label="Plan name"></div>' +
      TA.workTabs(S) +
      '<div class="phr">' +
      '<button type="button" class="btn-ghost" data-act="form">' + ic('eye') + ' Form preview</button>' +
      '<span class="pdfwrap"><button type="button" class="icon-btn" disabled title="PDF export is in the next release" aria-label="Download PDF, next release">' + ic('download') + '</button><span class="soon">Next</span></span>' +
      '</div></header>';
    if (S.tab && S.tab !== 'plan') return head + TA.workView(S);
    var secs = [
      ['Objective', '<input class="ctl big" data-role="pobj" value="' + esc(S.objective) + '" aria-label="Objective">'],
      ['Target population', '<div class="fstack">' + (S.fields.population || []).map(fieldHTML).join('') + '</div>'],
      ['Design and sampling', '<div class="fstack">' + (S.fields.design || []).map(fieldHTML).join('') + '</div>'],
      ['Constructs and questions', constructBlocks(S, true)],
      ['Flags', flagsView(S)],
      ['Consent and demographics', consentSection(S)],
      ['Ethics', '<p class="val">Standard review route, to confirm with the committee. No minors or health data in this design.</p>']
    ];
    var doc = secs.map(function (s, i) {
      return '<section class="psec"><div class="pshead"><span class="sn">' + (i + 1) + '</span><h3>' + esc(s[0]) + '</h3></div>' + s[1] + '</section>';
    }).join('');
    var msgs = S.chat.map(function (m) { return '<div class="bub ' + (m.role === 'u' ? 'me' : 'bot') + '">' + esc(m.text) + '</div>'; }).join('') +
      (S.busy === 'plan' ? '<div class="bub bot">' + DOTS + '</div>' : '');
    var chat = '<aside class="chat"><div class="chhead">Edit with Tahleel</div><div class="chmsgs" id="chm">' + msgs + '</div>' +
      '<form class="chform" id="plan-form"><input name="t" placeholder="Ask for a change, or a question" autocomplete="off" aria-label="Ask for a change">' +
      '<button type="button" class="icon-btn" data-act="regen" data-k="questions" title="Regenerate questions" aria-label="Regenerate questions">' + ic('refresh') + '</button>' +
      (S.undo.length ? '<button type="button" class="icon-btn" data-act="undo" title="Undo last AI change" aria-label="Undo">' + ic('undo') + '</button>' : '') +
      '<button type="submit" class="icon-btn solid" aria-label="Send" title="Send">' + ic('arrowUp') + '</button></form></aside>';
    return head + '<div class="pgrid"><article class="doc">' + doc + '</article>' + chat + '</div>';
  }

  // Optional consent statement and demographic items. Local edits only.
  function consentSection(S) {
    var c = S.consent, d = S.demo;
    var sw = function (on, act, label) {
      return '<button type="button" class="switch' + (on ? ' on' : '') + '" data-act="' + act + '" role="switch" aria-checked="' + on + '" aria-label="' + label + '"><span></span></button>';
    };
    var h = '<div class="fstack">' +
      '<div class="frow"><div class="flab">Consent</div><div class="fctl"><div class="optrow2">' + sw(c.on, 'consent', 'Consent statement') +
      '<span class="mute small">' + (c.on ? 'Shown first, with a required "I agree" question.' : 'Off') + '</span></div>' +
      (c.on ? '<label class="txlab">English</label><textarea class="ctl tx" rows="3" data-role="consent" data-lang="en" aria-label="Consent text in English">' + esc(c.text) + '</textarea>' +
        '<label class="txlab">Arabic</label><textarea class="ctl tx" rows="3" dir="rtl" lang="ar" data-role="consent" data-lang="ar" aria-label="Consent text in Arabic">' + esc(c.textAr) + '</textarea>' : '') +
      '</div></div>' +
      '<div class="frow"><div class="flab">Demographics</div><div class="fctl"><div class="optrow2">' + sw(d.on, 'demo', 'Demographic questions') +
      '<span class="mute small">' + (d.on ? d.items.length + ' items, asked at the end.' : 'Off') + '</span></div>' +
      (d.on ? '<div class="chips dchips">' + TC.DEMOGRAPHICS.map(function (x) {
        var on = d.items.indexOf(x.id) > -1;
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="demoitem" data-v="' + x.id + '">' + esc(x.label) + (x.country ? ' <em>all countries</em>' : '') + '</button>';
      }).join('') + '</div>' : '') +
      '</div></div></div>';
    return h;
  }

  // Respondent widget. opts: the option labels to show (English or Arabic).
  function widget(q, opts, ar) {
    var t = q.responseType;
    if (t === 'likert5' || t === 'likert7') return '<div class="scale lk" style="--n:' + opts.length + '">' + opts.map(function (o) { return '<span class="sc">' + esc(o) + '</span>'; }).join('') + '</div>';
    if (t === 'single') return '<div class="choices">' + opts.map(function (o) { return '<span class="ch"><i class="radio"></i>' + esc(o) + '</span>'; }).join('') + '</div>';
    if (t === 'multi') return '<div class="choices">' + opts.map(function (o) { return '<span class="ch"><i class="box"></i>' + esc(o) + '</span>'; }).join('') + '</div>';
    if (t === 'rating0_10') { var r = []; for (var i = 0; i <= 10; i++) r.push('<span class="sc">' + i + '</span>'); return '<div class="scale num">' + r.join('') + '</div>'; }
    if (t === 'yesno') return '<div class="scale">' + (ar ? TC.AR_SCALE.yesno : ['Yes', 'No']).map(function (o) { return '<span class="sc">' + o + '</span>'; }).join('') + '</div>';
    if (t === 'numeric') return '<div class="inputbox">' + (ar ? TC.AR_UI.number : 'Enter a number') + '</div>';
    return '<div class="inputbox tall">' + (ar ? TC.AR_UI.open : 'Respondent writes here') + '</div>';
  }

  function formModal(S) {
    var want = S.lang === 'ar';
    var ready = want && S.formAr && S.formAr.sig === TC.formSig(S.constructs);
    var ar = !!ready;
    var tr = ar ? S.formAr.constructs : null;
    var n = 0;
    var body = S.constructs.map(function (c, ci) {
      var tc = tr && tr[ci] || {};
      return '<div class="fsec-h">' + esc(ar && tc.name ? tc.name : c.name) + '</div>' + c.questions.map(function (q, qi) {
        n++;
        var tq = tc.questions && tc.questions[qi] || {};
        var opts = q.options;
        if (ar) {
          if (TC.AR_SCALE[q.responseType]) opts = TC.AR_SCALE[q.responseType];
          else if (Array.isArray(tq.options) && tq.options.length === q.options.length) opts = tq.options;
        }
        return '<div class="fq"><div class="fqt"><span class="qn">' + n + '</span>' + esc(ar && tq.text ? tq.text : q.text) + '</div>' + widget(q, opts, ar) + '</div>';
      }).join('');
    }).join('');
    var pre = '', post = '';
    if (S.consent.on) {
      pre = '<div class="fsec-h">' + (ar ? TC.AR_UI.consent : 'Consent') + '</div><div class="fq consent"><p class="ctext">' + esc(ar ? S.consent.textAr : S.consent.text) + '</p>' +
        '<div class="fqt">' + esc(ar ? TC.CONSENT_Q.ar : TC.CONSENT_Q.en) + ' <span class="req" aria-hidden="true">*</span></div>' +
        widget({ responseType: 'yesno' }, null, ar) + '</div>';
    }
    if (S.demo.on && S.demo.items.length) {
      post = '<div class="fsec-h">' + (ar ? TC.AR_UI.about : 'About you') + '</div>' + S.demo.items.map(function (id) {
        var it = TC.demoItem(id);
        if (!it) return '';
        n++;
        var lab = ar ? it.labelAr : it.label;
        var ctl = it.country
          ? '<select class="ctl cselect" aria-label="' + esc(lab) + '"><option>' + (ar ? TC.AR_UI.country : 'Select a country') + '</option>' + TC.countries(ar ? 'ar' : 'en').map(function (c) { return '<option>' + esc(c.name) + '</option>'; }).join('') + '</select>'
          : widget({ responseType: 'single' }, ar ? it.optionsAr : it.options, ar);
        return '<div class="fq demo"><div class="fqt"><span class="qn">' + n + '</span>' + esc(lab) + '</div>' + ctl + '</div>';
      }).join('');
    }
    body = pre + body + post;
    var status = '';
    if (want && S.busy === 'translate') status = '<div class="fstatus">Translating the form into Arabic ' + DOTS + '</div>';
    else if (want && !ready) status = '<div class="fstatus">' + esc(S.formArError || 'The Arabic version is out of date.') + ' <button type="button" class="link" data-act="lang" data-v="ar">Translate again</button></div>';
    var sec = TC.totalSeconds(S.constructs) + TC.extraSeconds(S);
    return '<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="Form preview">' +
      '<div class="mhead"><div><div class="mini">Form preview</div><h2 class="serif">' + esc(S.name) + '</h2></div>' +
      '<button type="button" class="icon-btn" data-act="closemodal" aria-label="Close">' + ic('x') + '</button></div>' +
      '<div class="ftabs" role="tablist"><button type="button" class="on">Tahleel form</button>' +
      '<button type="button" disabled>Google Forms <em>Later</em></button><button type="button" disabled>Microsoft Forms <em>Later</em></button>' +
      '<span class="grow"></span><div class="seg" role="group" aria-label="Form language" title="Language of the form respondents see">' +
      '<button type="button" class="' + (!want ? 'on' : '') + '" data-act="lang" data-v="en">EN</button>' +
      '<button type="button" class="' + (want ? 'on' : '') + '" data-act="lang" data-v="ar">عربي</button></div></div>' +
      status +
      '<div class="fbody' + (ar ? ' rtl' : '') + '"' + (ar ? ' dir="rtl" lang="ar"' : '') + '>' + body + '</div>' +
      '<div class="mfoot"' + (ar ? ' dir="rtl"' : '') + '><span class="mute">' + (ar ? TC.AR_UI.questions + ': ' + n + ' · ' + TC.fmtTimeAr(sec) : n + ' questions · ' + esc(TC.fmtTime(sec))) + '</span>' +
      '<span class="mute">' + (ar ? TC.AR_UI.preview : 'Preview only. Nothing is sent.') + '</span></div></div></div>';
  }

  function railHTML() {
    var open = TA.ui.recentOpen;
    return '<button type="button" class="rail-btn" data-act="new" title="New" aria-label="New">' + ic('plus') + '</button>' +
      '<button type="button" class="rail-btn' + (open ? ' on' : '') + '" data-act="recent" title="Recent" aria-label="Recent" aria-expanded="' + open + '">' + ic('clock') + '</button>';
  }

  function recentHTML() {
    if (!TA.ui.recentOpen) return '';
    var S = TA.state();
    return '<div class="rlabel">Recent</div>' + TA.sessions().map(function (s) {
      var tag = s.demo ? 'Demo' : (s.view === 'plan' ? 'Plan' : 'Draft');
      return '<button type="button" class="ritem' + (S && S.id === s.id ? ' on' : '') + '" data-act="open" data-id="' + s.id + '" title="' + esc(s.objective) + '">' +
        '<span class="rt">' + esc(shorten(s.name, 30)) + '</span><span class="rtag">' + tag + '</span></button>';
    }).join('');
  }

  TA.render = function render() {
    var main = document.getElementById('main');
    if (!main) return;
    var S = TA.state();
    var mScroll = main.scrollTop;
    var doc = main.querySelector('.doc');
    var dScroll = doc ? doc.scrollTop : 0;
    var work = main.querySelector('.work'), wScroll = work ? work.scrollTop : 0, wTab = S && S.tab;
    document.getElementById('rail').innerHTML = railHTML();
    var recent = document.getElementById('recent');
    recent.innerHTML = recentHTML();
    recent.classList.toggle('open', TA.ui.recentOpen);
    var plan = !!(S && S.view === 'plan');
    main.classList.toggle('is-plan', plan);
    main.innerHTML = !S ? homeView() : (plan ? planView(S) : flowView(S));
    main.scrollTop = plan ? 0 : mScroll;
    var nd = main.querySelector('.doc');
    if (nd) nd.scrollTop = dScroll;
    var nw = main.querySelector('.work');
    if (nw && TA._lastTab === wTab) nw.scrollTop = wScroll;
    TA._lastTab = wTab;
    var chm = document.getElementById('chm');
    if (chm) chm.scrollTop = chm.scrollHeight;
    document.getElementById('modal').innerHTML = S && TA.ui.modal === 'form' ? formModal(S) : '';
    main.querySelectorAll('textarea.qtext, textarea.story').forEach(TA.autosize);
    main.querySelectorAll('input.oin').forEach(TA.fitOpt);
  };

  // Option chips are exactly as wide as their text.
  var measure = document.createElement('canvas').getContext('2d');
  TA.fitOpt = function (el) {
    var cs = getComputedStyle(el);
    measure.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    el.style.width = Math.ceil(measure.measureText(el.value || el.placeholder || ' ').width + 10) + 'px';
  };

  // Question text grows with its content, so there is no empty box space.
  TA.autosize = function (el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };
})();
