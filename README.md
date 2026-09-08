# Failsafe

Failsafe is an execution firewall for trading agents, built for the Binance Agent OS Mini Hackathon. Any agent can submit a proposed action; Failsafe independently validates the evidence, enforces versioned policy, and either withholds execution authority or emits a tamper-evident receipt that is ready for human approval.

**[Open the live demo](https://failsafe-binance-agent.mires-falcons5v.chatgpt.site)**

## Why it exists

Most trading agents keep planning and policy inside the same prompt. That lets a hallucinating, compromised, or overly eager planner rationalize its own exception. Failsafe moves policy into a deterministic boundary between the planning agent and Binance MCP.

```text
Any agent → proposed action → Failsafe firewall → human approval → Binance MCP
                                ↓
                     tamper-evident receipt
```

## Demo flow

1. The user describes an intent with risk constraints.
2. Failsafe reads live BTC/USDT market data from Binance.
3. It evaluates momentum, freshness, single-order size, rolling exposure, balance evidence, and liquidity.
4. Missing evidence fails closed; it is never rendered as a pass.
5. Separate proposals are aggregated over a rolling window to detect split-order evasion, while retries with the same proposal ID remain idempotent.
6. The firewall emits a deterministic SHA-256 decision receipt containing its policy version, evidence, checks, reasons, and execution state.
7. Only a fully evidenced receipt can proceed to Binance's own human-confirmation boundary. The public demo intentionally stops before live execution.

## Binance Agent OS integration

- The default dashboard reads live ticker and order-book data from Binance's public API; the `?proof=mcp` view replays the timestamped genuine Binance MCP evidence and labels it as a recorded snapshot.
- The companion agent policy in `agent/FAILSAFE.md` is designed to run in a Binance MCP-connected AI client.
- The execution boundary follows Binance MCP semantics: least-privilege scopes, no withdrawal scope, and confirmation before each trading action.
- The interface exposes `evaluate_trade_proposal` through WebMCP, allowing any browser-connected agent to request the same deterministic firewall decision without receiving trade authority.
- The firewall core is independent of React and covered by adversarial Node tests.

See the timestamped [verified Binance MCP read](evidence/BINANCE-MCP-READ.md), where Failsafe used genuine market data and blocked an order whose positive-momentum condition was not met.

## Run locally

```bash
npm install
npm test
npm run dev
```

## Safety

This is a hackathon prototype, not financial advice. The hosted demo does not place orders or access account funds.
