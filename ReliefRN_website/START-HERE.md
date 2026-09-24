# ReliefRN website source

> **Running the demo with the live ReliefRN agents?** Read [RUN-LOCALLY.md](RUN-LOCALLY.md).
> On Windows, double-click `start-demo.cmd`; on macOS/Linux, run `./start-demo.sh`.

This is the complete published version 1 source, commit 05e78ca3b0c68226c0b2fc3dc86ed88121524599.
Since then: live Foundry agents (see RUN-LOCALLY.md), location detected from the chat, and nationwide resource lookup (USGS, FEMA Recovery Centers and shelters, OpenStreetMap vets). The accessibility/haptics fixes from the original backlog are still unfinished.

## Run locally

Install Node.js 22.13 or newer and pnpm 11.25.0. Extract this archive, open a terminal in the harbor folder, and run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed in the terminal (normally http://localhost:5173).
To build and preview the production Worker locally:

```sh
pnpm build
pnpm start
```

## Project contents

- app/: pages, styles, and server API routes
- components/: map and UI components
- lib/: resources, translations, safety rules, Foundry adapter
- public/: icons and map geometry
- scripts/, build/, configuration files: development and Worker build tooling
- SETUP.md: integration setup, data sources, and operational limitations
- README.md: original framework documentation
- pnpm-lock.yaml: locked dependency versions

No node_modules, generated builds, Git history, credentials, or local caches are included. Install dependencies with the command above.

The ReliefRN website runs in directory mode without Azure credentials. AI and callbacks require your own configured services; see SETUP.md. External resource lookups require network access and may fail.

The .openai/hosting.json file identifies the original Site. Use your own hosting project when deploying an independent copy. This archive does not include the hosted platform itself.
