import { render } from 'preact';
import { App } from './ui/App';
import './ui/styles.css';

// Some mobile browsers (Firefox for Android) size 100dvh / fixed boxes larger
// than the visible area, leaving a gap under the bottom tab bar. Track the
// real visible height and let the game screen use it.
function trackViewportHeight() {
  const set = () => {
    const vv = window.visualViewport;
    const h = vv ? vv.height * vv.scale : window.innerHeight; // ignore pinch zoom
    document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
  };
  set();
  window.visualViewport?.addEventListener('resize', set);
  window.addEventListener('resize', set);
}
trackViewportHeight();

render(<App />, document.getElementById('app')!);
