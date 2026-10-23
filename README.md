# Altivar 11 simulator

A Spanish classroom simulator of a variable frequency drive, with a projection view and a study guide. The model represents an ATV11HU09M2E, with a dynamic induction-motor model for teaching.

The application builds into standalone HTML files. Download either simulator page and open it directly in a browser. It needs no server or runtime downloads. Manufacturer links lead to official PDF downloads and require internet. Page fragments are viewer hints; after downloading, use the indicated PDF page.

## Development

Node.js 24 or newer and pnpm 11.25.0 are needed only for building and testing. The standalone HTML pages need only a browser.

```sh
pnpm install --frozen-lockfile
pnpm verify:light
```

`verify:light` checks TypeScript, runs source-based unit tests, and builds and checks the HTML. These are the automatic GitHub checks. `pnpm test` imports the current TypeScript sources through the test loader, without saved compiled model files.

The full browser suite is heavier and runs only when explicitly requested. To run it locally along with the lightweight checks:

```sh
pnpm exec playwright install --with-deps chromium firefox
pnpm verify
```

After a build, `pnpm test:browser` runs the browser suite alone. On Linux without a desktop display, use `xvfb-run -a pnpm verify` for the WebGL checks. Firefox audio checks need a PulseAudio-compatible output; the optional GitHub browser checks provide a null sink.

`dist/` contains the projection page, study page, model documentation, model limitations, index and a compatibility manual redirect. Keep these HTML files together to follow local documentation links. It contains no source files, dependency directories or manufacturer PDFs. `BUILD_DIR` can select a different output directory.

## Model and structure

- `engine.ts` owns command, ramp and protection behavior. `physical-plant.ts` couples shaft work, motor flux, current regulation and the DC bus.
- `motor-dynamics.ts` integrates four stationary-frame flux states. `motor-circuit.ts` fits nominal current, power factor and torque to an editable passive circuit and reports its power balance and residuals.
- `dc-link.ts`, `shaft-brake.ts` and `drive-control.ts` implement rectifier/precharge energy, finite shaft restraint and voltage based current loops.
- `configuration.ts` validates configurations and parameter dependencies. Invalid imports leave the current state intact. Motor nameplate and circuit edits require a stopped shaft and inactive output.
- `panel.ts` owns keypad and menu behavior. `simulator.ts` connects it to browser files, a bounded frame budget and the animation clock.
- `scope-history.ts` records signed physical transients independently of rendering. `scope-trends.ts` computes the trailing 100 ms RMS and mean values shown in Registro. `waveforms.ts` reconstructs periodic PWM and a separate local switching-current zoom. `motor-view.ts` and `motor-sound.ts` consume model output.
- `manufacturer-documents.json` holds official links and page mappings. `documentation.html` and `limitations.html` explain features, equations, a system diagram and limitations in Spanish. `documentation.ts` generates their catalog, circuit-fit and model-value tables from executable sources. [Fuentes.md](Fuentes.md) records source decisions.

The simulator uses a 100 us electrical step and 5 ms control step. It retains flux and capacitor energy through transients and regulates current through voltage. A stopped motor with the output off uses exact exponential remanent-flux decay while preserving the bus and sample cadence. Its estimated motor parameters and control algorithms are teaching choices. Thermal indices have compressed time constants and do not represent measured temperatures. See the generated limitations page before comparing behavior with a particular drive or motor.

The nominal circuit fit assigns every loss not determined by slip to an effective stator resistance. It does not identify iron, mechanical and copper losses separately. Equal leakage uses a generic prior; no-load, locked-rotor and maximum-torque references remain diagnostics. Low-speed V/f voltage includes the selected circuit's resistive drop, tapered to zero at nominal frequency. These are explicit teaching assumptions, not an identified firmware implementation.

Configuration files retain the `variador-aula` version 1 format. The optional legacy field `motorElectrical` is normalized to `{ "mode": "estimated" }` when absent. New exports state the estimate or explicit manual circuit parameters. Imports reset the dynamic session; they do not restore moving flux, bus charge or a scope capture.

## Browser console

The published page keeps `window.VFDSimulator` available for experiments. For example:

```js
VFDSimulator.getState()
VFDSimulator.getConfig()
VFDSimulator.saveParameter('ACC', 4)
```

`getConfig()` returns a copy. To install an edited configuration, use `VFDSimulator.importText(JSON.stringify(config))` and check its `{ok, value}` or `{ok, error}` result. Parameter changes still obey the simulator's ranges, dependencies and panel restrictions. The console interface is intended for classroom experiments and automated checks.

## GitHub Pages and classroom builds

The workflow runs lightweight checks on pushes, pull requests and version tags. To request browser tests on GitHub, start the Verify workflow manually and enable `browser_tests`, which is off by default.

To publish after creating the repository, select GitHub Actions as the Pages source, then run the Verify workflow with Publish to Pages enabled. This follows [GitHub's custom workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). All application links are relative, so the output works under a repository subpath without embedding the repository name.

A `v*` tag runs lightweight verification and produces a downloadable classroom artifact containing the HTML and a source archive from that commit. Source history is maintained in Git; generated outputs and test reports stay out of commits.

## Dependencies

[LICENSES.txt](LICENSES.txt) contains the notice for the Solid runtime embedded in the HTML. TypeScript, Babel, esbuild, parse5 and Playwright are development tools.
