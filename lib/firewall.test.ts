import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProposal, defaultPolicy, type TradeProposal } from './firewall.ts';

const NOW = '2026-09-08T20:00:00.000Z';

function proposal(overrides: Partial<TradeProposal> = {}): TradeProposal {
  return {
    proposalId: 'proposal-001',
    symbol: 'BTCUSDT',
    side: 'BUY',
    spendUsd: 100,
    createdAt: NOW,
    market: {
      source: 'Binance MCP',
      observedAt: '2026-09-08T19:59:30.000Z',
      price: 78_400.01,
      change24hPercent: 1.2,
      spreadPercent: 0.0000127,
    },
    account: { totalUsdt: 1_000, availableUsdt: 1_000 },
    ...overrides,
  };
}

void test('allows only a fully evidenced proposal to reach human approval', async () => {
  const receipt = await evaluateProposal(proposal(), defaultPolicy, [], NOW);
  assert.equal(receipt.status, 'ready_for_human_approval');
  assert.equal(receipt.execution, 'not_started');
  assert.deepEqual(receipt.reasons, []);
  assert.match(receipt.receiptId, /^fs_[a-f0-9]{16}$/);
});

void test('blocks negative momentum', async () => {
  const receipt = await evaluateProposal(proposal({ market: { ...proposal().market!, change24hPercent: -0.983 } }), defaultPolicy, [], NOW);
  assert.equal(receipt.status, 'blocked');
  assert.ok(receipt.reasons.includes('momentum_not_positive'));
});

void test('fails closed when account evidence is missing', async () => {
  const receipt = await evaluateProposal(proposal({ account: null }), defaultPolicy, [], NOW);
  assert.equal(receipt.status, 'blocked');
  assert.ok(receipt.reasons.includes('account_evidence_missing'));
});

void test('fails closed when market evidence is stale', async () => {
  const stale = { ...proposal().market!, observedAt: '2026-09-08T19:58:00.000Z' };
  const receipt = await evaluateProposal(proposal({ market: stale }), defaultPolicy, [], NOW);
  assert.equal(receipt.status, 'blocked');
  assert.ok(receipt.reasons.includes('market_evidence_stale'));
});

void test('blocks an order above the single-order cap', async () => {
  const receipt = await evaluateProposal(proposal({ spendUsd: 250.01 }), defaultPolicy, [], NOW);
  assert.ok(receipt.reasons.includes('single_order_cap_exceeded'));
});

void test('detects split-order evasion inside the rolling window', async () => {
  const history = [{ proposalId: 'prior-001', symbol: 'BTCUSDT', side: 'BUY' as const, spendUsd: 200, createdAt: '2026-09-08T19:55:00.000Z' }];
  const receipt = await evaluateProposal(proposal({ spendUsd: 75 }), defaultPolicy, history, NOW);
  assert.equal(receipt.status, 'blocked');
  assert.ok(receipt.reasons.includes('rolling_cap_exceeded'));
  assert.equal(receipt.checks.rollingExposure.observedUsd, 275);
});

void test('does not count a retry with the same proposal id twice', async () => {
  const retry = proposal({ spendUsd: 200 });
  const history = [{ proposalId: retry.proposalId, symbol: retry.symbol, side: retry.side, spendUsd: retry.spendUsd, createdAt: retry.createdAt }];
  const receipt = await evaluateProposal(retry, defaultPolicy, history, NOW);
  assert.equal(receipt.status, 'ready_for_human_approval');
  assert.equal(receipt.checks.rollingExposure.observedUsd, 200);
});

void test('produces the same tamper-evident receipt for the same inputs', async () => {
  const first = await evaluateProposal(proposal(), defaultPolicy, [], NOW);
  const second = await evaluateProposal(proposal(), defaultPolicy, [], NOW);
  assert.equal(first.receiptId, second.receiptId);
});
