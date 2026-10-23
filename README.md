# Drive simulator

A Spanish classroom simulator of a variable frequency drive, with a projection view and a study guide. The model represents an ATV11HU09M2E, with a reduced induction-motor model for teaching.

The application builds into standalone HTML files. Download either simulator page and open it directly in a browser. It needs no server or runtime downloads. Manufacturer manuals open on the official website and require internet.

## Development

Use Node.js 24 or newer and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox
pnpm verify
```

On Linux without a desktop display, run `xvfb-run -a pnpm verify` for the WebGL browser checks. Firefox audio checks need a PulseAudio-compatible output; CI provides a null sink.

`verify` checks TypeScript, runs source-based logic tests, builds and checks the HTML, and runs browser tests. `pnpm test` imports the current TypeScript sources through the test loader. It never uses saved compiled model files.

```sh
pnpm check
pnpm test
pnpm build
pnpm test:browser
```

`dist/` contains the projection page, study page, index and a compatibility manual redirect. It contains no source files, dependency directories or manufacturer PDFs. `BUILD_DIR` can select a different output directory.

## Model and structure

- `engine.ts` owns motor dynamics and electrical output. `engine-types.ts` describes AC, DC and off as distinct output states. `electrical.ts` holds the shared conductor topology.
- `configuration.ts` validates complete configurations and parameter dependencies. Invalid imports leave the current state intact.
- `panel.ts` owns keypad and menu behavior without browser dependencies. `simulator.ts` connects it to configuration, browser files and the animation clock.
- `waveforms.ts`, `motor-view.ts` and `motor-sound.ts` render the model's output. They do not control the physics.
- `layout.ts` holds fixed schematic placement. Solid components provide the controls and study view.
- `manufacturer-documents.json` holds official document links and page mappings. [Fuentes.md](Fuentes.md) documents manual references, equations and teaching assumptions.

Configuration files retain the `variador-aula` version 1 format. The reduced model has compressed thermal timing and approximate single-phasing, bus energy and DC injection. The stated assumptions are part of the lesson, rather than claims about proprietary drive firmware.

## Browser console

The published page keeps `window.VFDSimulator` available for experiments. For example:

```js
VFDSimulator.getState()
VFDSimulator.getConfig()
VFDSimulator.saveParameter('ACC', 4)
```

`getConfig()` returns a copy. To install an edited configuration, use `VFDSimulator.importText(JSON.stringify(config))` and check its `{ok, value}` or `{ok, error}` result. Parameter changes still obey the simulator's ranges, dependencies and panel restrictions. The console interface is intended for classroom experiments and automated checks.

## GitHub Pages and classroom builds

The workflow checks pushes and pull requests. To publish after creating the repository, select GitHub Actions as the Pages source, then run the Verify workflow with Publish to Pages enabled. This follows [GitHub's custom workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). All application links are relative, so the output works under a repository subpath without embedding the repository name.

A `v*` tag runs verification and produces a downloadable classroom artifact containing the HTML and a source archive from that commit. Source history is maintained in Git; generated outputs and test reports stay out of commits.

## Dependencies

[LICENSES.txt](LICENSES.txt) contains the notice for the Solid runtime embedded in the HTML. TypeScript, Babel, esbuild, parse5 and Playwright are development tools.
