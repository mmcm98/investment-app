# Investment App

Personal desktop-first portfolio management app (Core + Satellite, Triad analysis, Sharesight sync, Supabase).

## Running locally

Local development runs the React frontend and a local Express API proxy together. Supabase stays on cloud; there are no Vercel timeouts when using the local API server.

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   Copy `.env.example` to `.env` (or `.env.local`) and fill in API keys:

   - Supabase: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - Anthropic: `ANTHROPIC_API_KEY` (or `VITE_ANTHROPIC_API_KEY`)
   - Gemini: `GEMINI_API_KEY` (or `VITE_GEMINI_API_KEY`)
   - FMP: `FMP_API_KEY` (or `VITE_FMP_API_KEY`)
   - Sharesight OAuth and portfolio UUIDs (see `.env.example`)

3. **Start dev servers**

   ```bash
   npm run dev
   ```

   This starts:

   - **Vite** on [http://localhost:5173](http://localhost:5173) — React UI
   - **Local API** on [http://localhost:3001](http://localhost:3001) — proxies `/api/*` (Anthropic streaming, analysis, market data)

4. **Open the app**

   [http://localhost:5173](http://localhost:5173)

### Dev scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite + local API (primary) |
| `npm run dev:vite` | Frontend only |
| `npm run dev:server` | Local API only (port 3001) |
| `npm run dev:market-api` | Legacy standalone market API (port 8790) |
| `npm run dev:analysis-api` | Legacy standalone analysis API (port 8791) |

### Architecture (local)

```
Browser → Vite :5173 → proxy /api/* → Express :3001 → Anthropic / Gemini / FMP
                ↓
         Supabase cloud (data)
```

## Vercel deployment (backup)

The `/api` folder and `vercel.json` remain unchanged. Deploy to Vercel as before; serverless functions handle `/api/*` in production when not running locally.

## Build

```bash
npm run build
npm run preview
```

## Lint

```bash
npm run lint
```
