/**
 * dows6027-pdf.js
 * DOWS6027 PDF automation:
 *  - Reads secrets from DOWS6027_PDF_EMAIL and DOWS6027_PDF_SECRET
 *  - Uploads PDFs to Google Drive
 *  - Sends error emails if PDF generation or upload fails
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// --- CONFIG ---
// Paths to secrets
const EMAIL_FILE = path.join(__dirname, 'DOWS6027_PDF_EMAIL');
const SECRET_FILE = path.join(__dirname, 'DOWS6027_PDF_SECRET');

// Google Drive folder ID (GitHub secret or hardcoded)
const DRIVE_FOLDER_ID = process.env.DOWS_DRIVE_FOLDER_ID || 'YOUR_FOLDER_ID_HERE';

// Directory where PDFs are stored/generated
const PDF_DIR = path.join(__dirname, 'PDFS'); // adjust path

// --- READ SECRETS ---
if (!fs.existsSync(EMAIL_FILE) || !fs.existsSync(SECRET_FILE)) {
  console.error('ERROR: Secret files missing.');
  process.exit(1);
}
const email = fs.readFileSync(EMAIL_FILE, 'utf-8').trim();
const secret = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
if (!email || !secret) {
  console.error('ERROR: Secret email or password missing.');
  process.exit(1);
}

// --- EMAIL SETUP ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    type: 'OAuth2',
    user: email,
    refreshToken: secret // Using your secret as OAuth2 token
  }
});

async function sendErrorEmail(subject, text) {
  try {
    await transporter.sendMail({
      from: `"DOWS6027 PDF Automation" <${email}>`,
      to: email,
      subject,
      text
    });
    console.log('✅ Error email sent.');
  } catch (err) {
    console.error('ERROR sending email:', err);
  }
}

// --- GOOGLE DRIVE SETUP ---
const auth = new google.auth.GoogleAuth({
  keyFile: SECRET_FILE, // your OAuth2 secret file
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

async function uploadPDF(filePath) {
  try {
    const fileName = path.basename(filePath);
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: 'application/pdf',
        body: fs.createReadStream(filePath)
      }
    });
    console.log(`✅ Uploaded PDF: ${fileName} (ID: ${res.data.id})`);
  } catch (err) {
    console.error(`ERROR uploading PDF ${filePath}:`, err.message);
    await sendErrorEmail('DOWS6027 PDF Upload Failed', `Failed to upload ${filePath}\n\n${err.message}`);
  }
}

// --- MAIN FUNCTION ---
async function main() {
  if (!fs.existsSync(PDF_DIR)) {
    console.log('No PDFs to upload. Exiting.');
    return;
  }

  const pdfFiles = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf'));
  if (pdfFiles.length === 0) {
    console.log('No PDFs found in PDF directory. Exiting.');
    return;
  }

  for (const pdf of pdfFiles) {
    const fullPath = path.join(PDF_DIR, pdf);
    await uploadPDF(fullPath);
  }

  console.log('DOWS6027 PDF automation complete.');
}

// Run the script
main().catch(async (err) => {
  console.error('ERROR in main script:', err);
  await sendErrorEmail('DOWS6027 PDF Script Error', err.toString());
  process.exit(1);
});
