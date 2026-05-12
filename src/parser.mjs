/**
 * parser.mjs — Parse OpenAPI JSON into structured data for template rendering
 *
 * Transforms raw OpenAPI spec into a clean data structure that the EJS templates
 * can consume without any OpenAPI-specific logic.
 */

/**
 * Resolve a $ref pointer within the spec
 */
function resolveRef(spec, ref) {
  if (!ref || !ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let current = spec;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return null;
    current = current[part];
  }
  return current;
}

/**
 * Resolve a schema object, following $ref references
 */
function resolveSchema(spec, schema) {
  if (!schema) return null;
  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref);
    return resolved ? resolveSchema(spec, resolved) : { type: 'object', description: `⚠️ Unresolved: ${schema.$ref}` };
  }
  return schema;
}

/**
 * Get display name for a schema type
 */
function schemaTypeDisplay(schema, spec) {
  if (!schema) return 'any';
  const resolved = resolveSchema(spec, schema);

  if (resolved.allOf) return 'object';
  if (resolved.oneOf) return resolved.oneOf.map((s) => schemaTypeDisplay(s, spec)).join(' | ');
  if (resolved.anyOf) return resolved.anyOf.map((s) => schemaTypeDisplay(s, spec)).join(' | ');

  if (resolved.type === 'array' && resolved.items) {
    return `${schemaTypeDisplay(resolved.items, spec)}[]`;
  }

  return resolved.type || resolved.enum ? 'string' : 'object';
}

/**
 * Flatten a schema into a list of { name, type, description, required, properties } for tables
 */
function flattenSchemaProperties(schema, spec, depth = 0) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved) return [];

  // Handle allOf by merging properties
  let merged = { ...resolved };
  if (resolved.allOf) {
    merged = { type: 'object', properties: {}, required: [] };
    for (const item of resolved.allOf) {
      const r = resolveSchema(spec, item);
      if (r.properties) Object.assign(merged.properties, r.properties);
      if (r.required) merged.required.push(...r.required);
    }
  }

  if (!merged.properties) return [];
  const requiredFields = new Set(merged.required || []);

  const result = [];
  for (const [name, propSchema] of Object.entries(merged.properties)) {
    const prop = resolveSchema(spec, propSchema);
    const entry = {
      name,
      type: schemaTypeDisplay(propSchema, spec),
      description: prop?.description || '',
      required: requiredFields.has(name),
      nullable: prop?.nullable || false,
      default: prop?.default ?? undefined,
      enum: prop?.enum || undefined,
      format: prop?.format || undefined,
      example: prop?.example ?? undefined,
      depth,
    };

    // Nested object properties (max depth 2 to avoid infinite recursion)
    if (prop?.type === 'object' && prop.properties && depth < 2) {
      entry.children = flattenSchemaProperties(propSchema, spec, depth + 1);
    }

    result.push(entry);
  }

  return result;
}

/**
 * Extract parameters grouped by location (path, query, header)
 */
function extractParameters(operation, spec) {
  const params = (operation.parameters || []).map((p) => {
    const resolved = p.$ref ? resolveRef(spec, p.$ref) : p;
    return {
      name: resolved.name,
      in: resolved.in,
      description: resolved.description || '',
      required: resolved.required || false,
      type: resolved.schema ? schemaTypeDisplay(resolved.schema, spec) : 'string',
      schema: resolved.schema,
    };
  });

  return {
    path: params.filter((p) => p.in === 'path'),
    query: params.filter((p) => p.in === 'query'),
    header: params.filter((p) => p.in === 'header'),
  };
}

/**
 * Extract request body details
 */
function extractRequestBody(operation, spec) {
  const rb = operation.requestBody;
  if (!rb) return null;

  const resolved = rb.$ref ? resolveRef(spec, rb.$ref) : rb;
  const content = resolved.content || {};
  const jsonContent = content['application/json'] || content['multipart/form-data'];

  if (!jsonContent?.schema) return null;

  const schema = resolveSchema(spec, jsonContent.schema);

  return {
    description: resolved.description || '',
    required: resolved.required || false,
    contentType: Object.keys(content)[0] || 'application/json',
    schema: jsonContent.schema,
    properties: flattenSchemaProperties(jsonContent.schema, spec),
    type: schemaTypeDisplay(jsonContent.schema, spec),
  };
}

/**
 * Extract response details grouped by status code
 */
function extractResponses(operation, spec) {
  const responses = operation.responses || {};
  const result = [];

  for (const [code, respRef] of Object.entries(responses)) {
    const resp = respRef.$ref ? resolveRef(spec, respRef.$ref) : respRef;
    const content = resp.content || {};
    const jsonContent = content['application/json'];

    const entry = {
      code,
      description: resp.description || '',
      schema: null,
      properties: [],
    };

    if (jsonContent?.schema) {
      entry.schema = jsonContent.schema;
      entry.properties = flattenSchemaProperties(jsonContent.schema, spec);
      entry.type = schemaTypeDisplay(jsonContent.schema, spec);
    }

    result.push(entry);
  }

  return result;
}

/**
 * HTTP method color mapping
 */
const METHOD_COLORS = {
  get: { bg: '#e8f5e9', text: '#1b5e20', border: '#4caf50' },
  post: { bg: '#e3f2fd', text: '#0d47a1', border: '#2196f3' },
  put: { bg: '#fff3e0', text: '#e65100', border: '#ff9800' },
  patch: { bg: '#fff8e1', text: '#f57f17', border: '#ffc107' },
  delete: { bg: '#fce4ec', text: '#b71c1c', border: '#f44336' },
};

/**
 * Main parse function — transforms raw OpenAPI spec into template-friendly data
 */
export function parseOpenApiSpec(spec) {
  const info = spec.info || {};
  const securitySchemes = spec.components?.securitySchemes || {};
  const definedSchemas = spec.components?.schemas || {};

  // Determine base URL
  const servers = spec.servers || [];
  const baseUrl = servers[0]?.url || 'N/A';

  // Determine auth type from securitySchemes
  const authTypes = Object.entries(securitySchemes).map(([, scheme]) => {
    if (scheme.type === 'http') return `${scheme.scheme?.toUpperCase() || 'HTTP'} Auth`;
    if (scheme.type === 'apiKey') return `API Key (${scheme.name || 'header'})`;
    if (scheme.type === 'oauth2') return 'OAuth 2.0';
    return scheme.type;
  });

  // Group endpoints by tag
  const tagMap = {};
  const tagOrder = [];

  // Ensure all declared tags have entries
  for (const tag of spec.tags || []) {
    tagMap[tag.name] = {
      name: tag.name,
      description: tag.description || '',
      endpoints: [],
    };
    tagOrder.push(tag.name);
  }

  // Process all paths
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  let endpointCount = 0;

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;

      endpointCount++;

      const tags = operation.tags || ['Uncategorized'];
      const endpointData = {
        method: method.toUpperCase(),
        methodLower: method,
        path,
        summary: operation.summary || '',
        description: operation.description || '',
        operationId: operation.operationId || '',
        deprecated: operation.deprecated || false,
        methodColor: METHOD_COLORS[method] || METHOD_COLORS.get,
        parameters: extractParameters(operation, spec),
        requestBody: extractRequestBody(operation, spec),
        responses: extractResponses(operation, spec),
        security: operation.security || [],
        anchorId: `${method}-${path}`.replace(/[^a-zA-Z0-9-]/g, '-'),
      };

      for (const tag of tags) {
        if (!tagMap[tag]) {
          tagMap[tag] = { name: tag, description: '', endpoints: [] };
          tagOrder.push(tag);
        }
        tagMap[tag].endpoints.push(endpointData);
      }
    }
  }

  // Build tag list in declared order
  const tags = tagOrder
    .map((name) => tagMap[name])
    .filter((tag) => tag.endpoints.length > 0)
    .map((tag, index) => ({ ...tag, anchorId: `tag-${index}-${tag.name.replace(/[^a-zA-Z0-9-]/g, '-')}` }));

  // Build component schemas for reference section
  const schemas = Object.entries(definedSchemas).map(([name, schema]) => ({
    name,
    type: schema.type || 'object',
    description: schema.description || '',
    properties: flattenSchemaProperties(schema, spec),
  }));

  // Stats
  const stats = {
    endpointCount,
    tagCount: tags.length,
    schemaCount: schemas.length,
    pathCount: Object.keys(spec.paths || {}).length,
  };

  return {
    title: info.title || 'API Documentation',
    version: info.version || '1.0.0',
    description: info.description || '',
    baseUrl,
    authType: authTypes.join(', ') || 'None',
    tags,
    schemas,
    stats,
    securitySchemes,
  };
}
