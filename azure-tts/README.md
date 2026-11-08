# Azure AI Speech integration (PoC backend)

This folder contains a **server-side** Azure Functions v4 (Node.js) endpoint for text-to-speech. It is **not yet deployed** and the live GitHub Pages frontend has not been switched.

## Safety before deployment
- **Do not expose the anonymous /api/tts route directly to the public internet.** The HTTP trigger is anonymous so a separately deployed authenticated and rate-limited gateway (for example API Management with suitable authentication and quotas, or another secure server gateway) is required. CORS by itself does not restrict non-browser callers.
- Keep `SPEECH_KEY` and `SPEECH_REGION` in Function App settings or Key Vault. Never commit credentials or put keys in `index.html`.
- Test using synthetic text only; no resident names, care records, diagnoses, or identifiable conversations.
- Set Azure budgets and usage monitoring before offering trials. Speech output is billable by character beyond available free allocations.

## Setup
1. Create an Azure subscription, then create a Speech resource in a supported region (e.g. Japan East) using the desired pricing tier.
2. Create an Azure Functions app with a supported Node.js runtime and deploy this directory as the Function App project root.
3. Set Function App application settings `SPEECH_KEY` and `SPEECH_REGION` (e.g. `japaneast`).
4. Place an authentication + per-user rate-limiting gateway in front of this endpoint and verify it works.
5. Configure allowed browser origin `https://acankado.github.io` on the gateway / Function App, and then connect the GitHub Pages frontend to the gateway endpoint.
6. Verify all six reading languages (including standard Japanese), failures, rate limiting, mobile devices, and actual pronunciation with native speakers.

## API contract
`POST /api/tts` with JSON `{"text":"...", "language":"my", "slow":false}`.
Accepted language codes: `ja`, `vi`, `my`, `id`, `tl`, `en`. Returns MP3.

This folder is preparation only. **No Azure deployment, API credentials, or paid Azure resource has been created.**
