#!/usr/bin/env node

/**
 * JayDB MCP Server
 *
 * Model Context Protocol (MCP) server for JayDB & JayDB Cloud.
 * Allows AI assistants (Cursor, Claude Desktop, Antigravity, Cline)
 * to read, write, list, and manage JayDB documents with full CAS support.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const DEFAULT_BASE_URL = process.env.JAYDB_URL || process.env.JAYDB_BASE_URL || 'http://localhost:8080';
const DEFAULT_API_KEY = process.env.JAYDB_API_KEY || '';
const DEFAULT_NAMESPACE = process.env.JAYDB_NAMESPACE || 'default';

// Initialize MCP Server
const server = new McpServer({
  name: 'jaydb-mcp',
  version: '0.1.0',
});

function getHeaders(apiKey) {
  const key = apiKey || DEFAULT_API_KEY;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (key) {
    if (key.startsWith('Bearer ') || key.startsWith('eyJ')) {
      headers['Authorization'] = key.startsWith('Bearer ') ? key : `Bearer ${key}`;
    } else {
      headers['X-JayDB-API-Key'] = key;
    }
  }
  return headers;
}

function resolveUrl(baseUrl, namespace, key, isList = false, query = '') {
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const ns = namespace || DEFAULT_NAMESPACE;
  const cleanKey = (key || '').replace(/^\/+/, '');

  // Detect mode based on URL or explicit namespace
  const isCloud = !base.includes('localhost') || base.includes('jaydb.com') || namespace !== undefined;

  if (isCloud) {
    if (isList) {
      const q = query ? `&${query}` : '';
      return `${base}/v1/n/${encodeURIComponent(ns)}/docs?list${q}`;
    }
    return `${base}/v1/n/${encodeURIComponent(ns)}/docs/${cleanKey}`;
  } else {
    // Core JayDB engine mode (/v1/kv/...)
    if (isList) {
      const q = query ? `&${query}` : '';
      return `${base}/v1/kv/${cleanKey}?list=true${q}`;
    }
    return `${base}/v1/kv/${cleanKey}`;
  }
}

// -------------------------------------------------------------
// 1. Tool: jaydb_get
// -------------------------------------------------------------
server.tool(
  'jaydb_get',
  'Retrieve a document by key from JayDB or JayDB Cloud',
  {
    key: z.string().describe('The document path key, e.g. "users/123/profile" or "boards/task-4"'),
    namespace: z.string().optional().describe('Namespace name (defaults to JAYDB_NAMESPACE or "default")'),
  },
  async ({ key, namespace }) => {
    try {
      const url = resolveUrl(DEFAULT_BASE_URL, namespace, key);
      const res = await fetch(url, {
        method: 'GET',
        headers: getHeaders(),
      });

      if (res.status === 404) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ found: false, key, message: 'Document not found' }, null, 2),
          }],
        };
      }

      if (!res.ok) {
        const errorText = await res.text();
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `JayDB Error [HTTP ${res.status}]: ${errorText}`,
          }],
        };
      }

      const etag = res.headers.get('etag')?.replace(/^W\//, '').replace(/"/g, '') || null;
      const data = await res.json().catch(() => res.text());

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ found: true, key, etag, data }, null, 2),
        }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to fetch document: ${err.message}` }],
      };
    }
  }
);

// -------------------------------------------------------------
// 2. Tool: jaydb_put
// -------------------------------------------------------------
server.tool(
  'jaydb_put',
  'Create or update a document with optimistic concurrency control (CAS)',
  {
    key: z.string().describe('The document path key, e.g. "users/123/profile"'),
    data: z.union([z.record(z.any()), z.array(z.any()), z.string()]).describe('The document content (JSON object, array, or string)'),
    ifMatch: z.string().optional().describe('Expected ETag for optimistic locking (CAS). Rejects write if modified concurrently.'),
    createOnly: z.boolean().optional().describe('If true, fails if document already exists (If-None-Match: *)'),
    namespace: z.string().optional().describe('Namespace name (defaults to JAYDB_NAMESPACE or "default")'),
  },
  async ({ key, data, ifMatch, createOnly, namespace }) => {
    try {
      const url = resolveUrl(DEFAULT_BASE_URL, namespace, key);
      const headers = getHeaders();

      if (createOnly) {
        headers['If-None-Match'] = '*';
      } else if (ifMatch) {
        headers['If-Match'] = ifMatch.startsWith('"') ? ifMatch : `"${ifMatch}"`;
      }

      const body = typeof data === 'string' ? data : JSON.stringify(data);

      const res = await fetch(url, {
        method: 'PUT',
        headers,
        body,
      });

      if (res.status === 412) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'ConflictError',
              status: 412,
              message: 'Optimistic locking conflict: document was modified by another writer (ETag mismatch) or already exists.',
              key,
            }, null, 2),
          }],
        };
      }

      if (!res.ok) {
        const errorText = await res.text();
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `JayDB Error [HTTP ${res.status}]: ${errorText}`,
          }],
        };
      }

      const newETag = res.headers.get('etag')?.replace(/^W\//, '').replace(/"/g, '') || null;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, key, etag: newETag }, null, 2),
        }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to put document: ${err.message}` }],
      };
    }
  }
);

// -------------------------------------------------------------
// 3. Tool: jaydb_delete
// -------------------------------------------------------------
server.tool(
  'jaydb_delete',
  'Delete a document from JayDB or JayDB Cloud',
  {
    key: z.string().describe('The document path key to delete'),
    ifMatch: z.string().optional().describe('Expected ETag for optimistic locking guard'),
    namespace: z.string().optional().describe('Namespace name (defaults to JAYDB_NAMESPACE or "default")'),
  },
  async ({ key, ifMatch, namespace }) => {
    try {
      const url = resolveUrl(DEFAULT_BASE_URL, namespace, key);
      const headers = getHeaders();
      if (ifMatch) {
        headers['If-Match'] = ifMatch.startsWith('"') ? ifMatch : `"${ifMatch}"`;
      }

      const res = await fetch(url, {
        method: 'DELETE',
        headers,
      });

      if (res.status === 404) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ deleted: false, key, message: 'Document does not exist' }, null, 2),
          }],
        };
      }

      if (res.status === 412) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Optimistic locking conflict [HTTP 412]: ETag mismatch for key "${key}".`,
          }],
        };
      }

      if (!res.ok) {
        const errorText = await res.text();
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `JayDB Error [HTTP ${res.status}]: ${errorText}`,
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ deleted: true, key }, null, 2),
        }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to delete document: ${err.message}` }],
      };
    }
  }
);

// -------------------------------------------------------------
// 4. Tool: jaydb_list
// -------------------------------------------------------------
server.tool(
  'jaydb_list',
  'List keys and metadata by prefix in JayDB or JayDB Cloud',
  {
    prefix: z.string().optional().describe('Key prefix to list, e.g. "users/" or "boards/"'),
    limit: z.number().optional().describe('Max items to return (default: 50)'),
    namespace: z.string().optional().describe('Namespace name (defaults to JAYDB_NAMESPACE or "default")'),
  },
  async ({ prefix = '', limit = 50, namespace }) => {
    try {
      const queryParts = [];
      if (prefix) queryParts.push(`prefix=${encodeURIComponent(prefix)}`);
      if (limit) queryParts.push(`limit=${limit}`);

      const url = resolveUrl(DEFAULT_BASE_URL, namespace, prefix, true, queryParts.join('&'));
      const res = await fetch(url, {
        method: 'GET',
        headers: getHeaders(),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `JayDB Error [HTTP ${res.status}]: ${errorText}`,
          }],
        };
      }

      const body = await res.json();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(body, null, 2),
        }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list keys: ${err.message}` }],
      };
    }
  }
);

// -------------------------------------------------------------
// 5. Tool: jaydb_health
// -------------------------------------------------------------
server.tool(
  'jaydb_health',
  'Check connectivity and health of the JayDB endpoint',
  {
    baseUrl: z.string().optional().describe('JayDB base URL to test (defaults to configured JAYDB_URL)'),
  },
  async ({ baseUrl }) => {
    const target = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    try {
      const res = await fetch(`${target}/v1/health`, {
        headers: getHeaders(),
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: res.status,
            ok: res.ok,
            endpoint: target,
            timestamp: new Date().toISOString(),
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `JayDB health check failed for ${target}: ${err.message}` }],
      };
    }
  }
);

// -------------------------------------------------------------
// Resources: Direct JayDB Document URI Template
// -------------------------------------------------------------
server.resource(
  'jaydb-doc',
  new ResourceTemplate('jaydb://{namespace}/{key}', { list: undefined }),
  async (uri, { namespace, key }) => {
    const url = resolveUrl(DEFAULT_BASE_URL, namespace, key);
    const res = await fetch(url, { headers: getHeaders() });
    const text = await res.text();
    return {
      contents: [{
        uri: uri.href,
        text,
        mimeType: 'application/json',
      }],
    };
  }
);

// Start stdio transport
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('JayDB MCP server running on stdio');
}

run().catch((err) => {
  console.error('Fatal error starting JayDB MCP server:', err);
  process.exit(1);
});
