/**
 * dows6027-pdf.js
 * FINAL VERSION — NOW WITH:
 *  - PNW Archive Fetch + Enumerator Fallback
 *  - Better directory detection
 *  - Full upload + email error reporting
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { JSDOM } = require('jsdom');

// Secret file paths
const EMAIL_FILE = path.join(__dirname, 'DOWS6027_PDF_EMAIL');
const PASS_FILE = path.join(__dirname, 'DOWS6027_PDF_SECRET');
const ADMIN_FILE = path.join(__dirname, 'DOWS6027_PDF_ADMIN');

const DRIVE_FOLDER_ID = process.env.DOWS_DRIVE_FOLDER_ID;
const PDF_DIR = path.join(__dirname, 'PDFS');

// --- Verify secrets ---
if (!fs.existsSync(EMAIL_FILE) || !fs.existsSync(PASS_FILE) || !fs.existsSync(ADMIN_FILE)) {
  console.error("ERROR: One or more secret files missing.");
  process.exit(1);
}

const email = fs.readFileSync(EMAIL_FILE, 'utf-8').trim();
const password = fs.readFileSync(PASS_FILE, 'utf-8').trim();

if (!email || !password) {
  console.error("ERROR: Gmail email or password missing.");
  process.exit(1);
}

// --- EMAIL ERROR REPORTING ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: email, pass: password }
});

async function sendErrorEmail(subject, text) {
  try {
    await transporter.sendMail({
    from: `"DOWS6027 PDF Automation" <${email}>`,
    to: email,
    subject,
    text
    });
  } catch (err) {
    console.error("ERROR sending error email:", err);
  }
}

// --- GOOGLE DRIVE AUTH (SERVICE ACCOUNT) ---
const auth = new google.auth.GoogleAuth({
  keyFile: ADMIN_FILE,
  scopes: ["https://www.googleapis.com/auth/drive.file"]
});
const drive = google.drive({ version: "v3", auth });

// Upload a PDF
async function uploadPDF(filePath) {
  try {
    const fileName = path.basename(filePath);
    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [DRIVE_FOLDER_ID] },
      media: { mimeType: "application/pdf", body: fs.createReadStream(filePath) }
    });
    console.log(`✔ Uploaded PDF: ${fileName} (ID: ${res.data.id})`);
  } catch (err) {
    console.error(`UPLOAD ERROR for ${filePath}: ${err.message}`);
    await sendErrorEmail("DOWS6027 PDF Upload Failed", `${filePath}\n\n${err.message}`);
  }
}

// ---------------------------------------------------------
// 1. FETCH PNW ARCHIVE
// ---------------------------------------------------------

async function fetchPNWArchive() {
  try {
    console.log("Fetching PNW Archive...");
    const res = await axios.get("https://www.prophecynewswatch.com/archive.cfm");
    const dom = new JSDOM(res.data);
    const doc = dom.window.document;

    const links = [...doc.querySelectorAll("a")]
      .map(a => a.href)
      .filter(h => h.includes("article.cfm"));

    console.log(`✔ Found ${links.length} archive items.`);
    return links;

  } catch (err) {
    console.error("ERROR FETCHING PNW ARCHIVE — fallback to enumerator:", err.message);
    return null;
  }
}

// ---------------------------------------------------------
// 2. FALLBACK: Enumerator from current date backwards
// ---------------------------------------------------------

async function fallbackEnumerator() {
  console.log("Using ENUMERATOR FALLBACK…");

  const today = new Date();
  const urls = [];

  for (let i = 0; i < 14; i++) {  // 2 weeks back
    const d = new Date(today);
    d.setDate(today.getDate() - i);

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    urls.push(`https://www.prophecynewswatch.com/article.cfm?feature=${y}${m}${day}`);
  }

  console.log(`Fallback generated ${urls.length} URL patterns.`);
  return urls;
}

// ---------------------------------------------------------
// 3. MAIN FUNCTION
// ---------------------------------------------------------

async function main() {

  // Ensure folder exists
  if (!fs.existsSync(PDF_DIR)) {
    console.log("PDFS folder missing — creating...");
    fs.mkdirSync(PDF_DIR);
  }

  // Step 1: Get links from archive
  let links = await fetchPNWArchive();
  if (!links || links.length === 0) {
    links = await fallbackEnumerator();
  }

  if (!links || links.length === 0) {
    await sendErrorEmail("DOWS6027 PDF ERR", "NO LINKS FOUND from archive or fallback.");
    return;
  }

  // Step 2: Identify all PDFs in folder
  const pdfs = fs.readdirSync(PDF_DIR).filter(f => f.endsWith(".pdf"));
  console.log(`PDFs ready for upload: ${pdfs.length}`);

  if (pdfs.length === 0) {
    console.log("No PDFs to upload.");
    return;
  }

  // Step 3: Upload
  for (const f of pdfs) {
    await uploadPDF(path.join(PDF_DIR, f));
  }

  console.log("✔ DOWS6027 PDF automation complete.");
}

main().catch(async err => {
  console.error("SCRIPT ERROR:", err);
  await sendErrorEmail("DOWS6027 PDF Script Crash", err.toString());
  process.exit(1);
});
