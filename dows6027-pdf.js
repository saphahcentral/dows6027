/**
 * DOWS6027 PDF Automation — Production Version
 * Fetches PNW articles, generates PDFs, uploads to Google Drive,
 * tracks last processed article, sends error email on failure.
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { format } = require('date-fns');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// --- Environment
const runMode = process.env.run_mode || 'run';
if (runMode === 'skip') process.exit(0);

// --- Paths and tracking
const DATA_FILE = path.join(__dirname, 'dows6027-pdf-tracking.json');
const trackingData = fs.existsSync(DATA_FILE)
  ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  : { last_URL_processed: '' };

// --- Dates
const today = new Date();
const yyyymmdd = format(today, 'yyyyMMdd');
const monthFolderName = format(today, 'MMMyyyy').toUpperCase(); // e.g., 04DEC2025

// --- Google Drive setup
const DRIVE_FOLDER_ID = process.env.DOWS_DRIVE_FOLDER_ID; // main folder
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'google-service-account.json'),
  scopes: ['https://www.googleapis.com/auth/drive']
});
const drive = google.drive({ version: 'v3', auth });

// --- Send error email
async function sendErrorEmail(reason) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'saphahcentralservices@gmail.com',
        pass: process.env.SAPHAH_EMAIL_PASS
      }
    });
    await transporter.sendMail({
      from: '"DOWS6027 PDF Automation" <saphahcentralservices@gmail.com>',
      to: 'saphahcentralservices@gmail.com',
      subject: 'DOWS6027 PDF Automation ERROR',
      text: `PDF generation failed.\nReason: ${reason}\nPlease rerun after resolving the issue.`
    });
    console.log('Error email sent.');
  } catch (err) {
    console.error('Failed to send error email:', err.message);
  }
}

// --- Fetch recent PNW URLs
async function getPNWArticleURLs() {
  const RECENT_URL = 'https://www.prophecynewswatch.com/recent-news.cfm';
  try {
    const res = await fetch(RECENT_URL, { timeout: 10000 });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const links = Array.from(document.querySelectorAll('a[href*="recent_news_id="]'));
    const urls = links
      .map(a => a.href)
      .filter((v, i, self) => self.indexOf(v) === i)
      .sort();
    return urls;
  } catch (err) {
    throw new Error(`Failed to fetch recent news page: ${err.message}`);
  }
}

// --- Fetch single article
async function fetchArticle(url) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const titleEl = document.querySelector('h1');
    return { title: titleEl ? titleEl.textContent.trim() : 'Untitled', url };
  } catch (err) {
    throw new Error(`Failed to fetch article ${url}: ${err.message}`);
  }
}

// --- Google Drive folder helpers
async function findOrCreateMonthFolder() {
  try {
    const res = await drive.files.list({
      q: `'${DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and name='${monthFolderName}' and trashed=false`,
      fields: 'files(id, name)'
    });
    if (res.data.files.length) return res.data.files[0].id;

    // create folder if not exists
    const folder = await drive.files.create({
      requestBody: {
        name: monthFolderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [DRIVE_FOLDER_ID]
      }
    });
    return folder.data.id;
  } catch (err) {
    throw new Error(`Failed to create/find month folder: ${err.message}`);
  }
}

// --- Upload PDF to Drive
async function uploadPDF(filePath, fileName, folderId) {
  try {
    await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { body: fs.createReadStream(filePath) }
    });
  } catch (err) {
    throw new Error(`Failed to upload ${fileName} to Drive: ${err.message}`);
  }
}

// --- Main
(async () => {
  try {
    const urls = await getPNWArticleURLs();
    const newURLs = trackingData.last_URL_processed
      ? urls.filter(u => u > trackingData.last_URL_processed)
      : urls;

    if (!newURLs.length) return process.exit(0); // nothing to do

    const articles = [];
    for (const url of newURLs) articles.push(await fetchArticle(url));

    // Launch Puppeteer
    const browser = await puppeteer.launch({ headless: true });
    for (const [index, article] of articles.entries()) {
      const pdfName = `${yyyymmdd}-${(index + 1).toString().padStart(4, '0')}.pdf`;
      const tmpPath = path.join(__dirname, pdfName);

      // Convert article URL to PDF
      const page = await browser.newPage();
      await page.goto(article.url, { waitUntil: 'networkidle0' });
      await page.pdf({ path: tmpPath, format: 'A4', printBackground: true });

      // Upload to Drive
      const folderId = await findOrCreateMonthFolder();
      await uploadPDF(tmpPath, pdfName, folderId);

      fs.unlinkSync(tmpPath); // remove local PDF
      console.log(`PDF uploaded: ${pdfName}`);
    }
    await browser.close();

    // Update tracking JSON
    trackingData.last_URL_processed = newURLs[newURLs.length - 1];
    fs.writeFileSync(DATA_FILE, JSON.stringify(trackingData, null, 2));
    console.log('Tracking JSON updated.');

  } catch (err) {
    console.error('PDF automation failed:', err.message);
    await sendErrorEmail(err.message);
    process.exit(1);
  }
})();
