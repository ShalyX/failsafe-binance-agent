export type TradeSide = 'BUY' | 'SELL';

export type MarketEvidence = {
  source: string;
  observedAt: string;
  price: number;
  change24hPercent: number;
  spreadPercent: number;
};

export type AccountEvidence = {
  totalUsdt: number;
  availableUsdt: number;
};

export type TradeProposal = {
  proposalId: string;
  symbol: string;
  side: TradeSide;
  spendUsd: number;
  createdAt: string;
  market: MarketEvidence | null;
  account: AccountEvidence | null;
};

export type ProposalRecord = Pick<TradeProposal, 'proposalId' | 'symbol' | 'side' | 'spendUsd' | 'createdAt'>;

export type FirewallPolicy = {
  version: string;
  maxSingleOrderUsd: number;
  maxRollingExposureUsd: number;
  rollingWindowMs: number;
  maximumMarketAgeMs: number;
  maximumMomentumPercent: number;
  minimumCashRetainedPercent: number;
  maximumSpreadPercent: number;
};

type Check = {
  status: 'pass' | 'block' | 'unverified';
  observed: string;
  limit: string;
};

export type DecisionReceipt = {
  receiptId: string;
  policyVersion: string;
  status: 'blocked' | 'ready_for_human_approval';
  execution: 'not_started';
  evaluatedAt: string;
  reasons: string[];
  proposal: ProposalRecord;
  evidence: {
    marketSource: string | null;
    marketObservedAt: string | null;
    marketAgeMs: number | null;
    accountEvidencePresent: boolean;
  };
  checks: {
    orderSize: Check & { observedUsd: number };
    rollingExposure: Check & { observedUsd: number };
    momentum: Check;
    marketFreshness: Check;
    cashRetention: Check;
    liquidity: Check;
  };
};

export const defaultPolicy: FirewallPolicy = {
  version: 'failsafe-conservative-v3',
  maxSingleOrderUsd: 250,
  maxRollingExposureUsd: 250,
  rollingWindowMs: 10 * 60 * 1000,
  maximumMarketAgeMs: 60_000,
  maximumMomentumPercent: 4,
  minimumCashRetainedPercent: 70,
  maximumSpreadPercent: 0.1,
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function receiptHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function addReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export async function evaluateProposal(
  proposal: TradeProposal,
  policy: FirewallPolicy = defaultPolicy,
  history: ProposalRecord[] = [],
  evaluatedAt = new Date().toISOString(),
): Promise<DecisionReceipt> {
  const reasons: string[] = [];
  const nowMs = Date.parse(evaluatedAt);
  const proposalMs = Date.parse(proposal.createdAt);

  const orderPass = Number.isFinite(proposal.spendUsd) && proposal.spendUsd > 0 && proposal.spendUsd <= policy.maxSingleOrderUsd;
  if (!orderPass) addReason(reasons, 'single_order_cap_exceeded');

  const priorSpend = history
    .filter((item) => item.proposalId !== proposal.proposalId)
    .filter((item) => item.symbol === proposal.symbol && item.side === proposal.side)
    .filter((item) => {
      const created = Date.parse(item.createdAt);
      return Number.isFinite(created) && created <= nowMs && created >= nowMs - policy.rollingWindowMs;
    })
    .reduce((sum, item) => sum + item.spendUsd, 0);
  const rollingSpend = priorSpend + proposal.spendUsd;
  const rollingPass = rollingSpend <= policy.maxRollingExposureUsd;
  if (!rollingPass) addReason(reasons, 'rolling_cap_exceeded');

  const marketAgeMs = proposal.market ? nowMs - Date.parse(proposal.market.observedAt) : null;
  const marketFresh = marketAgeMs !== null && Number.isFinite(marketAgeMs) && marketAgeMs >= 0 && marketAgeMs <= policy.maximumMarketAgeMs;
  if (!proposal.market) addReason(reasons, 'market_evidence_missing');
  else if (!marketFresh) addReason(reasons, 'market_evidence_stale');

  const momentumPositive = proposal.market !== null && proposal.market.change24hPercent > 0;
  const momentumBelowCeiling = proposal.market !== null && proposal.market.change24hPercent <= policy.maximumMomentumPercent;
  if (proposal.market && !momentumPositive) addReason(reasons, 'momentum_not_positive');
  if (proposal.market && !momentumBelowCeiling) addReason(reasons, 'momentum_above_ceiling');

  const liquidityPass = proposal.market !== null && proposal.market.spreadPercent <= policy.maximumSpreadPercent;
  if (proposal.market && !liquidityPass) addReason(reasons, 'spread_above_limit');

  let retainedPercent: number | null = null;
  if (!proposal.account) {
    addReason(reasons, 'account_evidence_missing');
  } else if (proposal.account.totalUsdt <= 0 || proposal.account.availableUsdt < proposal.spendUsd) {
    addReason(reasons, 'insufficient_available_balance');
  } else {
    retainedPercent = ((proposal.account.totalUsdt - proposal.spendUsd) / proposal.account.totalUsdt) * 100;
    if (retainedPercent < policy.minimumCashRetainedPercent) addReason(reasons, 'cash_retention_below_minimum');
  }

  const checks: DecisionReceipt['checks'] = {
    orderSize: {
      status: orderPass ? 'pass' : 'block',
      observed: `$${proposal.spendUsd.toFixed(2)}`,
      observedUsd: proposal.spendUsd,
      limit: `$${policy.maxSingleOrderUsd.toFixed(2)} max`,
    },
    rollingExposure: {
      status: rollingPass ? 'pass' : 'block',
      observed: `$${rollingSpend.toFixed(2)}`,
      observedUsd: rollingSpend,
      limit: `$${policy.maxRollingExposureUsd.toFixed(2)} / ${policy.rollingWindowMs / 60_000}m`,
    },
    momentum: {
      status: proposal.market ? momentumPositive && momentumBelowCeiling ? 'pass' : 'block' : 'unverified',
      observed: proposal.market ? `${proposal.market.change24hPercent.toFixed(3)}%` : 'missing',
      limit: `positive, ≤${policy.maximumMomentumPercent.toFixed(2)}%`,
    },
    marketFreshness: {
      status: proposal.market ? marketFresh ? 'pass' : 'block' : 'unverified',
      observed: marketAgeMs === null || !Number.isFinite(marketAgeMs) ? 'missing' : `${Math.round(marketAgeMs / 1000)}s old`,
      limit: `≤${policy.maximumMarketAgeMs / 1000}s`,
    },
    cashRetention: {
      status: retainedPercent === null ? 'unverified' : retainedPercent >= policy.minimumCashRetainedPercent ? 'pass' : 'block',
      observed: retainedPercent === null ? 'missing account evidence' : `${retainedPercent.toFixed(1)}%`,
      limit: `≥${policy.minimumCashRetainedPercent.toFixed(1)}%`,
    },
    liquidity: {
      status: proposal.market ? liquidityPass ? 'pass' : 'block' : 'unverified',
      observed: proposal.market ? `${proposal.market.spreadPercent.toFixed(6)}%` : 'missing',
      limit: `≤${policy.maximumSpreadPercent.toFixed(2)}%`,
    },
  };

  const receiptWithoutId = {
    policyVersion: policy.version,
    status: reasons.length ? 'blocked' as const : 'ready_for_human_approval' as const,
    execution: 'not_started' as const,
    evaluatedAt,
    reasons,
    proposal: {
      proposalId: proposal.proposalId,
      symbol: proposal.symbol,
      side: proposal.side,
      spendUsd: proposal.spendUsd,
      createdAt: Number.isFinite(proposalMs) ? proposal.createdAt : evaluatedAt,
    },
    evidence: {
      marketSource: proposal.market?.source ?? null,
      marketObservedAt: proposal.market?.observedAt ?? null,
      marketAgeMs: marketAgeMs !== null && Number.isFinite(marketAgeMs) ? marketAgeMs : null,
      accountEvidencePresent: proposal.account !== null,
    },
    checks,
  };

  return { receiptId: `fs_${await receiptHash(receiptWithoutId)}`, ...receiptWithoutId };
}
