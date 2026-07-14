/* Sons sintetizados via Web Audio API — sem arquivos externos.
   Estética militar: beeps de radar, alertas, confirmações. */

let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSoundEnabled(v) { enabled = v; }
export function isSoundEnabled() { return enabled; }
// Necessário desbloquear áudio após interação do usuário (políticas do browser).
export function unlockAudio() { ac(); }

function tone({ freq = 440, dur = 0.12, type = 'sine', gain = 0.08, slideTo = null, delay = 0 }) {
  const c = ac();
  if (!c || !enabled) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  // novo ataque detectado — beep de radar duplo grave/agudo
  attack() {
    tone({ freq: 180, dur: 0.08, type: 'sawtooth', gain: 0.06 });
    tone({ freq: 880, dur: 0.1, type: 'square', gain: 0.05, delay: 0.06 });
  },
  // alerta crítico (muitas tentativas)
  alert() {
    tone({ freq: 660, dur: 0.14, type: 'square', gain: 0.07 });
    tone({ freq: 660, dur: 0.14, type: 'square', gain: 0.07, delay: 0.2 });
    tone({ freq: 660, dur: 0.18, type: 'square', gain: 0.07, delay: 0.4 });
  },
  // clique de interface
  click() { tone({ freq: 520, dur: 0.05, type: 'square', gain: 0.04 }); },
  // hover suave
  blip() { tone({ freq: 1200, dur: 0.03, type: 'sine', gain: 0.02 }); },
  // sucesso (credencial funcionou!) — fanfarra curta ascendente
  success() {
    tone({ freq: 523, dur: 0.1, type: 'triangle', gain: 0.06 });
    tone({ freq: 659, dur: 0.1, type: 'triangle', gain: 0.06, delay: 0.1 });
    tone({ freq: 784, dur: 0.16, type: 'triangle', gain: 0.06, delay: 0.2 });
  },
  // falha
  fail() { tone({ freq: 300, dur: 0.18, type: 'sawtooth', gain: 0.06, slideTo: 120 }); },
  // sweep de abertura
  boot() {
    tone({ freq: 120, dur: 0.5, type: 'sawtooth', gain: 0.05, slideTo: 900 });
    tone({ freq: 440, dur: 0.2, type: 'square', gain: 0.04, delay: 0.5 });
  },
};
