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

  const relatedHistory = history
    .filter((item) => item.proposalId !== proposal.proposalId)
    .filter((item) => item.symbol === proposal.symbol && item.side === proposal.side);
  const historyEvidenceValid = relatedHistory.every((item) => Number.isFinite(item.spendUsd) && item.spendUsd > 0 && Number.isFinite(Date.parse(item.createdAt)));
  if (!historyEvidenceValid) addReason(reasons, 'history_evidence_invalid');
  const priorSpend = relatedHistory
    .filter((item) => Number.isFinite(item.spendUsd) && item.spendUsd > 0)
    .filter((item) => {
      const created = Date.parse(item.createdAt);
      return Number.isFinite(created) && created <= nowMs && created >= nowMs - policy.rollingWindowMs;
    })
    .reduce((sum, item) => sum + item.spendUsd, 0);
  const rollingSpend = priorSpend + proposal.spendUsd;
  const rollingPass = historyEvidenceValid && Number.isFinite(rollingSpend) && rollingSpend <= policy.maxRollingExposureUsd;
  if (!rollingPass) addReason(reasons, 'rolling_cap_exceeded');

  const marketEvidenceValid = proposal.market !== null
    && typeof proposal.market.source === 'string'
    && proposal.market.source.trim().length > 0
    && Number.isFinite(proposal.market.price)
    && proposal.market.price > 0
    && Number.isFinite(proposal.market.change24hPercent)
    && Number.isFinite(proposal.market.spreadPercent)
    && proposal.market.spreadPercent >= 0;
  const marketAgeMs = proposal.market ? nowMs - Date.parse(proposal.market.observedAt) : null;
  const marketFresh = marketEvidenceValid && marketAgeMs !== null && Number.isFinite(marketAgeMs) && marketAgeMs >= 0 && marketAgeMs <= policy.maximumMarketAgeMs;
  if (!proposal.market) addReason(reasons, 'market_evidence_missing');
  else if (!marketEvidenceValid) addReason(reasons, 'market_evidence_invalid');
  else if (!marketFresh) addReason(reasons, 'market_evidence_stale');

  const momentumPositive = marketEvidenceValid && proposal.market !== null && proposal.market.change24hPercent > 0;
  const momentumBelowCeiling = marketEvidenceValid && proposal.market !== null && proposal.market.change24hPercent <= policy.maximumMomentumPercent;
  if (proposal.market && marketEvidenceValid && !momentumPositive) addReason(reasons, 'momentum_not_positive');
  if (proposal.market && marketEvidenceValid && !momentumBelowCeiling) addReason(reasons, 'momentum_above_ceiling');

  const liquidityPass = marketEvidenceValid && proposal.market !== null && proposal.market.spreadPercent <= policy.maximumSpreadPercent;
  if (proposal.market && marketEvidenceValid && !liquidityPass) addReason(reasons, 'spread_above_limit');

  const accountEvidenceValid = proposal.account !== null
    && Number.isFinite(proposal.account.totalUsdt)
    && Number.isFinite(proposal.account.availableUsdt)
    && proposal.account.totalUsdt > 0
    && proposal.account.availableUsdt >= 0
    && proposal.account.availableUsdt <= proposal.account.totalUsdt;
  let retainedPercent: number | null = null;
  if (!proposal.account) {
    addReason(reasons, 'account_evidence_missing');
  } else if (!accountEvidenceValid) {
    addReason(reasons, 'account_evidence_invalid');
  } else {
    retainedPercent = ((proposal.account.availableUsdt - proposal.spendUsd) / proposal.account.totalUsdt) * 100;
    if (proposal.account.availableUsdt < proposal.spendUsd) addReason(reasons, 'insufficient_available_balance');
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
      status: !proposal.market ? 'unverified' : marketEvidenceValid && momentumPositive && momentumBelowCeiling ? 'pass' : 'block',
      observed: !proposal.market ? 'missing' : !marketEvidenceValid ? 'invalid market evidence' : `${proposal.market.change24hPercent.toFixed(3)}%`,
      limit: `positive, ≤${policy.maximumMomentumPercent.toFixed(2)}%`,
    },
    marketFreshness: {
      status: !proposal.market ? 'unverified' : marketFresh ? 'pass' : 'block',
      observed: !proposal.market ? 'missing' : !marketEvidenceValid ? 'invalid market evidence' : marketAgeMs === null || !Number.isFinite(marketAgeMs) ? 'invalid timestamp' : `${Math.round(marketAgeMs / 1000)}s old`,
      limit: `≤${policy.maximumMarketAgeMs / 1000}s`,
    },
    cashRetention: {
      status: !proposal.account ? 'unverified' : !accountEvidenceValid || retainedPercent === null || retainedPercent < policy.minimumCashRetainedPercent ? 'block' : 'pass',
      observed: !proposal.account ? 'missing account evidence' : !accountEvidenceValid ? 'invalid account evidence' : `${retainedPercent!.toFixed(1)}%`,
      limit: `≥${policy.minimumCashRetainedPercent.toFixed(1)}% unallocated after proposal`,
    },
    liquidity: {
      status: !proposal.market ? 'unverified' : liquidityPass ? 'pass' : 'block',
      observed: !proposal.market ? 'missing' : !marketEvidenceValid ? 'invalid market evidence' : `${proposal.market.spreadPercent.toFixed(6)}%`,
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
