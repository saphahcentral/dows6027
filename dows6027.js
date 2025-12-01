/**
 * DOWS6027 Automation Script — FIXED + PRODUCTION STABLE
 * - Gmail App Password Authentication (works reliably)
 * - Updated PNW Scraper
 * - Correct Template Injection
 * - Daily WARN Generation Guaranteed
 */

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { format } = require("date-fns");
const { JSDOM } = require("jsdom");
const nodemailer = require("nodemailer");
const { sendTelegramUpdate } = require("./telegram-bot");

// ---- Paths ----
const TEMPLATE_DIR = path.join(__dirname, "TEMPLATES");
const OUTPUT_DIR = path.join(__dirname);
const SCHEDULE_DIR = path.join(__dirname, "../saphahemailservices/schedule");
const DATA_FILE = path.join(__dirname, "dows6027data.json");
const INDEX_FILE = path.join(__dirname, "index2.html");

// ---- RUN MODE ----
if ((process.env.run_mode || "run") === "skip") process.exit(0);

// ---- Gmail App Password Auth (same as your other scripts) ----
const EMAIL_FILE = path.join(__dirname, "DOWS6027_PDF_EMAIL");
const PASS_FILE = path.join(__dirname, "DOWS6027_PDF_SECRET");

if (!fs.existsSync(EMAIL_FILE) || !fs.existsSync(PASS_FILE)) {
  console.error("ERROR: Secret files missing.");
  process.exit(1);
}

const email = fs.readFileSync(EMAIL_FILE, "utf-8").trim();
const appPass = fs.readFileSync(PASS_FILE, "utf-8").trim();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: email, pass: appPass }
});

async function sendErrorEmail(subject, msg) {
  try {
    await transporter.sendMail({
      from: `"DOWS6027 Automation" <${email}>`,
      to: email,
      subject,
      text: msg
    });
    console.log("✔ Error email sent.");
  } catch (err) {
    console.error("Email send error:", err.message);
  }
}

// ---- Load tracking ----
let trackingData = { last_date_used: "2025-11-01", last_URL_processed: "" };
if (fs.existsSync(DATA_FILE)) {
  trackingData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

const today = new Date();
const yyyymmdd = format(today, "yyyyMMdd");

// --------------------------------------------------------
// 1. Fetch PNW Recent Articles (updated selectors)
// --------------------------------------------------------
async function getPNWArticleURLs() {
  try {
    const res = await fetch("https://www.prophecynewswatch.com/recent-news.cfm", { timeout: 10000 });
    const html = await res.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const links = [...doc.querySelectorAll("a")]
      .map(a => a.href)
      .filter(h => h.includes("article.cfm?feature="))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    console.log(`✔ PNW links found: ${links.length}`);
    return links.sort();
  } catch (err) {
    console.error("PNW Fetch failed:", err.message);
    return [];
  }
}

// Fetch individual article
async function fetchArticle(url) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    const html = await res.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    return {
      title: (doc.querySelector("h1")?.textContent || "Untitled").trim(),
      category: parseInt(doc.querySelector(".category")?.textContent || "0"),
      url
    };
  } catch (err) {
    console.error(`Article error: ${url}`);
    return null;
  }
}

// --------------------------------------------------------
// MAIN
// --------------------------------------------------------
(async () => {
  try {
    let urls = await getPNWArticleURLs();

    if (!urls.length) {
      console.log("No recent PNW links found — continuing with WARN generation anyway.");
      urls = [];
    }

    // Get only new ones
    const newURLs = trackingData.last_URL_processed
      ? urls.filter(u => u > trackingData.last_URL_processed)
      : urls;

    const articles = [];
    for (const url of newURLs) {
      const a = await fetchArticle(url);
      if (a) articles.push(a);
    }

    // ---- Template ----
    const templateFile = path.join(TEMPLATE_DIR, "WARNyyyymmdd.txt");
    let html = fs.readFileSync(templateFile, "utf-8");

    html = html
      .replace("{{START_DATE}}", trackingData.last_date_used)
      .replace("{{END_DATE}}", format(today, "MMMM d, yyyy"));

    // Insert Articles
    for (const article of articles) {
      const li = `<li><a href="${article.url}" target="_blank">${article.title}</a></li>`;
      const regex = new RegExp(`<section>\\s*<h2>${article.category}\\..*?</ul>`, "s");

      html = html.replace(regex, block => {
        return block.replace("</ul>", li + "\n</ul>");
      });
    }

    // ---- Write WARN file ----
    const warnFile = path.join(OUTPUT_DIR, `WARN${yyyymmdd}.html`);
    fs.writeFileSync(warnFile, html);
    console.log(`✔ WARN file created: WARN${yyyymmdd}.html`);

    // ---- Update index2.html ----
    if (fs.existsSync(INDEX_FILE)) {
      let index = fs.readFileSync(INDEX_FILE, "utf-8");

      const linkLine = `<li><a href="WARN${yyyymmdd}.html" target="_blank">DOWS6027 Warnings ${format(today, "MMMM d, yyyy")}</a></li>`;

      index = index.replace(/<ul>/, `<ul>\n${linkLine}`);
      fs.writeFileSync(INDEX_FILE, index);

      console.log("✔ index2.html updated");
    }

    // ---- Telegram ----
    try {
      await sendTelegramUpdate(
        "DOWS6027",
        "Latest WARNING message posted.",
        `https://saphahcentral.github.io/dows6027/WARN${yyyymmdd}.html`,
        yyyymmdd
      );
      console.log("✔ Telegram update sent");
    } catch {}

    // ---- Schedule email trigger ----
    const schedFile = path.join(SCHEDULE_DIR, `WARN${yyyymmdd}.txt`);
    if (!fs.existsSync(schedFile)) {
      fs.writeFileSync(
        schedFile,
        `dows6027@googlegroups.com | ⚠️ DOWS6027 Warnings Update - ${format(today, "MMMM d, yyyy")} | ${format(today, "yyyy-MM-dd")}`
      );
    }

    // ---- Save Tracking ----
    trackingData.last_date_used = format(today, "yyyy-MM-dd");
    trackingData.last_URL_processed = urls[urls.length - 1] || trackingData.last_URL_processed;

    fs.writeFileSync(DATA_FILE, JSON.stringify(trackingData, null, 2));

    console.log("✔ DOWS6027 automation complete.");

  } catch (err) {
    console.error("DOWS6027 ERROR:", err.message);
    await sendErrorEmail("DOWS6027 Automation ERROR", err.message);
    process.exit(1);
  }
})();
