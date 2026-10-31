/* Workspace state. Local edits apply at once. Groq is called only on: start, confirm (next stage), prompt box, regenerate, plan chat. */
(function () {
  var TC = window.TC;
  var CATS = ['wording', 'sampling', 'statistics', 'risk'];

  var TA = {};
  var sessions = [];
  var S = null;
  var ui = { recentOpen: false, modal: null };

  function shorten(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n).trim() + '…' : s; }
  function nextStage(k) { var i = TC.STAGES.indexOf(k); return i > -1 && i < TC.STAGES.length - 1 ? TC.STAGES[i + 1] : null; }
  function refresh() { if (TA.render) TA.render(); }

  function newSession(objective) {
    return {
      id: TC.uid('s'), objective: objective, name: shorten(objective, 36), demo: false,
      view: 'flow', stage: 'population', loaded: {}, confirmed: {}, editing: null, busy: '', notes: {},
      subActive: {}, subSteps: { population: [], design: [] }, fields: { population: [], design: [] },
      constructs: [], aiFlags: [], undo: [], history: [{ role: 'user', text: objective }],
      lang: 'en', chat: []
    };
  }

  function demoSession() {
    var s = newSession('Understanding AI usage for projects in university');
    s.name = 'AI use in university';
    s.demo = true; s.view = 'plan'; s.stage = 'flags';
    TC.STAGES.forEach(function (k) { s.loaded[k] = true; s.confirmed[k] = true; });
    s.fields.population = TC.defaultFields('population');
    s.fields.design = TC.defaultFields('design');
    s.subSteps.population = TC.defaultSubSteps('population');
    s.subSteps.design = TC.defaultSubSteps('design');
    s.subActive = { population: 'who', design: 'type' };
    s.constructs = TC.defaultConstructs();
    s.formAr = { sig: TC.formSig(s.constructs), constructs: TC.DEMO_AR };
    s.history = [];
    s.chat = [{ role: 't', text: 'The plan is ready. Ask for a change here, or edit any text in the plan.' }];
    return s;
  }

  function historyPush(role, text) { if (S) { S.history.push({ role: role, text: String(text).slice(0, 400) }); if (S.history.length > 80) S.history.shift(); } }

  function display(v) {
    if (Array.isArray(v)) return v.length === 2 && typeof v[0] === 'number' ? v[0] + '–' + v[1] : v.join(', ');
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    return String(v);
  }

  function snapshot() {
    return { fields: TC.clone(S.fields), subSteps: TC.clone(S.subSteps), constructs: TC.clone(S.constructs), aiFlags: TC.clone(S.aiFlags), notes: TC.clone(S.notes) };
  }
  function pushUndo(label) {
    S.undo.push({ label: label, snap: snapshot() });
    if (S.undo.length > 12) S.undo.shift();
  }

  // Questions wanted for a construct: set by the user, otherwise what it has (or 3).
  function qCount(c) { return c.count != null ? c.count : (c.questions.length || 3); }

  function aiState() {
    return {
      flags: S.aiFlags.concat(TC.localFlags(S)).map(function (f) { return f.title + ': ' + f.detail; }).slice(0, 10),
      estimatedSeconds: TC.totalSeconds(S.constructs),
      subSteps: S.subSteps,
      fields: { population: S.fields.population, design: S.fields.design },
      constructs: S.constructs.map(function (c) {
        return { name: c.name, description: c.description, questionCount: qCount(c), questions: c.questions.map(function (q) { return { text: q.text, responseType: q.responseType, options: q.options }; }) };
      })
    };
  }

  function payload(instruction, target, prompt, construct) {
    return { instruction: instruction, target: target, objective: S.objective, prompt: prompt || '', construct: construct || '', state: aiState(), history: S.history.slice(-16) };
  }

  // Runs a reply against the session that made the request, so a reply that arrives after the user
  // switches or starts another plan lands in the right one. Renders the session that is open now.
  function later(sess, promise, cb) {
    return promise.then(function (r) {
      var prev = S;
      S = sess;
      try { cb(r); } finally { S = prev; }
      refresh();
    });
  }

  function apiCall(body) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 30000);
    return fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Unreadable reply.' }; }); })
      .catch(function (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'The request timed out.' : 'The planning service is not reachable.' }; })
      .then(function (j) { clearTimeout(timer); return j; });
  }

  function normQ(q) {
    var type = TC.RESPONSE[q.responseType] ? q.responseType : 'likert5';
    var r = TC.RESPONSE[type];
    var options = [];
    if (r.choice) options = Array.isArray(q.options) && q.options.length >= 2 ? q.options.map(String).slice(0, 8) : r.opts.slice();
    else if (r.opts) options = r.opts.slice();
    var text = String(q.text || '').trim().slice(0, 300);
    var out = { id: TC.uid('q'), text: text, responseType: type, options: options, reworded: false };
    var fixed = TC.rewrite(text);
    if (fixed) { out.original = text; out.text = fixed; out.reworded = true; }
    return out;
  }
  function normQs(list) {
    return (Array.isArray(list) ? list : []).filter(function (q) { return q && String(q.text || '').trim(); }).slice(0, 6).map(normQ);
  }

  function normField(f, st) {
    if (!f || typeof f !== 'object') return null;
    var type = TC.FIELD_TYPES.indexOf(f.type) > -1 ? f.type : 'select';
    var id = String(f.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
    if (!id) return null;
    var field = { id: id, stage: st, sub: String(f.sub || ''), label: String(f.label || id).slice(0, 60), type: type };
    var needOpts = ['select', 'multiselect', 'chips', 'tiles'];
    if (needOpts.indexOf(type) > -1) {
      field.options = (Array.isArray(f.options) ? f.options : []).map(String).filter(Boolean).slice(0, 12);
      if (field.options.length < 2) return null;
    }
    if (type === 'range' || type === 'stepper' || type === 'number') {
      field.min = Number(f.min) || 0;
      field.max = Number(f.max) || field.min + 100;
      if (field.max <= field.min) field.max = field.min + 10;
      field.step = field.max - field.min > 100 ? 10 : 1;
    }
    var v = f.value;
    if (type === 'range') {
      field.value = Array.isArray(v) && v.length === 2 ? [Number(v[0]) || field.min, Number(v[1]) || field.max] : [field.min, field.max];
    } else if (type === 'stepper' || type === 'number') {
      field.value = Number(v) || field.min;
    } else if (type === 'chips' || type === 'multiselect') {
      field.value = (Array.isArray(v) ? v : [v]).map(String).filter(function (x) { return field.options.indexOf(x) > -1; });
    } else if (type === 'toggle') {
      field.value = !!v;
    } else {
      field.value = String(v == null ? '' : v);
      if (type !== 'text' && field.options.indexOf(field.value) < 0) field.value = field.options[0];
    }
    return field;
  }

  function fixSubs(st) {
    var subs = S.subSteps[st] || [];
    if (!subs.length) return;
    var ids = subs.map(function (s) { return s.id; });
    (S.fields[st] || []).forEach(function (f) { if (ids.indexOf(f.sub) < 0) f.sub = ids[0]; });
    if (ids.indexOf(S.subActive[st]) < 0) S.subActive[st] = ids[0];
  }

  // Apply a reply from /api/chat. Only the parts present in the reply are replaced.
  // mode 'replace': the reply is the full stage (start, next, regenerate).
  // mode 'merge': the reply changes some parts (prompt, plan). Matching ids or names are updated, others are kept.
  function applyAI(d, target, mode) {
    if (!d || typeof d !== 'object') return;
    mode = mode || 'replace';
    if (Array.isArray(d.subSteps) && d.subSteps.length) {
      var groups = {};
      d.subSteps.forEach(function (s) {
        var st = s && (s.stage || target);
        if (st !== 'population' && st !== 'design') return;
        if (!s.id || !s.label) return;
        (groups[st] = groups[st] || []).push({ id: String(s.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24), label: String(s.label).slice(0, 40), stage: st });
      });
      Object.keys(groups).forEach(function (st) {
        if (!groups[st].length) return;
        if (mode === 'replace') { S.subSteps[st] = groups[st].slice(0, 6); return; }
        var cur = (S.subSteps[st] || []).slice();
        groups[st].forEach(function (s) {
          var ix = cur.map(function (x) { return x.id; }).indexOf(s.id);
          if (ix > -1) cur[ix] = s; else cur.push(s);
        });
        S.subSteps[st] = cur.slice(0, 6);
      });
    }
    if (Array.isArray(d.fields) && d.fields.length) {
      var fg = {};
      d.fields.forEach(function (f) {
        var st = f && (f.stage || target);
        if (st !== 'population' && st !== 'design') return;
        var nf = normField(f, st);
        if (nf) (fg[st] = fg[st] || []).push(nf);
      });
      Object.keys(fg).forEach(function (st) {
        if (!fg[st].length) return;
        if (mode === 'replace') { S.fields[st] = fg[st].slice(0, 12); return; }
        var cur = (S.fields[st] || []).slice();
        fg[st].forEach(function (nf) {
          var ix = -1;
          cur.forEach(function (x, i) { if (x.id === nf.id) ix = i; });
          if (ix > -1) {
            var merged = Object.assign({}, cur[ix], nf);
            if (!nf.sub) merged.sub = cur[ix].sub;
            cur[ix] = merged;
          } else cur.push(nf);
        });
        S.fields[st] = cur.slice(0, 12);
      });
    }
    ['population', 'design'].forEach(fixSubs);
    if (Array.isArray(d.constructs) && d.constructs.length) {
      var old = S.constructs;
      var built = d.constructs.filter(function (c) { return c && String(c.name || '').trim(); }).slice(0, 8).map(function (c) {
        var name = String(c.name).trim().slice(0, 80);
        var prev = old.filter(function (o) { return o.name.toLowerCase() === name.toLowerCase(); })[0];
        var qs = normQs(c.questions);
        return {
          id: prev ? prev.id : TC.uid('c'), name: name, description: String(c.description || '').slice(0, 200), count: prev ? prev.count : undefined,
          questions: qs.length ? qs : (prev ? prev.questions : [])
        };
      });
      if (mode === 'replace') S.constructs = built;
      else built.forEach(function (nc) {
        var ix = S.constructs.map(function (x) { return x.name.toLowerCase(); }).indexOf(nc.name.toLowerCase());
        if (ix > -1) {
          var old = S.constructs[ix];
          S.constructs[ix] = { id: old.id, count: old.count, name: nc.name, description: nc.description || old.description, questions: nc.questions.length ? nc.questions : old.questions };
        } else S.constructs.push(nc);
      });
    }
    if (Array.isArray(d.flags) && d.flags.length) {
      S.aiFlags = d.flags.filter(function (f) { return f && String(f.title || '').trim(); }).slice(0, 10).map(function (f) {
        return { source: 'ai', category: CATS.indexOf(f.category) > -1 ? f.category : 'risk', title: String(f.title).slice(0, 80), detail: String(f.detail || '').slice(0, 240) };
      });
    }
    if (target === 'plan') {
      S.chat.push({ role: 't', text: String(d.message || 'Updated the plan.').slice(0, 700) });
    } else {
      S.notes[target] = String(d.message || '').slice(0, 240);
      S.loaded[target] = true;
    }
  }

  function fallback(st, err) {
    if (st === 'population' || st === 'design') {
      S.fields[st] = TC.defaultFields(st);
      S.subSteps[st] = TC.defaultSubSteps(st);
      fixSubs(st);
    }
    if ((st === 'constructs' || st === 'questions') && !S.constructs.length) S.constructs = TC.defaultConstructs();
    S.loaded[st] = true;
    S.notes[st] = 'The planning service is unavailable, so starter content is loaded.' + (err ? ' (' + err + ')' : '');
  }

  function start(objective) {
    objective = String(objective || '').trim();
    if (!objective || S && S.busy) return;
    S = newSession(objective.charAt(0).toUpperCase() + objective.slice(1));
    sessions.unshift(S);
    S.busy = 'population';
    refresh();
    later(S, apiCall(payload('start', 'population')), function (r) {
      S.busy = '';
      if (r.ok) applyAI(r.data, 'population'); else fallback('population', r.error);
    });
  }

  function confirm(k) {
    if (!S || S.busy) return;
    if (S.editing === k) { S.editing = null; S.confirmed[k] = true; historyPush('event', 'Saved ' + TC.STAGE_SHORT[k]); refresh(); return; }
    S.confirmed[k] = true;
    S.editing = null;
    historyPush('event', 'Confirmed ' + TC.STAGE_SHORT[k]);
    if (k === 'flags') {
      S.view = 'plan';
      refresh();
      return;
    }
    var nx = nextStage(k);
    S.stage = nx;
    if (S.loaded[nx]) { refresh(); return; }
    S.busy = nx;
    refresh();
    later(S, apiCall(payload('next', nx)), function (r) {
      S.busy = '';
      if (r.ok) applyAI(r.data, nx); else fallback(nx, r.error);
    });
  }

  function reopen(k) { if (S) { S.editing = k; refresh(); } }

  function prompt(stage, text) {
    text = String(text || '').trim();
    if (!text || !S || S.busy) return;
    pushUndo('Change to ' + TC.STAGE_SHORT[stage]);
    historyPush('user', text);
    S.busy = stage;
    S.notes[stage] = '';
    refresh();
    later(S, apiCall(payload('prompt', stage, text)), function (r) {
      S.busy = '';
      if (r.ok) { applyAI(r.data, stage, 'merge'); historyPush('assistant', r.data.message || 'Updated.'); }
      else { S.undo.pop(); S.notes[stage] = 'Could not apply that change. ' + (r.error || ''); }
    });
  }

  function regenerate(stage, cid) {
    if (!S || S.busy) return;
    var c = cid ? S.constructs.filter(function (x) { return x.id === cid; })[0] : null;
    if (c && c.busy) return;
    pushUndo('Regenerate ' + (c ? c.name : TC.STAGE_SHORT[stage]));
    historyPush('event', 'Regenerate ' + (c ? c.name + ' questions' : TC.STAGE_SHORT[stage]));
    if (c) c.busy = true; else S.busy = stage;
    refresh();
    later(S, apiCall(payload('regenerate', c ? 'questions' : stage, '', c ? c.name : '')), function (r) {
      if (c) c.busy = false; else S.busy = '';
      if (r.ok) {
        if (c) {
          var first = Array.isArray(r.data.constructs) && r.data.constructs[0];
          var nq = first ? normQs(first.questions) : [];
          if (nq.length) c.questions = nq; else S.notes.questions = 'No new questions came back for ' + c.name + '.';
        } else applyAI(r.data, stage);
      } else {
        S.undo.pop();
        S.notes[c ? 'questions' : stage] = 'Could not regenerate. ' + (r.error || '');
      }
    });
  }

  function undo() {
    if (!S || !S.undo.length || S.busy) return;
    var u = S.undo.pop();
    S.fields = u.snap.fields; S.subSteps = u.snap.subSteps; S.constructs = u.snap.constructs; S.aiFlags = u.snap.aiFlags; S.notes = u.snap.notes;
    historyPush('event', 'Undid: ' + u.label);
    refresh();
  }

  function setSub(stage, id) { if (S) { S.subActive[stage] = id; refresh(); } }
  function stepSub(stage, d) {
    if (!S) return;
    var ids = (S.subSteps[stage] || []).map(function (x) { return x.id; });
    var at = Math.max(0, ids.indexOf(S.subActive[stage] || ids[0]));
    var to = Math.min(ids.length - 1, Math.max(0, at + d));
    if (ids[to]) S.subActive[stage] = ids[to];
  }

  function findField(st, id) { return (S.fields[st] || []).filter(function (f) { return f.id === id; })[0]; }

  function setField(st, id, value, commit) {
    if (!S) return;
    var f = findField(st, id);
    if (!f) return;
    var before = f.value;
    f.value = value;
    if (st === 'design' && id === 'method') {
      var opts = TC.REFINE[value] || [];
      var r = findField('design', 'refine');
      if (r && opts.length) { r.options = opts.slice(); r.value = opts[0]; }
    }
    if (commit && JSON.stringify(before) !== JSON.stringify(value)) {
      historyPush('edit', TC.STAGE_SHORT[st] + ' · ' + f.label + ': ' + display(before) + ' → ' + display(value));
    }
  }
  function setRange(st, id, i, v, commit) {
    var f = findField(st, id);
    if (!f) return;
    var val = f.value.slice();
    var n = Number(v);
    if (!isFinite(n)) return;
    if (commit) n = Math.min(f.max, Math.max(f.min, Math.round(n)));
    val[i] = n;
    if (commit && val[0] > val[1]) { if (i === 0) val[1] = val[0]; else val[0] = val[1]; }
    setField(st, id, val, commit);
  }
  function toggleChip(st, id, v) {
    var f = findField(st, id);
    if (!f) return;
    var val = f.value.slice();
    var ix = val.indexOf(v);
    if (ix > -1) val.splice(ix, 1); else val.push(v);
    setField(st, id, val, true);
  }

  // Adds a criterion the user typed to a chips field, selected.
  function addChipOption(st, id, text) {
    var f = findField(st, id);
    text = String(text || '').trim().slice(0, 60);
    if (!f || !text || !Array.isArray(f.options)) return;
    if (f.options.indexOf(text) < 0) f.options.push(text);
    if (f.value.indexOf(text) < 0) setField(st, id, f.value.concat([text]), true);
  }
  function stepField(st, id, dir) {
    var f = findField(st, id);
    if (!f) return;
    var step = f.step || (f.max - f.min > 100 ? 10 : 1);
    setField(st, id, Math.min(f.max, Math.max(f.min, Number(f.value) + dir * step)), true);
  }

  function findC(cid) { return S.constructs.filter(function (c) { return c.id === cid; })[0]; }
  function findQ(cid, qid) { var c = findC(cid); return c ? c.questions.filter(function (q) { return q.id === qid; })[0] : null; }

  function addConstruct() {
    if (!S) return;
    S.constructs.push({ id: TC.uid('c'), name: 'New construct', description: '', questions: [], count: 3 });
    historyPush('edit', 'Added construct');
  }
  function setCount(cid, d) {
    var c = findC(cid);
    if (!c) return;
    var n = Math.min(6, Math.max(1, qCount(c) + d));
    if (n !== qCount(c)) { c.count = n; historyPush('edit', c.name + ': ' + n + ' questions wanted'); }
  }
  function removeConstruct(cid) {
    if (!S) return;
    var c = findC(cid);
    S.constructs = S.constructs.filter(function (x) { return x.id !== cid; });
    if (c) historyPush('edit', 'Removed construct ' + c.name);
  }
  function setConstruct(cid, key, value, commit) {
    var c = findC(cid);
    if (!c) return;
    var before = c[key];
    c[key] = value;
    if (commit && before !== value) historyPush('edit', (key === 'name' ? 'Construct renamed' : 'Construct description changed') + ': ' + value);
  }
  function addQuestion(cid) {
    var c = findC(cid);
    if (!c) return;
    c.questions.push(TC.makeQuestion('New question', 'likert5'));
    historyPush('edit', 'Added question to ' + c.name);
  }
  function removeQuestion(cid, qid) {
    var c = findC(cid);
    if (!c) return;
    c.questions = c.questions.filter(function (q) { return q.id !== qid; });
    historyPush('edit', 'Removed a question from ' + c.name);
  }
  function setQuestion(cid, qid, text, commit) {
    var q = findQ(cid, qid);
    if (!q) return;
    q.text = text;
    if (commit) {
      var fixed = TC.rewrite(q.text);
      if (fixed) {
        q.original = q.original || q.text;
        q.text = fixed;
        q.reworded = true;
        historyPush('edit', 'Reworded a leading question');
      } else historyPush('edit', 'Edited a question');
    }
  }
  function setQuestionType(cid, qid, type) {
    var q = findQ(cid, qid);
    if (!q || !TC.RESPONSE[type]) return;
    var r = TC.RESPONSE[type];
    var keep = r.choice && q.options.length >= 2 && TC.RESPONSE[q.responseType].choice;
    q.responseType = type;
    q.options = keep ? q.options.slice() : (r.opts ? r.opts.slice() : []);
    historyPush('edit', 'Response type set to ' + r.label);
  }
  function unreword(cid, qid) {
    var q = findQ(cid, qid);
    if (!q || !q.reworded) return;
    q.text = q.original;
    q.reworded = false;
    delete q.original;
    historyPush('edit', 'Undid the rewording');
  }
  function addOption(cid, qid) { var q = findQ(cid, qid); if (q) { q.options.push('Option ' + (q.options.length + 1)); historyPush('edit', 'Added an option'); } }
  function removeOption(cid, qid, i) {
    var q = findQ(cid, qid);
    if (q && q.options.length > 2) { q.options.splice(i, 1); historyPush('edit', 'Removed an option'); }
  }
  function setOption(cid, qid, i, value, commit) {
    var q = findQ(cid, qid);
    if (!q) return;
    q.options[i] = value;
    if (commit) historyPush('edit', 'Option changed to ' + value);
  }

  // Questions and summaries are answered in the chat and change nothing. Anything else is a change request.
  var ASK = /^(summar|recap|overview|explain|describe|what|why|how|which|who|where|when|list|tell|show|is |are |does |do |can |could |should |would )|\?\s*$/i;

  function sectionsChanged(before) {
    var names = [];
    if (JSON.stringify(before.fields.population) !== JSON.stringify(S.fields.population)) names.push('target population');
    if (JSON.stringify(before.fields.design) !== JSON.stringify(S.fields.design)) names.push('design');
    if (JSON.stringify(before.constructs.map(function (c) { return [c.name, c.description]; })) !== JSON.stringify(S.constructs.map(function (c) { return [c.name, c.description]; }))) names.push('constructs');
    if (JSON.stringify(before.constructs.map(function (c) { return c.questions.map(function (q) { return [q.text, q.responseType, q.options]; }); })) !== JSON.stringify(S.constructs.map(function (c) { return c.questions.map(function (q) { return [q.text, q.responseType, q.options]; }); }))) names.push('questions');
    if (JSON.stringify(before.aiFlags) !== JSON.stringify(S.aiFlags)) names.push('flags');
    return names;
  }

  function planChat(text) {
    text = String(text || '').trim();
    if (!text || !S || S.busy) return;
    var ask = ASK.test(text);
    S.chat.push({ role: 'u', text: text });
    historyPush('user', text);
    S.busy = 'plan';
    if (ask) {
      refresh();
      later(S, apiCall(payload('ask', 'plan', text)), function (r) {
        S.busy = '';
        if (r.ok) { S.chat.push({ role: 't', text: String(r.data.message).slice(0, 1400) }); historyPush('assistant', r.data.message); }
        else S.chat.push({ role: 't', text: 'Could not answer that. ' + (r.error || '') });
      });
      return;
    }
    pushUndo('Plan change');
    var before = snapshot();
    refresh();
    later(S, apiCall(payload('plan', 'plan', text)), function (r) {
      S.busy = '';
      if (!r.ok) { S.undo.pop(); S.chat.push({ role: 't', text: 'Could not apply that. ' + (r.error || '') }); return; }
      applyAI(r.data, 'plan', 'merge');
      var changed = sectionsChanged(before);
      var last = S.chat[S.chat.length - 1];
      if (changed.length) last.text += '\nUpdated: ' + changed.join(', ') + '.';
      else { last.text += '\nNothing in the plan changed.'; S.undo.pop(); }
      historyPush('assistant', last.text);
    });
  }

  TA.state = function () { return S; };
  TA.sessions = function () { return sessions; };
  TA.ui = ui;
  TA.start = start;
  TA.confirm = confirm;
  TA.reopen = reopen;
  TA.prompt = prompt;
  TA.regenerate = regenerate;
  TA.undo = undo;
  TA.setSub = setSub;
  TA.stepSub = stepSub;
  TA.setField = setField;
  TA.setRange = setRange;
  TA.toggleChip = toggleChip;
  TA.addChipOption = addChipOption;
  TA.stepField = stepField;
  TA.addConstruct = addConstruct;
  TA.removeConstruct = removeConstruct;
  TA.setCount = setCount;
  TA.qCount = qCount;
  TA.setConstruct = setConstruct;
  TA.addQuestion = addQuestion;
  TA.removeQuestion = removeQuestion;
  TA.setQuestion = setQuestion;
  TA.setQuestionType = setQuestionType;
  TA.unreword = unreword;
  TA.addOption = addOption;
  TA.removeOption = removeOption;
  TA.setOption = setOption;
  TA.planChat = planChat;
  // Form language (respondent form only). Arabic comes from Groq once per version of the questionnaire.
  function setLang(v) {
    if (!S) return;
    S.lang = v === 'ar' ? 'ar' : 'en';
    S.formArError = '';
    if (S.lang !== 'ar' || S.busy) return;
    var sig = TC.formSig(S.constructs);
    if (S.formAr && S.formAr.sig === sig) return;
    S.busy = 'translate';
    later(S, apiCall(payload('translate', 'form')), function (r) {
      S.busy = '';
      if (r.ok && r.data.constructs) S.formAr = { sig: sig, constructs: r.data.constructs };
      else S.formArError = 'The Arabic version could not be made. ' + (r.error || '');
    });
  }
  TA.setLang = setLang;
  TA.setName = function (v) { if (S) S.name = v; };
  TA.setObjective = function (v) { if (S) S.objective = v; };
  TA.newSession = function () { S = null; ui.modal = null; };
  TA.select = function (id) { S = sessions.filter(function (s) { return s.id === id; })[0] || S; };
  TA.openDemo = function () {
    var d = sessions.filter(function (s) { return s.demo; })[0];
    if (!d) { d = demoSession(); sessions.push(d); }
    S = d;
    S.view = 'plan';
  };
  TA.toggleRecent = function () { ui.recentOpen = !ui.recentOpen; };
  TA.openModal = function (name) { ui.modal = name; };
  TA.closeModal = function () { ui.modal = null; };
  TA.helpers = { CATS: CATS, shorten: shorten };
  TA.setSessions = function (list) { sessions = list; };
  TA.init = function (opts) {
    var demo = demoSession();
    sessions = [demo];
    S = opts && opts.demo ? demo : null;
    if (S) S.view = 'plan';
  };

  window.TA = TA;
})();
