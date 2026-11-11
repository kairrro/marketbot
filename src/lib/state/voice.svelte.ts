// Push-to-talk voice notes. Hold V to record, let go to stop: the browser's own
// speech recognition (Web Speech API, no paid service) turns it into text, which
// is added to the note of the trade that just closed. Where the browser has no
// speech recognition, the note can be typed instead. Always optional.

import { sessions } from './sessions.svelte';
import { ui } from './ui.svelte';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const UNSUPPORTED = "This browser can't turn speech into text. Type your note instead.";

class VoiceStore {
  /** The trade a voice or typed note is being added to. */
  tradeId = $state<string | null>(null);
  recording = $state(false);
  /** What has been heard so far in this recording. */
  heard = $state('');
  /** A short message about why no voice note was made. */
  message = $state<string | null>(null);
  /** The note box is showing, to type in or to edit what was heard. */
  typing = $state(false);
  /** The note box takes the cursor as it opens: set when voice could not be used. */
  focusNote = $state(false);

  #recognition: Recognition | null = null;
  #held = false;
  #error: string | null = null;
  #messageTimer: ReturnType<typeof setTimeout> | undefined;

  /** True while there is anything of the voice note to show. */
  get active(): boolean {
    return this.recording || this.typing || this.message != null;
  }

  /** V went down: starts listening for the trade that just closed. */
  start(): void {
    if (this.#held) return;
    const id = ui.promptId ?? sessions.trades.at(-1)?.id ?? null;
    if (!id) {
      ui.toast('Close a trade first, then hold V to add a voice note.', 'warn');
      return;
    }
    clearTimeout(this.#messageTimer);
    this.tradeId = id;
    this.message = null;

    const Recognition = recognitionConstructor();
    if (!Recognition) return this.#typeInstead(UNSUPPORTED);

    this.#held = true;
    this.#error = null;
    this.heard = '';
    try {
      const recognition = new Recognition();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let text = '';
        for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
        this.heard = text.trim();
      };
      recognition.onerror = (event) => {
        this.#error = event.error;
      };
      recognition.onend = () => this.#finish();
      this.#recognition = recognition;
      recognition.start();
      this.recording = true;
    } catch {
      this.#held = false;
      this.#recognition = null;
      this.#typeInstead(UNSUPPORTED);
    }
  }

  /** V came up (or the window lost focus): stops listening; the text is saved when the browser is done. */
  stop(): void {
    this.#held = false;
    if (!this.#recognition) return;
    try {
      this.#recognition.stop();
    } catch {
      this.#finish();
    }
  }

  #finish(): void {
    this.#recognition = null;
    this.#held = false;
    this.recording = false;
    const text = this.heard.trim();
    this.heard = '';
    const error = this.#error;

    if (error === 'not-allowed' || error === 'service-not-allowed') {
      return this.#typeInstead('The microphone is blocked for this page. Type your note instead.');
    }
    if (error === 'audio-capture') return this.#typeInstead('No microphone found. Type your note instead.');
    if (error === 'network') {
      // Not about your connection: the browser has no speech service to send the audio to.
      return this.#typeInstead(
        "This browser's speech service isn't available (Brave, and app-embedded browsers like Claude's, don't have one). Open the backtester in Chrome or Edge for voice notes, or type your note."
      );
    }
    if (!text) {
      this.#say(error && error !== 'no-speech' && error !== 'aborted' ? "Couldn't record that." : "Didn't catch anything.");
      return;
    }

    const trade = sessions.findTrade(this.tradeId);
    if (!trade) return;
    sessions.updateTrade(trade.id, { notes: trade.notes ? `${trade.notes} ${text}` : text });
    // Shown in the note box, so it can be corrected on the spot.
    this.focusNote = false;
    this.typing = true;
  }

  #typeInstead(message: string): void {
    this.message = message;
    this.focusNote = true;
    this.typing = true;
  }

  /** A message that goes away by itself. */
  #say(message: string): void {
    this.message = message;
    clearTimeout(this.#messageTimer);
    this.#messageTimer = setTimeout(() => {
      this.message = null;
      if (!this.typing && !this.recording) this.tradeId = null;
    }, 2500);
  }

  /** Closes the voice note area. A recording in progress is dropped. */
  dismiss(): void {
    clearTimeout(this.#messageTimer);
    const recognition = this.#recognition;
    if (recognition) {
      recognition.onresult = recognition.onerror = recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
    }
    this.#recognition = null;
    this.#held = false;
    this.heard = '';
    this.recording = false;
    this.typing = false;
    this.focusNote = false;
    this.message = null;
    this.tradeId = null;
  }
}

export const voice = new VoiceStore();
