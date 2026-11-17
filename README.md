# LEXORA AI

LEXORA AI is a source-conscious legal intelligence workspace for local analysis and structured research. The project keeps legal-source review, provenance, and uncertainty explicit rather than claiming legal authority or a legal conclusion.

## Supported architecture

- Generative AI: Google Gemini only
- Specialized ML: multilingual embedding-based semantic retrieval and similarity ranking
- Storage: local SQLite database for cases, documents, audit events, source material, and usage logs
- Trust model: all AI/ML output is evidence-scoped and never treated as legal advice

This project does not host local AI models and does not require OpenAI or Ollama. It uses Google Gemini as the only generative provider and a separate multilingual ML embedding layer for retrieval and similarity ranking, without adding extra generative providers.

## Quick start

1. Install dependencies:
   npm install
2. Copy environment variables:
   copy .env.example .env
3. Set your server-side Gemini credentials in `.env`:
   GEMINI_API_KEY=...
   GEMINI_MODEL=gemini-2.5-flash or your approved Gemini model
   AI_TIMEOUT_MS=20000
4. Start the app:
   npm start
5. Open http://127.0.0.1:3000

## Environment variables

See `.env.example` for the supported server-side settings:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `AI_TIMEOUT_MS`
- `GEMINI_INPUT_USD_PER_MILLION`
- `GEMINI_OUTPUT_USD_PER_MILLION`
- `LEXORA_DATA_DIR`
- `LEXORA_ML_CACHE_DIR`
- `LEXORA_ADMIN_BOOTSTRAP_TOKEN`
- `LEXORA_ALLOW_SIGNUP`

Never keep real secrets in source control or frontend code.

## Architecture notes

- Gemini is the single generative reasoning layer.
- The ML embedding model is used for document-to-source similarity and retrieval ranking only; it does not prove legal correctness.
- Every AI analysis must include exact-source quote verification and clear uncertainty language.
- Reports are informational only and must be reviewed by a qualified human before use in legal matters.

## Running tests

npm test
npm run check
npm run ml:smoke

## Safety and limitations

- This is a local demonstration project, not a legal or compliance-certified system.
- No legal authority, binding advice, or certified review is implied.
- Any AI output must be treated as provisional and human-verified.
- Use only approved and non-sensitive material for provider calls.

## Deployment guidance

- GitHub Pages deploys the static frontend from `public/` using `.github/workflows/pages.yml`. In the repository settings, choose **Pages → Build and deployment → GitHub Actions**.
- GitHub Pages does not run the Node.js backend. Host the backend separately on a Node.js-capable service with persistent storage; provision `GEMINI_API_KEY` and `GEMINI_MODEL` only in that backend's secret manager.
- After hosting the backend, set `window.LEXORA_API_BASE_URL` in `public/api-config.js` to its HTTPS origin and set backend `LEXORA_ALLOWED_ORIGIN` to the exact Pages origin (for this repository: `https://kevinantonakhil-coder.github.io`). These are public endpoint/origin values, not secrets.
- Cross-site authentication depends on browser cookie privacy settings. The backend uses `SameSite=None; Secure` only when an explicit allowed origin is configured; some browsers may block third-party cookies. A custom domain/reverse proxy that keeps frontend and API same-site is preferable for a production deployment.
- Keep `GEMINI_API_KEY` in a real secret manager or server environment.
- Ensure the deployment environment can reach Google Generative Language APIs.
- Keep the database and uploaded content secured with production-grade storage and access controls.
