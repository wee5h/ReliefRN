# Harbor website source

This is the complete published version 1 source, commit 05e78ca3b0c68226c0b2fc3dc86ed88121524599.
The subsequent accessibility/haptics and non-Norfolk resource fixes are unfinished and are not included in this published snapshot.

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

Harbor runs in directory mode without Azure credentials. AI and callbacks require your own configured services; see SETUP.md. External resource lookups require network access and may fail. The published snapshot has a known resource-lookup problem outside Norfolk.

The .openai/hosting.json file identifies the original Site. Use your own hosting project when deploying an independent copy. This archive does not include the hosted platform itself.
