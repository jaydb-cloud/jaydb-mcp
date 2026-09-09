# JayDB MCP Server (`@jaydb/mcp`)

Model Context Protocol (MCP) server for **[JayDB](https://jaydb.com)** and **JayDB Cloud**.

Give AI coding assistants (**Cursor**, **Claude Desktop**, **Antigravity**, **Cline**) direct access to read, create, update (with optimistic concurrency / CAS), delete, and list documents in your JayDB databases during development.

---

## ⚡ Features & Tools Exposed to AI

- 🔍 `jaydb_get`: Read documents and view current ETags.
- ✍️ `jaydb_put`: Create or update documents with optimistic locking (`ifMatch` CAS or `createOnly`).
- 🗑️ `jaydb_delete`: Delete documents with ETag safety checks.
- 📋 `jaydb_list`: List keys and document metadata by prefix.
- 🩺 `jaydb_health`: Test database connectivity and ping the endpoint.
- 📦 Resource: Access documents directly via URI `jaydb://{namespace}/{key}`.

---

## 🚀 Setup & Configuration

### 1. Cursor IDE

Add to your `.cursor/mcp.json` (or Cursor Settings > Features > MCP):

```json
{
  "mcpServers": {
    "jaydb": {
      "command": "npx",
      "args": ["-y", "@jaydb/mcp"],
      "env": {
        "JAYDB_URL": "https://your-tenant.jaydb.com",
        "JAYDB_API_KEY": "jcloud_sec_your_api_key_here",
        "JAYDB_NAMESPACE": "production"
      }
    }
  }
}
```

*For local JayDB development, omit the API key and set `JAYDB_URL: "http://localhost:8080"`.*

---

### 2. Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "jaydb": {
      "command": "npx",
      "args": ["-y", "@jaydb/mcp"],
      "env": {
        "JAYDB_URL": "https://your-tenant.jaydb.com",
        "JAYDB_API_KEY": "jcloud_sec_your_api_key_here",
        "JAYDB_NAMESPACE": "default"
      }
    }
  }
}
```

---

## 🛠️ Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `JAYDB_URL` | Base URL of JayDB Cloud tenant or local JayDB instance | `http://localhost:8080` |
| `JAYDB_API_KEY` | Server-side API key (`X-JayDB-API-Key`) | `""` |
| `JAYDB_NAMESPACE` | Default document namespace/bucket | `"default"` |

---

## 📄 License

MIT © [JayDB](https://jaydb.com)
