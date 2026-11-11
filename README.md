# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.15.1 create --template minimal --types ts --install npm ww-journal
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Connect your agent (MCP)

The journal exposes an MCP server so AI agents can look up rivers, read your log and add entries
("log a Sky run today, Ben and Sam came, it was pushy").

**URL:** `https://ww-journal.noegosunderwater.com/mcp`

Sign-in uses your normal NoEgos login (username + authenticator code) and a consent screen. You need
access to the Whitewater Journal in noegos-auth. Manage or disconnect agents at
https://auth.noegosunderwater.com/connections.

- **Claude.ai / Claude Desktop:** Settings → Connectors → Add custom connector → paste the URL.
- **ChatGPT:** Settings → Connectors → Add (developer mode) → paste the URL, auth: OAuth.
- **Claude Code:** `claude mcp add --transport http ww-journal https://ww-journal.noegosunderwater.com/mcp`, then `/mcp` to log in.
- **Hermes (e.g. Flow):** in `~/.hermes/config.yaml`
  ```yaml
  mcp_servers:
    ww-journal:
      url: https://ww-journal.noegosunderwater.com/mcp
      auth: oauth
  ```

Tools: `find_river`, `get_river_conditions`, `list_entries`, `get_entry`, `list_trips`,
`list_tag_categories` (read) and `create_entry`, `update_entry`, `create_trip` (write).
Entries created by agents show up in the app on its next sync.
