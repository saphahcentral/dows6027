/**
 * DOWS6027 Automation Script — Production Ready
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { format } = require('date-fns');
const { JSDOM } = require('jsdom');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { sendTelegramUpdate } = require('./telegram-bot'); // <-- your bot module

// --- Paths ---
const TEMPLATE_DIR = path.join(__dirname, 'TEMPLATES');
const OUTPUT_DIR = path.join(__dirname);
const SCHEDULE_DIR = path.join(__dirname, '../saphahemailservices/schedule');
const DATA_FILE = path.join(__dirname, 'dows6027data.json');
const INDEX_FILE = path.join(__dirname, 'index2.html');

// --- Environment variable to detect mode ---
const runMode = process.env.run_mode || 'run';
if (runMode === 'skip') process.exit(0);

// --- OAuth2 Email Setup ---
const EMAIL_FILE = path.join(__dirname, 'DOWS6027_PDF_EMAIL');
const SECRET_FILE = path.join(__dirname, 'DOWS6027_PDF_SECRET');

if (!fs.existsSync(EMAIL_FILE) || !fs.existsSync(SECRET_FILE)) {
  console.error('ERROR: Secret files missing.');
  process.exit(1);
}
const email = fs.readFileSync(EMAIL_FILE, 'utf-8').trim();
const secret = fs.readFileSync(SECRET_FILE, 'utf-8').trim();

const oauth2Client = new google.auth.OAuth2(
  email,
  secret,
  'https://developers.google.com/oauthplayground'
);
oauth2Client.setCredentials({ refresh_token: secret });

async function sendErrorEmail(subject, text) {
  try {
    const accessToken = await oauth2Client.getAccessToken();
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: email,
        clientId: email,
        clientSecret: secret,
        refreshToken: secret,
        accessToken: accessToken.token
      }
    });

    await transporter.sendMail({
      from: `"DOWS6027 Automation" <${email}>`,
      to: email,
      subject,
      text
    });
    console.log('✅ Error email sent via OAuth2.');
  } catch (err) {
    console.error('ERROR sending email via OAuth2:', err);
  }
}

// --- Load tracking JSON ---
let trackingData = { last_date_used: '2025-11-01', last_URL_processed: '' };
if (fs.existsSync(DATA_FILE)) trackingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

// --- Today's date ---
const today = new Date();
const yyyymmdd = format(today, 'yyyyMMdd');

// --- Fetch PNW recent articles ---
async function getPNWArticleURLs() {
  const RECENT_URL = 'https://www.prophecynewswatch.com/recent-news.cfm';
  try {
    const res = await fetch(RECENT_URL, { timeout: 10000 });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    const dom = new JSDOM(html);
    const links = Array.from(dom.window.document.querySelectorAll('a[href*="recent_news_id="]'));
    const urls = links.map(a => a.href).filter((v, i, self) => self.indexOf(v) === i).sort();
    return urls;
  } catch (err) {
    throw new Error(`Failed to fetch recent news page: ${err.message}`);
  }
}

async function fetchArticle(url) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    const dom = new JSDOM(html);
    const titleEl = dom.window.document.querySelector('h1');
    const catEl = dom.window.document.querySelector('span.category'); // adjust as needed
    return {
      title: titleEl ? titleEl.textContent.trim() : 'Untitled',
      category: catEl ? parseInt(catEl.textContent.trim(), 10) : 0,
      url
    };
  } catch (err) {
    throw new Error(`Failed to fetch article ${url}: ${err.message}`);
  }
}

async function fetchAllArticles(urls) {
  const articles = [];
  for (const url of urls) {
    const article = await fetchArticle(url);
    articles.push(article);
  }
  return articles;
}

// --- Main ---
(async () => {
  try {
    const articleURLs = await getPNWArticleURLs();
    if (!articleURLs.length) return process.exit(0);

    const newURLs = trackingData.last_URL_processed
      ? articleURLs.filter(u => u > trackingData.last_URL_processed)
      : articleURLs;

    if (!newURLs.length) return process.exit(0);

    const articles = await fetchAllArticles(newURLs);

    // Read template
    const templatePath = path.join(TEMPLATE_DIR, 'WARNyyyymmdd.txt');
    let templateHTML = fs.readFileSync(templatePath, 'utf-8');
    templateHTML = templateHTML
      .replace('{{START_DATE}}', trackingData.last_date_used)
      .replace('{{END_DATE}}', format(today, 'MMMM d, yyyy'));

    // Inject articles
    articles.forEach(article => {
      const liLine = `<li><a href="${article.url}" target="_blank">${article.title}</a></li>`;
      const regex = new RegExp(`<section>\\s*<h2>${article.category}\\..*?</ul>`, 's');
      templateHTML = templateHTML.replace(regex, match =>
        match.replace('<li><a href="" target="_blank">X</a></li>', liLine)
      );
    });

    // Write WARN HTML
    const outputFile = path.join(OUTPUT_DIR, `WARN${yyyymmdd}.html`);
    fs.writeFileSync(outputFile, templateHTML);
    console.log(`WARN HTML created: ${outputFile}`);

    // Update index2.html
    if (fs.existsSync(INDEX_FILE)) {
      let indexContent = fs.readFileSync(INDEX_FILE, 'utf-8');
      const newLink = `<li><a href="WARN${yyyymmdd}.html" target="_blank">DOWS6027 Warnings ${format(today, 'MMMM d, yyyy')}</a></li>`;
      indexContent = indexContent.replace(/(<\/ul>)/i, `${newLink}\n$1`);
      fs.writeFileSync(INDEX_FILE, indexContent);
      console.log(`index2.html updated`);
    }

    // Yearly archive on Jan 1
    if (today.getMonth() === 0 && today.getDate() === 1) {
      const archiveFile = path.join(OUTPUT_DIR, `archives_${today.getFullYear()}.html`);
      fs.writeFileSync(archiveFile, fs.readFileSync(INDEX_FILE, 'utf-8'));
      console.log(`Yearly archive created: ${archiveFile}`);
    }

    // --- Telegram posting ---
    const warnURL = `https://saphahcentral.github.io/dows6027/WARN${yyyymmdd}.html`;
    await sendTelegramUpdate(
      "DOWS6027",
      "Latest WARNING message posted.",
      warnURL,
      yyyymmdd
    );
    console.log(`✅ Telegram bot posted WARN${yyyymmdd}.html`);

    // Update tracking JSON
    trackingData.last_date_used = format(today, 'yyyy-MM-dd');
    trackingData.last_URL_processed = articles[articles.length - 1].url;
    fs.writeFileSync(DATA_FILE, JSON.stringify(trackingData, null, 2));
    console.log(`Tracking JSON updated: ${DATA_FILE}`);

    // Create email trigger
    const triggerFile = path.join(SCHEDULE_DIR, `WARN${yyyymmdd}.txt`);
    const content = `dows6027@googlegroups.com | ⚠️ DOWS6027 Warnings Update - ${format(today, 'MMMM d, yyyy')} | ${format(today, 'yyyy-MM-dd')}`;
    if (!fs.existsSync(triggerFile)) fs.writeFileSync(triggerFile, content);

    console.log('DOWS6027 automation complete.');
  } catch (err) {
    console.error('DOWS6027 fetch error:', err.message);
    await sendErrorEmail('DOWS6027 Automation ERROR', err.message);
    process.exit(1);
  }
})();
