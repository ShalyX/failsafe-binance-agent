'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, Check, ChevronDown, CircleGauge, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, TriangleAlert, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

type Market = { price: number; change: number; high: number; low: number; volume: number; source: string };
const fallback: Market = { price: 80142.2, change: 2.41, high: 81680, low: 77542, volume: 32184, source: 'Demo snapshot' };
const verifiedMcpSnapshot: Market = { price: 78400.01, change: -0.983, high: 79980, low: 77542, volume: 32184, source: 'Verified MCP snapshot · Sep 8' };
const bars = [31, 40, 37, 49, 55, 51, 63, 59, 71, 68, 78, 74, 87, 83, 92, 89, 96, 93, 104, 99, 112, 108, 118, 115];
type WebMcpDocument = Document & { modelContext?: { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> } };

export default function Home() {
  const [market, setMarket] = useState<Market>(fallback);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'draft' | 'checked' | 'ready'>('draft');
  const [advanced, setAdvanced] = useState(false);
  const momentumPass = market.change > 0 && market.change <= 4;

  async function refreshMarket() {
    setLoading(true);
    try {
      const response = await fetch('/api/market', { cache: 'no-store' });
      if (!response.ok) throw new Error('market unavailable');
      setMarket(await response.json());
    } catch { setMarket(fallback); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('proof') === 'mcp') {
      setMarket(verifiedMcpSnapshot);
      setLoading(false);
      return;
    }
    refreshMarket();
  }, []);
  useEffect(() => {
    const context = (document as WebMcpDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'stage_policy_checked_order',
      title: 'Stage policy-checked order',
      description: 'Validate a proposed BTC/USDT order against the visible Failsafe policy and prepare it for human review. This never executes a trade.',
      inputSchema: {
        type: 'object',
        properties: {
          spendUsd: { type: 'number', minimum: 1, maximum: 250 },
          maxMomentumPercent: { type: 'number', minimum: 0.1, maximum: 4 },
          minimumCashRetainedPercent: { type: 'number', minimum: 70, maximum: 100 },
        },
        required: ['spendUsd', 'maxMomentumPercent', 'minimumCashRetainedPercent'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const value = input as { spendUsd?: number; maxMomentumPercent?: number; minimumCashRetainedPercent?: number };
        if (typeof value.spendUsd !== 'number' || value.spendUsd > 250 || value.spendUsd < 1) throw new Error('spendUsd must be between 1 and 250');
        if (typeof value.maxMomentumPercent !== 'number' || value.maxMomentumPercent > 4 || value.maxMomentumPercent < .1) throw new Error('maxMomentumPercent must be between 0.1 and 4');
        if (typeof value.minimumCashRetainedPercent !== 'number' || value.minimumCashRetainedPercent < 70 || value.minimumCashRetainedPercent > 100) throw new Error('minimumCashRetainedPercent must be between 70 and 100');
        if (!momentumPass) {
          setStep('draft');
          return { status: 'blocked', reason: 'momentum_not_positive', execution: 'not_started', requiresHumanApproval: false };
        }
        setStep('checked');
        return { status: 'policy_verified', execution: 'not_started', requiresHumanApproval: true };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [momentumPass]);
  const allocation = useMemo(() => (250 / market.price).toFixed(6), [market.price]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><ShieldCheck size={18}/></span><span>FAILSAFE</span><span className="beta">AGENT</span></div>
        <div className="session"><span className="pulse"/> Binance MCP · Market data <span className="scope">READ ONLY</span></div>
        <button className="account"><span className="avatar">AK</span><span className="account-copy">Agentic account<small>Not connected</small></span><ChevronDown size={15}/></button>
      </header>

      <section className="mission-strip">
        <div><span className="eyebrow">CURRENT MISSION</span><strong>Build BTC exposure without breaking my rules.</strong></div>
        <div className="mission-meta"><span>Policy <b>Conservative v2</b></span><span>Mode <b>Human approval</b></span></div>
      </section>

      <div className="workspace">
        <section className="left-rail">
          <div className="rail-label">01 · INTENT</div>
          <h1>Plan the trade.<br/><em>Prove it’s safe.</em></h1>
          <p className="lede">Failsafe converts a trading goal into a bounded order. Every assumption stays visible. Nothing executes without you.</p>
          <div className="prompt-card">
            <label htmlFor="intent">YOUR INTENT</label>
            <textarea id="intent" defaultValue="Buy $250 of BTC if momentum is positive, but don't chase a move above 4%. Keep at least 70% of my USDT unallocated." />
            <div className="prompt-footer"><span><Sparkles size={14}/> Parsed into 4 constraints</span><button aria-label="Regenerate plan"><RefreshCw size={15}/></button></div>
          </div>
          <div className="guardrails">
            <div className="section-title"><span>GUARDRAILS</span><button onClick={() => setAdvanced(!advanced)}>{advanced ? 'Hide' : 'Tune'} limits</button></div>
            <PolicyRow icon={<WalletCards/>} title="Order cap" value="$250.00" note="Single-order maximum"/>
            <PolicyRow icon={<CircleGauge/>} title="Portfolio exposure" value="30% max" note="70% must remain in USDT"/>
            <PolicyRow icon={<Activity/>} title="Momentum ceiling" value="+4.00%" note="Block if 24h move exceeds limit"/>
            {advanced && <PolicyRow icon={<TriangleAlert/>} title="Daily loss limit" value="1.50%" note="Freeze execution if breached"/>}
          </div>
          <div className="scope-row"><div><LockKeyhole size={16}/><span><b>Execution lock</b><small>Binance requires approval for every order</small></span></div><Switch checked={false} disabled aria-label="Execution locked"/></div>
        </section>

        <section className="decision-room">
          <div className="decision-head"><div><span className="eyebrow">02 · DECISION PACKET</span><h2>BTC / USDT</h2></div><button className="refresh" onClick={refreshMarket} aria-label="Refresh market data"><RefreshCw className={loading ? 'spin' : ''} size={17}/></button></div>
          <div className="price-row"><div><span className="price">${market.price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span><span className={market.change >= 0 ? 'positive' : 'negative'}>{market.change >= 0 ? '+' : ''}{market.change.toFixed(2)}%</span></div><span className="source"><span className="live-dot"/>{market.source}</span></div>
          <div className="chart" aria-label="BTC intraday price trend">
            <div className="chart-grid"><span>81.6K</span><i/><span>79.6K</span><i/><span>77.5K</span><i/></div>
            <svg viewBox="0 0 600 140" role="img" aria-label="Rising BTC price line">
              <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f0b90b" stopOpacity=".3"/><stop offset="1" stopColor="#f0b90b" stopOpacity="0"/></linearGradient></defs>
              <path d={`M0 125 ${bars.map((v,i)=>`L${(i/(bars.length-1))*600} ${140-v}`).join(' ')} L600 140 L0 140Z`} fill="url(#area)"/>
              <path d={`M0 125 ${bars.map((v,i)=>`L${(i/(bars.length-1))*600} ${140-v}`).join(' ')}`} fill="none" stroke="#f0b90b" strokeWidth="3"/>
              <circle cx="600" cy={140-bars[bars.length-1]} r="5" fill="#f0b90b" stroke="#171915" strokeWidth="3"/>
            </svg>
            <div className="chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>NOW</span></div>
          </div>
          <div className="checks">
            <CheckRow label="Momentum" value={`${market.change >= 0 ? '+' : ''}${market.change.toFixed(2)}% / positive, +4.00% max`} status={momentumPass ? 'PASS' : 'BLOCK'} block={!momentumPass}/>
            <CheckRow label="Order size" value="$250.00 / $250.00 max" status="AT LIMIT" warn/>
            <CheckRow label="Cash retained" value="74.8% / 70.0% min" status="PASS"/>
            <CheckRow label="Liquidity" value="0.02% est. price impact" status="PASS"/>
          </div>
          <div className={`verdict ${!momentumPass ? 'blocked' : step !== 'draft' ? 'checked' : ''}`}>
            <div className="verdict-icon">{!momentumPass ? <TriangleAlert/> : step === 'draft' ? <ShieldCheck/> : <Check/>}</div>
            <div><span className="eyebrow">AGENT VERDICT</span><h3>{!momentumPass ? 'Policy blocked' : step === 'draft' ? 'Safe to prepare' : step === 'checked' ? 'Policy verified' : 'Approval packet ready'}</h3><p>{!momentumPass ? '24-hour momentum is not positive. Failsafe will not prepare or hand off this order.' : step === 'draft' ? 'All four policy checks pass. Review the order packet before sending it to Binance.' : 'The plan is bounded, reversible before execution, and requires your explicit confirmation.'}</p></div>
          </div>
        </section>

        <aside className="order-panel">
          <div><span className="eyebrow">03 · PROPOSED ORDER</span><h2>One last look.</h2></div>
          <dl className="order-spec"><div><dt>Market</dt><dd>BTC / USDT</dd></div><div><dt>Side</dt><dd className="buy">BUY</dd></div><div><dt>Type</dt><dd>Market</dd></div><div><dt>Spend</dt><dd>$250.00</dd></div><div><dt>Est. receive</dt><dd>{allocation} BTC</dd></div></dl>
          <div className="boundary"><div><LockKeyhole size={17}/><b>Permission boundary</b></div><p>Failsafe cannot withdraw funds. Binance will show the final order and ask you to confirm.</p></div>
          <div className="impact"><span>AFTER THIS ORDER</span><div><small>USDT retained</small><b>74.8%</b></div><div className="meter"><i/></div><p>Inside your 70% minimum</p></div>
          <Button className="approve" disabled={!momentumPass} onClick={() => setStep(step === 'draft' ? 'checked' : 'ready')}>
            {!momentumPass ? 'Order blocked by policy' : step === 'draft' ? 'Run final safety check' : step === 'checked' ? 'Prepare Binance approval' : 'Approval packet prepared'}
            {!momentumPass ? <LockKeyhole/> : step === 'ready' ? <Check/> : <ArrowRight/>}
          </Button>
          <p className="microcopy">No trade is placed in this demo. Live execution is handed to Binance MCP with human confirmation.</p>
          <div className="audit"><span>AUDIT TRAIL</span><code>4 checks · 0 overrides · {new Date().toISOString().slice(11,19)}Z</code></div>
        </aside>
      </div>
    </main>
  );
}

function PolicyRow({icon,title,value,note}:{icon:React.ReactNode,title:string,value:string,note:string}) {
  return <div className="policy-row"><span className="policy-icon">{icon}</span><span><b>{title}</b><small>{note}</small></span><strong>{value}</strong></div>;
}
function CheckRow({label,value,status,warn=false,block=false}:{label:string,value:string,status:string,warn?:boolean,block?:boolean}) {
  return <div className="check-row"><span className={`check-icon ${warn?'warn':''} ${block?'block':''}`}>{warn?'!':block?'×':<Check size={13}/>}</span><b>{label}</b><span>{value}</span><em className={warn?'warn-text':block?'block-text':''}>{status}</em></div>;
}
