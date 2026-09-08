'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, Check, ChevronDown, CircleGauge, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, TriangleAlert, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { defaultPolicy, evaluateProposal, type DecisionReceipt, type ProposalRecord, type TradeProposal } from '@/lib/firewall';

type Market = { price: number; change: number; high: number; low: number; volume: number; spreadPercent: number; observedAt: string; source: string };
type Scenario = 'baseline' | 'oversize' | 'split' | 'stale';
const fallback: Market = { price: 80142.2, change: 2.41, high: 81680, low: 77542, volume: 32184, spreadPercent: .02, observedAt: '2026-09-08T00:00:00.000Z', source: 'Fallback snapshot · stale' };
const verifiedMcpSnapshot: Market = { price: 78400.01, change: -0.983, high: 79980, low: 77542, volume: 32184, spreadPercent: .0000127, observedAt: '2026-09-08T19:00:30.000Z', source: 'Verified Binance MCP · Sep 8' };
const bars = [31, 40, 37, 49, 55, 51, 63, 59, 71, 68, 78, 74, 87, 83, 92, 89, 96, 93, 104, 99, 112, 108, 118, 115];
type WebMcpDocument = Document & { modelContext?: { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> } };

export default function Home() {
  const [market, setMarket] = useState<Market>(fallback);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'draft' | 'checked' | 'ready'>('draft');
  const [scenario, setScenario] = useState<Scenario>('baseline');
  const [receipt, setReceipt] = useState<DecisionReceipt | null>(null);
  const [evaluatedAt, setEvaluatedAt] = useState(() => new Date().toISOString());
  const [proofMode, setProofMode] = useState(false);

  const refreshMarket = useCallback(async () => {
    if (proofMode) return;
    setLoading(true);
    try {
      const response = await fetch('/api/market', { cache: 'no-store' });
      if (!response.ok) throw new Error('market unavailable');
      setMarket(await response.json());
      setEvaluatedAt(new Date().toISOString());
    } catch { setMarket(fallback); }
    finally { setLoading(false); }
  }, [proofMode]);

  // The URL selects an immutable recorded proof state before any network refresh.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('proof') === 'mcp') {
      setProofMode(true);
      setMarket(verifiedMcpSnapshot);
      setEvaluatedAt('2026-09-08T19:01:00.000Z');
      setLoading(false);
      return;
    }
    void refreshMarket();
  }, [refreshMarket]);
  useEffect(() => {
    const context = (document as WebMcpDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'evaluate_trade_proposal',
      title: 'Evaluate trade proposal',
      description: 'Evaluate agent-supplied evidence against Failsafe policy and return a reproducible decision receipt. This never executes a trade or attests to evidence provenance.',
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', minLength: 1 },
          spendUsd: { type: 'number', exclusiveMinimum: 0 },
          change24hPercent: { type: 'number' },
          marketObservedAt: { type: 'string' },
          accountTotalUsdt: { type: ['number', 'null'] },
          accountAvailableUsdt: { type: ['number', 'null'] },
          priorWindowSpendUsd: { type: 'number', minimum: 0 },
        },
        required: ['proposalId', 'spendUsd', 'change24hPercent', 'marketObservedAt', 'accountTotalUsdt', 'accountAvailableUsdt', 'priorWindowSpendUsd'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input: unknown) {
        const value = input as { proposalId?: string; spendUsd?: number; change24hPercent?: number; marketObservedAt?: string; accountTotalUsdt?: number | null; accountAvailableUsdt?: number | null; priorWindowSpendUsd?: number };
        const { proposalId, spendUsd, change24hPercent, marketObservedAt, priorWindowSpendUsd } = value;
        if (typeof proposalId !== 'string' || !proposalId.trim() || typeof spendUsd !== 'number' || !Number.isFinite(spendUsd) || spendUsd <= 0 || typeof change24hPercent !== 'number' || !Number.isFinite(change24hPercent) || typeof marketObservedAt !== 'string' || !marketObservedAt || typeof priorWindowSpendUsd !== 'number' || !Number.isFinite(priorWindowSpendUsd) || priorWindowSpendUsd < 0) throw new Error('proposal input is incomplete or invalid');
        const account = typeof value.accountTotalUsdt === 'number' && typeof value.accountAvailableUsdt === 'number' ? { totalUsdt: value.accountTotalUsdt, availableUsdt: value.accountAvailableUsdt } : null;
        const proposed: TradeProposal = {
          proposalId, symbol: 'BTCUSDT', side: 'BUY', spendUsd, createdAt: evaluatedAt,
          market: { source: 'Agent-supplied evidence via WebMCP', observedAt: marketObservedAt, price: market.price, change24hPercent, spreadPercent: market.spreadPercent }, account,
        };
        const history: ProposalRecord[] = priorWindowSpendUsd > 0 ? [{ proposalId: `${proposalId}-prior`, symbol: 'BTCUSDT', side: 'BUY', spendUsd: priorWindowSpendUsd, createdAt: new Date(Date.parse(evaluatedAt) - 300_000).toISOString() }] : [];
        const decision = await evaluateProposal(proposed, defaultPolicy, history, evaluatedAt);
        setReceipt(decision);
        setStep(decision.status === 'blocked' ? 'draft' : 'checked');
        return decision;
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [market, evaluatedAt]);

  const { proposal, history } = useMemo(() => {
    const spendUsd = scenario === 'oversize' ? 500 : scenario === 'split' ? 75 : 250;
    const observedAt = scenario === 'stale' ? new Date(Date.parse(evaluatedAt) - 120_000).toISOString() : market.observedAt;
    const proposal: TradeProposal = {
      proposalId: `demo-${scenario}-001`, symbol: 'BTCUSDT', side: 'BUY', spendUsd, createdAt: evaluatedAt,
      market: { source: market.source, observedAt, price: market.price, change24hPercent: market.change, spreadPercent: market.spreadPercent },
      account: null,
    };
    const history: ProposalRecord[] = scenario === 'split' ? [{ proposalId: 'demo-split-prior', symbol: 'BTCUSDT', side: 'BUY', spendUsd: 200, createdAt: new Date(Date.parse(evaluatedAt) - 300_000).toISOString() }] : [];
    return { proposal, history };
  }, [scenario, market, evaluatedAt]);

  useEffect(() => { void evaluateProposal(proposal, defaultPolicy, history, evaluatedAt).then(setReceipt); }, [proposal, history, evaluatedAt]);
  const blocked = receipt?.status !== 'ready_for_human_approval';
  const allocation = useMemo(() => (proposal.spendUsd / market.price).toFixed(6), [proposal.spendUsd, market.price]);
  const auditTime = receipt ? `${receipt.evaluatedAt.slice(11, 19)}Z` : 'awaiting decision';
  const sourceDot = proofMode ? 'snapshot-dot' : market.source.startsWith('Live ·') ? 'live-dot' : 'stale-dot';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><ShieldCheck size={18}/></span><span>FAILSAFE</span><span className="beta">AGENT</span></div>
        <div className="session"><span className="pulse"/> Execution firewall <span className="scope">FAIL CLOSED</span></div>
        <button className="account"><span className="avatar">AK</span><span className="account-copy">Agentic account<small>Not connected</small></span><ChevronDown size={15}/></button>
      </header>

      <section className="mission-strip">
        <div><span className="eyebrow">CURRENT MISSION</span><strong>Build BTC exposure without breaking my rules.</strong></div>
        <div className="mission-meta"><span>Policy <b>Conservative v3</b></span><span>Mode <b>Human approval</b></span></div>
      </section>

      <div className="workspace">
        <section className="left-rail">
          <div className="rail-label">01 · INTENT</div>
          <h1>Plan the trade.<br/><em>Prove it’s safe.</em></h1>
          <p className="lede">Failsafe converts a trading goal into a bounded order. Every assumption stays visible. The public demo evaluates only; it never executes.</p>
          <div className="prompt-card">
            <label htmlFor="intent">EXAMPLE INTENT</label>
            <textarea id="intent" readOnly aria-readonly="true" defaultValue="Buy $250 of BTC if momentum is positive, but don't chase a move above 4%. Keep at least 70% of my USDT unallocated." />
            <div className="prompt-footer"><span><Sparkles size={14}/> Reference policy: 4 visible constraints</span><span className="demo-chip">READ ONLY</span></div>
          </div>
          <div className="guardrails">
            <div className="section-title"><span>GUARDRAILS</span></div>
            <PolicyRow icon={<WalletCards/>} title="Order cap" value="$250.00" note="Single-order maximum"/>
            <PolicyRow icon={<CircleGauge/>} title="Portfolio exposure" value="30% max" note="70% must remain in USDT"/>
            <PolicyRow icon={<Activity/>} title="Momentum ceiling" value="+4.00%" note="Block if 24h move exceeds limit"/>
            <PolicyRow icon={<Activity/>} title="Liquidity limit" value="0.10%" note="Maximum bid/ask spread"/>
          </div>
          <div className="attack-lab">
            <div className="section-title"><span>ADVERSARIAL CHECKS</span><em>{proofMode ? 'RECORDED PROOF' : 'LIVE INPUT'}</em></div>
            <div className="scenario-buttons">
              <button className={scenario==='baseline'?'active':''} onClick={()=>setScenario('baseline')}>{proofMode ? 'MCP proof' : 'Baseline order'}</button>
              <button className={scenario==='oversize'?'active':''} onClick={()=>setScenario('oversize')}>$500 order</button>
              <button className={scenario==='split'?'active':''} onClick={()=>setScenario('split')}>Split order</button>
              <button className={scenario==='stale'?'active':''} onClick={()=>setScenario('stale')}>Stale data</button>
            </div>
          </div>
          <div className="scope-row"><div><LockKeyhole size={16}/><span><b>Execution lock</b><small>Public demo has no Binance Trade scope</small></span></div><Switch checked={false} disabled aria-label="Execution locked"/></div>
        </section>

        <section className="decision-room">
          <div className="decision-head"><div><span className="eyebrow">02 · DECISION PACKET</span><h2>BTC / USDT</h2></div><button className="refresh" onClick={refreshMarket} disabled={proofMode || loading} aria-label={proofMode ? 'Recorded MCP evidence cannot be refreshed' : 'Refresh market data'}><RefreshCw className={loading ? 'spin' : ''} size={17}/></button></div>
          <div className="price-row"><div><span className="price">${market.price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span><span className={market.change >= 0 ? 'positive' : 'negative'}>{market.change >= 0 ? '+' : ''}{market.change.toFixed(2)}%</span></div><span className="source"><span className={sourceDot}/>{market.source}</span></div>
          <div className="chart" aria-label="Illustrative BTC price path; Failsafe evaluates the quoted evidence above">
            <div className="chart-grid"><span>81.6K</span><i/><span>79.6K</span><i/><span>77.5K</span><i/></div>
            <svg viewBox="0 0 600 140" aria-label="Illustrative BTC price path">
              <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f0b90b" stopOpacity=".3"/><stop offset="1" stopColor="#f0b90b" stopOpacity="0"/></linearGradient></defs>
              <path d={`M0 125 ${bars.map((v,i)=>`L${(i/(bars.length-1))*600} ${140-v}`).join(' ')} L600 140 L0 140Z`} fill="url(#area)"/>
              <path d={`M0 125 ${bars.map((v,i)=>`L${(i/(bars.length-1))*600} ${140-v}`).join(' ')}`} fill="none" stroke="#f0b90b" strokeWidth="3"/>
              <circle cx="600" cy={140-bars[bars.length-1]} r="5" fill="#f0b90b" stroke="#171915" strokeWidth="3"/>
            </svg>
            <div className="chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>NOW</span></div>
            <span className="chart-context">Illustrative context — not decision evidence</span>
          </div>
          <div className="checks">
            <CheckRow label="Momentum" value={`${receipt?.checks.momentum.observed ?? 'evaluating'} / positive, +4.00% max`} status={(receipt?.checks.momentum.status ?? 'unverified').toUpperCase()} block={receipt?.checks.momentum.status==='block'} unverified={receipt?.checks.momentum.status==='unverified'}/>
            <CheckRow label="Order size" value={`${receipt?.checks.orderSize.observed ?? 'evaluating'} / $250.00 max`} status={(receipt?.checks.orderSize.status ?? 'unverified').toUpperCase()} block={receipt?.checks.orderSize.status==='block'}/>
            <CheckRow label="Rolling exposure" value={`${receipt?.checks.rollingExposure.observed ?? 'evaluating'} / $250.00 per 10m`} status={(receipt?.checks.rollingExposure.status ?? 'unverified').toUpperCase()} block={receipt?.checks.rollingExposure.status==='block'}/>
            <CheckRow label="Account evidence" value={receipt?.checks.cashRetention.observed ?? 'evaluating'} status={(receipt?.checks.cashRetention.status ?? 'unverified').toUpperCase()} block={receipt?.checks.cashRetention.status==='block'} unverified={receipt?.checks.cashRetention.status==='unverified'}/>
            <CheckRow label="Market freshness" value={`${receipt?.checks.marketFreshness.observed ?? 'evaluating'} / 60s max`} status={(receipt?.checks.marketFreshness.status ?? 'unverified').toUpperCase()} block={receipt?.checks.marketFreshness.status==='block'} unverified={receipt?.checks.marketFreshness.status==='unverified'}/>
            <CheckRow label="Liquidity" value={`${receipt?.checks.liquidity.observed ?? 'evaluating'} / 0.10% spread max`} status={(receipt?.checks.liquidity.status ?? 'unverified').toUpperCase()} block={receipt?.checks.liquidity.status==='block'} unverified={receipt?.checks.liquidity.status==='unverified'}/>
          </div>
          <div className={`verdict ${blocked ? 'blocked' : step !== 'draft' ? 'checked' : ''}`}>
            <div className="verdict-icon">{blocked ? <TriangleAlert/> : step === 'draft' ? <ShieldCheck/> : <Check/>}</div>
            <div><span className="eyebrow">FIREWALL VERDICT</span><h3>{blocked ? 'Execution denied' : step === 'draft' ? 'Policy cleared' : step === 'checked' ? 'Human approval required' : 'Approval packet ready'}</h3><p>{blocked ? `${receipt?.reasons.length ?? 0} invariant${receipt?.reasons.length===1?'':'s'} failed. No execution capability was released.` : 'All evidence is present and every invariant passes. Human confirmation is still required.'}</p></div>
          </div>
        </section>

        <aside className="order-panel">
          <div><span className="eyebrow">03 · PROPOSED ORDER</span><h2>One last look.</h2></div>
          <dl className="order-spec"><div><dt>Market</dt><dd>BTC / USDT</dd></div><div><dt>Side</dt><dd className="buy">BUY</dd></div><div><dt>Type</dt><dd>Market</dd></div><div><dt>Spend</dt><dd>${proposal.spendUsd.toFixed(2)}</dd></div><div><dt>Est. receive</dt><dd>{allocation} BTC</dd></div></dl>
          <div className="boundary"><div><LockKeyhole size={17}/><b>Permission boundary</b></div><p>No Trade scope is connected to this public demo. A production adapter would require a cleared receipt before Binance&apos;s final confirmation.</p></div>
          <div className="receipt-card"><span>DECISION RECEIPT</span><code>{receipt?.receiptId ?? 'evaluating…'}</code><div><small>Policy</small><b>{receipt?.policyVersion ?? defaultPolicy.version}</b></div><div><small>Execution</small><b>NOT STARTED</b></div><div className="reason-list">{receipt?.reasons.map(reason=><i key={reason}>{reason.replaceAll('_',' ')}</i>)}</div></div>
          <Button className="approve" disabled={blocked} onClick={() => setStep(step === 'draft' ? 'checked' : 'ready')}>
            {blocked ? 'Capability withheld' : step === 'draft' ? 'Review approval packet' : 'Approval packet reviewed'}
            {blocked ? <LockKeyhole/> : step === 'ready' ? <Check/> : <ArrowRight/>}
          </Button>
          <p className="microcopy">No trade can be placed here: this public demo has no Binance Trade scope or account access.</p>
          <div className="audit"><span>AUDIT TRAIL</span><code>6 firewall checks · 0 execution calls · {auditTime}</code></div>
        </aside>
      </div>
    </main>
  );
}

function PolicyRow({icon,title,value,note}:{icon:React.ReactNode,title:string,value:string,note:string}) {
  return <div className="policy-row"><span className="policy-icon">{icon}</span><span><b>{title}</b><small>{note}</small></span><strong>{value}</strong></div>;
}
function CheckRow({label,value,status,warn=false,block=false,unverified=false}:{label:string,value:string,status:string,warn?:boolean,block?:boolean,unverified?:boolean}) {
  return <div className="check-row"><span className={`check-icon ${warn?'warn':''} ${block?'block':''} ${unverified?'unverified':''}`}>{warn?'!':block?'×':unverified?'?':<Check size={13}/>}</span><b>{label}</b><span>{value}</span><em className={warn?'warn-text':block?'block-text':unverified?'unverified-text':''}>{status}</em></div>;
}
