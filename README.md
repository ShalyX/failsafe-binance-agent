# Failsafe

Failsafe is an execution-firewall prototype for trading agents, built for the Binance Agent OS Mini Hackathon. Any agent can submit a proposed action; Failsafe locally evaluates supplied evidence against versioned policy and either blocks the proposal or emits a deterministic decision receipt for human review.

**[Open the live demo](https://failsafe-binance-agent.mires-falcons5v.chatgpt.site)**

## Why it exists

Most trading agents keep planning and policy inside the same prompt. That lets a hallucinating, compromised, or overly eager planner rationalize its own exception. Failsafe models a deterministic policy boundary between the planning agent and Binance MCP.

```text
Intended production flow:
Any agent → proposed action → Failsafe firewall → human approval → Binance MCP
                                ↓
                  deterministic decision receipt
```

## Demo flow

1. The user describes an intent with risk constraints.
2. The dashboard displays live BTC/USDT market data from Binance, or replays a timestamped MCP snapshot in proof mode.
3. It evaluates momentum, freshness, single-order size, rolling exposure, balance evidence, and liquidity.
4. Missing evidence fails closed; it is never rendered as a pass.
5. Given supplied rolling history, it detects split-order evasion while retries with the same proposal ID remain idempotent. Production enforcement requires a durable server-side ledger.
6. The firewall emits a deterministic SHA-256 content fingerprint and decision receipt containing its policy version, evidence, checks, reasons, and execution state.
7. The public demo intentionally stops before live execution. In a production adapter, only a fully evidenced receipt would be eligible for Binance's own human-confirmation boundary.

## Binance Agent OS integration

- The default dashboard reads live ticker and order-book data from Binance's public API; the `?proof=mcp` view replays the timestamped genuine Binance MCP evidence and labels it as a recorded snapshot.
- The companion agent policy in `agent/FAILSAFE.md` is designed to run in a Binance MCP-connected AI client.
- A production execution adapter should follow Binance MCP semantics: least-privilege scopes, no withdrawal scope, and confirmation before each trading action.
- The interface exposes `evaluate_trade_proposal` through WebMCP, allowing any browser-connected agent to request the same deterministic evaluation without receiving trade authority. It evaluates agent-supplied evidence and does not attest to its provenance.
- The firewall core is independent of React and covered by adversarial Node tests.

## Prototype boundary

The public site evaluates proposals locally and deliberately has no Binance Trade scope, account access, order endpoint, or server-side receipt ledger. Its receipt ID is a reproducible SHA-256 content fingerprint, not a server signature or an authorization token. A production deployment must persist decisions and enforce an authorization check in the only adapter that has Binance Trade capability; an agent must not be able to call Binance directly around that adapter.

See the timestamped [verified Binance MCP read](evidence/BINANCE-MCP-READ.md), where Failsafe used genuine market data and blocked an order whose positive-momentum condition was not met.

## Run locally

```bash
npm install
npm test
npm run dev
```

## Safety

This is a hackathon prototype, not financial advice. The hosted demo does not place orders or access account funds.
