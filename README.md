# Failsafe

Failsafe is a policy-first trading copilot built for the Binance Agent OS Mini Hackathon. It converts a natural-language trading goal into a visible decision packet, evaluates the order against explicit guardrails, and only then prepares an execution handoff for Binance MCP's own confirmation flow.

**[Open the live demo](https://failsafe-binance-agent.mires-falcons5v.chatgpt.site)**

## Why it exists

Most trading agents optimize for finding a trade. Failsafe optimizes for knowing when an agent must stop. It makes the boundary between analysis, policy, approval, and execution legible to the user.

## Demo flow

1. The user describes an intent with risk constraints.
2. Failsafe reads live BTC/USDT market data from Binance.
3. It evaluates momentum, order size, retained cash, and estimated liquidity impact.
4. A decision packet shows every assumption and pass/block result.
5. The user runs a final safety check.
6. A production integration hands the bounded order to Binance MCP, where Binance asks for explicit human confirmation. The public demo intentionally stops before live execution.

## Binance Agent OS integration

- Live market data is read from Binance's public ticker endpoint.
- The companion agent policy in `agent/FAILSAFE.md` is designed to run in a Binance MCP-connected AI client.
- The execution boundary follows Binance MCP semantics: least-privilege scopes, no withdrawal scope, and confirmation before each trading action.
- The interface exposes a WebMCP tool, `stage_policy_checked_order`, so another agent can stage the same visible safety review without executing a trade.

## Run locally

```bash
npm install
npm run dev
```

## Safety

This is a hackathon prototype, not financial advice. The hosted demo does not place orders or access account funds.
