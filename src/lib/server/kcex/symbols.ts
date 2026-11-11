// Pulls the live list of perpetual contract symbols directly from KCEX's futures ticker endpoint.

const CONTRACT_TICKER_URL = 'https://www.kcex.com/fapi/v1/contract/ticker';

interface KcexContractTicker {
  symbol: string; // e.g. "BTC_USDT"
}

export async function getScanSymbols(): Promise<string[]> {
  const res = await fetch(CONTRACT_TICKER_URL);
  const json = await res.json();

  const items: KcexContractTicker[] = json.data ?? [];
  return items.map((item) => item.symbol);
}