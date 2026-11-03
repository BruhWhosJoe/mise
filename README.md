# Mise

**Get your data ready before you analyze.**

Mise helps anyone, whether a student, a journalist, or a curious resident, turn a plain-English question about their city into a shortlist of real government open datasets and an AI-generated **Data Recipe**: a step-by-step analysis plan explaining how those datasets could answer the question.

The name comes from *mise en place*, the cooking practice of getting every ingredient prepped before you start. Mise does that for data.

- **Repository:** https://github.com/BruhWhosJoe/mise
- **Demo video:** _<add link>_
- **Built for:** Meta Global AI Developer Hackathon 2026, Indie Developer track

---

## What it does

1. **Ask a question**, e.g. *"What affects pedestrian safety near schools in Washington, DC?"*
2. **AI Discovery** searches the full DC open data catalog (~1,660 records) and returns ranked recommendations, each with a relevance score, a "direct match" or "supporting" label, an explanation, and its stated limitations.
3. **Browse and inspect.** Every recommendation links to its real source page, service endpoint, publisher, license, and metadata details.
4. **Build a collection** of up to 10 datasets, by hand or by asking the assistant ("Select the top 3").
5. **Generate a Data Recipe:** a proposed analysis plan (joins, methods, caveats) that you can download as Markdown or JSON.

Mise never invents data, IDs, links, or findings. A recipe is a plan to verify, not a result.

## How Meta models are used

All runtime AI is **Meta Muse Spark** (`muse-spark-1.3`) via the Meta Model API:

| Step | What Muse Spark does |
|---|---|
| Query expansion | Turns the question into topical keywords and synonyms (e.g. *pedestrian safety → crash, crosswalk, sidewalk, vision zero*) and separates out place names |
| Relevance evaluation | Scores a bounded shortlist of candidates against a rubric (mission fit, geographic/temporal fit, role, suitability) and explains each pick |
| Data Recipe | Writes the analysis plan from the selected datasets' metadata |
| Assistant chat | Answers questions about the current investigation and proposes validated actions (select, deselect, filter) with Undo |

The app itself was built with **Muse Code**.

Every model output is schema-validated. IDs the model returns are checked against real catalog records, unknown IDs are dropped, and malformed output goes through a single repair attempt.

## Architecture

```
Browser (React 19 + TypeScript + Vite)
   │  same-origin /api
   ▼
FastAPI backend (Python 3.12)
   ├── Metadata MCP server (remote, read-only)  ← DC open data catalog
   └── Meta Model API (Muse Spark)              ← expansion, ranking, recipes, chat
```

**Discovery pipeline**

1. **Catalog snapshot.** The full catalog is pulled through the MCP server into a bounded TTL cache. Partial retrieval is disclosed, never hidden.
2. **Query expansion.** Muse Spark adds topical terms. If that call fails, the search falls back to the question's own words and says so.
3. **Lexical retrieval.** Whole-word matching with light stemming and per-catalog IDF weighting, so ubiquitous words like "Washington" or "DC" don't drown out topical words. This narrows the catalog to ~40 candidates.
4. **AI evaluation.** Muse Spark scores only that shortlist, which keeps cost and latency bounded as the catalog grows.
5. **Validation and enrichment.** Recommendations are matched back to authoritative MCP records before display.

The "How this search worked" panel shows the expanded terms, candidate counts, and coverage for every search.

## Run locally

Requirements: Python 3.12, Node 20+, a Meta Model API key.

```powershell
# Backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
copy backend\.env.example backend\.env   # then set MF_MODEL_API_KEY
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001

# Frontend (second terminal)
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api to :8001)
```

Tests:

```powershell
.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend; npm run test:state
```

Every configuration value is listed in `backend/.env.example`. Secrets are never committed or sent to the browser.

## Deploy

The root `Dockerfile` builds the frontend and serves it from FastAPI as a single service (one origin, `/api` for the backend). The only required secret is `MF_MODEL_API_KEY`, and `PORT` is respected when the host injects it. For public use, the AI endpoints have per-IP rate limits and a cap on concurrent model calls, and the catalog cache warms in the background on startup.

```bash
docker build -t mise .
docker run -p 8000:8000 -e MF_MODEL_API_KEY=... mise
# open http://localhost:8000
```

## Limitations

- **Coverage is Washington, DC only** for now (opendata.dc.gov via the metadata MCP server). State and national portals are the next milestone.
- Retrieval is lexical plus AI expansion, so very unusual phrasing can still miss datasets. Use Browse Catalog to search the whole catalog by title or ID.
- Relevance scores are the model's own assessment, not calibrated probabilities.
- A search takes roughly 30–45 seconds, most of it model time. It shows progress and can be canceled.

## Data and attribution

Dataset metadata comes from the District of Columbia's open data portal. Most DC GIS data is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); check each dataset's "Use limitations" in Mise before using it.

## License

MIT
