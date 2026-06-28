# Manual Beta Checklist

Before any public announcement, recruit 5 developers outside the team, give them zero context beyond the README, watch them attempt the full flow below without helping, and write down every point of friction or confusion as a bug — not a documentation gap to patch around. The goal is to discover what a fresh developer encounters, not to validate that instructions can be followed; if they get stuck, that is the bug to fix.

## Unaided flow to attempt

1. Install the `clq` CLI globally or via `npx` and run `clq --help` — confirm the command surface is discoverable without reading source.
2. Run `clq init my-project` in an empty directory and inspect the generated files — confirm the scaffolded project's purpose and structure are self-evident.
3. Inside the new project, run `clq add my-tool` and open the generated file — confirm the template's TODOs are clear enough to implement a real tool without guidance.
4. Run `clq dev` and make a source change — confirm the watch-and-reload cycle is visible and the output is understandable.
5. Run `clq inspect` and navigate to the printed URL — confirm the inspector UI is usable for calling a tool and reading its output without explanation.
