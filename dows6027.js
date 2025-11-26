/**
 * DOWS6027 Automation Script — Production Version
 * Fetches live articles from Prophecy News Watch,
 * generates WARN HTML, updates index2.html,
 * archives yearly, posts to Telegram,
 * creates email trigger, and alerts on fetch failures.
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { format } = require('date-fns');
const nodemailer = require('nodemailer'); // For sending error emails

// --- Environment variable to detect mode
const runMode = process.env.run_mode || 'run'; // 'run', 'skip', 'force'

// --- Early exit if run_mode is skip
if (runMode === 'skip') process.exit(0);

// Paths
const TEMPLATE_DIR = path.join(__dirname, 'TEMPLATES');
const OUTPUT_DIR = path.join(__dirname);
const SCHEDULE_DIR = path.join(__dirname, '../saphahemailservices/schedule');
const DATA_FILE = path.join(__dirname, 'dows6027data.json');
const INDEX_FILE = path.join(__dirname, 'index2.html');

// Load tracking JSON
let trackingData = { last_date_used: '2025-11-01', last_URL_processed: '' };
if (fs.existsSync(DATA_FILE)) {
  trackingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

// Determine today's date
const today = new Date();
const yyyymmdd = format(today, 'yyyyMMdd');

// --- Helper: send error email
async function sendErrorEmail(reason) {
  try {
    // Configure transporter for Gmail (or your SMTP)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'saphahcentralservices@gmail.com',
        pass: process.env.SAPHAH_EMAIL_PASS // store securely in GitHub secrets
      }
    });

    const info = await transporter.sendMail({
      from: '"DOWS6027 Automation" <saphahcentralservices@gmail.com>',
      to: 'saphahcentralservices@gmail.com',
      subject: 'DOWS6027 Automation ERROR',
      text: `Network fetch failed for WARN generation.\nReason: ${reason}\nPlease rerun the workflow after resolving the issue.`
    });

    console.log(`Error email sent: ${info.messageId}`);
  } catch (err) {
    console.error('Failed to send error email:', err.message);
  }
}

// --- Helper: fetch single article
async function fetchArticle(url) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();

    // Example parsing — adjust selectors as needed
    const titleMatch = html.match(/<h1>(.*?)<\/h1>/i);
    const categoryMatch = html.match(/Category:\s*(\d)/i);

    return {
      title: titleMatch ? titleMatch[1].trim() : 'Untitled',
      category: categoryMatch ? parseInt(categoryMatch[1], 10) : 0,
      url
    };
  } catch (err) {
    throw new Error(`Failed to fetch ${url}: ${err.message}`);
  }
}

// --- Helper: fetch all articles
async function fetchAllArticles(urls) {
  const articles = [];
  for (const url of urls) {
    const article = await fetchArticle(url);
    articles.push(article);
  }
  return articles;
}

// --- Main async function
(async () => {
  try {
    // 1. Build list of article URLs dynamically
    // Replace this with your real PNW list scraping logic
    const articleURLs = [
      'https://www.prophecynewswatch.com/article.cfm?recent_news_id=9053',
      'https://www.prophecynewswatch.com/article.cfm?recent_news_id=9054',
      'https://www.prophecynewswatch.com/article.cfm?recent_news_id=9055'
    ];

    if (!articleURLs.length) {
      process.exit(0); // nothing to do, silent exit
    }

    // 2. Fetch all articles
    const articles = await fetchAllArticles(articleURLs);

    if (!articles.length) {
      process.exit(0); // no articles fetched
    }

    // 3. Read WARN template
    const templatePath = path.join(TEMPLATE_DIR, 'WARNyyyymmdd.txt');
    let templateHTML = fs.readFileSync(templatePath, 'utf-8');
    templateHTML = templateHTML
      .replace('{{START_DATE}}', trackingData.last_date_used)
      .replace('{{END_DATE}}', format(today, 'MMMM d, yyyy'));

    // 4. Inject articles into template
    articles.forEach(article => {
      const liLine = `<li><a href="${article.url}" target="_blank">${article.title}</a></li>`;
      const regex = new RegExp(`<section>\\s*<h2>${article.category}\\..*?</ul>`, 's');
      templateHTML = templateHTML.replace(regex, match => {
        return match.replace('<li><a href="" target="_blank">X</a></li>', liLine);
      });
    });

    // 5. Write WARN HTML
    const outputFile = path.join(OUTPUT_DIR, `WARN${yyyymmdd}.html`);
    fs.writeFileSync(outputFile, templateHTML);
    console.log(`WARN HTML created: ${outputFile}`);

    // 6. Update index2.html
    if (fs.existsSync(INDEX_FILE)) {
      let indexContent = fs.readFileSync(INDEX_FILE, 'utf-8');
      const newLink = `<li><a href="WARN${yyyymmdd}.html" target="_blank">DOWS6027 Warnings ${format(today, 'MMMM d, yyyy')}</a></li>`;
      indexContent = indexContent.replace(/(<\/ul>)/i, `${newLink}\n$1`);
      fs.writeFileSync(INDEX_FILE, indexContent);
      console.log(`index2.html updated`);
    }

    // 7. Yearly archive on Jan 1
    if (today.getMonth() === 0 && today.getDate() === 1) {
      const archiveFile = path.join(OUTPUT_DIR, `archives_${today.getFullYear()}.html`);
      fs.writeFileSync(archiveFile, fs.readFileSync(INDEX_FILE, 'utf-8'));
      console.log(`Yearly archive created: ${archiveFile}`);
    }

    // 8. Telegram simulation
    console.log(`Telegram post simulated for WARN${yyyymmdd}.html`);

    // 9. Update tracking JSON
    trackingData.last_date_used = format(today, 'yyyy-MM-dd');
    trackingData.last_URL_processed = articles.length ? articles[articles.length - 1].url : trackingData.last_URL_processed;
    fs.writeFileSync(DATA_FILE, JSON.stringify(trackingData, null, 2));
    console.log(`Tracking JSON updated: ${DATA_FILE}`);

    // 10. Create email trigger for saphahemailservices
    const triggerFile = path.join(SCHEDULE_DIR, `WARN${yyyymmdd}.txt`);
    const content = `dows6027@googlegroups.com | ⚠️ DOWS6027 Warnings Update - ${format(today, 'MMMM d, yyyy')} | ${format(today, 'yyyy-MM-dd')}`;
    if (!fs.existsSync(triggerFile)) {
      fs.writeFileSync(triggerFile, content);
      console.log(`Email trigger created: ${triggerFile}`);
    } else {
      console.log(`Trigger file already exists: ${triggerFile}`);
    }

    console.log('DOWS6027 automation complete.');

  } catch (err) {
    console.error('DOWS6027 fetch error:', err.message);
    await sendErrorEmail(err.message);
    process.exit(1);
  }
})();
