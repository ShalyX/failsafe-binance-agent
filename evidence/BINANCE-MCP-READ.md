# Verified Binance MCP read

Captured September 8, 2026 using the installed Binance plugin's read-only market-data tools. No account, balance, trading, transfer, or withdrawal capability was used.

## Hypothetical intent

Buy 250 USDT of BTC only if its 24-hour move is positive and no greater than 4%. The order cap is 250 USDT and at least 70% of available USDT must remain unallocated.

## Genuine MCP observations

| Observation | Value |
| --- | ---: |
| BTCUSDT 24-hour change | -0.983% |
| 24-hour ticker last price | 78,400.01 USDT |
| Best bid | 78,463.99 USDT |
| Best ask | 78,464.00 USDT |
| Quoted spread | 0.01 USDT (~0.0000127%) |
| Six-hour candle move | +0.562% |
| Estimated BTC at best ask for 250 USDT | 0.00318617 BTC |

The ticker and order-book calls were separate live snapshots and differed by roughly 0.082%. Failsafe treats this as a reason to refresh all execution inputs immediately before presenting a final approval packet.

## Policy decision

| Check | Result | Reason |
| --- | --- | --- |
| Positive 24-hour momentum | **BLOCK** | -0.983% is not positive. |
| Momentum ceiling | PASS | -0.983% is not above +4.00%. |
| Order cap | AT LIMIT | 250 USDT equals the maximum. |
| Retain at least 70% USDT | NOT EVALUATED | Account access was not granted. |
| Liquidity context | PASS FOR PLANNING | Best-quote spread was approximately 0.0000127%; execution still requires a refreshed quote. |

**Failsafe verdict: DO NOT PREPARE OR EXECUTE THE ORDER.** The positive-momentum condition is unmet, and the retained-cash policy cannot be evaluated without account data.

## Binance MCP tools used

- `binance_get_spot_24hr_ticker_price_change_statistics`
- `binance_get_spot_symbol_order_book_ticker`
- `binance_get_spot_kline_candlestick_data`

All three calls were market-data reads.
