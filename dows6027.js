const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Paths to secrets
const EMAIL_FILE = path.join(__dirname, 'DOWS6027_PDF_EMAIL');
const SECRET_FILE = path.join(__dirname, 'DOWS6027_PDF_SECRET');

// Read secrets
if (!fs.existsSync(EMAIL_FILE) || !fs.existsSync(SECRET_FILE)) {
  console.error('ERROR: Secret files missing.');
  process.exit(1);
}
const email = fs.readFileSync(EMAIL_FILE, 'utf-8').trim();
const secret = fs.readFileSync(SECRET_FILE, 'utf-8').trim();

const oauth2Client = new google.auth.OAuth2(
  email,    // client ID
  secret,   // client secret
  'https://developers.google.com/oauthplayground' // redirect URI
);

// If you have a refresh token, set it here
oauth2Client.setCredentials({ refresh_token: secret }); // or store separately

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
