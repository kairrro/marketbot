<script lang="ts" module>
  // 16px stroke icons. Each entry is the contents of an <svg viewBox="0 0 16 16">.
  const PATHS = {
    back: 'M9.5 3.5 5 8l4.5 4.5',
    forward: 'M6.5 3.5 11 8l-4.5 4.5',
    chevron: 'M4 6l4 4 4-4',
    chevronUp: 'M4 10l4-4 4 4',
    check: 'M3.5 8.5l3 3 6-7',
    close: 'M4 4l8 8M12 4l-8 8',
    play: 'M5 3.5v9l7.5-4.5z',
    pause: 'M5.5 3.5v9M10.5 3.5v9',
    step: 'M4 3.5v9l6-4.5zM12 3.5v9',
    level: 'M2 8h12M2 4.5h2M6 4.5h2M10 4.5h2M2 11.5h2M6 11.5h2M10 11.5h2',
    zone: 'M2.5 4.5h11v7h-11z',
    sessions: 'M2 3.5h5M2 9.5h5M9 6.5h5M9 12.5h5M4.5 3.5v6M11.5 6.5v6',
    playbook: 'M4 13.5V2.5M4 3h8l-2 2.5L12 8H4',
    measure: 'M2.5 10.5l8-8 3 3-8 8zM5 8l1.5 1.5M7 6l1.5 1.5M9 4l1.5 1.5',
    latest: 'M3 4l4 4-4 4M8 4l4 4-4 4',
    trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5',
    plus: 'M8 3.5v9M3.5 8h9',
    download: 'M8 2.5v7.5M5 7.5l3 3 3-3M3 13h10',
    upload: 'M8 10.5V3M5 5.5l3-3 3 3M3 13h10',
    copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
    edit: 'M3 13l.6-2.8 6.9-6.9 2.2 2.2-6.9 6.9zM9.4 4.4l2.2 2.2',
    star: 'M8 2.3l1.75 3.6 3.95.55-2.85 2.8.68 3.95L8 11.35 4.47 13.2l.68-3.95L2.3 6.45l3.95-.55z',
    dice: 'M3 3h10v10H3zM5.75 5.75h.01M10.25 5.75h.01M8 8h.01M5.75 10.25h.01M10.25 10.25h.01',
    expand: 'M3 6.5V3h3.5M9.5 3H13v3.5M13 9.5V13H9.5M6.5 13H3V9.5',
    shrink: 'M6.5 3v3.5H3M13 6.5H9.5V3M9.5 13V9.5H13M3 9.5h3.5V13',
    // Added for the main app shell and the News page.
    compass: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM10.3 5.7 9.1 9.1 5.7 10.3 6.9 6.9z',
    eye: 'M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8s-2.3 4.5-6.5 4.5S1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
    news: 'M3 3.5h8v9H4.5A1.5 1.5 0 0 1 3 11zM11 6h2v5.5a1 1 0 0 1-1 1M5.5 6h3M5.5 8h3M5.5 10h2',
    candles: 'M4.5 2.5v11M3 5.5h3v5H3zM11.5 2.5v11M10 4.5h3v6h-3z',
    bell: 'M4.5 11.5V7a3.5 3.5 0 0 1 7 0v4.5l1 1h-9zM6.8 13.8a1.3 1.3 0 0 0 2.4 0',
    sliders: 'M2.5 5h6M11 5h2.5M2.5 11h2.5M7.5 11h6M9.5 3.5v3M6 9.5v3',
    refresh: 'M13 3.5v3h-3M3 12.5v-3h3M12.4 6.5A5 5 0 0 0 4 5M3.6 9.5A5 5 0 0 0 12 11',
    clock: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3.2l2 1.3',
    alert: 'M8 2.8 14 13H2zM8 6.8v3M8 11.5h.01',
    send: 'M13.5 2.5 2.5 7l4 1.8L8 13.5zM6.5 8.8l7-6.3',
    flask: 'M6.5 2.5h3M7 2.5v4L3.5 12.5a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5L9 6.5v-4M5 10h6',
    ban: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM4.1 4.1l7.8 7.8',
    arrow: 'M6 4h6v6M12 4 4 12',
    calendar: 'M3 4.5h10v8.5H3zM3 7.5h10M5.5 3v2.5M10.5 3v2.5'
  } as const;

  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 16, filled = false }: { name: IconName; size?: number; filled?: boolean } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>
