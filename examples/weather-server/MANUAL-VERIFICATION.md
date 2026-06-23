# Manual Verification — weather-server in Claude Desktop

This confirms the example server works as a real MCP server inside Claude Desktop,
not just under the automated test harness.

## 1. Build the server

```bash
pnpm --filter weather-server build
```

This produces the entry point at:

```
E:\CLQ\CLQ\examples\weather-server\dist\index.js
```

## 2. Register it with Claude Desktop

Add this `mcpServers` entry to your Claude Desktop config file:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "weather-server": {
      "command": "node",
      "args": ["E:\\CLQ\\CLQ\\examples\\weather-server\\dist\\index.js"]
    }
  }
}
```

> Use the absolute path to `dist/index.js` shown above. On macOS/Linux, use forward
> slashes and the corresponding absolute path.

## 3. Checklist

1. **Restart Claude Desktop** completely (quit and reopen — it only reads the config on launch).
2. **Start a new chat.** The `weather-server` tools (`get_weather`, `list_supported_cities`,
   `convert_temperature`) should appear in the tools/MCP indicator.
3. **Ask:** *"What's the weather in Addis Ababa?"* — confirm the model calls `get_weather`
   with `{ "location": "Addis Ababa" }` and reports **22°, sunny**.
