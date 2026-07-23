/* ==========================================================================
   MANNA v1.1.0  — Daily Sabbath Bible Lesson for Photoshop (UXP)
   © 2026 Sergio (Maestro). All rights reserved.
   --------------------------------------------------------------------------
   Lessons:  https://app.sdarm.org/sbl/data/<lang>/<lang>-<year>-<quarter>.json
   Verses:   https://api.getbible.net/v2/<translation>/<booknr>/<chapter>.json
   One day at a time: question → scripture answer → commentary.
   ========================================================================== */

/* ---------------- config ---------------- */

const LANGS = ["de", "en", "ru"];
const LOCALE = { de: "de-DE", en: "en-US", ru: "ru-RU" };
const BIBLE  = { de: "schlachter", en: "kjv", ru: "synodal" };
const T = {
    today:   { de: "Heute",  en: "Today",  ru: "Сегодня" },
    loading: { de: "Laden…", en: "Loading…", ru: "Загрузка…" },
    none:    { de: "Für diesen Tag gibt es keine Lektion.",
               en: "No lesson for this day.",
               ru: "На этот день урока нет." },
    offline: { de: "Keine Verbindung. Bitte später erneut versuchen.",
               en: "No connection. Please try again later.",
               ru: "Нет соединения. Попробуйте позже." },
    sabbath: { de: "Sabbat", en: "Sabbath", ru: "Суббота" }
};

/* OSIS book id → canonical number (1–66, getbible order) */
const OSIS = {
    Gen:1,Exod:2,Lev:3,Num:4,Deut:5,Josh:6,Judg:7,Ruth:8,"1Sam":9,"2Sam":10,
    "1Kgs":11,"2Kgs":12,"1Chr":13,"2Chr":14,Ezra:15,Neh:16,Esth:17,Job:18,
    Ps:19,Prov:20,Eccl:21,Song:22,Isa:23,Jer:24,Lam:25,Ezek:26,Dan:27,Hos:28,
    Joel:29,Amos:30,Obad:31,Jonah:32,Mic:33,Nah:34,Hab:35,Zeph:36,Hag:37,
    Zech:38,Mal:39,Matt:40,Mark:41,Luke:42,John:43,Acts:44,Rom:45,"1Cor":46,
    "2Cor":47,Gal:48,Eph:49,Phil:50,Col:51,"1Thess":52,"2Thess":53,"1Tim":54,
    "2Tim":55,Titus:56,Phlm:57,Heb:58,Jas:59,"1Pet":60,"2Pet":61,"1John":62,
    "2John":63,"3John":64,Jude:65,Rev:66
};

/* ---------------- state ---------------- */

let lang = localStorage.getItem("manna.lang") || "de";
if (LANGS.indexOf(lang) === -1) lang = "de";
let current = new Date();          // the day being viewed
const quarters = {};               // `${lang}-${y}-${q}` -> data
const verses = {};                 // `${transl}/${nr}/${chap}` -> chapter json
let renderToken = 0;               // guards against out-of-order async renders

/* ---------------- dom ---------------- */

const $ = (id) => document.getElementById(id);
const contentEl = $("content");
const navDate = $("nav-date");
const navSub = $("nav-sub");
const navCenter = $("nav-center");
const footEl = $("foot");

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
        // offline fallback
        try {
            const cached = localStorage.getItem("manna.q." + key);
            if (cached) { quarters[key] = JSON.parse(cached); return quarters[key]; }
        } catch (e2) {}
        return null;
    }
}

// Find the lesson/day for a date, searching this quarter and its neighbours
// (daily readings run Sun–Fri BEFORE the Sabbath, so a date can live in an
// adjacent quarter file).
async function findDay(d) {
    const target = ymd(d);
    const cand = neighbors(d.getFullYear(), quarterOf(d));
    let sawData = false;
    for (let i = 0; i < cand.length; i++) {
        const data = await loadQuarter(lang, cand[i][0], cand[i][1]);
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

async function loadChapter(nr, chap) {
    const transl = BIBLE[lang];
    const key = transl + "/" + nr + "/" + chap;
    if (verses[key]) return verses[key];
    const url = "https://api.getbible.net/v2/" + transl + "/" + nr + "/" + chap + ".json";
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    verses[key] = data;
    return data;
}

async function getVerseHtml(sOsis) {
    const parts = String(sOsis).split(",");
    let out = "";
    for (const raw of parts) {
        const seg = parseSeg(raw.trim());
        const nr = OSIS[seg.book];
        if (!nr) continue;
        for (let c = seg.chap; c <= seg.echap; c++) {
            const data = await loadChapter(nr, c);
            const from = (c === seg.chap) ? seg.v1 : 1;
            const to   = (c === seg.echap) ? seg.v2 : 9999;
            for (const v of (data.verses || [])) {
                if (v.verse >= from && v.verse <= to) {
                    out += '<span class="vnum">' + v.verse + '</span>' +
                        esc(v.text.trim()) + " ";
                }
            }
        }
    }
    return out.trim();
}

/* ---------------- rendering ---------------- */

function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function memVerseHtml(lesson) {
    const kt = lesson.keyText || {};
    const text = kt.text || lesson.keyTextVerse || "";
    const ref = (kt.ref && kt.ref.text) || "";
    if (!text) return "";
    return '<div class="memverse">' +
        '<div class="mv-label">' + esc(refWord()) + '</div>' +
        '<div class="mv-text">' + esc(text) + '</div>' +
        (ref ? '<div class="mv-ref">' + esc(ref) + '</div>' : "") +
        '</div>';
}
function refWord() {
    return { de: "Leittext", en: "Key Text", ru: "Памятный стих" }[lang];
}

function lessonHead(lesson) {
    const kicker = lesson.header || "";
    return '<div class="lesson-kicker">' + esc(kicker) + '</div>' +
        '<div class="lesson-title">' + esc(lesson.title || "") + '</div>' +
        memVerseHtml(lesson);
}

// Returns { html, tasks:[{id,sOsis}] }
function renderContent(info) {
    if (info.type === "offline") return { html: '<div class="msg error">' + esc(T.offline[lang]) + '</div>', tasks: [] };
    if (info.type === "none")    return { html: '<div class="msg">' + esc(T.none[lang]) + '</div>', tasks: [] };

    const tasks = [];
    let vid = 0;
    let html = lessonHead(info.lesson);

    if (info.type === "sabbath") {
        // Sabbath = weekly overview
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

    // Weekday
    const day = info.day;
    if (day.sectionTitle) {
        html += '<div class="section-title">' + esc(day.sectionTitle) + '</div>';
    }

    const subs = day.subsections || [];
    for (const sub of subs) {
        html += '<div class="qa">';
        for (const q of (sub.q || [])) {
            if (q.sOsis) {
                const id = "v" + (vid++);
                tasks.push({ id, sOsis: q.sOsis });
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

    // Friday review questions
    const rq = day.reviewQuestions || [];
    if (rq.length) {
        for (const q of rq) html += '<div class="review-item">' + esc(q) + '</div>';
    }

    return { html, tasks };
}

async function render() {
    const token = ++renderToken;

    // header
    navDate.textContent = fmtDate(current);
    const isToday = sameDay(current, new Date());
    navCenter.classList.toggle("is-today", isToday);
    navSub.textContent = isToday ? T.today[lang].toUpperCase() : String(current.getFullYear());

    contentEl.innerHTML = '<div class="msg">' + esc(T.loading[lang]) + '</div>';

    const info = await findDay(current);
    if (token !== renderToken) return;

    const { html, tasks } = renderContent(info);
    contentEl.innerHTML = html;
    footEl.textContent = "MANNA · Sabbath Bible Lessons";

    // fill verses asynchronously
    for (const t of tasks) {
        getVerseHtml(t.sOsis).then((vh) => {
            if (token !== renderToken) return;
            const el = $(t.id);
            if (!el) return;
            if (vh) { el.className = "verse"; el.innerHTML = vh; }
            else { el.className = "verse error"; el.textContent = "—"; }
        }).catch(() => {
            if (token !== renderToken) return;
            const el = $(t.id);
            if (el) { el.className = "verse error"; el.textContent = "—"; }
        });
    }
}

/* ---------------- events ---------------- */

$("prev").addEventListener("click", () => { current = addDays(current, -1); render(); });
$("next").addEventListener("click", () => { current = addDays(current, 1); render(); });
navCenter.addEventListener("click", () => { current = new Date(); render(); });

document.querySelectorAll(".lang-opt").forEach((el) => {
    el.addEventListener("click", () => {
        const l = el.dataset.lang;
        if (l === lang) return;
        lang = l;
        localStorage.setItem("manna.lang", lang);
        setLangUI();
        render();
    });
});

function setLangUI() {
    document.querySelectorAll(".lang-opt").forEach((el) => {
        el.classList.toggle("active", el.dataset.lang === lang);
    });
}

/* ---------------- init ---------------- */

setLangUI();
render();
