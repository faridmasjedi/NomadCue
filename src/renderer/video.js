// Control-side video controller: drives one or more Stage windows (unlimited stages, any display).
import { mediaUrl } from './lib/util.js';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

export class VideoController {
  constructor({ getSettings, log }) {
    this.getSettings = getSettings;
    this.log = log;
    this.layers = new Map(); // layerId -> playback
    this.openStages = new Set();
    window.nq.onStageEvent((evt) => this.onEvent(evt));
    window.nq.onStageClosed((id) => this.openStages.delete(id));
  }

  stageFor(cue) {
    const stages = this.getSettings().stages;
    return stages.find((s) => s.id === cue.stage) || stages[0];
  }

  ensureStage(stage) {
    if (!stage) return;
    if (!this.openStages.has(stage.id)) {
      window.nq.openStage(stage);
      this.openStages.add(stage.id);
    }
  }

  openStage(stage) { window.nq.openStage(stage); this.openStages.add(stage.id); }
  closeStage(id) { window.nq.closeStage(id); this.openStages.delete(id); }

  onEvent(evt) {
    const p = this.layers.get(evt.layerId);
    if (!p) return;
    if (evt.type === 'ended') p.finish();
    else if (evt.type === 'meta') p.mediaDuration = evt.duration;
    else if (evt.type === 'time') { p.currentTime = evt.time; p.timeAt = performance.now(); }
    else if (evt.type === 'error') { this.log(`Video cue ${p.cue.number || ''}: ${evt.message}`); p.finish(); }
  }

  play(cue, run) {
    const stage = this.stageFor(cue);
    if (!stage) { this.log('No video stage configured'); return null; }
    this.ensureStage(stage);
    const p = new VideoPlayback(this, cue, run, stage);
    this.layers.set(p.layerId, p);
    return p;
  }

  cmd(stageId, cmd) { window.nq.stageCmd({ stageId, ...cmd }); }

  clearAll() { window.nq.stageCmd({ stageId: '*', cmd: 'clear' }); }
}

function layerProps(cue) {
  return {
    layer: Number(cue.layer) || 0, opacity: Number(cue.opacity) / 100, x: Number(cue.x), y: Number(cue.y),
    scale: Number(cue.scale) / 100, rotation: Number(cue.rotation), fit: cue.fit, blend: cue.blend,
    crop: [cue.cropTop, cue.cropRight, cue.cropBottom, cue.cropLeft].map(Number),
    filters: { blur: cue.blur, brightness: cue.brightness, contrast: cue.contrast, saturate: cue.saturate, hue: cue.hue, grayscale: cue.grayscale, invert: cue.invert, sepia: cue.sepia },
    fadeIn: Number(cue.fadeIn) || 0,
  };
}

class VideoPlayback {
  constructor(ctrl, cue, run, stage) {
    this.ctrl = ctrl;
    this.cue = cue;
    this.run = run;
    this.stage = stage;
    this.layerId = run.id;
    this.startedAt = performance.now();
    this.pausedMs = 0;
    this.mediaDuration = null;
    const base = { cmd: 'play', layerId: this.layerId, props: layerProps(cue) };
    if (cue.type === 'video') {
      const isImage = IMAGE_EXT.test(cue.file || '');
      Object.assign(base, {
        kind: isImage ? 'image' : 'video', src: mediaUrl(cue.file), startTime: Number(cue.startTime) || 0,
        endTime: Number(cue.endTime) || 0, loops: Number(cue.loops), rate: Number(cue.rate) || 1, volume: Number(cue.volume),
        imageDuration: Number(cue.imageDuration) || 0,
      });
      if (isImage) this.mediaDuration = Number(cue.imageDuration) || Infinity;
    } else if (cue.type === 'camera') {
      Object.assign(base, { kind: 'camera', deviceId: cue.deviceId, mirror: !!cue.mirror });
      this.mediaDuration = Infinity;
    } else if (cue.type === 'text') {
      Object.assign(base, {
        kind: 'text', text: cue.text, style: { fontFamily: cue.fontFamily, fontSize: Number(cue.fontSize), fontWeight: cue.fontWeight, color: cue.textColor, background: cue.bgColor, align: cue.align },
      });
      this.mediaDuration = Number(cue.duration) > 0 ? Number(cue.duration) : Infinity;
      if (Number(cue.duration) > 0) this.textTimer = setTimeout(() => this.stop(0), Number(cue.duration) * 1000);
    }
    ctrl.cmd(stage.id, base);
  }

  get duration() {
    if (this.mediaDuration === null) return null;
    if (this.cue.type === 'video' && Number(this.cue.loops) === 0) return Infinity;
    if (this.cue.type === 'video' && this.mediaDuration !== Infinity) {
      const end = Number(this.cue.endTime) > 0 ? Math.min(this.cue.endTime, this.mediaDuration) : this.mediaDuration;
      return ((end - (Number(this.cue.startTime) || 0)) * Math.max(1, Number(this.cue.loops) || 1)) / (Number(this.cue.rate) || 1);
    }
    return this.mediaDuration;
  }

  elapsed() {
    const now = this.paused ? this.pausedAt : performance.now();
    return (now - this.startedAt - this.pausedMs) / 1000;
  }

  pause() {
    if (this.paused) return;
    this.paused = true; this.pausedAt = performance.now();
    this.ctrl.cmd(this.stage.id, { cmd: 'pause', layerId: this.layerId });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false; this.pausedMs += performance.now() - this.pausedAt;
    this.ctrl.cmd(this.stage.id, { cmd: 'resume', layerId: this.layerId });
  }

  devamp() { this.ctrl.cmd(this.stage.id, { cmd: 'devamp', layerId: this.layerId }); }

  fade(params, seconds, curve) {
    const to = {};
    if (params.opacity !== undefined) to.opacity = params.opacity / 100;
    if (params.x !== undefined) { to.x = params.x; to.y = params.y; to.scale = params.scale / 100; to.rotation = params.rotation; }
    if (params.volume !== undefined) to.volume = params.volume;
    if (params.rate !== undefined) to.rate = params.rate;
    this.ctrl.cmd(this.stage.id, { cmd: 'fade', layerId: this.layerId, to, duration: seconds, curve });
  }

  stop(fade = 0) {
    clearTimeout(this.textTimer);
    this.ctrl.cmd(this.stage.id, { cmd: 'stop', layerId: this.layerId, fade });
    if (fade > 0) this.stopTimer = setTimeout(() => this.finish(), fade * 1000);
    else this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.textTimer);
    clearTimeout(this.stopTimer);
    this.ctrl.layers.delete(this.layerId);
    this.ctrl.cmd(this.stage.id, { cmd: 'remove', layerId: this.layerId });
    this.run.done();
  }
}
