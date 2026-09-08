export const dynamic = 'force-dynamic';

function numberFrom(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid market field: ${field}`);
  return parsed;
}

export async function GET() {
  try {
    const [tickerResponse, bookResponse] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { cache: 'no-store' }),
      fetch('https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT', { cache: 'no-store' }),
    ]);
    if (!tickerResponse.ok || !bookResponse.ok) throw new Error('Binance market request failed');
    const data = await tickerResponse.json() as Record<string, unknown>;
    const book = await bookResponse.json() as Record<string, unknown>;
    const price = numberFrom(data.lastPrice, 'lastPrice');
    const change = numberFrom(data.priceChangePercent, 'priceChangePercent');
    const high = numberFrom(data.highPrice, 'highPrice');
    const low = numberFrom(data.lowPrice, 'lowPrice');
    const volume = numberFrom(data.volume, 'volume');
    const ask = numberFrom(book.askPrice, 'askPrice');
    const bid = numberFrom(book.bidPrice, 'bidPrice');
    if (price <= 0 || high <= 0 || low <= 0 || volume < 0 || ask <= 0 || bid <= 0 || bid > ask) throw new Error('invalid market range');
    return Response.json({
      price, change, high, low, volume,
      spreadPercent: ((ask - bid) / ask) * 100,
      observedAt: new Date().toISOString(), source: 'Live · Binance public API',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ price: 80142.2, change: 2.41, high: 81680, low: 77542, volume: 32184, spreadPercent: .02, observedAt: '2026-09-08T00:00:00.000Z', source: 'Fallback snapshot · stale' });
  }
}
