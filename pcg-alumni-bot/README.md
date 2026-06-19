# PCG Alumni Slack Bot

A Slack bot that lets current members ask "who should I talk to about SWE?"
and get back alumni contacts from your Google Sheet. No AI / Claude API
needed — it's plain keyword matching against your spreadsheet, so it costs
nothing to run besides hosting.

---

## How it works

1. You publish your "Alumni Directory" Google Sheet as a CSV link.
2. The bot fetches that CSV every 10 minutes and caches it in memory.
3. Members run `/alumni swe` (or DM the bot, or @mention it) and it searches
   the cached data and replies with matching alumni — name, company, focus
   area, and how to reach them.

Updating the directory each semester = editing the Google Sheet. No code
changes, no redeploying.

---

## Part 1 — Create the Slack App (~10 min, free)

1. Go to **https://api.slack.com/apps** → **Create New App** → **From scratch**
2. Name it (e.g. "PCG Alumni Bot"), pick your PCG workspace
3. **Enable Socket Mode**: left sidebar → *Socket Mode* → toggle on →
   generate an app-level token with the `connections:write` scope →
   copy it (starts with `xapp-`) → this is your `SLACK_APP_TOKEN`
4. **Add Bot Token Scopes**: left sidebar → *OAuth & Permissions* → under
   *Scopes → Bot Token Scopes*, add:
   - `commands`
   - `chat:write`
   - `app_mentions:read`
   - `im:history`
   - `im:write`
5. **Create the slash command**: left sidebar → *Slash Commands* →
   *Create New Command*
   - Command: `/alumni`
   - Short description: "Find PCG alumni by interest area"
   - Usage hint: `SWE | consulting | medicine | a name or company`
6. **Subscribe to events**: left sidebar → *Event Subscriptions* → toggle on
   → under *Subscribe to bot events*, add `app_mention` and `message.im`
7. **Install the app** to your workspace: left sidebar → *Install App* →
   *Install to Workspace* → copy the **Bot User OAuth Token**
   (starts with `xoxb-`) → this is your `SLACK_BOT_TOKEN`
8. Copy your **Signing Secret**: *Basic Information* → *App Credentials* →
   this is your `SLACK_SIGNING_SECRET`
9. Invite the bot to your channel: in Slack, `/invite @PCG Alumni Bot`

---

## Part 2 — Publish your Google Sheet as CSV

1. Open your Alumni Directory in Google Sheets (upload the template I gave
   you if you haven't)
2. **File → Share → Publish to web**
3. Under "Link", select the **Alumni Directory** sheet specifically
   (not "Entire Document")
4. Format: **Comma-separated values (.csv)**
5. Click **Publish**, copy the URL — this is your `CSV_URL`

⚠️ Important: this makes the sheet readable by anyone with the link (no
edit access, just read). Don't put anything sensitive beyond what's already
meant to be shared with members.

---

## Part 3 — Deploy the bot (free hosting)

### Option A: Railway (recommended, easiest)

1. Go to **https://railway.app**, sign up with GitHub
2. Push this folder to a new GitHub repo
3. In Railway: **New Project → Deploy from GitHub repo** → select your repo
4. Go to **Variables** tab and add:
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_APP_TOKEN`
   - `CSV_URL`
5. Railway auto-detects Node.js and runs `npm start`. Done — the bot is live.

### Option B: Render

1. Go to **https://render.com**, sign up with GitHub
2. **New → Background Worker** (not Web Service, since this bot uses Socket
   Mode and doesn't need a public URL)
3. Connect your repo, set Build Command: `npm install`, Start Command:
   `npm start`
4. Add the same 4 environment variables under **Environment**
5. Deploy.

### Option C: Run locally for testing

```bash
npm install
cp .env.example .env
# fill in .env with your real values
npm start
```

---

## Using the bot

In Slack, once invited to a channel:

```
/alumni SWE
/alumni consulting
/alumni medicine
/alumni Kobe Oh
```

Or DM the bot directly, or @mention it in a channel:
```
@PCG Alumni Bot who works in product?
```

---

## Updating keyword matching

If members phrase requests in ways the bot doesn't catch (e.g. "tech" not
matching SWE), edit the `KEYWORD_MAP` object at the top of `app.js` and add
more synonyms. No need to touch anything else.

---

## Costs

- Slack app: free
- Google Sheets publish: free
- Railway/Render free tier: free for low-traffic bots like this (a few
  hundred queries/month is nothing). If PCG grows huge, Railway's free tier
  caps out around 500 hours/month — still plenty for one bot.
- No AI API costs at all — this bot does not call Claude, OpenAI, or any
  LLM. It's keyword matching.
