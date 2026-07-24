/* ==========================================================================
   MANNA v1.4.0  — Daily Sabbath Bible Lesson for Photoshop (UXP)
   © 2026 Sergio (Maestro). All rights reserved.
   --------------------------------------------------------------------------
   Lessons:  https://app.sdarm.org/sbl/data/<lang>/<lang>-<year>-<quarter>.json
   Verses:   https://app.sdarm.org/bible/data/<lang>-<version>.json (exact SDARM text)
   Two modes:
     · DAY   — the whole day, one language, scroll.
     · CARDS — step sideways (question → verse → verse → commentary),
               shown in TWO languages at once (top / bottom, your choice).
   ========================================================================== */

/* ---------------- config ---------------- */

const LANGS = ["de", "en", "ru"];
const LOCALE = { de: "de-DE", en: "en-US", ru: "ru-RU" };
// SDARM's own Bible versions — exact match to sbl.sdarm.org
const BIBLE  = { de: "de-lut", en: "en-kjv", ru: "ru-rst" };
const T = {
    today:   { de: "Heute",  en: "Today",  ru: "Сегодня" },
    loading: { de: "Laden…", en: "Loading…", ru: "Загрузка…" },
    none:    { de: "Für diesen Tag gibt es keine Lektion.",
               en: "No lesson for this day.",
               ru: "На этот день урока нет." },
    offline: { de: "Keine Verbindung. Bitte später erneut versuchen.",
               en: "No connection. Please try again later.",
               ru: "Нет соединения. Попробуйте позже." },
    sabbath: { de: "Sabbat", en: "Sabbath", ru: "Суббота" },
    cards:   { de: "CARDS", en: "CARDS", ru: "КАРТЫ" },
    day:     { de: "DAY", en: "DAY", ru: "ДЕНЬ" }
};

// content-type kicker per card (shown in the top language)
const KIND = {
    question:   { de: "Frage", en: "Question", ru: "Вопрос" },
    commentary: { de: "Kommentar", en: "Commentary", ru: "Комментарий" },
    review:     { de: "Wiederholung", en: "Review", ru: "Повторение" },
    memory:     { de: "Leittext", en: "Key Text", ru: "Памятный стих" }
};
// bottom-stepper label per step type (top language)
const STEPWORD = {
    question:   KIND.question,
    commentary: KIND.commentary,
    review:     KIND.review,
    memory:     KIND.memory,
    verse:      { de: "Vers", en: "Verse", ru: "Стих" }
};

/* ---------------- state ---------------- */

let lang = localStorage.getItem("manna.lang") || "de";       // top language
if (LANGS.indexOf(lang) === -1) lang = "de";
let bottomLang = localStorage.getItem("manna.lang2") || "ru"; // bottom language
if (LANGS.indexOf(bottomLang) === -1 || bottomLang === lang) {
    bottomLang = lang === "de" ? "ru" : "de";
}
let currentMode = localStorage.getItem("manna.mode") || "full"; // full | cards
let current = new Date();          // the day being viewed
const quarters = {};               // `${lang}-${y}-${q}` -> data
const bibles = {};                 // versionId -> Promise<bible json>
let renderToken = 0;               // guards against out-of-order async renders
let cardSteps = [];
let cardIndex = 0;
let cardContextKey = "";

/* ---------------- dom ---------------- */

const $ = (id) => document.getElementById(id);
const contentEl = $("content");
const navDate = $("nav-date");
const navSub = $("nav-sub");
const navCenter = $("nav-center");
const footEl = $("foot");
const stepbar = $("stepbar");
const stepLabelEl = $("step-label");

/* ---------------- date helpers ---------------- */

function ymd(d) {
    return d.getFullYear() +
        ("0" + (d.getMonth() + 1)).slice(-2) +
        ("0" + d.getDate()).slice(-2);
}
function sameDay(a, b) { return ymd(a) === ymd(b); }
function quarterOf(d) { return Math.floor(d.getMonth() / 3) + 1; }
function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
}
function neighbors(y, q) {
    const list = [[y, q]];
    list.push(q === 1 ? [y - 1, 4] : [y, q - 1]);
    list.push(q === 4 ? [y + 1, 1] : [y, q + 1]);
    return list;
}
function fmtDate(d) {
    try {
        return new Intl.DateTimeFormat(LOCALE[lang], {
            weekday: "short", day: "numeric", month: "long"
        }).format(d);
    } catch (e) {
        return ymd(d);
    }
}

/* ---------------- data loading ---------------- */

async function loadQuarter(l, y, q) {
    const key = l + "-" + y + "-" + q;
    if (quarters[key]) return quarters[key];
    const url = "https://app.sdarm.org/sbl/data/" + l + "/" + l + "-" + y + "-" + q + ".json";
    try {
        const r = await fetch(url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data = await r.json();
        quarters[key] = data;
        try { localStorage.setItem("manna.q." + key, JSON.stringify(data)); } catch (e) {}
        return data;
    } catch (e) {
        try {
            const cached = localStorage.getItem("manna.q." + key);
            if (cached) { quarters[key] = JSON.parse(cached); return quarters[key]; }
        } catch (e2) {}
        return null;
    }
}

// Find the lesson/day for a date in a given language, searching this quarter
// and its neighbours (daily readings run Sun–Fri BEFORE the Sabbath, so a
// date can live in an adjacent quarter file).
async function findDayFor(d, l) {
    const target = ymd(d);
    const cand = neighbors(d.getFullYear(), quarterOf(d));
    let sawData = false;
    for (let i = 0; i < cand.length; i++) {
        const data = await loadQuarter(l, cand[i][0], cand[i][1]);
        if (!data || !data.lessons) continue;
        sawData = true;
        for (const lesson of data.lessons) {
            if (lesson.date === target) return { type: "sabbath", lesson, data };
            const dl = lesson.dailyLessons || [];
            for (const day of dl) {
                if (day.date === target) return { type: "day", lesson, day, data };
            }
        }
    }
    return { type: sawData ? "none" : "offline" };
}
function findDay(d) { return findDayFor(d, lang); }

/* ---------------- bible verses ---------------- */

function parseSeg(seg) {
    // "Acts.26.10" or "Acts.26.10-Acts.26.11"
    const dash = seg.split("-");
    const a = dash[0].split(".");
    const b = (dash[1] || dash[0]).split(".");
    return {
        book: a[0], chap: +a[1], v1: +a[2],
        echap: +(b[1] || a[1]), v2: +(b[2] || a[2])
    };
}

// Whole Bible per version (~4–6 MB), fetched once per session, kept in memory.
// Books are keyed by OSIS id; each is [chapter][verse] of strings.
function loadBible(version) {
    if (bibles[version]) return bibles[version];
    const url = "https://app.sdarm.org/bible/data/" + version + ".json";
    bibles[version] = fetch(url).then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
    }).catch((e) => { delete bibles[version]; throw e; });
    return bibles[version];
}

async function getVerseFor(sOsis, language) {
    const bible = await loadBible(BIBLE[language]);
    const books = (bible && bible.books) || {};
    const parts = String(sOsis).split(",");
    const rows = [];
    for (const raw of parts) {
        const seg = parseSeg(raw.trim());
        const chapters = books[seg.book];
        if (!chapters) continue;
        for (let c = seg.chap; c <= seg.echap; c++) {
            const vs = chapters[c - 1];
            if (!vs) continue;
            const from = (c === seg.chap) ? seg.v1 : 1;
            const to = (c === seg.echap) ? seg.v2 : vs.length;
            for (let n = from; n <= to; n++) {
                const t = vs[n - 1];
                if (t == null) continue;
                rows.push({ verse: n, text: String(t).trim() });
            }
        }
    }
    return rows;
}

function expandVerseRefs(sOsis) {
    const refs = [];
    const parts = String(sOsis).split(",");
    for (const raw of parts) {
        const seg = parseSeg(raw.trim());
        for (let c = seg.chap; c <= seg.echap; c++) {
            const from = (c === seg.chap) ? seg.v1 : 1;
            const to = (c === seg.echap) ? seg.v2 : 9999;
            for (let n = from; n <= to; n++) refs.push(seg.book + "." + c + "." + n);
        }
    }
    return refs;
}

/* ---------------- helpers ---------------- */

function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function normalizeBottomLang() {
    if (bottomLang === lang) {
        bottomLang = LANGS.find((l) => l !== lang) || lang;
    }
}
function versesHtml(rows) {
    return rows.map((r) => '<span class="vnum">' + r.verse + '</span>' + esc(r.text)).join(" ");
}

/* ---------------- full-day mode ---------------- */

function memVerseHtml(lesson) {
    const kt = lesson.keyText || {};
    const text = kt.text || lesson.keyTextVerse || "";
    const ref = (kt.ref && kt.ref.text) || "";
    if (!text) return "";
    return '<div class="memverse">' +
        '<div class="mv-label">' + esc({ de: "Leittext", en: "Key Text", ru: "Памятный стих" }[lang]) + '</div>' +
        '<div class="mv-text">' + esc(text) + '</div>' +
        (ref ? '<div class="mv-ref">' + esc(ref) + '</div>' : "") +
        '</div>';
}

function lessonHead(lesson) {
    return '<div class="lesson-kicker">' + esc(lesson.header || "") + '</div>' +
        '<div class="lesson-title">' + esc(lesson.title || "") + '</div>' +
        memVerseHtml(lesson);
}

function renderContent(info) {
    if (info.type === "offline") return { html: '<div class="msg error">' + esc(T.offline[lang]) + '</div>', tasks: [] };
    if (info.type === "none")    return { html: '<div class="msg">' + esc(T.none[lang]) + '</div>', tasks: [] };

    const tasks = [];
    let vid = 0;
    let html = lessonHead(info.lesson);

    if (info.type === "sabbath") {
        html += '<div class="section-title">' + esc(T.sabbath[lang]) + '</div>';
        if (info.lesson.keyNote && info.lesson.keyNote.text) {
            html += '<div class="note">' + esc(info.lesson.keyNote.text) + '</div>';
        }
        const rd = info.lesson.reading;
        if (rd && rd.reading && rd.reading.length) {
            html += '<div class="reading"><span class="rd-label">' + esc(rd.label || "") + '</span> ';
            html += rd.reading.map((x) => esc(x.label || "")).join("; ");
            html += '</div>';
        }
        return { html, tasks };
    }

    const day = info.day;
    if (day.sectionTitle) html += '<div class="section-title">' + esc(day.sectionTitle) + '</div>';

    for (const sub of (day.subsections || [])) {
        html += '<div class="qa">';
        for (const q of (sub.q || [])) {
            if (q.sOsis) {
                const id = "v" + (vid++);
                tasks.push({ id: id, sOsis: q.sOsis });
                html += '<div class="vref">' + esc(q.text || "") + '</div>';
                html += '<div class="verse loading" id="' + id + '">' + esc(T.loading[lang]) + '</div>';
            } else if (q.text) {
                html += '<div class="question">' + esc(q.text) + '</div>';
            }
        }
        for (const q of (sub.question || [])) {
            if (q && q.text) html += '<div class="question">' + esc(q.text) + '</div>';
        }
        for (const n of (sub.note || [])) {
            if (n && n.text) html += '<div class="note">' + esc(n.text) + '</div>';
        }
        html += '</div>';
    }

    for (const q of (day.reviewQuestions || [])) {
        if (q) html += '<div class="review-item">' + esc(q) + '</div>';
    }

    return { html, tasks };
}

/* ---------------- cards mode (bilingual, step by step) ---------------- */

function buildCardSteps(infoTop, infoBottom) {
    const steps = [];
    if (infoTop.type === "sabbath") {
        const lt = infoTop.lesson || {};
        const lb = (infoBottom && infoBottom.lesson) || {};
        const tt = (lt.keyText && lt.keyText.text) || lt.keyTextVerse || "";
        const tb = (lb.keyText && lb.keyText.text) || lb.keyTextVerse || "";
        if (tt) steps.push({ type: "text", kind: "memory", top: tt, bottom: tb });
        return steps;
    }
    if (infoTop.type !== "day") return steps;

    const subsT = (infoTop.day && infoTop.day.subsections) || [];
    const subsB = (infoBottom && infoBottom.day && infoBottom.day.subsections) || [];
    for (let i = 0; i < subsT.length; i++) {
        const st = subsT[i], sb = subsB[i] || {};
        const qT = st.q || [], qB = sb.q || [];
        for (let j = 0; j < qT.length; j++) {
            const q = qT[j];
            if (q.sOsis) {
                const refTop = (q.text || "").trim();
                for (const one of expandVerseRefs(q.sOsis)) {
                    steps.push({ type: "verse", sOsis: one, refTop: refTop });
                }
            } else if (q.text) {
                steps.push({ type: "text", kind: "question", top: q.text, bottom: (qB[j] && qB[j].text) || "" });
            }
        }
        const exT = st.question || [], exB = sb.question || [];
        for (let j = 0; j < exT.length; j++) {
            if (exT[j] && exT[j].text) {
                steps.push({ type: "text", kind: "question", top: exT[j].text, bottom: (exB[j] && exB[j].text) || "" });
            }
        }
        const nT = st.note || [], nB = sb.note || [];
        for (let j = 0; j < nT.length; j++) {
            if (nT[j] && nT[j].text) {
                steps.push({ type: "text", kind: "commentary", top: nT[j].text, bottom: (nB[j] && nB[j].text) || "" });
            }
        }
    }
    const rT = (infoTop.day && infoTop.day.reviewQuestions) || [];
    const rB = (infoBottom && infoBottom.day && infoBottom.day.reviewQuestions) || [];
    for (let j = 0; j < rT.length; j++) {
        if (rT[j]) steps.push({ type: "text", kind: "review", top: rT[j], bottom: rB[j] || "" });
    }
    return steps;
}

function vId(sOsis, l) { return "cs-" + sOsis + "-" + l; }

function renderCardStep(step) {
    let kicker = "";
    let body = "";
    if (step.type === "verse") {
        kicker = step.refTop || "";
        const top = '<div class="c-verse loading" id="' + vId(step.sOsis, lang) + '">' + esc(T.loading[lang]) + '</div>';
        const bot = '<div class="c-verse loading" id="' + vId(step.sOsis, bottomLang) + '">' + esc(T.loading[lang]) + '</div>';
        body = '<div class="bi">' + top + '<div class="bi-sep"></div>' + bot + '</div>';
    } else {
        kicker = (KIND[step.kind] && KIND[step.kind][lang]) || "";
        const top = '<div class="c-text">' + esc(step.top) + '</div>';
        const bot = '<div class="c-text">' + esc(step.bottom) + '</div>';
        body = '<div class="bi">' + top + '<div class="bi-sep"></div>' + bot + '</div>';
    }
    return '<div class="card-shell">' +
        (kicker ? '<div class="card-label">' + esc(kicker) + '</div>' : "") +
        body + '</div>';
}

function renderCards(infoTop, infoBottom) {
    if (infoTop.type === "offline") return { html: '<div class="msg error">' + esc(T.offline[lang]) + '</div>', tasks: [], label: "" };
    if (infoTop.type === "none")    return { html: '<div class="msg">' + esc(T.none[lang]) + '</div>', tasks: [], label: "" };

    const ctx = ymd(current) + "|" + lang + "|" + bottomLang;
    if (cardContextKey !== ctx) {
        cardSteps = buildCardSteps(infoTop, infoBottom);
        cardContextKey = ctx;
    }
    if (!cardSteps.length) return { html: '<div class="msg">' + esc(T.none[lang]) + '</div>', tasks: [], label: "" };
    if (cardIndex < 0) cardIndex = cardSteps.length - 1;
    if (cardIndex >= cardSteps.length) cardIndex = 0;

    const step = cardSteps[cardIndex];
    let html = '<div class="card-header">';
    html += '<div class="card-title">' + esc((infoTop.lesson && infoTop.lesson.title) || "") + '</div>';
    html += '</div>';
    html += renderCardStep(step);

    let word;
    if (step.type === "verse") {
        word = (STEPWORD.verse[lang] || "") + " " + step.sOsis.split(".")[2];
    } else {
        word = (STEPWORD[step.kind] && STEPWORD[step.kind][lang]) || "";
    }
    const label = word + "  ·  " + (cardIndex + 1) + " / " + cardSteps.length;

    const tasks = step.type === "verse" ? [
        { id: vId(step.sOsis, lang), sOsis: step.sOsis, language: lang },
        { id: vId(step.sOsis, bottomLang), sOsis: step.sOsis, language: bottomLang }
    ] : [];
    return { html, tasks, label };
}

/* ---------------- render ---------------- */

async function render() {
    const token = ++renderToken;

    navDate.textContent = fmtDate(current);
    const isToday = sameDay(current, new Date());
    navCenter.classList.toggle("is-today", isToday);
    navSub.textContent = isToday ? T.today[lang].toUpperCase() : String(current.getFullYear());

    contentEl.innerHTML = '<div class="msg">' + esc(T.loading[lang]) + '</div>';

    const info = await findDay(current);
    if (token !== renderToken) return;

    let result;
    if (currentMode === "cards") {
        const infoBottom = await findDayFor(current, bottomLang);
        if (token !== renderToken) return;
        result = renderCards(info, infoBottom);
    } else {
        result = renderContent(info);
    }

    contentEl.innerHTML = result.html;
    footEl.textContent = "MANNA · Sabbath Bible Lessons";

    if (currentMode === "cards" && result.label) {
        stepLabelEl.textContent = result.label;
        stepbar.classList.remove("hidden");
    } else {
        stepbar.classList.add("hidden");
    }

    // fill verses asynchronously
    for (const t of result.tasks) {
        const taskLang = t.language || lang;
        getVerseFor(t.sOsis, taskLang).then((rows) => {
            if (token !== renderToken) return;
            const el = $(t.id);
            if (!el) return;
            if (t.language) {                       // bilingual card verse
                el.classList.remove("loading");
                if (rows.length) { el.innerHTML = versesHtml(rows); }
                else { el.classList.add("error"); el.textContent = "—"; }
            } else {                                // full-day verse
                if (rows.length) { el.className = "verse"; el.innerHTML = versesHtml(rows); }
                else { el.className = "verse error"; el.textContent = "—"; }
            }
        }).catch(() => {
            if (token !== renderToken) return;
            const el = $(t.id);
            if (!el) return;
            if (t.language) { el.classList.remove("loading"); el.classList.add("error"); el.textContent = "—"; }
            else { el.className = "verse error"; el.textContent = "—"; }
        });
    }
}

/* ---------------- events ---------------- */

// Top arrows = change the day (both modes). Center = jump to today.
$("prev").addEventListener("click", () => { current = addDays(current, -1); cardIndex = 0; render(); });
$("next").addEventListener("click", () => { current = addDays(current, 1); cardIndex = 0; render(); });
navCenter.addEventListener("click", () => { current = new Date(); cardIndex = 0; render(); });

// Bottom stepper = step through the cards, rolling into days at the ends.
$("step-prev").addEventListener("click", () => {
    if (!cardSteps.length) return;
    if (cardIndex <= 0) { current = addDays(current, -1); cardIndex = -1; }
    else cardIndex--;
    render();
});
$("step-next").addEventListener("click", () => {
    if (!cardSteps.length) return;
    if (cardIndex >= cardSteps.length - 1) { current = addDays(current, 1); cardIndex = 0; }
    else cardIndex++;
    render();
});

// Burger → settings drawer
$("burger").addEventListener("click", () => {
    const open = $("drawer").classList.toggle("hidden") === false;
    $("burger").classList.toggle("open", open);
});

// Mode segmented control
document.querySelectorAll(".seg-opt").forEach((el) => {
    el.addEventListener("click", () => {
        const m = el.dataset.mode;
        if (m === currentMode) return;
        currentMode = m;
        localStorage.setItem("manna.mode", currentMode);
        cardIndex = 0;
        cardContextKey = "";
        setModeUI();
        render();
    });
});

// Top language row
document.querySelectorAll("#langrow-top .lang-opt").forEach((el) => {
    el.addEventListener("click", () => {
        const l = el.dataset.lang;
        if (l === lang) return;
        if (l === bottomLang) bottomLang = lang;   // swap instead of colliding
        lang = l;
        localStorage.setItem("manna.lang", lang);
        localStorage.setItem("manna.lang2", bottomLang);
        cardContextKey = "";
        setLangUI();
        render();
    });
});
// Bottom language row
document.querySelectorAll(".lang2-opt").forEach((el) => {
    el.addEventListener("click", () => {
        const l = el.dataset.lang;
        if (l === bottomLang) return;
        if (l === lang) lang = bottomLang;          // swap instead of colliding
        bottomLang = l;
        localStorage.setItem("manna.lang", lang);
        localStorage.setItem("manna.lang2", bottomLang);
        cardContextKey = "";
        setLangUI();
        render();
    });
});
$("swap-lang").addEventListener("click", () => {
    const t = lang; lang = bottomLang; bottomLang = t;
    localStorage.setItem("manna.lang", lang);
    localStorage.setItem("manna.lang2", bottomLang);
    cardContextKey = "";
    setLangUI();
    render();
});

/* ---------------- ui state ---------------- */

function setLangUI() {
    normalizeBottomLang();
    document.querySelectorAll("#langrow-top .lang-opt").forEach((el) => {
        el.classList.toggle("active", el.dataset.lang === lang);
    });
    document.querySelectorAll(".lang2-opt").forEach((el) => {
        el.classList.toggle("active", el.dataset.lang === bottomLang);
    });
}

function setModeUI() {
    document.querySelectorAll(".seg-opt").forEach((el) => {
        el.classList.toggle("active", el.dataset.mode === currentMode);
    });
    $("langrow-bot").classList.toggle("hidden", currentMode !== "cards");
    if (currentMode !== "cards") stepbar.classList.add("hidden");
}

/* ---------------- init ---------------- */

setLangUI();
setModeUI();
render();
