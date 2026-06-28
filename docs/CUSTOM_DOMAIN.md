# Custom domain deployment

## 1. Deploy the frontend

Create a Railway service from this repository with:

- Root Directory: `/frontend`
- Config File: `/frontend/railway.json`
- Builder: Dockerfile (`/frontend/Dockerfile`)
- Healthcheck: `/health`
- Port: supplied automatically through `PORT`

Copy every required value from `frontend/.env.example`. Use different wallets
for `PAYER_PRIVATE_KEY` (Agent 1) and `ERC8004_PRIVATE_KEY` (Agent 2 owner).

Set a long random `SERVICE_ACCESS_TOKEN`. The browser UI has an Access token
field and sends it only to `POST /api/process`.

## 2. Verify before adding DNS

Open:

```text
https://<railway-domain>/health
```

Expected response:

```json
{"status":"ok","service":"erc8004-frontend","timestamp":"..."}
```

Then run one upload flow and one prompt flow. Prompt generation requires
OpenAI API access to `gpt-image-2`; both flows require a funded Base Sepolia
payer wallet for x402.

## 3. Attach your domain

In Railway:

1. Open the frontend service.
2. Go to **Settings → Networking → Custom Domain**.
3. Enter the domain or subdomain, for example `agent.example.com`.
4. Copy the CNAME target shown by Railway.
5. Create that CNAME record at your DNS provider.
6. Wait for DNS verification and TLS issuance.

Do not proxy the record until Railway has issued the certificate. If using
Cloudflare, start with **DNS only**, then enable proxying after HTTPS works.

## 4. Keep the agent endpoint separate

The ERC-8004 registration currently points to the colorizer service at
`erc8004-agent-demo-production.up.railway.app`. Attaching a domain to the
frontend does not require an on-chain update.

If the colorizer endpoint itself moves, update
`erc8004/registration/colorizer.json`, pin the new registration file to IPFS,
and call `setAgentURI()` before removing the old endpoint.
