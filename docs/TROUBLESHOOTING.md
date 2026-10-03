# Troubleshooting

Problems hit during the build, with what caused them and what to do. Newest at the bottom.

| What you see | Why | What to do |
| --- | --- | --- |
| `agent-trade.ts` or `record-sync.ts` fails with `Unexpected token '<', "<!doctype "... is not valid JSON` | The script fetched an HTML error page because nothing was serving the API at `VERDICT_APP_URL` (default `http://localhost:3000`). | Start the app with `yarn next:start`, or point `VERDICT_APP_URL` at a running instance. The scripts now report "did not return JSON" instead. |
| `/api/record` answers 503 `HCS operator not configured` | `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY` are not set in the server environment; the route cannot submit to the topic without them. | Add both to `packages/nextjs/.env.local`. The rest of the app works without them. |
| `/api/record` answers 503 `HCS topic not configured` | `hcsTopicId` in `packages/nextjs/verdict.config.ts` is still null. | Run `yarn record:create-topic` with the operator env set; it writes the topic id into the config. |
