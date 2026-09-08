export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [tickerResponse, bookResponse] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { cache: 'no-store' }),
      fetch('https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT', { cache: 'no-store' }),
    ]);
    if (!tickerResponse.ok || !bookResponse.ok) throw new Error('Binance market request failed');
    const data = await tickerResponse.json() as Record<string,string>;
    const book = await bookResponse.json() as Record<string,string>;
    const ask = Number(book.askPrice);
    const bid = Number(book.bidPrice);
    return Response.json({
      price: Number(data.lastPrice), change: Number(data.priceChangePercent),
      high: Number(data.highPrice), low: Number(data.lowPrice), volume: Number(data.volume),
      spreadPercent: ((ask - bid) / ask) * 100,
      observedAt: new Date().toISOString(), source: 'Live · Binance public API',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ price: 80142.2, change: 2.41, high: 81680, low: 77542, volume: 32184, spreadPercent: .02, observedAt: '2026-09-08T00:00:00.000Z', source: 'Fallback snapshot · stale' });
  }
}
