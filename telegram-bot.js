/**
 * telegram-bot.js — Trigger generator for Telegram posting
 * ---------------------------------------------------------
 * This file only creates a trigger file.
 * DOTS6027-CONSOLE will detect, parse, and post the message.
 */

const fs = require('fs');
const path = require('path');

// DOTS6027-CONSOLE trigger directory
const TRIGGER_DIR = path.join(__dirname, '../DOTS6027-CONSOLE/telegram-triggers');

// Ensure directory exists
if (!fs.existsSync(TRIGGER_DIR)) {
  fs.mkdirSync(TRIGGER_DIR, { recursive: true });
}

/**
 * Create service-specific Telegram trigger file.
 *
 * @param {string} serviceName  - "DOWS6027" or "DOM6027"
 * @param {string} message      - main message line
 * @param {string} warnURL      - URL for the post
 * @param {string} yyyymmdd     - date code for filename
 */
async function sendTelegramUpdate(serviceName, message, warnURL, yyyymmdd) {
  try {
    const triggerName = `WARN${yyyymmdd}.telegram`;
    const triggerPath = path.join(TRIGGER_DIR, triggerName);

    const content =
`SERVICE:${serviceName}

${message}

${warnURL}
`;

    fs.writeFileSync(triggerPath, content.trim() + "\n");

    console.log(`📨 Telegram trigger created for ${serviceName}: ${triggerName}`);
  } catch (err) {
    console.error('Error writing Telegram trigger:', err.message);
  }
}

module.exports = { sendTelegramUpdate };
