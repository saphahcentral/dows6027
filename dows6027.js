/**
 * dows6027.js — Archive-aware + enumerator fallback + robust production script
 *
 * - Crawls https://www.prophecynewswatch.com/archive.cfm (paginated)
 * - Falls back to probing article.cfm?recent_news_id=NNNN if archive is unavailable
 * - Numeric ID detection & comparison to avoid duplicates
 * - Clear logging for GitHub Actions run output
 * - Uses Gmail app password for error emails (same style as your other scripts)
 * - Creates schedule trigger file and Telegram trigger via sendTelegramUpdate()
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { format } = require('date-fns');
const { JSDOM } = require('jsdom');
const nodemailer = require('nodemailer');
const { sendTelegramUpdate } = require('./telegram-bot'); // writes trigger file in DOTS repo

// ---- Paths ----
const TEMPLATE_DIR = path.join(__dirname, 'TEMPLATES');
const OUTPUT_DIR = path.join(__dirname);
const SCHEDULE_DIR = path.join(__dirname, '../saphahemailservices/schedule');
const DATA_FILE = path.join(__dirname, 'dows6027data.json');
const INDEX_FILE = path.join(__dirname, 'index2.html');

// ---- Run mode ----
const runMode = process.env.run_mode || 'run';
if (runMode === 'skip') {
  console.log('run_mode=skip -> exiting quietly.');
  process.exit(0);
}

// ---- Email (Gmail app password) ----
const EMAIL_FILE = path.join(__dirname, 'DOWS6027_PDF_EMAIL');
const PASS_FILE = path.join(__dirname, 'DOWS6027_PDF_SECRET');

if (!fs.existsSync(EMAIL_FILE) || !fs.existsSync(PASS_FILE)) {
  console.error('ERROR: Secret files missing (DOWS6027_PDF_EMAIL / DOWS6027_PDF_SECRET).');
  process.exit(1);
}
const email = fs.readFileSync(EMAIL_FILE, 'utf-8').trim();
const appPass = fs.readFileSync(PASS_FILE, 'utf-8').trim();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: email, pass: appPass }
});

async function sendErrorEmail(subject, text) {
  try {
    await transporter.sendMail({
      from: `"DOWS6027 Automation" <${email}>`,
      to: email,
      subject,
      text
    });
    console.log('✔ Error email sent.');
  } catch (err) {
    console.error('ERROR sending error email:', err);
  }
}

// ---- Load tracking ----
let trackingData = { last_date_used: '2025-11-01', last_URL_processed: '' };
if (fs.existsSync(DATA_FILE)) {
  try {
    trackingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) {
    console.warn('Warning: could not parse tracking JSON, using defaults.');
    trackingData = { last_date_used: '2025-11-01', last_URL_processed: '' };
  }
}

// ---- Date vars ----
const today = new Date();
const yyyymmdd = format(today, 'yyyyMMdd');

// ---- Helpers ----
function extractPNWId(href) {
  if (!href) return null;
  const m = String(href).match(/recent_news_id=(\d+)/);
  if (m) return Number(m[1]);
  // Some article links use feature=YYYYMMDD or article.cfm?feature=YYYYMMDD - not numeric id; return null
  return null;
}

async function fetchWithTimeout(url, opts = {}, timeout = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ---- Archive crawler ----
async function crawlPNWArchive(maxPages = 10) {
  const BASE = 'https://www.prophecynewswatch.com/archive.cfm';
  const found = new Map(); // key=>url (key = id:<num> or url:<full>)
  console.log(`Starting archive crawl: ${BASE} (maxPages=${maxPages})`);

  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = `${BASE}?page=${page}`;
    console.log(`Fetching archive page ${page}: ${pageUrl}`);

    let res;
    try {
      res = await fetchWithTimeout(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html'
        },
        redirect: 'follow'
      }, 30000);
    } catch (err) {
      console.error(`Network error fetching archive page ${page}: ${err.message}`);
      break;
    }

    console.log(`Archive page ${page} HTTP ${res.status} ${res.statusText}`);
    if (!res.ok) {
      // stop on a 4xx/5xx
      break;
    }

    const html = await res.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    let addedThisPage = 0;
    const anchors = Array.from(doc.querySelectorAll('a[href]'));
    for (const a of anchors) {
      const href = a.getAttribute('href').trim();
      if (!href) continue;

      // Accept links that point to article pages
      if (href.includes('article.cfm') || href.includes('recent_news_id=')) {
        let full;
        try {
          full = new URL(href, BASE).toString();
        } catch (e) {
          continue;
        }
        const id = extractPNWId(full);
        const key = id ? `id:${id}` : `url:${full}`;
        if (!found.has(key)) {
          found.set(key, full);
          addedThisPage++;
        }
      }
    }

    console.log(`Archive page ${page}: found ${addedThisPage} new candidate links (total so far: ${found.size})`);

    // Determine if there's a "Next" link: look for anchor text 'Next' or rel
    const next = Array.from(doc.querySelectorAll('a')).find(a => {
      const t = (a.textContent || '').trim();
      return /Next/i.test(t) || /next/i.test(t) || (a.getAttribute('rel') || '').toLowerCase() === 'next';
    });

    if (!next) {
      console.log('No Next link on this page — assuming last page reached.');
      break;
    }

    // be polite
    await new Promise(r => setTimeout(r, 300));
  }

  // build sorted result: numeric ids ascending first, then others
  const numeric = [];
  const others = [];
  for (const [key, url] of found.entries()) {
    if (key.startsWith('id:')) numeric.push({ id: Number(key.slice(3)), url });
    else others.push({ url });
  }
  numeric.sort((a, b) => a.id - b.id);
  const sorted = numeric.map(x => x.url).concat(others.map(x => x.url));

  console.log(`Archive crawl complete — total unique candidate URLs: ${sorted.length}`);
  if (numeric.length) {
    console.log(`Numeric IDs found: ${numeric[0].id} ... ${numeric[numeric.length - 1].id}`);
  }
  return sorted;
}

// ---- Enumerator fallback: try recent_news_id probe ----
async function enumeratorFallback(lastIdGuess = null, window = 50) {
  console.log('Starting enumerator fallback probing recent_news_id...');
  const found = [];
  // If we have a last processed numeric id, start after it, else guess a range backwards from today
  let start = lastIdGuess ? lastIdGuess + 1 : null;

  if (!start) {
    // quick heuristic: try recent range 9000..9100 if no lastId (adjust as desired)
    start = Math.max(1, (lastIdGuess || 9000));
  }

  const maxProbe = start + window;
  console.log(`Probing IDs ${start} .. ${maxProbe}`);

  for (let id = start; id <= maxProbe; id++) {
    const url = `https://www.prophecynewswatch.com/article.cfm?recent_news_id=${id}`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow'
      }, 15000);

      if (res.ok) {
        const html = await res.text();
        // quick heuristic: page must contain <h1> or 'Recent News' or similar
        if (html.includes('<h1') || html.includes('Recent News') || html.includes('Read Full Story')) {
          found.push(url);
          console.log(`Enumerator found article id=${id}`);
        }
      }
    } catch (e) {
      // ignore network timeouts for single id probes
    }

    // small throttle
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`Enumerator fallback found ${found.length} candidate URLs.`);
  return found;
}

// ---- Fetch article details (title, category) ----
async function fetchArticleDetails(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 20000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const titleEl = doc.querySelector('h1');
    let category = 0;
    // try a few heuristics for category
    const catSpan = doc.querySelector('span.category, .category, a.category');
    if (catSpan && /\d+/.test(catSpan.textContent)) {
      category = parseInt(catSpan.textContent.match(/\d+/)[0], 10);
    }

    return {
      title: titleEl ? titleEl.textContent.trim() : 'Untitled',
      category,
      url
    };
  } catch (err) {
    throw new Error(`Failed to fetch article ${url}: ${err.message}`);
  }
}

// ---- get article URLs with fallback ----
async function getPNWArticleURLsWithFallback() {
  // try archive crawl first
  let urls = [];
  try {
    urls = await crawlPNWArchive(8); // 8 pages usually enough for recent month
  } catch (err) {
    console.error('Archive crawl error:', err.message);
  }

  if (!urls || urls.length === 0) {
    // attempt enumerator fallback using last processed id if available
    let lastId = null;
    if (trackingData.last_URL_processed) {
      lastId = extractPNWId(trackingData.last_URL_processed);
      console.log('Using last processed ID for enumerator start:', lastId);
    }
    const fallbackUrls = await enumeratorFallback(lastId, 60);
    urls = fallbackUrls.concat(urls || []);
  }

  // ensure uniqueness and return
  const uniq = Array.from(new Set(urls));
  console.log(`Total PNW candidate URLs after fallback & dedupe: ${uniq.length}`);
  return uniq;
}

// ---- MAIN ----
(async () => {
  try {
    console.log('DOWS6027 run start:', new Date().toISOString());

    const articleURLs = await getPNWArticleURLsWithFallback();

    if (!articleURLs || articleURLs.length === 0) {
      console.log('No article URLs found. Exiting with code 0.');
      return process.exit(0);
    }

    // Build mapping id->url where possible
    const items = articleURLs.map(u => {
      return { url: u, id: extractPNWId(u) || null };
    });

    // determine last processed numeric id
    let lastProcessedId = null;
    if (trackingData.last_URL_processed) {
      lastProcessedId = extractPNWId(trackingData.last_URL_processed);
    }
    console.log('Last processed ID from tracking:', lastProcessedId);

    // filter for new items using numeric comparison when possible
    let newItems;
    if (lastProcessedId !== null) {
      newItems = items.filter(it => it.id !== null && it.id > lastProcessedId);
    } else {
      // if tracking has no numeric id, use entire list (or filter by url inequality)
      newItems = items;
    }

    // If numeric filtering produced zero but there are items with no numeric id,
    // include those (we don't want to skip non-id article links)
    if (newItems.length === 0) {
      const nonNumeric = items.filter(it => it.id === null).map(it => it.url);
      if (nonNumeric.length > 0) {
        console.log(`No numeric new IDs found; will process ${nonNumeric.length} non-numeric article links.`);
        newItems = nonNumeric.map(u => ({ url: u, id: null }));
      }
    }

    console.log(`New items to process: ${newItems.length}`);
    if (newItems.length === 0) {
      console.log('No new articles to process. Exiting 0.');
      return process.exit(0);
    }

    // Fetch details for each new article
    const articles = [];
    for (const it of newItems) {
      try {
        const art = await fetchArticleDetails(it.url);
        articles.push(art);
      } catch (err) {
        console.error('Article fetch error:', err.message);
        await sendErrorEmail('DOWS6027 Article Fetch Error', `Failed to fetch ${it.url}\n\n${err.message}`);
        // abort run on article fetch failure (you asked for immediate email)
        return process.exit(1);
      }
      // polite delay
      await new Promise(r => setTimeout(r, 200));
    }

    // --- Read template ---
    const templatePath = path.join(TEMPLATE_DIR, 'WARNyyyymmdd.txt');
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template file missing: ${templatePath}`);
    }
    let templateHTML = fs.readFileSync(templatePath, 'utf-8');
    templateHTML = templateHTML.replace('{{START_DATE}}', trackingData.last_date_used || '')
                               .replace('{{END_DATE}}', format(today, 'MMMM d, yyyy'));

    // Inject articles into template (safe fallback)
    for (const article of articles) {
      const liLine = `<li><a href="${article.url}" target="_blank">${article.title}</a></li>`;
      const regex = new RegExp(`<section>\\s*<h2>${article.category}\\..*?</ul>`, 's');
      if (regex.test(templateHTML)) {
        templateHTML = templateHTML.replace(regex, match => match.replace('</ul>', `  ${liLine}\n</ul>`));
      } else if (templateHTML.includes('<li><a href="" target="_blank">X</a></li>')) {
        templateHTML = templateHTML.replace('<li><a href="" target="_blank">X</a></li>', liLine);
      } else if (/<ul>/i.test(templateHTML)) {
        templateHTML = templateHTML.replace(/(<ul>)/i, `$1\n  ${liLine}`);
      } else {
        templateHTML += `\n<ul>\n  ${liLine}\n</ul>\n`;
      }
    }

    // --- Write WARN HTML ---
    const outputFile = path.join(OUTPUT_DIR, `WARN${yyyymmdd}.html`);
    fs.writeFileSync(outputFile, templateHTML, 'utf-8');
    console.log(`WARN HTML created: ${outputFile}`);

    // --- Update index2.html ---
    if (fs.existsSync(INDEX_FILE)) {
      let indexContent = fs.readFileSync(INDEX_FILE, 'utf-8');
      const newLink = `<li><a href="WARN${yyyymmdd}.html" target="_blank">DOWS6027 Warnings ${format(today, 'MMMM d, yyyy')}</a></li>`;
      if (/(<\/ul>)/i.test(indexContent)) {
        indexContent = indexContent.replace(/(<\/ul>)/i, `${newLink}\n$1`);
      } else {
        indexContent += `\n<ul>\n${newLink}\n</ul>\n`;
      }
      fs.writeFileSync(INDEX_FILE, indexContent, 'utf-8');
      console.log('index2.html updated');
    } else {
      console.warn('index2.html not found; skipping index update');
    }

    // --- Telegram trigger (create DOTS trigger file via telegram-bot.js) ---
    const warnURL = `https://saphahcentral.github.io/dows6027/WARN${yyyymmdd}.html`;
    try {
      await sendTelegramUpdate('DOWS6027', 'Latest WARNING message posted.', warnURL, yyyymmdd);
      console.log('Telegram trigger created.');
    } catch (err) {
      console.error('Telegram trigger error (non-fatal):', err.message);
    }

    // --- Schedule email trigger file ---
    if (!fs.existsSync(SCHEDULE_DIR)) fs.mkdirSync(SCHEDULE_DIR, { recursive: true });
    const triggerFile = path.join(SCHEDULE_DIR, `WARN${yyyymmdd}.txt`);
    const triggerContent = `dows6027@googlegroups.com | ⚠️ DOWS6027 Warnings Update - ${format(today, 'MMMM d, yyyy')} | ${format(today, 'yyyy-MM-dd')}`;
    if (!fs.existsSync(triggerFile)) fs.writeFileSync(triggerFile, triggerContent, 'utf-8');

    // --- Update tracking JSON AFTER success ---
    const lastNumericId = (() => {
      // prefer highest numeric id from newItems
      const ids = newItems.map(i => i.id).filter(Boolean);
      if (ids.length) return Math.max(...ids);
      // else if we have at least one url, save last url string
      return null;
    })();

    trackingData.last_date_used = format(today, 'yyyy-MM-dd');
    if (lastNumericId) {
      trackingData.last_URL_processed = `recent_news_id=${lastNumericId}`;
    } else {
      // fallback: store last processed URL (last article url)
      trackingData.last_URL_processed = articles.length ? articles[articles.length - 1].url : trackingData.last_URL_processed;
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(trackingData, null, 2), 'utf-8');
    console.log('Tracking JSON updated:', DATA_FILE);

    console.log('DOWS6027 automation complete.');
    process.exit(0);

  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error('Fatal error:', msg);
    await sendErrorEmail('DOWS6027 Automation FATAL', msg);
    process.exit(1);
  }
})();
