import * as THREE from 'three';
import { CAMERA_FORWARD_AZIMUTH_RAD } from '../constants';

// tweak these two numbers to brighten/dim the whole day or night cycle at once
// without editing each keyframe row individually.
const SUN_BRIGHTNESS_SCALE = 3;
const MOON_BRIGHTNESS_SCALE = 1;
// MOON_LIGHT_COLOR removed — no longer needed. Every keyframe now carries
// its own "core" color directly (Sun/Sunset/Sunrise Core by day, Moon
// Core at night), so ordinary keyframe-to-keyframe interpolation already
// produces the sun<->moon color transition on its own.

/**
 * Redraws the 3-stop (top/mid/horizon) sky gradient onto the given canvas
 * in place, and flags its CanvasTexture for re-upload. A flat 2D texture
 * assigned to scene.background renders as a fixed backdrop quad (not
 * equirectangular-mapped), which is fine here since the camera's own
 * azimuth/polar range is already locked to a narrow band (see
 * AZIMUTH_RANGE/POLAR_RANGE in Scene.tsx) — the sky never needs to wrap
 * around behind the viewer.
 */
export function drawSkyGradient(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  top: THREE.Color,
  mid: THREE.Color,
  horizon: THREE.Color,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, `#${top.getHexString()}`);
  gradient.addColorStop(0.55, `#${mid.getHexString()}`);
  gradient.addColorStop(1, `#${horizon.getHexString()}`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  texture.needsUpdate = true;
}

// --- Day/night cycle ---
// Simplified sky model: sun and moon both arc across the SAME forward
// hemisphere (fixed +Z tilt) rather than true opposite sides of the
// world. Astronomically a full moon sits opposite the sun, but the
// camera's own constraints (AZIMUTH_RANGE/POLAR_RANGE in Scene.tsx only
// allow ~180° horizontal and a narrow vertical band) mean anything on the
// far side would never be reachable by orbiting anyway. The moon's arc is
// just the sun's arc offset by 12 hours along the same path — "moon
// rises as sun sets" still falls out of that, without the moon ever
// landing behind the fence, out of view.
//
// NOT verified against the actual render yet — if the sun/moon discs turn
// out to sit behind the camera instead of in front of it, flip the sign
// on SKY_ORBIT_DEPTH_Z_M (try -22).
const SKY_ORBIT_RADIUS_M = 120;
const SKY_ORBIT_DEPTH_Z_M = 44;

// "Offset to the right" — sign is an unverified guess; flip to negative
// if sunset ends up on the LEFT of camera-forward instead once rendered.
const SKY_ORBIT_AZIMUTH_OFFSET_DEG = -50;
const SKY_ORBIT_WEST_AZIMUTH_RAD =
  CAMERA_FORWARD_AZIMUTH_RAD + THREE.MathUtils.degToRad(SKY_ORBIT_AZIMUTH_OFFSET_DEG);
// The OLD (unrotated) arc's own sunset azimuth, hour 18 — solved here
// from SKY_ORBIT_RADIUS_M/SKY_ORBIT_DEPTH_Z_M rather than hardcoded, so
// the rotation below stays correct even if those two change later.
const SKY_ORBIT_UNROTATED_SUNSET_AZIMUTH_RAD = Math.atan2(-SKY_ORBIT_RADIUS_M, SKY_ORBIT_DEPTH_Z_M);
const SKY_ORBIT_ROTATION_RAD = SKY_ORBIT_WEST_AZIMUTH_RAD - SKY_ORBIT_UNROTATED_SUNSET_AZIMUTH_RAD;

export function skyDirectionForHour(hour: number): THREE.Vector3 {
  const angle = ((hour - 6) / 24) * Math.PI * 2; // 0 at 6:00 (rising), PI/2 at 12:00 (zenith), PI at 18:00 (setting)
  const elevation = Math.sin(angle);
  const horizontal = Math.cos(angle);
  const x0 = horizontal * SKY_ORBIT_RADIUS_M;
  const z0 = SKY_ORBIT_DEPTH_Z_M;
  // Rotates the (x0,z0) ground-plane pair by SKY_ORBIT_ROTATION_RAD, in
  // the same atan2(x,z) convention used above — adds that angle to
  // whatever azimuth (x0,z0) already had, for every hour alike.
  const cosR = Math.cos(SKY_ORBIT_ROTATION_RAD);
  const sinR = Math.sin(SKY_ORBIT_ROTATION_RAD);
  const x = x0 * cosR + z0 * sinR;
  const z = z0 * cosR - x0 * sinR;
  return new THREE.Vector3(x, elevation * SKY_ORBIT_RADIUS_M, z);
}

export interface DayNightKeyframe {
  hour: number;
  /** Sky gradient, top to horizon — drawn as a 3-stop canvas gradient (see drawSkyGradient) rather than a flat scene.background color. */
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  /** "Ambient Shadow" tint from the palette — drives the AmbientLight's color/intensity. */
  ambient: THREE.Color;
  ambientIntensity: number;
  /** "Core" color of whichever body is dominant at this hour — Sun/Sunset/Sunrise Core by day, Moon Core at night. Drives BOTH the merged directional light's color and the visible sun/moon disc's own color. */
  sunColor: THREE.Color;
  /** "Glow" color of whichever body is dominant — drives the soft halo sprite behind the sun/moon disc. */
  glowColor: THREE.Color;
  sunIntensity: number;
  moonIntensity: number;
  /** "Ground Light"/"Ground Shadow" tint — the grass material's own base color at this hour. No real shadow mapping in this scene, so this single color stands in for that whole layer. */
  groundTint: THREE.Color;
  /** Scales scene.environment's contribution (the procedural RoomEnvironment
   * set up for PBR reflections) — that map is otherwise a FIXED light
   * source that doesn't dim at night on its own, unlike ambient/sun/moon
   * above. Kept low at night so metal materials don't stay artificially
   * bright once the sun/ambient lights have gone down. */
  envIntensity: number;
  /** "Cloud Bright"/"Cloud Shadow" tokens from the palette — tint the two
   * layers of every cloud sprite (see clouds.ts). */
  cloudBright: THREE.Color;
  cloudShadow: THREE.Color;
}

// Hand-picked aesthetic values, not measured light readings — tune freely.
// First and last entries both represent midnight (hour 0 / hour 24) with
// identical values, so interpolation wraps cleanly across that seam.
// Values sourced from the "Unified Environment Palette" (Yam, 2026-09-17).
// Each hour maps to one of the 4 named categories (Night / Sunrise / Day /
// Sunset); hours 8/12/16 all use Day tokens — the palette doesn't
// distinguish morning/noon/afternoon separately, so the brightness
// difference between them still comes from sunIntensity/ambientIntensity,
// not a different color set. Noon's sunColor is the palette's own Sun
// Core (#FFF4C2) rather than pure white — a deliberate change from the
// previous #ffffff, to stay faithful to the given palette.
export const DAY_NIGHT_KEYFRAMES: DayNightKeyframe[] = [
  { hour: 0, skyTop: new THREE.Color('#080F2B'), skyMid: new THREE.Color('#1D3263'), skyHorizon: new THREE.Color('#40567D'), ambient: new THREE.Color('#0C172A'), ambientIntensity: 0.22, sunColor: new THREE.Color('#FFF1C7'), glowColor: new THREE.Color('#AFC7E8'), sunIntensity: 0, moonIntensity: 0.5, groundTint: new THREE.Color('#354B48'), envIntensity: 0.1, cloudBright: new THREE.Color('#526487'), cloudShadow: new THREE.Color('#202B4C') },
  { hour: 5, skyTop: new THREE.Color('#080F2B'), skyMid: new THREE.Color('#1D3263'), skyHorizon: new THREE.Color('#40567D'), ambient: new THREE.Color('#0C172A'), ambientIntensity: 0.24, sunColor: new THREE.Color('#FFF1C7'), glowColor: new THREE.Color('#AFC7E8'), sunIntensity: 0, moonIntensity: 0.42, groundTint: new THREE.Color('#354B48'), envIntensity: 0.12, cloudBright: new THREE.Color('#526487'), cloudShadow: new THREE.Color('#202B4C') },
  { hour: 6.5, skyTop: new THREE.Color('#283B70'), skyMid: new THREE.Color('#C18BA4'), skyHorizon: new THREE.Color('#F6B18C'), ambient: new THREE.Color('#414D67'), ambientIntensity: 0.4, sunColor: new THREE.Color('#FFF0B5'), glowColor: new THREE.Color('#F7C17F'), sunIntensity: 0.55, moonIntensity: 0.05, groundTint: new THREE.Color('#9E9F7B'), envIntensity: 0.4, cloudBright: new THREE.Color('#FFD0B5'), cloudShadow: new THREE.Color('#8B7192') },
  { hour: 8, skyTop: new THREE.Color('#3B82C4'), skyMid: new THREE.Color('#73B9E6'), skyHorizon: new THREE.Color('#C6E6F5'), ambient: new THREE.Color('#526779'), ambientIntensity: 0.55, sunColor: new THREE.Color('#FFF4C2'), glowColor: new THREE.Color('#FFE6A3'), sunIntensity: 0.9, moonIntensity: 0, groundTint: new THREE.Color('#5c8a4a'), envIntensity: 0.75, cloudBright: new THREE.Color('#FFFFFF'), cloudShadow: new THREE.Color('#D4E3EB') },
  { hour: 12, skyTop: new THREE.Color('#3B82C4'), skyMid: new THREE.Color('#73B9E6'), skyHorizon: new THREE.Color('#C6E6F5'), ambient: new THREE.Color('#526779'), ambientIntensity: 0.65, sunColor: new THREE.Color('#FFF4C2'), glowColor: new THREE.Color('#FFE6A3'), sunIntensity: 1.1, moonIntensity: 0, groundTint: new THREE.Color('#5c8a4a'), envIntensity: 1, cloudBright: new THREE.Color('#FFFFFF'), cloudShadow: new THREE.Color('#D4E3EB') },
  { hour: 16, skyTop: new THREE.Color('#3B82C4'), skyMid: new THREE.Color('#73B9E6'), skyHorizon: new THREE.Color('#C6E6F5'), ambient: new THREE.Color('#526779'), ambientIntensity: 0.55, sunColor: new THREE.Color('#FFF4C2'), glowColor: new THREE.Color('#FFE6A3'), sunIntensity: 0.9, moonIntensity: 0, groundTint: new THREE.Color('#5c8a4a'), envIntensity: 0.75, cloudBright: new THREE.Color('#FFFFFF'), cloudShadow: new THREE.Color('#D4E3EB') },
  { hour: 17.5, skyTop: new THREE.Color('#343B78'), skyMid: new THREE.Color('#B96F91'), skyHorizon: new THREE.Color('#F3A16F'), ambient: new THREE.Color('#3E405E'), ambientIntensity: 0.4, sunColor: new THREE.Color('#FFD18A'), glowColor: new THREE.Color('#F47D55'), sunIntensity: 0.55, moonIntensity: 0.05, groundTint: new THREE.Color('#92785F'), envIntensity: 0.4, cloudBright: new THREE.Color('#F6B5A0'), cloudShadow: new THREE.Color('#735675') },
  { hour: 19, skyTop: new THREE.Color('#080F2B'), skyMid: new THREE.Color('#1D3263'), skyHorizon: new THREE.Color('#40567D'), ambient: new THREE.Color('#0C172A'), ambientIntensity: 0.24, sunColor: new THREE.Color('#FFF1C7'), glowColor: new THREE.Color('#AFC7E8'), sunIntensity: 0, moonIntensity: 0.42, groundTint: new THREE.Color('#354B48'), envIntensity: 0.12, cloudBright: new THREE.Color('#526487'), cloudShadow: new THREE.Color('#202B4C') },
  { hour: 24, skyTop: new THREE.Color('#080F2B'), skyMid: new THREE.Color('#1D3263'), skyHorizon: new THREE.Color('#40567D'), ambient: new THREE.Color('#0C172A'), ambientIntensity: 0.22, sunColor: new THREE.Color('#FFF1C7'), glowColor: new THREE.Color('#AFC7E8'), sunIntensity: 0, moonIntensity: 0.5, groundTint: new THREE.Color('#354B48'), envIntensity: 0.1, cloudBright: new THREE.Color('#526487'), cloudShadow: new THREE.Color('#202B4C') },
];

/** Linearly interpolates between the two DAY_NIGHT_KEYFRAMES bracketing `hour` (wraps across 0–24). */
export function sampleDayNight(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  let lo = DAY_NIGHT_KEYFRAMES[0];
  let hi = DAY_NIGHT_KEYFRAMES[DAY_NIGHT_KEYFRAMES.length - 1];
  for (let i = 0; i < DAY_NIGHT_KEYFRAMES.length - 1; i++) {
    if (h >= DAY_NIGHT_KEYFRAMES[i].hour && h <= DAY_NIGHT_KEYFRAMES[i + 1].hour) {
      lo = DAY_NIGHT_KEYFRAMES[i];
      hi = DAY_NIGHT_KEYFRAMES[i + 1];
      break;
    }
  }
  const span = hi.hour - lo.hour || 1;
  const t = (h - lo.hour) / span;
  return {
    skyTop: lo.skyTop.clone().lerp(hi.skyTop, t),
    skyMid: lo.skyMid.clone().lerp(hi.skyMid, t),
    skyHorizon: lo.skyHorizon.clone().lerp(hi.skyHorizon, t),
    ambientColor: lo.ambient.clone().lerp(hi.ambient, t),
    ambientIntensity: THREE.MathUtils.lerp(lo.ambientIntensity, hi.ambientIntensity, t),
    sunColor: lo.sunColor.clone().lerp(hi.sunColor, t),
    glowColor: lo.glowColor.clone().lerp(hi.glowColor, t),
    sunIntensity: THREE.MathUtils.lerp(lo.sunIntensity, hi.sunIntensity, t) * SUN_BRIGHTNESS_SCALE,
    moonIntensity: THREE.MathUtils.lerp(lo.moonIntensity, hi.moonIntensity, t) * MOON_BRIGHTNESS_SCALE,
    groundTint: lo.groundTint.clone().lerp(hi.groundTint, t),
    envIntensity: THREE.MathUtils.lerp(lo.envIntensity, hi.envIntensity, t),
    cloudBright: lo.cloudBright.clone().lerp(hi.cloudBright, t),
    cloudShadow: lo.cloudShadow.clone().lerp(hi.cloudShadow, t),
  };
}
