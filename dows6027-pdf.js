/**
 * dows6027-pdf.js
 * FINAL VERSION — using:
 *  - Gmail (email + app password) for error emails
 *  - Google Drive SERVICE ACCOUNT JSON from DOWS6027_PDF_ADMIN
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// Secret file paths
const EMAIL_FILE = path.join(__dirname, 'DOWS6027_PDF_EMAIL');
const PASS_FILE = path.join(__dirname, 'DOWS6027_PDF_SECRET');
const ADMIN_FILE = path.join(__dirname, 'DOWS6027_PDF_ADMIN');

// Drive folder ID
const DRIVE_FOLDER_ID = process.env.DOWS_DRIVE_FOLDER_ID;

// PDF directory
const PDF_DIR = path.join(__dirname, 'PDFS');

// --- Verify secrets ---
if (!fs.existsSync(EMAIL_FILE) || !fs.existsSync(PASS_FILE) || !fs.existsSync(ADMIN_FILE)) {
  console.error("ERROR: One or more secret files missing.");
  process.exit(1);
}

const email = fs.readFileSync(EMAIL_FILE, 'utf-8').trim();
const password = fs.readFileSync(PASS_FILE, 'utf-8').trim();
const adminJSON = path.join(__dirname, 'DOWS6027_PDF_ADMIN');

if (!email || !password) {
  console.error("ERROR: Gmail email or password missing.");
  process.exit(1);
}

// --- EMAIL ERROR REPORTING ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: email,
    pass: password
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
    console.log("✔ Error email sent.");
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
      requestBody: {
        name: fileName,
        parents: [DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: "application/pdf",
        body: fs.createReadStream(filePath)
      }
    });

    console.log(`✔ Uploaded PDF: ${fileName} (ID: ${res.data.id})`);

  } catch (err) {
    console.error(`UPLOAD ERROR for ${filePath}: ${err.message}`);
    await sendErrorEmail("DOWS6027 PDF Upload Failed", `${filePath}\n\n${err.message}`);
  }
}

// MAIN
async function main() {
  if (!fs.existsSync(PDF_DIR)) {
    console.log("No PDF directory. Exiting.");
    return;
  }

  const pdfs = fs.readdirSync(PDF_DIR).filter(f => f.endsWith(".pdf"));
  if (pdfs.length === 0) {
    console.log("No PDFs to upload. Exiting.");
    return;
  }

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
