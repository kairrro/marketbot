import { CONFIG } from '$lib/config';
import { getScanSymbols } from '../kcex/symbols';
import { sendNewListingAlert } from '../discord/webhook';
import {
  getKnownSymbols,
  recordKnownSymbols,
} from '../db';

// See perpWatcher.ts for why this lives on globalThis instead of a module-scoped `let`.
declare global {
  var __listingWatcherIntervalId: ReturnType<typeof setInterval> | undefined;
}

let knownSymbols: Set<string> | null = null;
let lastCheckAt: number | null = null;
let lastCheckError: string | null = null;
let checking = false;

async function doCheck(): Promise<void> {
  let symbols: string[];

  try {
    symbols = await getScanSymbols();
    lastCheckError = null;
  } catch (err) {
    lastCheckError = err instanceof Error ? err.message : String(err);
    console.error('Listing watcher: failed to fetch symbol list:', err);
    return;
  } finally {
    lastCheckAt = Date.now();
  }

  const currentSymbols = new Set(symbols);

  // First check after process startup.
  //
  // The DB contains the last KCEX state from the previous run.
  // We intentionally DO NOT alert for differences here because those
  // symbols may have been listed while the bot was offline.
  if (knownSymbols === null) {
    const storedSymbols = getKnownSymbols();

    if (storedSymbols.size === 0) {
      knownSymbols = currentSymbols;
      recordKnownSymbols(symbols);

      console.log(
        `Listing watcher: initial baseline established with ${currentSymbols.size} symbols.`
      );

      return;
    }

    knownSymbols = currentSymbols;
    recordKnownSymbols(symbols);

    console.log(
      `Listing watcher: baseline synchronized with ${currentSymbols.size} symbols.`
    );

    return;
  }

  // From this point onward, only symbols appearing after the previous
  // successful KCEX state are considered new.
  const newSymbols = symbols.filter(
    (symbol) => !knownSymbols!.has(symbol)
  );

  if (newSymbols.length > 0) {
    console.log(
      `Listing watcher: new symbol(s) detected: ${newSymbols.join(', ')}`
    );

    for (const symbol of newSymbols) {
      try {
        await sendNewListingAlert(symbol);
      } catch (err) {
        console.error(
          `Listing watcher: failed to send Discord alert for ${symbol}:`,
          err
        );
      }
    }
  } else {
    console.log('Listing watcher: no new symbols this check.');
  }

  knownSymbols = currentSymbols;
  recordKnownSymbols(symbols);
}

export async function checkForNewListings(): Promise<void> {
  // Without this, an overlapping run (e.g. a slow check still sending Discord
  // alerts for a big batch of new listings when the next interval tick
  // fires) would read the same stale knownSymbols and re-alert the same
  // symbols a second time.
  if (checking) return;
  checking = true;

  try {
    await doCheck();
  } finally {
    checking = false;
  }
}

export function startListingWatcher(): void {
  if (globalThis.__listingWatcherIntervalId) return;

  // Important: don't await this here.
  checkForNewListings();

  globalThis.__listingWatcherIntervalId = setInterval(
    checkForNewListings,
    CONFIG.listingWatcher.pollIntervalMs
  );

  console.log(
    `Listing watcher started (polling every ${CONFIG.listingWatcher.pollIntervalMs / 1000}s).`
  );
}

// --- Debug helpers ---

export function simulateNewListing(): string | null {
  if (!knownSymbols || knownSymbols.size === 0) return null;

  const [symbol] = knownSymbols;

  knownSymbols.delete(symbol);

  console.log(
    `Listing watcher: DEBUG - removed ${symbol} from baseline to simulate a new listing.`
  );

  return symbol;
}

export function getWatcherStatus() {
  return {
    running: globalThis.__listingWatcherIntervalId !== undefined,
    baselineEstablished: knownSymbols !== null,
    knownSymbolCount: knownSymbols?.size ?? 0,
    lastCheckAt,
    lastCheckError,
  };
}