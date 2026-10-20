import { AudioBands, QualityTier, RaphaelState, VisualizerTunables, GLYPH_RING_TEXTS } from './types';

interface StateMotion {
  /** 0..1 how "awake"/bright the whole piece is */
  energy: number;
  /** radians/sec base rotation for mid rings */
  ringSpeed: number;
  /** radians/sec for outer rings */
  outerSpeed: number;
  /** multiplier on ray count/length */
  rayBoost: number;
  /** multiplier on particle speed */
  particleSpeed: number;
  /** breathing pulse amplitude (fraction of core radius) */
  pulseAmplitude: number;
  /** breathing pulse speed, Hz-ish */
  pulseSpeed: number;
  /** tint applied to the core/glow (hue shift feel) */
  tint: 'gold' | 'amber' | 'red';
  /** scanning sweep arc visible (THINKING) */
  scanning: boolean;
  /** glyph text flicker (RESEARCHING) */
  flicker: boolean;
}

const STATE_MOTION: Record<RaphaelState, StateMotion> = {
  idle: { energy: 0.45, ringSpeed: 0.03, outerSpeed: 0.015, rayBoost: 0.5, particleSpeed: 0.3, pulseAmplitude: 0.02, pulseSpeed: 0.15, tint: 'gold', scanning: false, flicker: false },
  listening: { energy: 0.6, ringSpeed: 0.045, outerSpeed: 0.02, rayBoost: 0.7, particleSpeed: 0.4, pulseAmplitude: 0.05, pulseSpeed: 0.35, tint: 'gold', scanning: false, flicker: false },
  thinking: { energy: 0.55, ringSpeed: 0.02, outerSpeed: 0.01, rayBoost: 0.6, particleSpeed: 0.35, pulseAmplitude: 0.025, pulseSpeed: 0.2, tint: 'amber', scanning: true, flicker: false },
  researching: { energy: 0.7, ringSpeed: 0.09, outerSpeed: 0.05, rayBoost: 0.8, particleSpeed: 0.7, pulseAmplitude: 0.03, pulseSpeed: 0.3, tint: 'amber', scanning: false, flicker: true },
  waiting_for_permission: { energy: 0.4, ringSpeed: 0.015, outerSpeed: 0.008, rayBoost: 0.35, particleSpeed: 0.2, pulseAmplitude: 0.06, pulseSpeed: 0.12, tint: 'amber', scanning: false, flicker: false },
  executing: { energy: 0.9, ringSpeed: 0.12, outerSpeed: 0.07, rayBoost: 1.3, particleSpeed: 1.1, pulseAmplitude: 0.035, pulseSpeed: 0.5, tint: 'gold', scanning: false, flicker: false },
  speaking: { energy: 0.85, ringSpeed: 0.06, outerSpeed: 0.03, rayBoost: 1.0, particleSpeed: 0.8, pulseAmplitude: 0.03, pulseSpeed: 0.4, tint: 'gold', scanning: false, flicker: false },
  completed: { energy: 1.0, ringSpeed: 0.08, outerSpeed: 0.04, rayBoost: 1.2, particleSpeed: 0.9, pulseAmplitude: 0.04, pulseSpeed: 0.6, tint: 'gold', scanning: false, flicker: false },
  error: { energy: 0.5, ringSpeed: 0.012, outerSpeed: 0.006, rayBoost: 0.4, particleSpeed: 0.25, pulseAmplitude: 0.05, pulseSpeed: 0.25, tint: 'red', scanning: false, flicker: false }
};

const TINTS = {
  gold: { core: '#fff6df', mid: '#ffcf6b', outer: '#ffa94a', ring: '#e0b667', particle: '#ffdca3', teal: '#2fb6a8' },
  amber: { core: '#fff2e0', mid: '#ffb15c', outer: '#ff8a3d', ring: '#d99a52', particle: '#ffc98a', teal: '#2a9db3' },
  red: { core: '#ffe9e0', mid: '#ff8f6b', outer: '#e5484d', ring: '#c75c56', particle: '#ff9b8a', teal: '#2a6b8f' }
};

export interface FrameParticle {
  angle: number;
  radiusFrac: number; // 0..1 of max radius
  speed: number;
  size: number;
  twinkle: number;
}

export function makeParticles(count: number): FrameParticle[] {
  return Array.from({ length: count }, () => ({
    angle: Math.random() * Math.PI * 2,
    radiusFrac: 0.25 + Math.random() * 0.75,
    speed: 0.05 + Math.random() * 0.2,
    size: 0.6 + Math.random() * 1.8,
    twinkle: Math.random() * Math.PI * 2
  }));
}

let glyphCharCache: Map<string, string> = new Map();
function repeatToLength(text: string, chars: number): string {
  const key = `${text}:${chars}`;
  const cached = glyphCharCache.get(key);
  if (cached) return cached;
  let out = text;
  while (out.length < chars) out += text;
  out = out.slice(0, chars);
  glyphCharCache.set(key, out);
  return out;
}

function drawCircularText(
  ctx: CanvasRenderingContext2D,
  text: string,
  radius: number,
  rotation: number,
  fontPx: number,
  color: string,
  alpha: number,
  glowBlur: number
) {
  const angleStep = (fontPx * 1.05) / radius;
  const neededChars = Math.ceil((Math.PI * 2) / angleStep);
  const loop = repeatToLength(text, neededChars);

  ctx.save();
  ctx.rotate(rotation);
  ctx.font = `${fontPx}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = glowBlur;

  for (let i = 0; i < loop.length; i++) {
    const ch = loop[i];
    if (ch === ' ') continue;
    const angle = i * angleStep;
    ctx.save();
    ctx.rotate(angle);
    ctx.translate(0, -radius);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

export interface DrawParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  tSec: number;
  state: RaphaelState;
  audio: AudioBands;
  tunables: VisualizerTunables;
  quality: QualityTier;
  particles: FrameParticle[];
  /** seconds since the last COMPLETED transition, or null if none pending */
  completionPulseAge: number | null;
}

export function drawFrame(p: DrawParams): void {
  const { ctx, width, height, tSec, state, audio, tunables, quality, particles, completionPulseAge } = p;
  const motion = STATE_MOTION[state];
  const tint = TINTS[motion.tint];
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) / 2;

  ctx.clearRect(0, 0, width, height);

  // --- 1. Atmospheric background -------------------------------------
  ctx.save();
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.4);
  bg.addColorStop(0, '#0c1016');
  bg.addColorStop(0.55, '#090c11');
  bg.addColorStop(1, '#05070a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (quality !== 'low') {
    const blobCount = quality === 'high' ? 4 : 2;
    for (let i = 0; i < blobCount; i++) {
      const a = tSec * 0.03 * motion.outerSpeed * 20 + (i * Math.PI * 2) / blobCount;
      const bx = cx + Math.cos(a) * maxR * 0.7;
      const by = cy + Math.sin(a) * maxR * 0.55;
      const r = maxR * 0.6;
      const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      const hue = i % 2 === 0 ? tint.teal : '#2b4a8a';
      grad.addColorStop(0, hex2rgba(hue, 0.12));
      grad.addColorStop(1, hex2rgba(hue, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // --- 2. Background particle field -----------------------------------
  ctx.save();
  ctx.translate(cx, cy);
  for (const particle of particles) {
    const drift = tSec * particle.speed * motion.particleSpeed * (1 + audio.treble * tunables.audioSensitivity * 0.6);
    const angle = particle.angle + drift;
    const r = particle.radiusFrac * maxR * 1.25;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    const twinkle = 0.5 + 0.5 * Math.sin(tSec * 2 + particle.twinkle);
    const size = particle.size * tunables.particleDensity * (0.8 + twinkle * 0.6);
    ctx.globalAlpha = (0.15 + twinkle * 0.35) * clamp01(motion.energy + audio.amplitude * 0.3);
    ctx.fillStyle = r < maxR * 0.6 ? tint.particle : '#bfe6df';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.3, size), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // --- 3. Outer thin rings + edge ticks --------------------------------
  const outerRotation = tSec * motion.outerSpeed * tunables.rotationSpeed;
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 2; i++) {
    const r = maxR * (0.98 - i * 0.07);
    ctx.save();
    ctx.rotate(outerRotation * (i % 2 === 0 ? 1 : -1));
    ctx.strokeStyle = hex2rgba(tint.ring, 0.14 * tunables.ringIntensity);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (quality !== 'low') {
    drawCircularText(
      ctx,
      'SYSTEM ONLINE · LOCAL AI · ',
      maxR * 0.99,
      outerRotation * -1,
      Math.max(8, maxR * 0.016),
      tint.ring,
      0.5 * tunables.ringIntensity,
      quality === 'high' ? 6 : 0
    );
  }
  ctx.restore();

  // --- 4. Mid glyph rings -----------------------------------------------
  const midRotation = tSec * motion.ringSpeed * tunables.rotationSpeed;
  const flickerAlpha = motion.flicker ? 0.55 + 0.45 * Math.sin(tSec * 9) : 1;
  ctx.save();
  ctx.translate(cx, cy);
  const ringRadii = [maxR * 0.78, maxR * 0.62, maxR * 0.5];
  const ringDirs = [1, -1, 1];
  GLYPH_RING_TEXTS.forEach((text, i) => {
    const r = ringRadii[i];
    ctx.save();
    ctx.strokeStyle = hex2rgba(tint.outer, 0.25 * tunables.ringIntensity);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    drawCircularText(
      ctx,
      text,
      r,
      midRotation * ringDirs[i] + i,
      Math.max(9, maxR * 0.032),
      tint.outer,
      0.75 * tunables.ringIntensity * flickerAlpha,
      quality === 'low' ? 0 : 8 + audio.mid * 6
    );
  });

  // Thinking: a scanning sweep arc.
  if (motion.scanning) {
    const sweepAngle = tSec * 1.2;
    const grad = ctx.createConicGradient(sweepAngle, 0, 0);
    grad.addColorStop(0, hex2rgba(tint.outer, 0));
    grad.addColorStop(0.04, hex2rgba(tint.outer, 0.35));
    grad.addColorStop(0.08, hex2rgba(tint.outer, 0));
    grad.addColorStop(1, hex2rgba(tint.outer, 0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, maxR * 0.8, 0, Math.PI * 2);
    ctx.arc(0, 0, maxR * 0.45, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
  }
  ctx.restore();

  // --- 5. Radial rays -----------------------------------------------------
  const rayLevel = clamp01(motion.rayBoost * tunables.rayIntensity * (0.6 + audio.highMid * tunables.audioSensitivity));
  const rayCount = quality === 'high' ? 48 : quality === 'medium' ? 28 : 14;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < rayCount; i++) {
    const a = (i / rayCount) * Math.PI * 2 + tSec * 0.05 * motion.ringSpeed * 10;
    const len = maxR * (0.35 + rayLevel * 0.55) * (0.7 + 0.3 * Math.sin(i * 12.9898 + tSec));
    const grad = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grad.addColorStop(0, hex2rgba(tint.core, 0.35 * rayLevel));
    grad.addColorStop(1, hex2rgba(tint.outer, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1 + rayLevel;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();

  // --- 6. Core -------------------------------------------------------------
  const pulse =
    Math.sin(tSec * Math.PI * 2 * motion.pulseSpeed) * motion.pulseAmplitude +
    audio.bass * tunables.audioSensitivity * 0.18;
  const completionBoost = completionPulseAge !== null ? Math.max(0, 1 - completionPulseAge / 1.1) : 0;
  const coreR = maxR * (0.17 + pulse) * tunables.coreIntensity * (1 + completionBoost * 0.5);
  const bloomR = coreR * (2.2 + tunables.bloom * 1.3 + audio.amplitude * 1.2);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = 'lighter';

  // bloom halo
  const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, bloomR);
  bloom.addColorStop(0, hex2rgba(tint.core, 0.55 * motion.energy));
  bloom.addColorStop(0.4, hex2rgba(tint.mid, 0.22 * motion.energy));
  bloom.addColorStop(1, hex2rgba(tint.outer, 0));
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(0, 0, bloomR, 0, Math.PI * 2);
  ctx.fill();

  // jagged irregular ring (distortion driven)
  const jagPoints = 14;
  const jagAmp = coreR * 0.18 * tunables.distortion * (1 + audio.mid * 0.5);
  ctx.beginPath();
  for (let i = 0; i <= jagPoints; i++) {
    const a = (i / jagPoints) * Math.PI * 2;
    const n = Math.sin(a * 5 + tSec * 1.3) * 0.5 + Math.sin(a * 3 - tSec * 0.7) * 0.5;
    const r = coreR * 1.35 + n * jagAmp;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = hex2rgba(tint.core, 0.9);
  ctx.lineWidth = Math.max(2, coreR * 0.07);
  ctx.shadowColor = tint.core;
  ctx.shadowBlur = quality === 'low' ? 4 : 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // bright center burst
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.35, tint.core);
  core.addColorStop(1, hex2rgba(tint.mid, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, coreR, 0, Math.PI * 2);
  ctx.fill();

  // fine center sparkle rays
  const sparkCount = quality === 'high' ? 18 : 10;
  for (let i = 0; i < sparkCount; i++) {
    const a = (i / sparkCount) * Math.PI * 2 + tSec * 0.4;
    const len = coreR * (1.1 + 0.6 * Math.abs(Math.sin(a * 4 + tSec * 2)));
    ctx.strokeStyle = hex2rgba('#ffffff', 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * coreR * 0.3, Math.sin(a) * coreR * 0.3);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();

  // --- 7. Waiting-for-permission cue: a slow outward pulse ring -----------
  if (state === 'waiting_for_permission') {
    const wave = (tSec * 0.3) % 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hex2rgba(tint.outer, (1 - wave) * 0.4);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, maxR * (0.2 + wave * 0.6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // --- 8. Completion pulse: expanding bright ring -------------------------
  if (completionPulseAge !== null && completionPulseAge < 1.1) {
    const wave = completionPulseAge / 1.1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hex2rgba('#ffffff', (1 - wave) * 0.8);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, maxR * (0.15 + wave * 0.85), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hex2rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
