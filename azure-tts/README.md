# Azure AI Speech — Azure Functions backend

The Azure Speech TTS backend is implemented in `azure-tts/src/functions/tts.js` (Node.js 24 / Azure Functions v4).

## Current security posture

- The `POST /api/tts` endpoint uses **`authLevel: 'function'`**. Anonymous requests without an Azure Function key are rejected by the Functions host.
- **Never place the Function key or `SPEECH_KEY` into public HTML, GitHub Pages, or client-side JavaScript.**
- The GitHub Pages frontend has **not** been connected to this backend. Later, provide an authenticated and rate-limited server-side gateway; CORS or an embedded client key is not sufficient access control.
- Use synthetic test sentences only, never identifiable residents' care records or patient details.
- The deployment workflow is **manual-only** and uses OIDC (no publishing profile secret). It will not deploy successfully until Azure federation and GitHub variables are configured.

## Azure settings

Function App: `acan-care-tts-api` (Windows Consumption / Node.js 24).
Function App settings:
- `SPEECH_REGION=japaneast`
- `SPEECH_KEY=<Azure Speech secret, in Azure only>`

## Deployment prerequisites

1. Configure an Azure user-assigned managed identity with permissions to deploy to the Function App and a GitHub federated identity credential whose subject matches `repo:acankado/acan-care-translator:environment:azure-tts-poc`. The repository branch must be `main`.
2. Set the following **GitHub Actions environment variables** under environment `azure-tts-poc` (names are non-secret IDs):
   - `AZURE_CLIENT_ID`: client ID of the Azure deployment identity
   - `AZURE_TENANT_ID`: Azure Entra tenant ID
   - `AZURE_SUBSCRIPTION_ID`: Azure subscription ID
3. Review the permissions and require a reviewer for the `azure-tts-poc` environment if supported by the GitHub plan.
4. Use GitHub Actions → **Deploy Azure Speech TTS backend (manual)** → **Run workflow**, after the prerequisites are verified.
5. Test `POST /api/tts` using a trusted, authenticated server-side client with an Azure Functions key. Never put the key in a public browser application.

## API

`POST /api/tts` (function-key protected), JSON:
```json
{"text":"こんにちは","language":"ja","slow":false}
```
Supported languages: `ja`, `vi`, `my`, `id`, `tl`, `en`. Successful responses return MP3 bytes.

## Limits and next steps

- Add end-user authentication, per-user quotas, request/character rate limits, logging limits, and an appropriate gateway before connecting GitHub Pages.
- Check actual billing for Azure Functions and related resources; the Azure Speech free tier does not cover all hosting costs.
- The TTS function uses a 600-character input limit per request as one safeguard, not as a complete cost-control mechanism.
