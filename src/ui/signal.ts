/**
 * Short signals that draw the player back to the game: a beep and a buzz.
 * Browsers play sound only after the page has been touched, so the audio is
 * unlocked on the first tap (iOS wants a sound started inside a tap).
 */

let audio: AudioContext | undefined;

function unlock() {
  try {
    audio ??= new AudioContext();
    if (audio.state !== 'running') void audio.resume();
    // A silent sound within the tap unlocks the output on iOS.
    const src = audio.createBufferSource();
    src.buffer = audio.createBuffer(1, 1, 22050);
    src.connect(audio.destination);
    src.start();
  } catch {
    /* no Web Audio: no beep */
  }
}

const TAPS = ['pointerdown', 'touchend', 'keydown'];
function onTap() {
  unlock();
  if (audio?.state === 'running') for (const ev of TAPS) document.removeEventListener(ev, onTap, true);
}
if (typeof document !== 'undefined') for (const ev of TAPS) document.addEventListener(ev, onTap, true);

/** A soft two-tone chime, about a third of a second long. */
export function beep(): void {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  for (const [freq, at] of [
    [880, 0],
    [1320, 0.12],
  ] as const) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + at);
    gain.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.2);
    osc.connect(gain).connect(audio.destination);
    osc.start(t + at);
    osc.stop(t + at + 0.22);
  }
}

/** Whether this browser can vibrate (Android does, iOS does not). */
export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export function buzz(): void {
  if (canVibrate) navigator.vibrate(150);
}
