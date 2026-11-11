<script lang="ts">
  // Mounts the chart and keeps it in sync with app state. All chart logic lives
  // in $lib/chart; this component only pushes state in and routes clicks out.
  import { onMount, untrack } from 'svelte';
  import { ChartController } from '$lib/chart/controller';
  import { Interaction, type InteractionHost } from '$lib/chart/interaction';
  import { barIndexAt, buildMarkers, type MarkerTrade } from '$lib/chart/markers';
  import { draftView, openView } from '$lib/chart/positionView';
  import { snapToTick } from '$lib/engine/instruments';
  import { sessionRanges } from '$lib/engine/marketSessions';
  import { fmtPrice, roundTo } from '$lib/format';
  import { playbookFor } from '$lib/strategy/playbook';
  import { atr } from '$lib/state/atr.svelte';
  import { chartBridge } from '$lib/state/chartBridge';
  import { display } from '$lib/state/display.svelte';
  import { replay } from '$lib/state/replay.svelte';
  import { sessions } from '$lib/state/sessions.svelte';
  import { swings } from '$lib/state/swings.svelte';
  import { trade } from '$lib/state/trade.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import ChartOverlay from './ChartOverlay.svelte';

  let el: HTMLDivElement;
  let chart = $state.raw<ChartController | null>(null);
  let interaction: Interaction | null = null;
  let atLatest = $state(true);
  /** Size of the square under the price axis, where the time zone is shown. */
  let corner = $state({ width: 0, height: 0 });

  /** Runs `fn` with the loaded coin, if there is one. */
  const onCoin = (fn: (coin: string) => void) => {
    const coin = replay.info?.coin;
    if (coin) fn(coin);
  };

  const host: InteractionHost = {
    mode: () => ui.tool,
    setMode: (mode) => {
      ui.tool = mode;
    },
    // Futures sit on their tick (0.25 on NQ), so a dragged stop or target never lands between two.
    snap: (price) => {
      const tick = trade.future?.tick;
      return tick ? snapToTick(price, tick) : roundTo(price, replay.precision);
    },
    placeLevel: (price) => onCoin((coin) => ui.selectLevel(sessions.addLevel(coin, price).id)),
    selectLevel: (id) => ui.selectLevel(id),
    moveLevel: (id, price) => onCoin((coin) => sessions.moveLevel(coin, id, price)),
    addZone: (shape) => onCoin((coin) => ui.selectZone(sessions.addZone(coin, shape).id)),
    selectZone: (id) => ui.selectZone(id),
    updateZone: (id, shape) => onCoin((coin) => sessions.updateZone(coin, id, shape)),
    clickStop: (price) => trade.clickStop(price),
    beginDrag: (line) => trade.beginDrag(line),
    drag: (line, price) => trade.drag(line, price),
    endDrag: (line) => trade.endDrag(line)
  };

  onMount(() => {
    const controller = new ChartController(el);
    const mouse = new Interaction(el, controller, host);
    const offScroll = controller.onScroll(() => {
      atLatest = controller.isAtLatest();
    });
    const offResize = controller.onResize(() => {
      corner = controller.corner();
    });

    // Canvas text does not re-render by itself when a web font arrives.
    const refreshFonts = () => controller.refreshFonts();
    void document.fonts?.ready.then(refreshFonts);
    document.fonts?.addEventListener('loadingdone', refreshFonts);

    chartBridge.capture = () => controller.screenshot();
    chartBridge.cancelDrawing = () => mouse.cancelDrawing();
    chartBridge.scrollToLatest = () => controller.scrollToLatest();
    interaction = mouse;
    chart = controller;

    return () => {
      chart = null;
      interaction = null;
      chartBridge.capture = chartBridge.cancelDrawing = chartBridge.scrollToLatest = null;
      document.fonts?.removeEventListener('loadingdone', refreshFonts);
      offScroll();
      offResize();
      mouse.destroy();
      controller.destroy();
    };
  });

  // Candles. Only the visible count, and the candle forming at the cursor, are ever handed to the chart.
  $effect(() => {
    chart?.sync(
      replay.candles,
      replay.count,
      replay.forming,
      replay.datasetId,
      replay.precision,
      replay.tfMs,
      display.timeZone
    );
  });

  // Session highs and lows, from the visible candles only.
  $effect(() => {
    const show = display.sessions && replay.info != null;
    chart?.marketSessions.set(
      show
        ? sessionRanges(replay.candles, replay.count, replay.tfMs, display.shownSessions, {
            weekends: display.weekendSessions
          })
        : []
    );
  });

  // The playbook, from the visible closed candles only, and on 1m only.
  $effect(() => {
    const show = display.playbook && replay.info != null;
    chart?.playbook.set(show ? playbookFor(replay.candles, replay.count, replay.tfMs) : null);
  });

  // Swing dots and sweeps, from the chart's own closed candles.
  $effect(() => {
    chart?.swings.set(swings.points, swings.sweeps);
  });

  // The ATR ruler beside the latest candle: 1 and 2 ATRs around the entry while a
  // trade is being planned, around the current price otherwise (a stop to trail).
  $effect(() => {
    const reading = atr.reading;
    const anchor = (trade.draft ?? trade.pending)?.entry ?? replay.price;
    if (!reading || anchor == null || replay.count === 0) {
      chart?.atr.set(null);
      return;
    }
    chart?.atr.set({
      index: replay.forming ? replay.count : replay.count - 1,
      anchor,
      atr: reading.value
    });
  });

  // The current price: the same on every timeframe, unlike the last candle.
  $effect(() => {
    chart?.setPrice(replay.info ? replay.price : null);
  });

  // While the journal's edge is dragged the chart keeps its height (the stage
  // clips it), so it is redrawn once on release rather than on every frame.
  let frozenHeight = $state<number | null>(null);
  $effect(() => {
    const resizing = ui.journalResizing;
    frozenHeight = resizing ? untrack(() => el.clientHeight) : null;
  });

  // Bar indexes change with the dataset, so a measurement or a half-drawn zone
  // cannot survive a reload.
  $effect(() => {
    void replay.datasetId;
    interaction?.cancelDrawing();
  });

  // Entry and exit markers for the current coin, up to the cursor.
  $effect(() => {
    const info = replay.info;
    // Marker times carry the zone's offset, so they move when the zone does.
    void display.timeZone;
    if (!chart) return;
    if (!info) {
      chart.setMarkers([]);
      return;
    }

    const trades: MarkerTrade[] = sessions.trades.map((t) => ({
      coin: t.coin,
      side: t.side,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      r: t.r
    }));
    if (trade.open && trade.meta) {
      trades.push({
        coin: trade.meta.coin,
        side: trade.open.side,
        entryTime: trade.open.entryTime,
        exitTime: null,
        r: null
      });
    }

    const controller = chart;
    controller.setMarkers(
      buildMarkers(trades, {
        coin: info.coin,
        tfMs: replay.tfMs,
        candles: replay.candles,
        count: replay.count,
        forming: replay.forming,
        toTime: (ms) => controller.time(ms),
        theme: controller.theme
      })
    );
  });

  // Levels and zones for the current coin in the active session.
  $effect(() => {
    const precision = replay.precision;
    chart?.levels.set(sessions.levelsFor(replay.info?.coin), ui.selectedLevel, (price) => fmtPrice(price, precision));
  });

  $effect(() => {
    // Zones are placed by time, so they are redrawn when the candles change too.
    void replay.datasetId;
    void replay.count;
    chart?.zones.set(sessions.zonesFor(replay.info?.coin), ui.selectedZone);
  });

  // The position tool: a draft, a limit order waiting to fill, the open trade,
  // or a trade being photographed as it closes.
  $effect(() => {
    if (!chart) return;
    const base = {
      coin: replay.info?.coin ?? '',
      contracts: trade.contract != null,
      precision: replay.precision,
      draggingStop: trade.dragging === 'stop',
      atr: atr.reading?.value ?? null
    };
    const shown = trade.open ?? trade.closing;
    const pending = trade.pending;

    if (trade.draft && trade.draftMetrics) {
      const takeProfit = !sessions.settings.scaleOut || trade.contract != null;
      // From the latest bar: the forming candle, if there is one.
      const fromLogical = replay.forming ? replay.count : replay.count - 1;
      const stopWarning = trade.draftWarnings.find((w) => w.code === 'min-stop')?.message;
      chart.position.set(
        draftView(trade.draft, trade.draftMetrics, { ...base, fromLogical, takeProfit, stopWarning, limit: trade.limitEntry })
      );
    } else if (pending && trade.pendingMetrics && replay.count > 0) {
      const fromLogical = barIndexAt(replay.candles, replay.count, replay.tfMs, pending.placedAt, replay.forming);
      const takeProfit = pending.scaleOut === false || pending.contract != null;
      const stopWarning = trade.pendingWarnings.find((w) => w.code === 'min-stop')?.message;
      chart.position.set(
        draftView(pending, trade.pendingMetrics, { ...base, fromLogical, takeProfit, stopWarning, limit: true, placed: true })
      );
    } else if (shown && replay.count > 0) {
      const fromLogical = barIndexAt(replay.candles, replay.count, replay.tfMs, shown.entryTime, replay.forming);
      const stopWarning = trade.open ? trade.tightStop : null;
      chart.position.set(openView(shown, replay.price, { ...base, fromLogical, stopWarning }));
    } else {
      chart.position.set(null);
    }
  });

  // Lets the measure tool express a move in R while a trade is on.
  $effect(() => {
    const plan = trade.draft ?? trade.pending;
    const open = trade.open;
    const risk = open
      ? { dist: open.dist, dir: open.dir }
      : plan
        ? { dist: Math.abs(plan.entry - plan.stop), dir: plan.side === 'long' ? (1 as const) : (-1 as const) }
        : null;
    chart?.measure.setContext({ tfMs: replay.tfMs, precision: replay.precision, risk });
  });
</script>

<div class="pane">
  <div
    class="chart"
    bind:this={el}
    style:bottom={frozenHeight != null ? 'auto' : null}
    style:height={frozenHeight != null ? `${frozenHeight}px` : null}
  ></div>
  <ChartOverlay {atLatest} {corner} />
</div>

<style>
  .pane {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .chart {
    position: absolute;
    inset: 0;
  }
</style>
