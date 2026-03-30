# S6 Trade Curation Tool

Internal wall art curation tool for the Society6 trade team. Paste a Jotform submission, get AI-assisted recommendations from the crawled catalog, and generate a Google Slides deck.

---

## Quick Start (Local)

### 1. Install dependencies
```bash
cd "S6 Trade Curation Tool"
npm install
```

### 2. Load your catalog
Either through the browser (see below), or via terminal:
```bash
npm run process-catalog ~/Downloads/society6-clean-wall-art-crawler/output/listing_records.csv
```

### 3. Start the app
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

---

## Loading Your Catalog

### Option A — Browser upload (no terminal needed)
1. Run the app
2. Click **Catalog** in the top nav
3. Upload your `listing_records.csv`
4. Done — the tool starts using your real data immediately

### Option B — Terminal
```bash
npm run process-catalog path/to/listing_records.csv
```
Then restart the dev server.

---

## Google Slides Setup

The deck button will show setup instructions in the UI when credentials aren't configured. Here's the full process:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Enable **Google Slides API** and **Google Drive API**
4. Go to **IAM & Admin → Service Accounts** → Create a service account
5. Give it a name like `s6-curation-tool`
6. Click the service account → **Keys** → **Add Key** → JSON
7. A JSON file downloads to your computer
8. Encode it:
   ```bash
   cat path/to/key.json | base64 | pbcopy
   ```
9. Create a `.env.local` file in the project root:
   ```
   GOOGLE_SERVICE_ACCOUNT_KEY=<paste the base64 string here>
   ```
10. Restart the app

Generated decks are shared publicly (anyone with the link can view).

---

## Deployment (Netlify)

1. Push the project to a GitHub repo
2. Connect the repo to Netlify
3. Build settings are in `netlify.toml` — no changes needed
4. Set environment variables in Netlify Dashboard → Site Settings → Environment Variables:
   - `GOOGLE_SERVICE_ACCOUNT_KEY` — base64-encoded service account JSON
5. **Important:** The catalog CSV is not committed to git. After deploying, use the Catalog page to upload it.

### For Vercel
Works the same — Vercel auto-detects Next.js. Set the same environment variables in the Vercel dashboard.

---

## How It Works

### Brief Parsing
The app extracts key fields from pasted Jotform text using pattern matching:
- Project name, type, style, palette, rooms, gallery wall, avoid terms

### Catalog Tagging
Each catalog record gets tagged automatically from title + image alt text:
- **Mood**: dark, bright, playful, calm, dramatic
- **Subject**: music, abstract, landscape, floral, typography, city, animal, etc.
- **Style**: modern, vintage, coastal, southern, photography, illustration, etc.
- **Palette**: neutral, blue, green, orange, pink, purple, metallic, etc.

### Recommendation Scoring
Each item is scored against the brief:
- Style match: +3 per tag
- Palette match: +2 per tag
- Subject match: +2 per tag
- Mood match: +1.5 per tag
- Keyword bonus: +1 per keyword hit in title/alt
- Avoid penalty: -15 if an avoid term appears

Results are split into:
- **Primary Collection** — top 12 scored pieces
- **Accent & Alternates** — next 8, skewed toward variety
- **Gallery Wall Sets** — 3 cohesive groups of 6 (only if requested)

---

## Project Structure

```
.
├── app/
│   ├── page.jsx                  # Main intake form + results UI
│   ├── catalog/page.jsx          # Catalog management UI
│   ├── layout.jsx
│   ├── globals.css
│   └── api/
│       ├── recommend/route.js    # POST: parse brief + run recommendations
│       ├── slides/route.js       # POST: generate Google Slides deck
│       └── catalog/route.js     # GET: catalog info  POST: upload CSV
├── lib/
│   ├── parser.js                 # Jotform text → brief object
│   ├── tagger.js                 # Catalog record → tags
│   ├── recommender.js            # Score catalog against brief
│   ├── slides.js                 # Google Slides API
│   └── catalog.js                # Catalog loader/cache
├── data/
│   ├── sample-catalog.json       # Demo data (always present)
│   └── catalog.json              # Your real data (gitignored, loaded separately)
├── scripts/
│   └── process-catalog.js        # CSV → catalog.json converter
├── .env.example                  # Copy to .env.local and fill in
└── netlify.toml                  # Netlify deployment config
```
