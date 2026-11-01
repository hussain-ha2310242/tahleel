/* Shared logic: stage model, local defaults (used offline and for the demo), local rule checks, time estimates, top bar. */
(function () {
  var I = window.TI.ic;

  var STAGES = ['population', 'design', 'constructs', 'questions', 'flags'];
  var STAGE_TITLE = { population: 'Target population', design: 'Sampling and design', constructs: 'Constructs', questions: 'Questions', flags: 'Flags' };
  var STAGE_SHORT = { population: 'Population', design: 'Design', constructs: 'Constructs', questions: 'Questions', flags: 'Flags' };
  var FIELD_TYPES = ['text', 'number', 'select', 'multiselect', 'chips', 'range', 'stepper', 'toggle', 'tiles'];

  // Predefined question response types. sec = estimated seconds per question.
  var RESPONSE = {
    likert5: { label: 'Likert, 5 points', sec: 6, opts: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'] },
    likert7: { label: 'Likert, 7 points', sec: 7, opts: ['Strongly disagree', 'Disagree', 'Somewhat disagree', 'Neutral', 'Somewhat agree', 'Agree', 'Strongly agree'] },
    single: { label: 'Single choice', sec: 6, opts: ['Option A', 'Option B'], choice: true },
    multi: { label: 'Multiple choice', sec: 10, opts: ['Option A', 'Option B', 'Option C'], choice: true },
    rating0_10: { label: 'Rating, 0 to 10', sec: 5 },
    yesno: { label: 'Yes or no', sec: 3 },
    numeric: { label: 'Number', sec: 8 },
    open: { label: 'Open text', sec: 45 }
  };
  var RESPONSE_KEYS = Object.keys(RESPONSE);

  var STUDY = ['Cross-sectional survey', 'Pre/post survey with a comparison group', 'Randomised experiment'];
  var METHOD = ['Stratified random', 'Simple random', 'Cluster', 'Quota', 'Convenience'];
  var REFINE = {
    'Stratified random': ['College and study level', 'College only', 'Study level only'],
    'Simple random': ['Registrar student list'],
    'Cluster': ['Course sections', 'Clinical placement sites'],
    'Quota': ['Gender and study level', 'College'],
    'Convenience': ['Online invitation', 'Campus stand']
  };
  var WHO = ['Students', 'Nursing students', 'Teachers', 'Patients', 'Residents'];
  var INST = ['One university', 'Two or more universities', 'Public schools', 'Clinics'];
  var LEVEL = ['Undergraduate and postgraduate', 'Undergraduate only', 'Postgraduate only'];
  var REGION = ['Qatar', 'GCC', 'Arab world', 'Other'];
  var INCLUDE = ['Enrolled this semester', 'Worked on a project in the past year', 'Aged 18 or over', 'Gave informed consent'];
  var EXCLUDE = ['Exchange or visiting students', 'Took part in the pilot', 'Staff who also study', 'Incomplete responses'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid(p) { return (p || 'x') + Math.random().toString(36).slice(2, 9); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function initials(name) { return name.split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase(); }

  // Demo user until sign-in arrives (Supabase later). Named after John Tukey.
  var profileName = 'Tukey';

  function topbar(opts) {
    opts = opts || {};
    var right = opts.right || '';
    var profile = opts.profile === false ? '' :
      '<span class="profile" title="Demo user"><span class="avatar">' + esc(initials(profileName)) + '</span><span>' + esc(profileName) + '</span><span class="tag">Demo</span></span>';
    return '<header class="topbar"><a class="wordmark" href="' + (opts.home || '/') + '">Tahleel</a><div class="topbar-r">' + right + profile + '</div></header>';
  }

  function makeQuestion(text, type, options) {
    var r = RESPONSE[type] || RESPONSE.likert5;
    var q = { id: uid('q'), text: text, responseType: type, options: options ? options.slice() : (r.opts ? r.opts.slice() : []), reworded: false };
    var fixed = rewrite(text);
    if (fixed) { q.original = text; q.text = fixed; q.reworded = true; }
    return q;
  }

  // Local defaults. Used for the demo plan and as a fallback when the AI call fails.
  function defaultFields(stage) {
    if (stage === 'population') return [
      { id: 'who', stage: 'population', sub: 'who', label: 'Group', type: 'select', options: WHO, value: 'Students' },
      { id: 'level', stage: 'population', sub: 'who', label: 'Level', type: 'select', options: LEVEL, value: LEVEL[0] },
      { id: 'age', stage: 'population', sub: 'who', label: 'Age', type: 'range', min: 16, max: 80, value: [18, 30] },
      { id: 'inst', stage: 'population', sub: 'where', label: 'Setting', type: 'select', options: INST, value: 'One university' },
      { id: 'region', stage: 'population', sub: 'where', label: 'Region', type: 'select', options: REGION, value: 'Qatar' },
      { id: 'include', stage: 'population', sub: 'eligibility', label: 'Include', type: 'chips', options: INCLUDE, value: [INCLUDE[0], INCLUDE[1]] },
      { id: 'exclude', stage: 'population', sub: 'eligibility', label: 'Exclude', type: 'chips', options: EXCLUDE, value: [EXCLUDE[0], EXCLUDE[1]] },
      { id: 'size', stage: 'population', sub: 'size', label: 'Responses', type: 'stepper', min: 50, max: 800, step: 10, value: 356 }
    ];
    if (stage === 'design') return [
      { id: 'studyType', stage: 'design', sub: 'type', label: 'Study type', type: 'select', options: STUDY, value: STUDY[0] },
      { id: 'method', stage: 'design', sub: 'method', label: 'Method', type: 'tiles', options: METHOD, value: 'Stratified random' },
      { id: 'refine', stage: 'design', sub: 'method', label: 'Strata', type: 'select', options: REFINE['Stratified random'], value: REFINE['Stratified random'][0] },
      { id: 'alloc', stage: 'design', sub: 'alloc', label: 'Allocation', type: 'select', options: ['Proportional to enrolment', 'Equal per group'], value: 'Proportional to enrolment' }
    ];
    return [];
  }
  function defaultSubSteps(stage) {
    if (stage === 'population') return [{ id: 'who', label: 'Who', stage: 'population' }, { id: 'where', label: 'Where', stage: 'population' }, { id: 'eligibility', label: 'Eligibility', stage: 'population' }, { id: 'size', label: 'Size', stage: 'population' }];
    if (stage === 'design') return [{ id: 'type', label: 'Study type', stage: 'design' }, { id: 'method', label: 'Sampling', stage: 'design' }, { id: 'alloc', label: 'Allocation', stage: 'design' }];
    return [];
  }
  function defaultConstructs() {
    var q = function (t, ty, o) { return makeQuestion(t, ty, o); };
    var extent = ['Not at all', 'A little', 'Somewhat', 'Mostly', 'Completely'];
    return [
      { id: uid('c'), name: 'AI use', description: 'How often and for which tasks students use AI tools.', questions: [
        q('In the past month, how often did you use AI tools for your university projects?', 'single', ['Never', 'Once', 'A few times', 'Weekly', 'Daily']),
        q('Which project tasks have you used AI tools for?', 'multi', ['Finding sources', 'Summarising readings', 'Writing drafts', 'Coding or data analysis', 'Editing and proofreading'])
      ] },
      { id: uid('c'), name: 'Perceived usefulness', description: 'Whether AI tools help students finish project work.', questions: [
        q('AI tools help me finish project tasks more quickly.', 'likert5'),
        q("Don't you agree that AI tools make university projects easier?", 'single', extent),
        q('AI tools improve the quality of my project work.', 'likert5'),
        q('AI tools help me understand difficult course material.', 'likert5')
      ] },
      { id: uid('c'), name: 'Trust and accuracy', description: 'How far students trust AI answers for academic work.', questions: [
        q('I trust the answers AI tools give me for academic work.', 'likert5'),
        q('AI tools give accurate information in my subject area.', 'likert5'),
        q('I feel confident using AI output in graded work.', 'likert5')
      ] },
      { id: uid('c'), name: 'Integrity and concerns', description: 'Worry about breaking academic integrity rules.', questions: [
        q('I am worried about breaking academic integrity rules when I use AI.', 'likert5'),
        q('I worry that using AI could be seen as cheating.', 'likert5')
      ] },
      { id: uid('c'), name: 'Guidance and support', description: 'Clarity of university guidance on AI use.', questions: [
        q('My university gives clear guidance on AI use in projects.', 'likert5'),
        q('My instructors explain when AI use is allowed.', 'likert5')
      ] }
    ];
  }

  // Leading wording rewrite. Returns the neutral form, or null.
  function rewrite(q) {
    var m = String(q || '').match(/^Don'?t you agree that (.*)\?$/i);
    if (!m) return null;
    // Lowercase the first letter only for an ordinary capitalised word. Keep acronyms such as AI, and "I".
    var rest = /^[A-Z][a-z]/.test(m[1]) ? m[1].charAt(0).toLowerCase() + m[1].slice(1) : m[1];
    return 'To what extent do you think ' + rest + '?';
  }

  function wordCount(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }

  function questionFlags(text) {
    var out = [], t = String(text || '');
    if (!t.trim()) return out;
    if (/\b(and|or)\b/i.test(t) && t.split(/\b(and|or)\b/i).length > 2 && /\?/.test(t)) out.push({ category: 'wording', title: 'Double-barrelled', detail: 'Two ideas joined by "and" or "or". Split it into two questions.' });
    if (!rewrite(t) && /\b(obviously|unfortunately|most people|everyone knows)\b/i.test(t)) out.push({ category: 'wording', title: 'Leading', detail: 'Loaded wording. Rewrite it in neutral terms.' });
    if (wordCount(t) > 25) out.push({ category: 'wording', title: 'Long', detail: 'More than 25 words. Shorten it.' });
    return out;
  }

  // Rule-based flags for the flags stage. Auto-fixed wording is not listed.
  function localFlags(state) {
    var out = [];
    (state.constructs || []).forEach(function (c) {
      (c.questions || []).forEach(function (q) {
        questionFlags(q.text).forEach(function (f) { out.push(Object.assign({ source: 'rule', construct: c.name }, f)); });
      });
      if ((c.questions || []).length && c.questions.length < 2) out.push({ source: 'rule', category: 'statistics', title: 'Reliability', detail: c.name + ' has one question. Use two or three items for a stable scale.', construct: c.name });
    });
    var method = (state.fields && state.fields.design || []).filter(function (f) { return f.id === 'method'; })[0];
    if (method && method.value === 'Convenience') out.push({ source: 'rule', category: 'sampling', title: 'Sampling bias', detail: 'Convenience sampling over-represents students who respond easily. Limits generalisation.' });
    var size = (state.fields && state.fields.population || []).filter(function (f) { return f.id === 'size'; })[0];
    if (size && Number(size.value) < 100) out.push({ source: 'rule', category: 'statistics', title: 'Statistical power', detail: 'Under 100 responses. Small differences between groups may not be detectable.' });
    out.push({ source: 'rule', category: 'statistics', title: 'Analysis wording', detail: 'Report effect sizes with confidence intervals, not only p-values.' });
    return out;
  }

  // Arabic for the respondent form. Fixed scales are translated here; questions come from Groq or DEMO_AR.
  var AR_SCALE = {
    likert5: ['أعارض بشدة', 'أعارض', 'محايد', 'أوافق', 'أوافق بشدة'],
    likert7: ['أعارض بشدة', 'أعارض', 'أعارض إلى حد ما', 'محايد', 'أوافق إلى حد ما', 'أوافق', 'أوافق بشدة'],
    yesno: ['نعم', 'لا']
  };
  var AR_UI = { number: 'أدخل رقمًا', open: 'يكتب المشارك هنا', questions: 'عدد الأسئلة', preview: 'معاينة فقط. لا يُرسل أي شيء.', consent: 'الموافقة على المشاركة', about: 'معلومات عنك', country: 'اختر الدولة' };
  var DEMO_AR = [
    { name: 'استخدام الذكاء الاصطناعي', description: 'عدد مرات استخدام الطلبة لأدوات الذكاء الاصطناعي والمهام التي يستخدمونها فيها.', questions: [
      { text: 'خلال الشهر الماضي، كم مرة استخدمت أدوات الذكاء الاصطناعي في مشاريعك الجامعية؟', options: ['أبدًا', 'مرة واحدة', 'بضع مرات', 'أسبوعيًا', 'يوميًا'] },
      { text: 'في أي مهام المشروع استخدمت أدوات الذكاء الاصطناعي؟', options: ['البحث عن المصادر', 'تلخيص القراءات', 'كتابة المسودات', 'البرمجة أو تحليل البيانات', 'التحرير والتدقيق اللغوي'] }] },
    { name: 'الفائدة المدركة', description: 'مدى مساعدة أدوات الذكاء الاصطناعي للطلبة في إنجاز أعمال المشروع.', questions: [
      { text: 'تساعدني أدوات الذكاء الاصطناعي على إنجاز مهام المشروع بسرعة أكبر.' },
      { text: 'إلى أي مدى تعتقد أن أدوات الذكاء الاصطناعي تجعل المشاريع الجامعية أسهل؟', options: ['لا على الإطلاق', 'قليلًا', 'إلى حد ما', 'في الغالب', 'تمامًا'] },
      { text: 'تحسّن أدوات الذكاء الاصطناعي جودة عملي في المشاريع.' },
      { text: 'تساعدني أدوات الذكاء الاصطناعي على فهم المواد الدراسية الصعبة.' }] },
    { name: 'الثقة والدقة', description: 'مدى ثقة الطلبة في إجابات الذكاء الاصطناعي في العمل الأكاديمي.', questions: [
      { text: 'أثق في الإجابات التي تقدمها لي أدوات الذكاء الاصطناعي في العمل الأكاديمي.' },
      { text: 'تقدم أدوات الذكاء الاصطناعي معلومات دقيقة في مجال تخصصي.' },
      { text: 'أشعر بالثقة عند استخدام مخرجات الذكاء الاصطناعي في الأعمال التي تُقيَّم.' }] },
    { name: 'النزاهة والمخاوف', description: 'القلق من مخالفة قواعد النزاهة الأكاديمية.', questions: [
      { text: 'أشعر بالقلق من مخالفة قواعد النزاهة الأكاديمية عند استخدام الذكاء الاصطناعي.' },
      { text: 'أخشى أن يُعدّ استخدام الذكاء الاصطناعي غشًا.' }] },
    { name: 'الإرشاد والدعم', description: 'وضوح إرشادات الجامعة بشأن استخدام الذكاء الاصطناعي.', questions: [
      { text: 'تقدم جامعتي إرشادات واضحة حول استخدام الذكاء الاصطناعي في المشاريع.' },
      { text: 'يوضح لي أساتذتي متى يُسمح باستخدام الذكاء الاصطناعي.' }] }
  ];

  // Optional consent and demographics. Labels and options in English and Arabic.
  var CONSENT_EN = 'You are invited to take part in a research survey. Taking part is voluntary. You can skip any question or stop at any time, with no consequence. Your answers are anonymous and will be reported only in summary form. If you have questions, contact the research team.';
  var CONSENT_AR = 'ندعوك للمشاركة في استبيان بحثي. المشاركة طوعية، ويمكنك تخطي أي سؤال أو التوقف في أي وقت دون أي تبعات. إجاباتك مجهولة الهوية ولن تُعرض إلا في صورة ملخصة. إذا كانت لديك أسئلة، يرجى التواصل مع فريق البحث.';
  var CONSENT_Q = { en: 'I agree to take part in this survey.', ar: 'أوافق على المشاركة في هذا الاستبيان.' };
  var DEMOGRAPHICS = [
    { id: 'age', label: 'Age group', labelAr: 'الفئة العمرية', options: ['18–20', '21–24', '25–29', '30–39', '40 or older', 'Prefer not to say'], optionsAr: ['18–20', '21–24', '25–29', '30–39', '40 فأكثر', 'أفضل عدم الإجابة'] },
    { id: 'gender', label: 'Gender', labelAr: 'الجنس', options: ['Male', 'Female', 'Prefer not to say'], optionsAr: ['ذكر', 'أنثى', 'أفضل عدم الإجابة'] },
    { id: 'nationality', label: 'Nationality', labelAr: 'الجنسية', country: true },
    { id: 'college', label: 'College', labelAr: 'الكلية', options: ['Arts and Sciences', 'Business and Economics', 'Education', 'Engineering', 'Health Sciences', 'Law', 'Medicine', 'Pharmacy', 'Sharia and Islamic Studies'], optionsAr: ['الآداب والعلوم', 'الإدارة والاقتصاد', 'التربية', 'الهندسة', 'العلوم الصحية', 'القانون', 'الطب', 'الصيدلة', 'الشريعة والدراسات الإسلامية'] },
    { id: 'level', label: 'Study level', labelAr: 'المرحلة الدراسية', options: ['Undergraduate', "Master's", 'Doctoral'], optionsAr: ['بكالوريوس', 'ماجستير', 'دكتوراه'] },
    { id: 'year', label: 'Year of study', labelAr: 'السنة الدراسية', options: ['First', 'Second', 'Third', 'Fourth or later'], optionsAr: ['الأولى', 'الثانية', 'الثالثة', 'الرابعة أو أكثر'] },
    { id: 'employment', label: 'Employment', labelAr: 'العمل', options: ['Not working', 'Part-time', 'Full-time'], optionsAr: ['لا أعمل', 'دوام جزئي', 'دوام كامل'] }
  ];
  // Countries for the nationality item (ISO codes; names come from the browser in English or Arabic). Qatar and the GCC first.
  var COUNTRY_FIRST = ['QA', 'SA', 'AE', 'KW', 'BH', 'OM'];
  var COUNTRY_REST = ('AF AL DZ AD AO AG AR AM AU AT AZ BS BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IT JM JP JO KZ KE KI KP KR KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO PK PW PS PA PG PY PE PH PL PT RO RU RW KN LC VC WS SM ST SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA GB US UY UZ VU VE VN YE ZM ZW').split(' ');
  function countryName(code, lang) {
    try { return new Intl.DisplayNames([lang === 'ar' ? 'ar' : 'en'], { type: 'region' }).of(code) || code; } catch (e) { return code; }
  }
  function countries(lang) {
    var rest = COUNTRY_REST.map(function (c) { return { code: c, name: countryName(c, lang) }; });
    rest.sort(function (a, b) { return a.name.localeCompare(b.name, lang === 'ar' ? 'ar' : 'en'); });
    return COUNTRY_FIRST.map(function (c) { return { code: c, name: countryName(c, lang) }; }).concat(rest);
  }
  function demoItem(id) { return DEMOGRAPHICS.filter(function (d) { return d.id === id; })[0]; }
  // Seconds the optional parts add to the form.
  function extraSeconds(S) {
    var s = 0;
    if (S && S.consent && S.consent.on) s += 20;
    if (S && S.demo && S.demo.on) s += 5 * S.demo.items.length;
    return s;
  }

  // Fingerprint of the questionnaire. A translation is reused only while this stays the same.
  function formSig(constructs) {
    return JSON.stringify((constructs || []).map(function (c) {
      return [c.name, (c.questions || []).map(function (q) { return [q.text, q.responseType, q.options]; })];
    }));
  }
  function fmtTimeAr(sec) { return sec < 60 ? sec + ' ثانية' : 'حوالي ' + Math.round(sec / 60) + ' دقيقة'; }

  function estSeconds(q) { var r = RESPONSE[q.responseType]; return r ? r.sec : 6; }
  function totalSeconds(constructs) {
    var s = 0;
    (constructs || []).forEach(function (c) { (c.questions || []).forEach(function (q) { s += estSeconds(q); }); });
    return s;
  }
  function fmtTime(sec) {
    if (sec < 60) return sec + ' sec';
    var m = Math.round(sec / 60);
    return 'about ' + m + ' min';
  }
  function countQuestions(constructs) {
    var n = 0; (constructs || []).forEach(function (c) { n += (c.questions || []).length; }); return n;
  }

  window.TC = {
    STAGES: STAGES, STAGE_TITLE: STAGE_TITLE, STAGE_SHORT: STAGE_SHORT, FIELD_TYPES: FIELD_TYPES,
    RESPONSE: RESPONSE, RESPONSE_KEYS: RESPONSE_KEYS, STUDY: STUDY, METHOD: METHOD, REFINE: REFINE,
    esc: esc, uid: uid, clone: clone, initials: initials, topbar: topbar,
    profileName: profileName, makeQuestion: makeQuestion,
    defaultFields: defaultFields, defaultSubSteps: defaultSubSteps, defaultConstructs: defaultConstructs,
    rewrite: rewrite, questionFlags: questionFlags, localFlags: localFlags,
    AR_SCALE: AR_SCALE, AR_UI: AR_UI, DEMO_AR: DEMO_AR, formSig: formSig, fmtTimeAr: fmtTimeAr,
    CONSENT_EN: CONSENT_EN, CONSENT_AR: CONSENT_AR, CONSENT_Q: CONSENT_Q, DEMOGRAPHICS: DEMOGRAPHICS, demoItem: demoItem,
    countries: countries, countryName: countryName, COUNTRY_CODES: COUNTRY_FIRST.concat(COUNTRY_REST), extraSeconds: extraSeconds,
    estSeconds: estSeconds, totalSeconds: totalSeconds, fmtTime: fmtTime, countQuestions: countQuestions,
    icon: I
  };
})();
