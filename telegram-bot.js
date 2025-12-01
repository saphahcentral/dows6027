// telegram-post.js — DOWS6027 / DOM6027 / SAPHAHCENTRAL Telegram Posting Service
// -------------------------------------------------------------
// Usage:
//   import { sendTelegramMessage } from './telegram-post.js';
//   await sendTelegramMessage("Your message text here");
// -------------------------------------------------------------

import fetch from 'node-fetch';

// Inject your BOT TOKEN and CHAT ID via environment vars:
// TELEGRAM_BOT_TOKEN="123:ABC"  TELEGRAM_CHAT_ID="-1000000000"
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment variables.");
}

/**
 * sendTelegramMessage
 * Sends a text message to Telegram using the bot.
 */
export async function sendTelegramMessage(text) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      })
    });

    const data = await response.json();

    if (!data.ok) {
      console.error("❌ Telegram API error:", data);
    } else {
      console.log("✔ Telegram message sent.");
    }

    return data;
  } catch (err) {
    console.error("❌ Error sending Telegram message:", err);
    throw err;
  }
}
