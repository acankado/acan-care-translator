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


## Facility trial gateway integration (November 2026)

The public GitHub Pages UI now uses `POST /api/trial-tts` when a visitor enters a facility trial code. No Azure Function host key or Azure Speech key is embedded in GitHub Pages. Without a trial code the browser keeps local Japanese TTS, while foreign-language Azure TTS asks for an invite code.

**Fail closed:** the anonymous gateway returns 503 unless `TRIAL_TTS_ENABLED=true` and a valid high-entropy invite-code hash has been configured. The original `POST /api/tts` remains function-key protected for administrative testing.

### Activation checklist (Azure Portal only)

1. Create a unique random invite code per test facility. On a trusted local machine, run:
   `node -e "const c=require('node:crypto');const token=c.randomBytes(32).toString('base64url');console.log('Private trial code:',token);console.log('SHA256 for Azure:',c.createHash('sha256').update(token).digest('hex'))"`
   Give the **trial code** privately to the facility. Enter only its **SHA256 digest** in Azure. Never publish either value in GitHub, issues, chat screenshots, or shared Postman workspaces.
2. In Function App `acan-care-tts-api` > Settings > Environment variables > Application settings, add:
   - `TRIAL_TTS_TOKEN_HASHES` = one or more comma-separated SHA256 hex digests (64 hex characters each).
   - `TRIAL_TTS_ENABLED` = `true` **only once** all checks pass.
   - Keep `AzureWebJobsStorage`, `SPEECH_REGION`, and `SPEECH_KEY` in Azure only.
3. Function App > API > CORS: add exact origin `https://acankado.github.io`; do not use `*`. Postman does not prove browser CORS.
4. In GitHub Actions run the existing manual `deploy-azure-tts.yml` workflow on `main` after reviewing the diff. Ensure the deployment succeeds and Azure lists `trial-tts` and `tts`.
5. Before setting `TRIAL_TTS_ENABLED=true`, verify an unauthenticated POST to `/api/trial-tts` fails (503 while disabled), and after enabling, an incorrect trial code receives 401. Test an authorized synthetic phrase, verifying 200 MP3, CORS, and a second request within 8 seconds receives 429.
6. For shutdown, set `TRIAL_TTS_ENABLED=false`; to revoke one facility code, remove its digest from `TRIAL_TTS_TOKEN_HASHES` and save settings.

### Safeguards and scope

- Random 32-byte codes serve as bearer credentials; they must be given to approved testers only. They are entered manually and retained only in page memory, not localStorage.
- Server checks tokens against SHA256 digests using constant-time comparison, limits text to 400 UTF-16 code units, enforces a maximum of **20 requests and 5,000 characters per code per UTC day**, and enforces an **8-second minimum interval**. Counts are persisted atomically in Azure Table Storage (`CareTtsUsage`) through conditional ETags. Usage is charged before the speech service call to avoid repeated failed requests increasing cost.
- The Azure Storage account must support the Table service and access through its connection string. If quota storage is unavailable, synthesis is disabled rather than unmetered.
- CORS restricts browser origins, **not** non-browser callers; the secret invite code and quotas are the access control. This is controlled PoC access, not production end-user identity verification.
- Do not enter real residents' names, health data, care records, or other confidential data: MyMemory translation and Microsoft Azure Speech are external processing services. Before production use, implement stronger identity, operational monitoring, formal privacy review, and facility-specific retention/security controls.
