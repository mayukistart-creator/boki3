"use strict";

(() => {
  // ===== 設定値 =====
  const STORE_KEY = "boki3-record-v1";
  const LAP_PERCENT = 70;          // 1周とみなす正答率（%以上）
  const LAPS_TO_MASTER = 3;        // 習得済みになる周回数
  const STALE_DAYS = 7;            // 復習に出す「最後に解いてからの日数」
  const CHOICE_COUNT = 8;          // 仕訳問題の科目の選択肢の数
  const BASIC_ACCOUNTS = ["現金", "当座預金", "売掛金", "買掛金", "仕入", "売上", "借入金", "貸付金", "資本金", "給料", "建物", "土地"];
  const LETTERS = ["ア", "イ", "ウ", "エ", "オ", "カ"];

  // ===== 目次と問題の索引 =====
  const SECTIONS = [];
  const SECTION_BY_ID = {};
  const CHAPTER_LIST = CHAPTERS.map((ch) => {
    const chapter = { no: ch.no, title: ch.title, name: ch.no === 0 ? "序章" : `第${ch.no}章`, sections: [] };
    ch.sections.forEach((s) => {
      const sec = { id: s.id, title: s.title, page: s.page, chapter, label: ch.no === 0 ? "序章" : s.id };
      chapter.sections.push(sec);
      SECTIONS.push(sec);
      SECTION_BY_ID[s.id] = sec;
    });
    return chapter;
  });

  const Q_BY_ID = {};
  const Q_BY_SECTION = {};
  const DATA_WARNINGS = [];
  QUESTIONS.forEach((q, i) => {
    const where = q.id || `${i + 1}番目の問題`;
    if (!q.id) { DATA_WARNINGS.push(`${where}：id がありません`); return; }
    if (Q_BY_ID[q.id]) { DATA_WARNINGS.push(`${where}：id が重複しています`); return; }
    if (!SECTION_BY_ID[q.section]) { DATA_WARNINGS.push(`${where}：節「${q.section}」が目次にありません`); return; }
    if (q.type === "journal") {
      const sum = (lines) => (lines || []).reduce((t, l) => t + l[1], 0);
      if (!q.debit?.length || !q.credit?.length) { DATA_WARNINGS.push(`${where}：借方・貸方がありません`); return; }
      if (sum(q.debit) !== sum(q.credit)) DATA_WARNINGS.push(`${where}：借方と貸方の合計が一致しません`);
    } else if (q.type === "choice") {
      if (!q.options?.length || !(q.answer >= 0 && q.answer < q.options.length)) { DATA_WARNINGS.push(`${where}：選択肢か正解の番号が正しくありません`); return; }
    } else {
      DATA_WARNINGS.push(`${where}：type は "journal" か "choice" にしてください`);
      return;
    }
    Q_BY_ID[q.id] = q;
    (Q_BY_SECTION[q.section] ||= []).push(q);
  });
  if (DATA_WARNINGS.length) console.warn("問題データの確認:\n" + DATA_WARNINGS.join("\n"));

  const hasQ = (sec) => (Q_BY_SECTION[sec.id] || []).length > 0;
  const TOTAL_Q = Object.keys(Q_BY_ID).length;

  // ===== 学習記録（localStorage） =====
  function freshState() {
    return {
      version: 1,
      sections: {},   // 節id → { laps, lapDates[], lastAccuracy, lastStudied }
      questions: {},  // 問題id → { correct, wrong, last, star, lastAt }
      daily: {},      // "YYYY-MM-DD" → 解いた問題数
      runs: {},       // 途中の周（節id または "review"）
      lastRunKey: null,
      lastSectionId: null,
      lastResult: null,
      lastExport: null,
      settings: { theme: "auto" },
    };
  }
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  function normalize(d) {
    const f = freshState();
    if (!isObj(d)) return f;
    for (const k of ["sections", "questions", "daily", "runs"]) if (isObj(d[k])) f[k] = d[k];
    for (const k of ["lastRunKey", "lastSectionId", "lastResult", "lastExport"]) if (d[k] !== undefined) f[k] = d[k];
    if (isObj(d.settings)) Object.assign(f.settings, d.settings);
    return f;
  }
  let storageOk = true;
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? normalize(JSON.parse(raw)) : freshState();
    } catch (e) {
      storageOk = false;
      return freshState();
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(S));
      storageOk = true;
    } catch (e) {
      if (storageOk) toast("記録を保存できませんでした");
      storageOk = false;
    }
  }
  let S = load();

  // ===== 日付 =====
  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => dateKey(new Date());
  const nowIso = () => new Date().toISOString();
  function daysAgo(iso) {
    if (!iso) return null;
    const a = new Date(iso); const b = new Date();
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((db - da) / 86400000);
  }
  const agoText = (n) => (n === null ? "−" : n === 0 ? "今日" : n === 1 ? "昨日" : `${n}日前`);

  // ===== 小道具 =====
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 「さくら銀行−普通預金」のような長い科目名は「−」の後ろで改行する
  const acctLabel = (a) => esc(a).replace("−", "−<br>");
  const yen = (n) => n.toLocaleString("ja-JP");
  const pct = (correct, total) => (total ? Math.round((correct / total) * 100) : 0);
  const unique = (arr) => [...new Set(arr)];
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  };

  // ===== 進捗の計算 =====
  const secRec = (id) => S.sections[id] || null;
  function ensureSec(id) {
    if (!S.sections[id]) S.sections[id] = { laps: 0, lapDates: [], lastAccuracy: null, lastStudied: null };
    return S.sections[id];
  }
  function status(sec) {
    if (!hasQ(sec)) return "prep";
    const r = secRec(sec.id);
    if (r && r.laps >= LAPS_TO_MASTER) return "mastered";
    if ((r && (r.lastStudied || r.laps > 0)) || S.runs[sec.id]) return "learning";
    return "new";
  }
  const STATUS_LABEL = { mastered: "習得済み", learning: "学習中", new: "未着手", prep: "準備中" };
  const lapCountedToday = (secId) => (secRec(secId)?.lapDates || []).includes(todayKey());

  function dots(laps, big) {
    const n = Math.max(LAPS_TO_MASTER, 0);
    let h = `<span class="dots${big ? " big" : ""}" aria-label="${laps}周">`;
    for (let i = 0; i < n; i++) h += `<span class="dot${i < laps ? " on" : ""}"></span>`;
    return h + "</span>";
  }
  const pill = (st) => `<span class="pill ${st}">${STATUS_LABEL[st]}</span>`;

  function wrongIds() {
    return Object.keys(S.questions).filter((id) => Q_BY_ID[id] && S.questions[id].last === false);
  }
  function starIds() {
    return Object.keys(S.questions).filter((id) => Q_BY_ID[id] && S.questions[id].star);
  }
  function staleSections() {
    return SECTIONS
      .filter((sec) => hasQ(sec) && secRec(sec.id)?.lastStudied)
      .map((sec) => ({ sec, days: daysAgo(secRec(sec.id).lastStudied) }))
      .filter((x) => x.days >= STALE_DAYS)
      .sort((a, b) => b.days - a.days);
  }

  // 途中の周（存在しない問題は取り除く）
  function getRun(key) {
    const run = S.runs[key];
    if (!run) return null;
    const before = run.order.length;
    run.order = run.order.filter((id) => Q_BY_ID[id]);
    if (run.order.length !== before) run.index = Math.min(run.index, run.order.length);
    if (!run.order.length) { delete S.runs[key]; return null; }
    return run;
  }
  function latestRun() {
    const keys = Object.keys(S.runs).sort((a, b) => (S.runs[b].updatedAt || "").localeCompare(S.runs[a].updatedAt || ""));
    for (const k of keys) { const r = getRun(k); if (r) return r; }
    return null;
  }

  // 「続きから」の行き先
  function continueTarget() {
    const run = latestRun();
    if (run) return { type: "run", run };
    const candidates = SECTIONS.filter((s) => hasQ(s) && status(s) !== "mastered" && !lapCountedToday(s.id));
    const last = S.lastSectionId && SECTION_BY_ID[S.lastSectionId];
    if (last && candidates.includes(last)) return { type: "section", sec: last };
    if (candidates.length) return { type: "section", sec: candidates[0] };
    return { type: "review" };
  }

  // ===== 出題 =====
  let ui = { runKey: null };

  function startSectionRun(secId) {
    const qs = Q_BY_SECTION[secId] || [];
    if (!qs.length) return;
    S.runs[secId] = { key: secId, mode: "section", sectionId: secId, order: shuffle(qs.map((q) => q.id)), index: 0, results: {}, updatedAt: nowIso() };
    S.lastRunKey = secId;
    save();
    openRun(secId);
  }
  function startReviewRun(kind) {
    const ids = kind === "wrong" ? wrongIds() : starIds();
    if (!ids.length) { toast("対象の問題がありません"); return; }
    S.runs.review = { key: "review", mode: "review", kind, order: shuffle(ids), index: 0, results: {}, updatedAt: nowIso() };
    S.lastRunKey = "review";
    save();
    openRun("review");
  }
  function openRun(key) {
    ui = { runKey: key };
    setupQuestion();
    go("#/quiz");
  }
  function setupQuestion() {
    const run = getRun(ui.runKey);
    if (!run) return;
    if (run.index >= run.order.length) return;
    const q = Q_BY_ID[run.order[run.index]];
    ui.qid = q.id;
    ui.mode = run.mode;
    ui.kind = run.kind || null;
    ui.total = run.order.length;
    ui.phase = "answer";
    ui.error = "";
    if (q.type === "journal") {
      ui.slots = [
        ...q.debit.map((l) => ({ side: "debit", amount: l[1], account: null })),
        ...q.credit.map((l) => ({ side: "credit", amount: l[1], account: null })),
      ];
      ui.sel = 0;
      ui.accounts = accountChoices(q);
    } else {
      ui.order = shuffle(q.options.map((_, i) => i));
      ui.choice = null;
    }
  }
  function accountChoices(q) {
    const correct = unique([...q.debit, ...q.credit].map((l) => l[0]));
    const extra = unique((q.distractors || []).filter((a) => !correct.includes(a)));
    let list = [...correct, ...extra];
    for (const a of shuffle(BASIC_ACCOUNTS)) {
      if (list.length >= CHOICE_COUNT) break;
      if (!list.includes(a)) list.push(a);
    }
    if (list.length > CHOICE_COUNT) list = [...correct, ...extra.slice(0, Math.max(0, CHOICE_COUNT - correct.length))];
    return shuffle(list);
  }

  // 仕訳の採点（行の順番は問わない）
  function gradeJournal(q, slots) {
    const key = (a, n) => `${a}|${n}`;
    const sideOk = (side, lines) => {
      const mine = slots.filter((s) => s.side === side).map((s) => key(s.account, s.amount)).sort();
      const ans = lines.map((l) => key(l[0], l[1])).sort();
      return mine.length === ans.length && mine.every((v, i) => v === ans[i]);
    };
    return sideOk("debit", q.debit) && sideOk("credit", q.credit);
  }
  // 解答後の表示用：各欄が正解に含まれるか
  function markSlots(q, slots) {
    const pool = { debit: q.debit.map((l) => `${l[0]}|${l[1]}`), credit: q.credit.map((l) => `${l[0]}|${l[1]}`) };
    return slots.map((s) => {
      const k = `${s.account}|${s.amount}`;
      const i = pool[s.side].indexOf(k);
      if (i >= 0) { pool[s.side].splice(i, 1); return true; }
      return false;
    });
  }

  function submitAnswer() {
    const run = getRun(ui.runKey);
    const q = Q_BY_ID[ui.qid];
    if (!run || !q || ui.phase !== "answer") return;
    let correct;
    if (q.type === "journal") {
      if (ui.slots.some((s) => !s.account)) { ui.error = "すべての欄に科目を選んでください"; render(); return; }
      correct = gradeJournal(q, ui.slots);
      ui.marks = markSlots(q, ui.slots);
    } else {
      if (ui.choice === null) { ui.error = "選択肢を1つ選んでください"; render(); return; }
      correct = ui.choice === q.answer;
    }
    // 記録
    const r = S.questions[q.id] || (S.questions[q.id] = { correct: 0, wrong: 0, last: null, star: false, lastAt: null });
    if (correct) r.correct++; else r.wrong++;
    r.last = correct;
    r.lastAt = nowIso();
    const tk = todayKey();
    S.daily[tk] = (S.daily[tk] || 0) + 1;
    if (run.mode === "section") {
      ensureSec(run.sectionId).lastStudied = nowIso();
      S.lastSectionId = run.sectionId;
    }
    run.results[q.id] = correct;
    run.index += 1;
    run.updatedAt = nowIso();
    ui.phase = "feedback";
    ui.correct = correct;
    ui.error = "";
    ui.finished = run.index >= run.order.length;
    if (ui.finished) finishRun(run);
    save();
    render();
    window.scrollTo(0, 0);
  }

  function finishRun(run) {
    const total = run.order.length;
    const correct = run.order.filter((id) => run.results[id]).length;
    const res = {
      mode: run.mode, sectionId: run.sectionId || null, kind: run.kind || null,
      total, correct, items: run.order.map((id) => ({ id, ok: !!run.results[id] })), at: nowIso(),
    };
    if (run.mode === "section") {
      const rec = ensureSec(run.sectionId);
      rec.lastAccuracy = correct / total;
      if (correct * 100 >= total * LAP_PERCENT) {
        if (rec.lapDates.includes(todayKey())) {
          res.lap = "already";
        } else {
          rec.laps += 1;
          rec.lapDates.push(todayKey());
          res.lap = "counted";
          res.laps = rec.laps;
          res.mastered = rec.laps === LAPS_TO_MASTER;
        }
      } else {
        res.lap = "below";
      }
    }
    delete S.runs[run.key];
    if (S.lastRunKey === run.key) S.lastRunKey = null;
    S.lastResult = res;
  }

  function nextQuestion() {
    if (ui.finished) { ui = { runKey: null }; go("#/result", true); return; }
    setupQuestion();
    render();
    window.scrollTo(0, 0);
  }

  function toggleStar(id) {
    const r = S.questions[id] || (S.questions[id] = { correct: 0, wrong: 0, last: null, star: false, lastAt: null });
    r.star = !r.star;
    save();
    render();
    toast(r.star ? "★マークを付けました" : "★マークを外しました");
  }

  // ===== 画面：ホーム =====
  function viewHome() {
    const mastered = SECTIONS.filter((s) => status(s) === "mastered").length;
    const learning = SECTIONS.filter((s) => status(s) === "learning").length;
    const ready = SECTIONS.filter(hasQ).length;
    const today = S.daily[todayKey()] || 0;
    const pending = wrongIds().length + staleSections().length;
    const t = continueTarget();

    let contLabel, contAction;
    if (t.type === "run") {
      const r = t.run;
      const where = r.mode === "section" ? `${SECTION_BY_ID[r.sectionId].label} ${SECTION_BY_ID[r.sectionId].title}` : `復習（${r.kind === "wrong" ? "間違えた問題" : "★マーク"}）`;
      contLabel = `続きから：${where}（${r.index + 1}/${r.order.length}問目）`;
      contAction = `data-act="resume" data-key="${esc(r.key)}"`;
    } else if (t.type === "section") {
      const laps = secRec(t.sec.id)?.laps || 0;
      contLabel = `次は：${t.sec.label} ${t.sec.title}（第${laps + 1}周）`;
      contAction = `data-act="start" data-sec="${esc(t.sec.id)}"`;
    } else {
      contLabel = "今日の周回はすべて済みました。復習で仕上げましょう";
      contAction = `data-go="#/review"`;
    }

    const answered = Object.keys(S.questions).length;
    const expDays = daysAgo(S.lastExport);
    const backupNote = answered > 0 && (expDays === null || expDays >= 7)
      ? `<a class="card flat small" href="#/settings" style="display:block;text-decoration:none;color:var(--text-2)">記録のバックアップ：${expDays === null ? "まだ書き出していません" : `最後の書き出しから${expDays}日`}。設定から書き出せます。</a>`
      : "";

    const html = `
      <h1>簿記3級 復習</h1>
      <div class="card">
        <div class="small muted">全体の進捗（習得した節）</div>
        <div class="bignum"><b>${mastered}</b><span class="muted">/ ${SECTIONS.length}節</span><span class="small muted" style="margin-left:auto">${pct(mastered, SECTIONS.length)}%</span></div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${SECTIONS.length}" aria-valuenow="${mastered}"><span style="width:${pct(mastered, SECTIONS.length)}%"></span></div>
        <div class="tiny" style="margin-top:8px">学習中 ${learning}節 ・ 問題のある節 ${ready}節（全${TOTAL_Q}問）</div>
      </div>
      <div class="metrics">
        <div class="metric"><div class="label">今日解いた問題</div><div class="value">${today}<small>問</small></div></div>
        <a class="metric" href="#/review" style="text-decoration:none;color:inherit"><div class="label">復習待ち</div><div class="value">${pending}<small>件</small></div></a>
      </div>
      ${backupNote}
      ${!storageOk ? '<div class="notice ng">この環境では記録を保存できません。プライベートブラウズを解除してください。</div>' : ""}
      <div style="height:8px"></div>
      <div class="small muted" style="margin-bottom:6px">${esc(contLabel)}</div>
      <div class="stack">
        <button class="btn primary" ${contAction}>続きから</button>
        <a class="btn" href="#/review">復習する</a>
      </div>`;
    return { html, tab: "home" };
  }

  // ===== 画面：学習マップ =====
  function viewMap() {
    const groups = CHAPTER_LIST.map((ch) => {
      const tiles = ch.sections.map((s) => {
        const st = status(s);
        const title = `${s.label} ${s.title}（${STATUS_LABEL[st]}）`;
        return st === "prep"
          ? `<span class="tile prep" title="${esc(title)}"></span>`
          : `<button class="tile ${st}" data-go="#/sec/${esc(s.id)}" aria-label="${esc(title)}"></button>`;
      }).join("");
      return `<span class="ov-group"><span class="ov-label">${ch.no === 0 ? "序" : ch.no}</span>${tiles}</span>`;
    }).join("");

    const cards = CHAPTER_LIST.map((ch) => {
      const withQ = ch.sections.filter(hasQ);
      const mastered = ch.sections.filter((s) => status(s) === "mastered").length;
      const allPrep = withQ.length === 0;
      const rows = ch.sections.map((s) => {
        const st = status(s);
        if (st === "prep") {
          return `<div class="secrow prep"><div class="main"><div class="name"><span class="num">${esc(s.label)}</span>${esc(s.title)}</div><div class="sub">教科書 p.${s.page}〜</div></div>${pill("prep")}</div>`;
        }
        const r = secRec(s.id);
        const acc = r && r.lastAccuracy !== null && r.lastAccuracy !== undefined ? `${Math.round(r.lastAccuracy * 100)}%` : "−";
        const run = S.runs[s.id];
        const extra = run ? ` ・ 途中 ${run.index}/${run.order.length}` : "";
        return `<button class="secrow" data-go="#/sec/${esc(s.id)}">
          <div class="main"><div class="name"><span class="num">${esc(s.label)}</span>${esc(s.title)}</div>
          <div class="sub">p.${s.page}〜 ・ 正答率 ${acc} ・ ${(Q_BY_SECTION[s.id] || []).length}問${extra}</div></div>
          ${dots(r?.laps || 0)}${pill(st)}</button>`;
      }).join("");
      return `<section class="card chapter${allPrep ? " prep" : ""}" style="padding:12px 0 0">
        <div class="card-head"><h2>${ch.name} ${esc(ch.title)}</h2><span class="count">${allPrep ? "準備中" : `${mastered}/${ch.sections.length} 習得`}</span></div>
        ${rows}</section>`;
    }).join("");

    const html = `
      <h1>学習マップ</h1>
      <div class="overview" aria-label="全節の一覧">${groups}</div>
      <div class="legend">
        <span><i class="tile mastered"></i>習得済み</span><span><i class="tile learning"></i>学習中</span>
        <span><i class="tile new"></i>未着手</span><span><i class="tile prep"></i>準備中</span>
        <span>${dots(1)} 周回（${LAPS_TO_MASTER}周で習得）</span>
      </div>
      ${cards}`;
    return { html, tab: "map" };
  }

  // ===== 画面：節 =====
  function viewSection(id) {
    const sec = SECTION_BY_ID[id];
    if (!sec) return null;
    const qs = Q_BY_SECTION[id] || [];
    const st = status(sec);
    const r = secRec(id);
    const laps = r?.laps || 0;
    const run = getRun(id);
    const acc = r && r.lastAccuracy !== null && r.lastAccuracy !== undefined ? `${Math.round(r.lastAccuracy * 100)}%` : "−";

    let notice = "";
    if (st === "prep") notice = `<div class="notice">この節の問題は準備中です。教科書 p.${sec.page}〜 を読んで進めましょう。</div>`;
    else if (lapCountedToday(id)) notice = `<div class="notice ok">今日はこの節の周回を数えました。解き直すことはできますが、次の周は明日以降に数えます。</div>`;

    const list = qs.map((q, i) => {
      const qr = S.questions[q.id];
      const mark = !qr || qr.last === null ? '<span class="mark none">−</span>' : qr.last ? '<span class="mark ok">○</span>' : '<span class="mark ng">×</span>';
      return `<li>${mark}<span class="qt">${esc(q.text)}</span>${qr?.star ? '<span class="st">★</span>' : ""}</li>`;
    }).join("");

    let dock = "";
    if (qs.length) {
      const label = run ? `続きから（${run.index + 1}/${run.order.length}問目）`
        : lapCountedToday(id) ? "もう一度解く"
        : laps >= LAPS_TO_MASTER ? `もう一度解く（${laps + 1}周目）`
        : `第${laps + 1}周を始める`;
      dock = `<button class="btn primary" data-act="${run ? "resume" : "start"}" data-key="${esc(id)}" data-sec="${esc(id)}">${label}</button>`;
    }

    const html = `
      <div class="backrow"><a class="iconbtn" href="#/map" aria-label="学習マップへ戻る">${ICON.back}</a>${sec.chapter.name} ${esc(sec.chapter.title)}</div>
      <h1>${esc(sec.label)} ${esc(sec.title)}</h1>
      <div class="card">
        <div class="page-badge"><span class="muted">教科書</span><b>p.${sec.page}〜</b></div>
        <div class="statgrid">
          <div><div class="label">周回</div><div class="value">${dots(laps, true)} <span style="margin-left:4px">${laps}周</span></div></div>
          <div><div class="label">状態</div><div class="value">${pill(st)}</div></div>
          <div><div class="label">直近の正答率</div><div class="value">${acc}</div></div>
          <div><div class="label">最後に学習</div><div class="value">${agoText(daysAgo(r?.lastStudied))}</div></div>
        </div>
      </div>
      ${notice}
      ${run ? `<div class="small muted" style="margin:-4px 0 8px">途中まで解いた周があります。<button class="linkbtn" data-act="restart" data-sec="${esc(id)}">最初からやり直す</button></div>` : ""}
      ${qs.length ? `<div class="card"><div class="card-head"><h2>問題（${qs.length}問）</h2></div><ul class="qlist">${list}</ul></div>` : ""}
      <p class="tiny">正答率${LAP_PERCENT}%以上で1周（1日1回まで）。${LAPS_TO_MASTER}周で習得済みになります。</p>`;
    return { html, dock, tab: "map" };
  }

  // ===== 画面：問題 =====
  function viewQuiz() {
    let run = ui.runKey ? getRun(ui.runKey) : null;
    if (!run && !(ui.phase === "feedback" && ui.finished)) {
      // 再読み込み時などは最後の周を開き直す
      const key = S.lastRunKey && getRun(S.lastRunKey) ? S.lastRunKey : null;
      if (!key) return null;
      ui = { runKey: key };
      setupQuestion();
      run = getRun(key);
    }
    const q = Q_BY_ID[ui.qid];
    if (!q) return null;
    const sec = SECTION_BY_ID[q.section];
    const total = ui.total;
    const num = ui.phase === "feedback" ? (run ? run.index : total) : run.index + 1;
    const starred = !!S.questions[q.id]?.star;

    // 何周目か（解き終えた直後は結果に合わせる）
    let lapText = "";
    if (ui.mode === "section") {
      const res = ui.finished ? S.lastResult : null;
      if (res && res.lap === "counted") lapText = `第${res.laps}周`;
      else if (res ? res.lap === "already" : lapCountedToday(q.section)) lapText = "解き直し（周回は明日以降に数えます）";
      else lapText = `第${(secRec(q.section)?.laps || 0) + 1}周`;
    }
    const meta = ui.mode === "section"
      ? `教科書 p.${sec.page}〜 ・ ${lapText}`
      : `復習 ・ ${esc(sec.label)} ${esc(sec.title)}（p.${sec.page}〜）`;
    const title = ui.mode === "section" ? `${sec.label} ${sec.title}` : ui.kind === "star" ? "★マークの問題" : "間違えた問題";
    const backTo = ui.mode === "section" ? `#/sec/${q.section}` : "#/review";

    let body = "";
    if (q.type === "journal") body = journalHtml(q);
    else body = choiceHtml(q);

    let feedback = "";
    if (ui.phase === "feedback") {
      const answerTable = q.type === "journal" ? `
        <div class="explain-label">正解の仕訳</div>
        <table class="answer-table"><thead><tr><th>借方科目</th><th style="text-align:right">金額</th><th>貸方科目</th><th style="text-align:right">金額</th></tr></thead><tbody>
        ${Array.from({ length: Math.max(q.debit.length, q.credit.length) }, (_, i) => {
          const d = q.debit[i]; const c = q.credit[i];
          return `<tr><td>${d ? acctLabel(d[0]) : ""}</td><td class="amt">${d ? yen(d[1]) : ""}</td><td>${c ? acctLabel(c[0]) : ""}</td><td class="amt">${c ? yen(c[1]) : ""}</td></tr>`;
        }).join("")}</tbody></table>` : "";
      feedback = `
        <div class="verdict ${ui.correct ? "ok" : "ng"}" role="status"><span class="mk">${ui.correct ? "○" : "×"}</span>${ui.correct ? "正解" : "不正解"}</div>
        <div class="card">
          ${answerTable}
          ${answerTable ? '<div style="height:12px"></div>' : ""}
          <div class="explain-label">解説</div>
          <div class="explain">${esc(q.explanation || "")}</div>
        </div>`;
    }

    const dock = ui.phase === "answer"
      ? `${ui.error ? `<p class="err" role="alert">${esc(ui.error)}</p>` : ""}<button class="btn primary" data-act="submit">解答する</button>`
      : `<button class="btn primary" data-act="next">${ui.finished ? "結果を見る" : "次の問題へ"}</button>`;

    const html = `
      <div class="qtop">
        <a class="iconbtn" href="${backTo}" aria-label="中断して戻る（途中から再開できます）">${ICON.close}</a>
        <span class="title">${esc(title)}</span>
        <span class="count">${num} / ${total}</span>
        <button class="iconbtn${starred ? " star-on" : ""}" data-act="star" data-q="${esc(q.id)}" aria-pressed="${starred}" aria-label="★マーク">${ICON.star}</button>
      </div>
      <div class="bar thin" style="margin:2px 0 8px"><span style="width:${pct(num, total)}%"></span></div>
      <p class="qmeta">${meta}</p>
      <div class="qtext">${esc(q.text)}</div>
      ${body}
      ${feedback}`;
    return { html, dock, tab: null };
  }

  function journalHtml(q) {
    const fb = ui.phase === "feedback";
    const slotHtml = (side) => ui.slots.map((s, i) => {
      if (s.side !== side) return "";
      let cls = "slot";
      if (fb) cls += ui.marks[i] ? " ok" : " ng";
      else if (ui.sel === i) cls += " sel";
      else if (s.account) cls += " filled";
      const acct = s.account ? `<span class="acct">${acctLabel(s.account)}</span>` : '<span class="acct empty">科目を選ぶ</span>';
      return `<button class="${cls}" data-act="slot" data-i="${i}" ${fb ? "disabled" : ""} aria-label="${side === "debit" ? "借方" : "貸方"} ${yen(s.amount)}円 ${s.account || "未選択"}">${acct}<span class="amt">${yen(s.amount)}</span></button>`;
    }).join("");
    const chips = fb ? "" : `
      <p class="hint">欄を選んでから、科目をタップしてください。</p>
      <div class="chips">${ui.accounts.map((a) => `<button class="chip" data-act="acct" data-a="${esc(a)}">${acctLabel(a)}</button>`).join("")}</div>`;
    return `
      <div class="je">
        <div class="je-col"><div class="je-h">借方</div>${slotHtml("debit")}</div>
        <div class="je-col"><div class="je-h">貸方</div>${slotHtml("credit")}</div>
      </div>${chips}`;
  }

  function choiceHtml(q) {
    const fb = ui.phase === "feedback";
    return `<div class="opts" role="radiogroup">${ui.order.map((oi, pos) => {
      let cls = "opt";
      if (fb) {
        if (oi === q.answer) cls += " ok";
        else if (oi === ui.choice) cls += " ng";
      } else if (ui.choice === oi) cls += " sel";
      return `<button class="${cls}" role="radio" aria-checked="${ui.choice === oi}" data-act="opt" data-o="${oi}" ${fb ? "disabled" : ""}><span class="lt">${LETTERS[pos]}</span><span>${esc(q.options[oi])}</span></button>`;
    }).join("")}</div>`;
  }

  // ===== 画面：結果 =====
  function viewResult() {
    const res = S.lastResult;
    if (!res) return null;
    const p = pct(res.correct, res.total);
    let msg = "";
    let primary = "";
    if (res.mode === "section") {
      const sec = SECTION_BY_ID[res.sectionId];
      const laps = secRec(res.sectionId)?.laps || 0;
      if (res.lap === "counted") {
        msg = res.mastered
          ? `<div class="notice ok"><b>習得済みになりました。</b>${LAPS_TO_MASTER}周を達成しました。7日以上あいたら復習に出てきます。</div>`
          : `<div class="notice ok"><b>第${res.laps}周を達成しました。</b>あと${Math.max(LAPS_TO_MASTER - res.laps, 0)}周で習得済みです。次の周は明日以降に数えます。</div>`;
      } else if (res.lap === "already") {
        msg = `<div class="notice">正答率${LAP_PERCENT}%以上でしたが、今日はこの節の周回をすでに数えています。明日以降に解くと次の周になります。</div>`;
      } else {
        msg = `<div class="notice ng">正答率が${LAP_PERCENT}%に届かなかったため、周回には数えません。解説を読み直して、もう一度解いてみましょう。</div>`;
      }
      msg += `<div class="center" style="margin:4px 0 14px">${dots(laps, true)}<div class="tiny">${esc(sec.label)} ${esc(sec.title)} ・ ${laps}周</div></div>`;
      primary = `<button class="btn primary" data-act="start" data-sec="${esc(res.sectionId)}">もう一度解く</button>`;
    } else {
      msg = `<div class="notice">復習モードの結果は周回には数えません。正解した問題は「間違えた問題」から外れます。</div>`;
      primary = `<a class="btn primary" href="#/review">復習に戻る</a>`;
    }
    const items = res.items.map((it) => {
      const q = Q_BY_ID[it.id];
      if (!q) return "";
      return `<li><span class="mark ${it.ok ? "ok" : "ng"}">${it.ok ? "○" : "×"}</span><span class="qt">${esc(q.text)}</span>${S.questions[it.id]?.star ? '<span class="st">★</span>' : ""}</li>`;
    }).join("");
    const html = `
      <h1>結果</h1>
      <div class="score"><div class="pct">${p}%</div><div class="raw">${res.total}問中 ${res.correct}問正解</div></div>
      ${msg}
      <div class="card"><ul class="qlist">${items}</ul></div>
      <div class="btn-row"><a class="btn small" href="#/map">マップへ</a><a class="btn small" href="#/">ホームへ</a></div>`;
    return { html, dock: primary, tab: null };
  }

  // ===== 画面：復習 =====
  function viewReview() {
    const w = wrongIds().length;
    const s = starIds().length;
    const stale = staleSections();
    const run = getRun("review");
    const staleRows = stale.length
      ? stale.map(({ sec, days }) => `<button class="secrow" data-go="#/sec/${esc(sec.id)}"><div class="main"><div class="name"><span class="num">${esc(sec.label)}</span>${esc(sec.title)}</div><div class="sub">p.${sec.page}〜 ・ ${pill(status(sec))}</div></div><span class="small muted">${days}日前</span>${ICON.chev}</button>`).join("")
      : `<div class="small muted" style="padding:4px 16px 14px">今はありません。</div>`;
    const html = `
      <h1>復習</h1>
      ${run ? `<div class="card"><div class="small muted">途中の復習：${run.kind === "wrong" ? "間違えた問題" : "★マーク"}（${run.index + 1}/${run.order.length}問目）</div><button class="btn primary small" style="margin-top:8px" data-act="resume" data-key="review">続きから</button></div>` : ""}
      <div class="card">
        <div class="card-head"><h2><span style="color:var(--ng)">×</span> 間違えた問題</h2><b>${w}問</b></div>
        <div class="tiny" style="margin-bottom:8px">最後に解いたときに不正解だった問題</div>
        ${w ? `<button class="btn small" data-act="review" data-kind="wrong">まとめて解く</button>` : `<div class="small muted">今はありません。</div>`}
      </div>
      <div class="card">
        <div class="card-head"><h2><span style="color:var(--star)">★</span> ★マークした問題</h2><b>${s}問</b></div>
        <div class="tiny" style="margin-bottom:8px">問題の画面の右上の★で付け外しできます</div>
        ${s ? `<button class="btn small" data-act="review" data-kind="star">まとめて解く</button>` : `<div class="small muted">今はありません。</div>`}
      </div>
      <section class="card chapter" style="padding:12px 0 0">
        <div class="card-head"><h2>最後に解いてから${STALE_DAYS}日以上たった節</h2><span class="count">${stale.length}節</span></div>
        ${staleRows}
      </section>
      <p class="tiny">復習モードで解いた結果は周回には数えません。</p>`;
    return { html, tab: "review" };
  }

  // ===== 画面：設定 =====
  function viewSettings() {
    const theme = S.settings.theme || "auto";
    const seg = [["auto", "自動"], ["light", "ライト"], ["dark", "ダーク"]]
      .map(([v, l]) => `<button class="${theme === v ? "on" : ""}" data-act="theme" data-v="${v}" aria-pressed="${theme === v}">${l}</button>`).join("");
    const exp = S.lastExport ? `${new Date(S.lastExport).toLocaleDateString("ja-JP")}（${agoText(daysAgo(S.lastExport))}）` : "まだありません";
    const answered = Object.keys(S.questions).length;
    const html = `
      <h1>設定</h1>
      <div class="card">
        <h2>テーマ</h2>
        <div class="seg">${seg}</div>
      </div>
      <div class="card">
        <h2>記録のバックアップ</h2>
        <div class="kv"><span class="muted">最後の書き出し</span><span>${exp}</span></div>
        <p class="small muted" style="margin:6px 0 10px">記録はこのブラウザの中だけに保存されています。ときどき書き出しておくと、消えたときや機種変更のときに読み込んで戻せます。iPhoneでは共有メニューの「"ファイル"に保存」を選んでください。</p>
        <div class="stack">
          <button class="btn" data-act="export">記録を書き出す</button>
          <button class="btn" data-act="import">記録を読み込む</button>
        </div>
        <input id="importFile" type="file" hidden>
      </div>
      <div class="card">
        <h2>進捗のルール</h2>
        <p class="small muted" style="margin:0">節の全問を解き、正答率${LAP_PERCENT}%以上で1周。同じ節の周回は1日1回まで数えます。${LAPS_TO_MASTER}周で習得済みになります。</p>
      </div>
      <div class="card">
        <h2>このアプリについて</h2>
        <div class="kv"><span class="muted">問題数</span><span>${TOTAL_Q}問</span></div>
        <div class="kv"><span class="muted">問題のある節</span><span>${SECTIONS.filter(hasQ).length} / ${SECTIONS.length}節</span></div>
        <div class="kv"><span class="muted">解いたことのある問題</span><span>${answered}問</span></div>
        ${DATA_WARNINGS.length ? `<div class="small" style="margin-top:8px;color:var(--ng)">問題データに確認が必要な点があります（その問題は出題されません）</div><ul class="warnlist">${DATA_WARNINGS.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      </div>
      <button class="btn danger" data-act="reset">記録をリセット</button>`;
    return { html, tab: "settings" };
  }

  // ===== 書き出し・読み込み =====
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  async function exportData() {
    const now = nowIso();
    const data = JSON.stringify({ app: "boki3", exportedAt: now, ...S, lastExport: now }, null, 1);
    const name = `boki3-record-${todayKey()}.json`;
    const done = () => { S.lastExport = now; save(); render(); toast("記録を書き出しました"); };
    if (isIOS() && typeof File === "function" && navigator.canShare) {
      const file = new File([data], name, { type: "application/json" });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); done(); } catch (e) { if (e.name !== "AbortError") downloadFile(data, name, done); }
        return;
      }
    }
    downloadFile(data, name, done);
  }
  function downloadFile(data, name, done) {
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    done();
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let d;
      try { d = JSON.parse(reader.result); } catch (e) { d = null; }
      if (!isObj(d) || d.version !== 1 || !isObj(d.sections) || !isObj(d.questions)) {
        alert("読み込めませんでした。このアプリで書き出したファイル（boki3-record-….json）を選んでください。");
        return;
      }
      const when = d.exportedAt ? new Date(d.exportedAt).toLocaleString("ja-JP") : "不明";
      if (!confirm(`${when} に書き出した記録を読み込みます。\n今の記録は上書きされます。よろしいですか？`)) return;
      S = normalize(d);
      save();
      applyTheme();
      ui = { runKey: null };
      render();
      toast("記録を読み込みました");
    };
    reader.onerror = () => alert("ファイルを読み込めませんでした。");
    reader.readAsText(file);
  }

  // ===== テーマ =====
  const THEME_META = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => ({ m, content: m.content, media: m.media }));
  function applyTheme() {
    const t = S.settings.theme;
    const forced = t === "light" || t === "dark";
    if (forced) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    THEME_META.forEach(({ m, content, media }) => {
      if (forced) { m.content = bg; m.removeAttribute("media"); }
      else { m.content = content; m.setAttribute("media", media); }
    });
  }

  // ===== トースト =====
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
  }

  // ===== 画面の切り替え =====
  function go(hash, replace) {
    if (location.hash === hash) { render(); return; }
    if (replace) location.replace(hash);
    else location.hash = hash;
  }
  function route() {
    const h = location.hash.replace(/^#/, "") || "/";
    if (h === "/" || h === "") return viewHome();
    if (h === "/map") return viewMap();
    if (h === "/review") return viewReview();
    if (h === "/settings") return viewSettings();
    if (h === "/quiz") return viewQuiz();
    if (h === "/result") return viewResult();
    const m = h.match(/^\/sec\/(.+)$/);
    if (m) return viewSection(decodeURIComponent(m[1]));
    return null;
  }
  let lastHash = null;
  function render() {
    let v = route();
    if (!v) { location.replace("#/"); v = viewHome(); }
    document.getElementById("app").innerHTML = v.html;
    const dock = document.getElementById("dock");
    if (v.dock) {
      dock.innerHTML = `<div>${v.dock}</div>`;
      dock.hidden = false;
    } else {
      dock.innerHTML = "";
      dock.hidden = true;
    }
    document.body.classList.toggle("has-dock", !!v.dock);
    const tabbar = document.getElementById("tabbar");
    tabbar.hidden = !!v.dock;
    tabbar.querySelectorAll("a").forEach((a) => a.classList.toggle("on", a.dataset.tab === v.tab));
    if (location.hash !== lastHash) { lastHash = location.hash; window.scrollTo(0, 0); }
  }

  // ===== 操作 =====
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act], [data-go]");
    if (!el) return;
    if (el.dataset.go) { go(el.dataset.go); return; }
    const act = el.dataset.act;
    switch (act) {
      case "start": startSectionRun(el.dataset.sec); break;
      case "resume": if (getRun(el.dataset.key)) openRun(el.dataset.key); else render(); break;
      case "restart":
        if (confirm("途中の記録を消して、この節を最初から解き直しますか？\n（解いた問題の正誤の記録は残ります）")) startSectionRun(el.dataset.sec);
        break;
      case "review": startReviewRun(el.dataset.kind); break;
      case "slot":
        if (ui.phase !== "answer") break;
        ui.sel = Number(el.dataset.i);
        ui.error = "";
        render();
        break;
      case "acct": {
        if (ui.phase !== "answer") break;
        let i = ui.sel;
        if (i === null || i === undefined || i < 0) i = ui.slots.findIndex((s) => !s.account);
        if (i < 0) break;
        ui.slots[i].account = el.dataset.a;
        ui.error = "";
        // 次の空欄へ自動で移る
        const next = ui.slots.findIndex((s, k) => k > i && !s.account);
        const first = ui.slots.findIndex((s) => !s.account);
        ui.sel = next >= 0 ? next : first >= 0 ? first : -1;
        render();
        break;
      }
      case "opt":
        if (ui.phase !== "answer") break;
        ui.choice = Number(el.dataset.o);
        ui.error = "";
        render();
        break;
      case "submit": submitAnswer(); break;
      case "next": nextQuestion(); break;
      case "star": toggleStar(el.dataset.q); break;
      case "theme":
        S.settings.theme = el.dataset.v;
        save();
        applyTheme();
        render();
        break;
      case "export": exportData(); break;
      case "import": document.getElementById("importFile").click(); break;
      case "reset":
        if (confirm("すべての学習記録を消去します。元に戻せません。\n先に「記録を書き出す」でバックアップすることをおすすめします。\n消去しますか？")) {
          const theme = S.settings.theme;
          S = freshState();
          S.settings.theme = theme;
          ui = { runKey: null };
          save();
          render();
          toast("記録をリセットしました");
        }
        break;
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "importFile" && e.target.files[0]) {
      importData(e.target.files[0]);
      e.target.value = "";
    }
  });
  window.addEventListener("hashchange", render);
  // 別のタブで記録が変わったら読み直す
  window.addEventListener("storage", (e) => { if (e.key === STORE_KEY) { S = load(); render(); } });

  // ===== 起動 =====
  applyTheme();
  render();

  // Webサーバーから開いたとき：ホーム画面のアプリ化とオフライン対応
  if (/^https?:$/.test(location.protocol)) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "manifest.json";
    document.head.appendChild(link);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
