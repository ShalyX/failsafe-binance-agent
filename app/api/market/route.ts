export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { cache: 'no-store' });
    if (!response.ok) throw new Error('Binance market request failed');
    const data = await response.json() as Record<string,string>;
    return Response.json({
      price: Number(data.lastPrice), change: Number(data.priceChangePercent),
      high: Number(data.highPrice), low: Number(data.lowPrice), volume: Number(data.volume),
      source: 'Live · Binance',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ price: 80142.2, change: 2.41, high: 81680, low: 77542, volume: 32184, source: 'Demo snapshot' });
  }
}
