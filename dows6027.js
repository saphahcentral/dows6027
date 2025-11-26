/**
 * DOWS6027 Automation Script
 * Generates WARN HTML, updates index2.html, archives yearly,
 * posts to Telegram, and creates email trigger for saphahemailservices.
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // for fetching articles
const { format } = require('date-fns');

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

// Read template
const templatePath = path.join(TEMPLATE_DIR, 'WARNyyyymmdd.txt');
let templateHTML = fs.readFileSync(templatePath, 'utf-8');

// Replace date placeholders
templateHTML = templateHTML
  .replace('{{START_DATE}}', trackingData.last_date_used)
  .replace('{{END_DATE}}', format(today, 'MMMM d, yyyy'));

// === Fetch articles from Prophecy News Watch ===
// NOTE: This is simulated content. Replace with real fetching logic.
const articles = [
  {
    url: 'https://www.prophecynewswatch.com/article.cfm?recent_news_id=9053',
    title: 'Middle East tensions escalate',
    category: 1
  },
  {
    url: 'https://www.prophecynewswatch.com/article.cfm?recent_news_id=9054',
    title: 'False church warning issued',
    category: 2
  },
  {
    url: 'https://www.prophecynewswatch.com/article.cfm?recent_news_id=9055',
    title: 'LGBT+ policy changes',
    category: 3
  }
  // Add more articles as needed
];

// === EARLY EXIT: If no work to do, exit silently with code 0 ===
if (!articles || articles.length === 0) {
  process.exit(0); // Completely silent exit, no logs, no writes
}

// Inject <li> lines into the correct categories
articles.forEach(article => {
  const liLine = `<li><a href="${article.url}" target="_blank">${article.title}</a></li>`;
  const regex = new RegExp(`<section>\\s*<h2>${article.category}\\..*?</ul>`, 's');
  templateHTML = templateHTML.replace(regex, match => {
    return match.replace('<li><a href="" target="_blank">X</a></li>', liLine);
  });
});

// Write new WARN HTML
const outputFile = path.join(OUTPUT_DIR, `WARN${yyyymmdd}.html`);
fs.writeFileSync(outputFile, templateHTML);
console.log(`WARN HTML created: ${outputFile}`);

// === Update index2.html ===
if (fs.existsSync(INDEX_FILE)) {
  let indexContent = fs.readFileSync(INDEX_FILE, 'utf-8');
  const newLink = `<li><a href="WARN${yyyymmdd}.html" target="_blank">DOWS6027 Warnings ${format(today, 'MMMM d, yyyy')}</a></li>`;

  // Insert before </ul>
  indexContent = indexContent.replace(/(<\/ul>)/i, `${newLink}\n$1`);
  fs.writeFileSync(INDEX_FILE, indexContent);
  console.log(`index2.html updated`);
}

// === Yearly archive on January 1 ===
if (today.getMonth() === 0 && today.getDate() === 1) {
  const archiveFile = path.join(OUTPUT_DIR, `archives_${today.getFullYear()}.html`);
  fs.writeFileSync(archiveFile, fs.readFileSync(INDEX_FILE, 'utf-8'));
  console.log(`Yearly archive created: ${archiveFile}`);
}

// === Telegram posting ===
// Replace with real Telegram Bot API call
console.log(`Telegram post simulated for WARN${yyyymmdd}.html`);

// === Update tracking JSON ===
trackingData.last_date_used = format(today, 'yyyy-MM-dd');
trackingData.last_URL_processed = articles.length ? articles[articles.length - 1].url : trackingData.last_URL_processed;
fs.writeFileSync(DATA_FILE, JSON.stringify(trackingData, null, 2));
console.log(`Tracking JSON updated: ${DATA_FILE}`);

// === Create email trigger for saphahemailservices ===
function createEmailTrigger(subject) {
  const triggerFile = path.join(SCHEDULE_DIR, `WARN${yyyymmdd}.txt`);
  const content = `dows6027@googlegroups.com | ${subject} | ${format(today, 'yyyy-MM-dd')}`;

  if (fs.existsSync(triggerFile)) {
    console.log(`Trigger file already exists: ${triggerFile}. Skipping creation.`);
    return;
  }

  fs.writeFileSync(triggerFile, content);
  console.log(`Email trigger created: ${triggerFile}`);
}

const emailSubject = `⚠️ DOWS6027 Warnings Update - ${format(today, 'MMMM d, yyyy')}`;
createEmailTrigger(emailSubject);

console.log('DOWS6027 automation complete.');
