# Tests

`pnpm verify` runs the type check, source unit tests, standalone build and browser
tests in that order. Run `pnpm test` for the unit tests or `pnpm test:browser`
after a build for the browser suite.
The default is one worker for reliable software WebGL initialization; use
`pnpm test:browser --workers=2` to enable parallel execution.

The Node test loader transforms TypeScript with esbuild in memory. Tests import
the source modules, so a previous build cannot hide a source change. Panel tests
use plain state and explicit services without browser globals or animation mocks.

The Playwright projects cover Chromium and Firefox, both local files and an HTTP
project subpath, plus two touch-enabled phone projects. Every application test
loads `dist/`; the isolated audio and renderer tests bundle the actual components
into a temporary fixture managed by Playwright.

| Suite | Coverage |
| --- | --- |
| `unit` | Flux and shaft dynamics, exact stopped/open remanent decay, energy balances, joint nominal current/power-factor/torque fit, passive circuit and power-balance residuals, controller recovery, fixed-step/frame-budget behavior, documentation coverage, configuration validation and ownership, waveform equations, slider scales, panel and diagnosis behavior, catalog and build contracts |
| `app.spec.mjs` | Native controls, parameter routes and editing, imports and downloads, study guide, layout matrix and WebGL fallback |
| `scope.spec.mjs` | Physical transient recording, trailing-window RMS trends, single-shot capture, continuous switching-current zoom and voltage references, integrated sound and fullscreen controls, guide explanations |
| `motor.spec.mjs` | Legacy circuit estimation, manual circuit round trip, fit diagnostics and stopped-only edits |
| `documentation.spec.mjs` | Offline application/documentation/limitations navigation, generated facts, equations, diagram and phone readability |
| `output.spec.mjs` | Reverse motoring and disconnected-conductor DC injection in both application pages |
| `mobile.spec.mjs` | Seven landscape sizes, study notes, rotation, touch controls, toolbar-height fixtures, native pinch, pan and reverse pinch |
| `stage-audit.spec.mjs` | Controlled conductor, text, clipping and overlap cases for the geometry auditor |
| `renderer.spec.mjs` | Rendered geometry, rotation, pixel density, resizing, context loss/restoration and resource disposal |
| `ui-audio.spec.mjs` | Keyboard repeat, audio preference and visibility, delayed/rejected resumes, disposal and fullscreen denial |

Circuit checks compare the estimated circuit with its stated nominal targets and verify input, converted and resistive power balance. No-load, locked-rotor and maximum-torque references are diagnostics, not constraints on the fit. The previous reduced torque curve is no longer a physical calibration target. Scope trend tests use known signed samples to check causal RMS/mean windows without changing stored captures or the plant.

Install Playwright's Chromium and Firefox browsers before running the browser
suite. On systems with packaged browser builds, `BROWSER_PATH` and `FIREFOX_PATH`
can select executables; `PLAYWRIGHT_BROWSERS_PATH` selects Playwright's browser
directory. Firefox uses a headed session when `DISPLAY` is set. A virtual display
such as `xvfb-run -a pnpm verify` supports software WebGL in environments where
headless Firefox has no GL driver. Firefox audio cases also require a working
audio backend; a PulseAudio null sink is sufficient for CI without speakers.

`TEST_OUTPUT_DIR` selects the Playwright artifact directory. The HTTP fixture
serves only the built pages below `/classroom/drive-simulator/`. Browser fixtures
reject external runtime requests. Official manual links are checked without
downloading or hosting the manufacturer's PDFs.

Scope samples and keyboard repetition use controlled time so slow protocol or
rendering work cannot change their meaning. Separate start/stop checks retain
real elapsed time. Audio visibility, resume delays and toolbar resizing use
controlled fixtures.
These checks do not reproduce physical phone chrome, keyboards, safe areas or
speaker output. Safari and iOS browsers are not covered.
