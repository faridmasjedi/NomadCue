# NomadQlab

**Free, open-source, cross-platform show control for theatre, live events and installations.**
Audio, video, lighting, OSC, MIDI, timecode, scripting and a phone remote, with every feature unlocked.

NomadQlab is modelled on the cue-based workflow of [QLab](https://qlab.app) by Figure 53 (cue lists, a GO button, a playhead, pre-wait/post-wait, auto-continue/auto-follow, fades that target other cues) and runs on **macOS, Windows and Linux**.

> NomadQlab is an independent project. It is not affiliated with, endorsed by, or connected to Figure 53, LLC. "QLab" is a trademark of Figure 53. NomadQlab cannot open `.qlab5` workspace files.

---

## Paid QLab tiers vs. NomadQlab (free)

QLab's free tier is limited. Full audio, video and lighting each need a separate paid licence (perpetual or daily rental). Here is what each limit looks like in NomadQlab:

| Area | QLab free tier | QLab paid licence | NomadQlab |
|---|---|---|---|
| Audio output channels | 2 | 128 (Audio licence) | **As many as your interface exposes** (Web Audio, tested up to the device max) |
| Channels per audio file | 2 | 24 | **Any** (full crosspoint matrix per cue) |
| Audio fades, rate fades | – | Audio licence | **Free** |
| Per-cue output levels & matrix | – | Audio licence | **Free** |
| Audio effects | – | Audio licence | **Free:** HPF/LPF, 3-band EQ, compressor, delay, reverb per cue |
| Waveform & slice editing | – | Audio licence | **Free** (click to set start / ⌥-click to set end, unlimited loops) |
| Mic cues (live input) | – | Audio licence | **Free** |
| Video stages | 1 single-output | Unlimited (Video licence) | **Unlimited stages on any display** |
| Video fades, geometry, opacity | – | Video licence | **Free** |
| Blend modes | – | Video licence | **Free** (16 modes) |
| Video effects | – | Video licence | **Free** (blur, brightness, contrast, saturation, hue, grayscale, invert, sepia) |
| Masking / crop | – | Video licence | **Free** |
| Keystone / corner-pin warp, edge blending | – | Video licence | **Free** |
| Camera cues, Text cues | – | Video licence | **Free** |
| DMX addresses | 16 | Unlimited (Lighting licence) | **Unlimited** (Art-Net & sACN/E1.31, unlimited universes) |
| Light dashboard, command language, groups | partial | Lighting licence | **Free** |
| RGB / RGBW / moving-head instruments | – | Lighting licence | **Free** |
| OSC / MIDI / MSC remote control | – | paid | **Free** (QLab-style OSC addresses on UDP 53000) |
| Network (OSC/UDP) cues | – | paid | **Free** |
| MIDI, MIDI File, Timecode (MTC) cues | – | paid | **Free** |
| iOS remote app | – | paid licence on host | **Free web remote** for any phone, tablet or laptop browser |
| Unlimited cue lists & carts | – | paid | **Free** |
| Pause, Devamp, Target, Arm/Disarm, Script cues | – | paid | **Free** (Script cues use JavaScript) |
| Automatic workspace backups | – | paid | **Free** (timestamped backups + autosave) |
| Platforms | macOS only | macOS only | **macOS, Windows, Linux** |

Not implemented yet: multi-machine collaboration, NDI/Syphon I/O, object/spatial audio, LTC timecode, Stream Deck plugin. Contributions welcome.

---

## Features

### Cue types (25)
Audio · Mic · Video (and still images) · Camera · Text · Light · Fade · Network · MIDI · MIDI File · Timecode · Group · Start · Stop · Pause · Load · Reset · Devamp · GoTo · Target · Arm · Disarm · Wait · Memo · Script

### Show-running
- **GO** (Space), **Panic** (Esc fades everything out; press Esc twice to hard stop), Pause/Resume all, Reset.
- The playhead jumps over auto-continue/auto-follow sequences, as you'd expect.
- Pre-wait, post-wait, **auto-continue** and **auto-follow**. Pausing freezes waits as well as media.
- Groups can start their first child (which then chains), start all children at once, or start a random child.
- Re-trigger policy per cue: ignore, restart, stop, or pause/resume.
- Double-GO protection, **Show Mode** (locks editing), live progress and time remaining, Active Cues panel.
- **Carts:** grid pads for SFX, with per-cue hotkeys.

### Editing
- Drag and drop media files to create cues. Drag cues to reorder them, drop them into groups, or move them to other lists.
- Multi-select editing, undo/redo, duplicate, group the selection (⌘G), renumber.
- Missing media and broken targets are flagged ⚠.
- **Bundle Workspace** copies all media next to the workspace. Paths are saved relative to the workspace, so the whole folder moves between machines.

### Control
- **OSC** in on UDP 53000 (QLab-style addresses), with replies on 53001. **Plain-text UDP** on 53535.
- **MIDI** triggers per cue (with MIDI Learn), plus global GO/Panic notes. **MIDI Show Control** receive and send.
- **Web remote:** open `http://<your-ip>:53100` on any device for GO, Panic, playhead control, firing cues and running times. Optional passcode.

#### OSC quick reference
```
/go  /go/{number}  /stop  /hardStop  /panic  /panicInTime {s}  /pause  /resume  /reset
/playhead/next  /playhead/previous  /playhead/{number}  /select/{number}
/cue/{number}/start|stop|pause|resume|togglePause|load|arm|disarm
/cue/{number}/name [value]   /cue/selected/start   /cue/playhead/start
/cueLists  /runningCues  /version  /connect {passcode}
(optional prefix: /workspace/{name})
```

### Lighting command language
```
front = 75            # by name
1 thru 6 = full       # ranges, full = 100, out = 0
1 + 3 + 5 = 40        # lists
wash.red = 100        # single parameter
wash.color = #ff8800  # colour for RGB(W) fixtures
all = out
```
You can also build a look on the Light Dashboard and record it into a cue with one click.

### Script cues
```js
nq.log('Starting act 2');
nq.start('12');                       // fire cue 12
await nq.wait(2.5);
nq.osc('192.168.1.20', 8000, '/eos/cue/1/5/fire');
nq.light('front = 40', 3);            // 3-second lighting fade
if (!nq.isRunning('1')) nq.go();
```

---

## Install

### Download
Pre-built installers for macOS (`.dmg`), Windows (`.exe`) and Linux (`.AppImage`, `.deb`) are attached to each [GitHub Release](https://github.com/faridmasjedi/NomadQlab/releases). The builds are unsigned:
- **macOS:** right-click the app, choose **Open**, then confirm (first launch only).
- **Windows:** SmartScreen → **More info** → **Run anyway**.

### Run from source
```bash
git clone https://github.com/faridmasjedi/NomadQlab.git
cd NomadQlab
npm install
npm start
```

### Build installers yourself
```bash
npm run dist:mac     # or dist:win / dist:linux
```
To have GitHub Actions build all three platforms and publish a Release, push a tag:
```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Development
```bash
npm test        # unit tests: engine, OSC, DMX packets, lighting language, MIDI files, model
npm run smoke   # launches the real app headless and runs a 22-step end-to-end self-test
```

Project layout:
```
src/main/       Electron main: windows, media:// protocol, OSC/UDP, Art-Net/sACN, web remote, files
src/renderer/   UI + engines (audio.js, video.js, lighting.js, midi.js, cues.js)
src/renderer/lib  pure logic: cue engine, data model, lighting language, MIDI file parser, keystone math
src/stage/      video output window
src/remote/     phone web remote
test/           node:test unit tests
```

## Keyboard shortcuts
| Key | Action |
|---|---|
| Space | GO |
| Esc | Panic (press twice: hard stop) |
| ↑ / ↓ | Move selection (playhead in Show Mode) |
| ⌘1–⌘9, ⌘0 | New Audio, Mic, Video, Camera, Text, Light, Fade, Network, MIDI, Group |
| ⌘D / ⌘G | Duplicate / Group selection |
| P / S / V | Pause, Stop, Audition selected |
| Enter | Rename selected cue |
| ⌘Z / ⌘⇧Z | Undo / Redo |
| ⌘, | Workspace settings |
| ⌘⇧L | Light dashboard |

## License
MIT. Free for any use, commercial or not.
