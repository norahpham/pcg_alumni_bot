// PCG Alumni Slack Bot
// Answers "who should I talk to about X" by matching against a live
// Google Sheets CSV (your Alumni Directory). No AI/Claude API needed —
// this is plain keyword matching, so it's free to run forever.

const { App } = require('@slack/bolt');
require('dotenv').config();

// ---------- CONFIG ----------
// Paste your published Google Sheets CSV URL here, or set it as the
// CSV_URL environment variable in Railway/Render (recommended, so you
// don't have to redeploy when the sheet URL changes).
const CSV_URL = process.env.CSV_URL || 'PASTE_YOUR_PUBLISHED_CSV_URL_HERE';

// How often to refresh the alumni list from the sheet (ms). 10 min default.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

// Keyword -> Focus Area map. Add synonyms here as members phrase things
// differently than the exact Focus Area values in the sheet.
const KEYWORD_MAP = {
  'SWE': ['swe', 'software', 'engineering', 'developer', 'dev', 'coding', 'tech', 'cs'],
  'Product': ['product', 'pm', 'product manager', 'product management'],
  'Consulting/Strategy': ['consulting', 'consultant', 'strategy', 'mckinsey', 'bcg', 'bain'],
  'IB/PE': ['ib', 'investment banking', 'private equity', 'pe', 'banking'],
  'Startup/VC': ['startup', 'vc', 'venture', 'founder', 'venture capital'],
  'Medicine': ['medicine', 'medical', 'doctor', 'md', 'physician', 'pre-med', 'premed', 'clinical'],
  'PhD/Research': ['phd', 'research', 'grad school', 'academia', 'graduate school'],
  'Finance': ['finance', 'financial'],
  'Quant': ['quant', 'trading', 'quantitative'],
  'Business Development': ['bizdev', 'business development', 'bd'],
  'Engineering': ['engineering', 'engineer', 'hardware'],
  'MBA': ['mba', 'business school'],
  'Law': ['law', 'legal', 'attorney', 'law school'],
};

// ---------- STATE ----------
let alumniCache = [];
let lastRefreshed = null;

// ---------- CSV PARSING ----------
// Minimal CSV parser that handles quoted fields with commas inside them
// (Google Sheets CSV export quotes any field containing a comma).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && next === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function rowsToObjects(rows) {
  // Find the header row — case-insensitive match for a "Name" column,
  // since sheets may use different capitalization (NAME, Name, name).
  const headerIdx = rows.findIndex(r =>
    r.some(cell => cell.trim().toLowerCase() === 'name')
  );
  if (headerIdx === -1) return [];

  const headers = rows[headerIdx].map(h => h.trim());
  const records = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    if (obj['Name'] || obj['NAME']) records.push(obj);
  }
  return records;
}

// Look up a field on a record regardless of header capitalization/spacing.
// e.g. getField(record, 'company') matches COMPANY, Company, company, etc.
function getField(record, targetKey) {
  const target = targetKey.trim().toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.trim().toLowerCase() === target) return record[key];
  }
  return '';
}

// ---------- FETCH + REFRESH ----------
async function refreshAlumni() {
  if (CSV_URL.includes('PASTE_YOUR')) {
    console.warn('[pcg-bot] CSV_URL not set — bot has no data yet.');
    return;
  }
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    const records = rowsToObjects(rows);

    alumniCache = records
      .filter(r => getField(r, 'company'))
      .map(r => ({
        name: getField(r, 'name'),
        gradYear: getField(r, 'grad year'),
        company: getField(r, 'company'),
        role: getField(r, 'role/title'),
        focus: getField(r, 'focus area(s)'),
        contact: getField(r, 'preferred contact') || 'Email',
        email: getField(r, 'email'),
        linkedin: getField(r, 'linkedin'),
      }));

    lastRefreshed = new Date();
    console.log(`[pcg-bot] Refreshed: ${alumniCache.length} alumni loaded.`);
    if (alumniCache.length === 0 && records.length > 0) {
      console.warn('[pcg-bot] Found rows but 0 had a Company value. Headers seen:', Object.keys(records[0]));
    }
    if (records.length === 0) {
      console.warn('[pcg-bot] No "Name" header found in CSV. First row was:', rows[0]);
    }
  } catch (err) {
    console.error('[pcg-bot] Failed to refresh alumni data:', err.message);
  }
}

// ---------- QUERY LOGIC ----------

// Simple fuzzy match: returns true if query is "close enough" to keyword.
// Handles typos like "consutling", "mckinesy", "mediicne" by checking if
// enough characters from the keyword appear in the query in order.
function fuzzyMatch(query, keyword) {
  if (query.includes(keyword)) return true;
  if (keyword.length < 4) return false;
  // Check if query contains at least the first 4 chars of the keyword
  if (query.includes(keyword.slice(0, 4))) return true;
  // Levenshtein-lite: count matching chars in order
  let qi = 0;
  let matched = 0;
  for (let ki = 0; ki < keyword.length && qi < query.length; ki++) {
    if (query[qi] === keyword[ki]) { matched++; qi++; }
  }
  return matched / keyword.length >= 0.75;
}

function matchFocusArea(query) {
  const q = query.toLowerCase();
  for (const [focusArea, keywords] of Object.entries(KEYWORD_MAP)) {
    if (keywords.some(k => fuzzyMatch(q, k))) return focusArea;
  }
  return null;
}

function queryAlumni(query) {
  const focusArea = matchFocusArea(query);
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const results = alumniCache.filter(a => {
    const matchesFocus = focusArea && a.focus.toLowerCase().includes(focusArea.toLowerCase());
    const haystack = `${a.name} ${a.company} ${a.focus} ${a.role}`.toLowerCase();
    const matchesText = words.some(w => haystack.includes(w) || fuzzyMatch(haystack, w));
    return matchesFocus || matchesText;
  });

  return results.slice(0, 8);
}

function formatResults(results, query) {
  if (!alumniCache.length) {
    return `:warning: Alumni data hasn't loaded yet. Ask an officer to check the bot's CSV_URL config.`;
  }
  if (!results.length) {
    return `Couldn't find alumni matching *"${query}"*. Try a broader term like "SWE", "consulting", or "medicine".`;
  }

  let text = `Found *${results.length}* alumni for *"${query}"*:\n\n`;

  for (const a of results) {
    const preferEmail = a.contact && a.contact.toLowerCase().includes('email');
    const preferLinkedIn = a.contact && a.contact.toLowerCase().includes('linkedin');

    // Build a clickable contact link based on preferred reach method
    let contactLink = '';
    if (preferLinkedIn && a.linkedin && a.linkedin.startsWith('http')) {
      contactLink = `<${a.linkedin}|LinkedIn>`;
    } else if (preferEmail && a.email) {
      contactLink = `<mailto:${a.email}|${a.email}>`;
    } else if (a.linkedin && a.linkedin.startsWith('http')) {
      contactLink = `<${a.linkedin}|LinkedIn>`;
    } else if (a.email) {
      contactLink = `<mailto:${a.email}|${a.email}>`;
    }

    // Always show both links if available
    const extraLinks = [];
    if (!preferLinkedIn && a.linkedin && a.linkedin.startsWith('http')) {
      extraLinks.push(`<${a.linkedin}|LinkedIn>`);
    }
    if (!preferEmail && a.email && contactLink !== `<mailto:${a.email}|${a.email}>`) {
      extraLinks.push(`<mailto:${a.email}|email>`);
    }
    const extra = extraLinks.length ? ` · ${extraLinks.join(' · ')}` : '';

    text += `*${a.name}* — ${a.role ? a.role + ' @ ' : ''}${a.company}\n`;
    text += `   _${a.focus}_ · Best way to reach: ${contactLink || a.contact}${extra}\n\n`;
  }

  return text;
}

// ---------- SLACK APP ----------
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Slash command: /alumni swe
app.command('/alumni', async ({ command, ack, respond }) => {
  await ack();
  const query = command.text.trim();
  if (!query) {
    await respond('Try `/alumni SWE`, `/alumni consulting`, `/alumni medicine`, or a name/company.');
    return;
  }
  // Hidden debug command: /alumni debug
  if (query === 'debug') {
    const sample = alumniCache.slice(0, 3).map(a =>
      `name="${a.name}" company="${a.company}" focus="${a.focus}"`
    ).join('\n');
    await respond(`Loaded ${alumniCache.length} alumni. First 3:\n\`\`\`\n${sample}\n\`\`\``);
    return;
  }
  const results = queryAlumni(query);
  await respond(formatResults(results, query));
});

// Also respond to @mentions in channels, e.g. "@PCG Bot who's in consulting"
app.event('app_mention', async ({ event, say }) => {
  const query = event.text.replace(/<@[^>]+>/g, '').trim();
  if (!query) {
    await say('Ask me something like "who works in SWE" or "show me alumni in consulting".');
    return;
  }
  const results = queryAlumni(query);
  await say(formatResults(results, query));
});

// Direct messages to the bot
app.message(async ({ message, say }) => {
  if (message.channel_type !== 'im' || message.subtype) return;
  const results = queryAlumni(message.text);
  await say(formatResults(results, message.text));
});

// ---------- STARTUP ----------
(async () => {
  await refreshAlumni();
  setInterval(refreshAlumni, REFRESH_INTERVAL_MS);

  await app.start();
  console.log('⚡️ PCG Alumni Bot is running on Slack!');
})();
