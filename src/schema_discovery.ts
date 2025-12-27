/**
 * OCP Schema Discovery
 * 
 * Automatic OpenAPI schema discovery and tool extraction for OCP agents.
 */

import { SchemaDiscoveryError } from './errors.js';

/**
 * Tool definition extracted from OpenAPI operation
 */
export interface OCPTool {
    name: string;
    description: string;
    method: string;
    path: string;
    parameters: Record<string, any>;
    response_schema?: Record<string, any>;
    operation_id?: string;
    tags?: string[];
}

/**
 * Complete API specification with tools
 */
export interface OCPAPISpec {
    base_url: string;
    title: string;
    version: string;
    description: string;
    tools: OCPTool[];
    raw_spec: Record<string, any>;
    name?: string;
}

/**
 * OCP Schema Discovery Client
 * 
 * Discovers and parses OpenAPI specifications to extract available tools.
 */
export class OCPSchemaDiscovery {
    private cache: Map<string, OCPAPISpec>;

    constructor() {
        this.cache = new Map();
    }

    /**
     * Discover API from OpenAPI specification.
     * 
     * @param specUrl - URL to OpenAPI specification (JSON or YAML)
     * @param baseUrl - Optional override for API base URL
     * @param includeResources - Optional list of resource names to filter tools by (case-insensitive, first resource segment matching)
     * @param pathPrefix - Optional path prefix to strip before filtering (e.g., '/v1', '/api/v2')
     * @returns API specification with extracted tools
     */
    async discoverApi(specUrl: string, baseUrl?: string, includeResources?: string[], pathPrefix?: string): Promise<OCPAPISpec> {
        // Check cache
        if (this.cache.has(specUrl)) {
            return this.cache.get(specUrl)!;
        }

        try {
            const spec = await this._fetchSpec(specUrl);
            const apiSpec = this._parseOpenApiSpec(spec, baseUrl);
            
            // Cache the result
            this.cache.set(specUrl, apiSpec);
            
            // Apply resource filtering if specified (only on newly parsed specs)
            if (includeResources) {
                const filteredTools = this._filterToolsByResources(apiSpec.tools, includeResources, pathPrefix);
                return {
                    base_url: apiSpec.base_url,
                    title: apiSpec.title,
                    version: apiSpec.version,
                    description: apiSpec.description,
                    tools: filteredTools,
                    raw_spec: apiSpec.raw_spec
                };
            }
            
            return apiSpec;
        } catch (error) {
            throw new SchemaDiscoveryError(
                `Failed to discover API: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Fetch OpenAPI specification from URL and resolve $refs.
     */
    private async _fetchSpec(specUrl: string): Promise<Record<string, any>> {
        try {
            const response = await fetch(specUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const specData = await response.json() as Record<string, any>;
            
            // Resolve all internal $ref references
            return this._resolveRefs(specData);
            
        } catch (error) {
            throw new SchemaDiscoveryError(
                `Failed to fetch OpenAPI spec from ${specUrl}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Recursively resolve $ref references in OpenAPI spec.
     * 
     * @param obj - Current object being processed (object, array, or primitive)
     * @param root - Root spec document for looking up references
     * @param resolutionStack - Stack of refs currently being resolved (for circular detection)
     * @returns Object with all resolvable $refs replaced by their definitions
     */
    private _resolveRefs(
        obj: any,
        root?: Record<string, any>,
        resolutionStack: string[] = []
    ): any {
        // Initialize on first call
        if (root === undefined) {
            root = obj;
        }

        // Handle object types
        if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
            // Check if this is a $ref
            if ('$ref' in obj && Object.keys(obj).length === 1) {
                const refPath = obj.$ref as string;
                
                // Only handle internal refs (start with #/)
                if (!refPath.startsWith('#/')) {
                    return obj;
                }
                
                // Check for circular reference
                if (resolutionStack.includes(refPath)) {
                    // Return a placeholder to break the cycle
                    return { type: 'object', description: 'Circular reference' };
                }
                
                // Resolve the reference
                try {
                    const resolved = this._lookupRef(root!, refPath);
                    if (resolved !== null) {
                        // Recursively resolve the resolved object with updated stack
                        const newStack = [...resolutionStack, refPath];
                        return this._resolveRefs(resolved, root, newStack);
                    }
                } catch {
                    // If lookup fails, return a placeholder
                    return { type: 'object', description: 'Unresolved reference' };
                }
                
                return obj;
            }
            
            // Not a $ref, recursively process all values
            const result: Record<string, any> = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this._resolveRefs(value, root, resolutionStack);
            }
            return result;
        }
        
        // Handle array types
        if (Array.isArray(obj)) {
            return obj.map(item => this._resolveRefs(item, root, resolutionStack));
        }
        
        // Primitives pass through unchanged
        return obj;
    }

    /**
     * Look up a reference path in the spec document.
     * 
     * @param root - Root spec document
     * @param refPath - Reference path like '#/components/schemas/User'
     * @returns The referenced object, or null if not found
     */
    private _lookupRef(root: Record<string, any>, refPath: string): any {
        // Remove the leading '#/' and split by '/'
        if (!refPath.startsWith('#/')) {
            return null;
        }
        
        const pathParts = refPath.substring(2).split('/');
        
        // Navigate through the spec
        let current: any = root;
        for (const part of pathParts) {
            if (current !== null && typeof current === 'object' && part in current) {
                current = current[part];
            } else {
                return null;
            }
        }
        
        return current;
    }

    /**
     * Parse OpenAPI specification and extract tools.
     */
    private _parseOpenApiSpec(spec: Record<string, any>, baseUrlOverride?: string): OCPAPISpec {
        // Extract API info
        const info = spec.info || {};
        const title = info.title || 'Unknown API';
        const version = info.version || '1.0.0';
        const description = info.description || '';

        // Extract base URL
        let baseUrl = baseUrlOverride;
        if (!baseUrl && spec.servers && spec.servers.length > 0) {
            baseUrl = spec.servers[0].url;
        }
        if (!baseUrl) {
            throw new SchemaDiscoveryError('No base URL found in OpenAPI spec and none provided');
        }

        // Extract tools from paths
        const tools: OCPTool[] = [];
        const paths = spec.paths || {};

        for (const [path, pathItem] of Object.entries(paths)) {
            if (typeof pathItem !== 'object' || pathItem === null) continue;

            for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
                if (!['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
                    continue;
                }

                const tool = this._createToolFromOperation(path, method, operation);
                if (tool) {
                    tools.push(tool);
                }
            }
        }

        return {
            base_url: baseUrl,
            title,
            version,
            description,
            tools,
            raw_spec: spec
        };
    }

    /**
     * Create tool definition from OpenAPI operation.
     */
    private _createToolFromOperation(path: string, method: string, operation: Record<string, any>): OCPTool | null {
        if (!operation || typeof operation !== 'object') {
            return null;
        }

        // Generate tool name with proper validation and fallback logic
        const operationId = operation.operationId;
        let toolName: string | null = null;
        
        // Try operationId first
        if (operationId) {
            const normalizedName = this._normalizeToolName(operationId);
            if (this._isValidToolName(normalizedName)) {
                toolName = normalizedName;
            }
        }
        
        // If operationId failed, try fallback naming
        if (!toolName) {
            // Generate name from path and method
            const cleanPath = path.replace(/\//g, '_').replace(/[{}]/g, '');
            const fallbackName = `${method.toLowerCase()}${cleanPath}`;
            const normalizedFallback = this._normalizeToolName(fallbackName);
            if (this._isValidToolName(normalizedFallback)) {
                toolName = normalizedFallback;
            }
        }
        
        // If we can't generate a valid tool name, skip this operation
        if (!toolName) {
            console.warn(`Skipping operation ${method} ${path}: unable to generate valid tool name`);
            return null;
        }

        const description = operation.summary || operation.description || 'No description provided';
        const tags = operation.tags || [];

        // Parse parameters
        const parameters = this._parseParameters(operation.parameters || []);

        // Parse request body
        const bodyParams = this._parseRequestBody(operation.requestBody);
        Object.assign(parameters, bodyParams);

        // Parse response schema
        const responseSchema = this._parseResponses(operation.responses || {});

        return {
            name: toolName,
            description,
            method: method.toUpperCase(),
            path,
            parameters,
            response_schema: responseSchema,
            operation_id: operationId,
            tags
        };
    }

    /**
     * Normalize tool name to camelCase, removing special characters.
     */
    private _normalizeToolName(name: string): string {
        if (!name) {
            return name;
        }
            
        // First, split PascalCase/camelCase words (e.g., "FetchAccount" -> "Fetch Account")
        // Insert space before uppercase letters that follow lowercase letters or digits
        const pascalSplit = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        
        // Replace separators (/, _, -, .) with spaces for processing
        // Also handle multiple consecutive separators like //
        const normalized = pascalSplit.replace(/[\/_.-]+/g, ' ');
        
        // Split into words and filter out empty strings
        const words = normalized.split(' ').filter(word => word);
        
        if (words.length === 0) {
            return name;
        }
            
        // Convert to camelCase: first word lowercase, rest capitalize
        const camelCaseWords = [words[0].toLowerCase()];
        for (let i = 1; i < words.length; i++) {
            camelCaseWords.push(words[i].charAt(0).toUpperCase() + words[i].slice(1).toLowerCase());
        }
                
        return camelCaseWords.join('');
    }

    /**
     * Check if a normalized tool name is valid.
     */
    private _isValidToolName(name: string): boolean {
        if (!name) {
            return false;
        }
            
        // Must start with a letter
        if (!/^[a-zA-Z]/.test(name)) {
            return false;
        }
            
        // Must contain at least one alphanumeric character
        if (!/[a-zA-Z0-9]/.test(name)) {
            return false;
        }
            
        return true;
    }

    /**
     * Parse OpenAPI parameters.
     */
    private _parseParameters(parameters: any[]): Record<string, any> {
        const result: Record<string, any> = {};

        for (const param of parameters) {
            if (!param || typeof param !== 'object') continue;

            const name = param.name;
            if (!name) continue;

            result[name] = {
                type: param.schema?.type || 'string',
                description: param.description || '',
                required: param.required || false,
                location: param.in || 'query',
                schema: param.schema || {}
            };
        }

        return result;
    }

    /**
     * Parse OpenAPI request body.
     */
    private _parseRequestBody(requestBody: any): Record<string, any> {
        if (!requestBody || typeof requestBody !== 'object') {
            return {};
        }

        const content = requestBody.content || {};
        const jsonContent = content['application/json'];
        
        if (!jsonContent || !jsonContent.schema) {
            return {};
        }

        const schema = jsonContent.schema;
        const properties = schema.properties || {};
        const required = schema.required || [];
        
        const result: Record<string, any> = {};

        for (const [name, propSchema] of Object.entries(properties)) {
            if (typeof propSchema !== 'object' || propSchema === null) continue;
            
            const prop = propSchema as Record<string, any>;
            result[name] = {
                type: prop.type || 'string',
                description: prop.description || '',
                required: required.includes(name),
                location: 'body',
                schema: prop
            };
        }

        return result;
    }

    /**
     * Parse OpenAPI responses.
     */
    private _parseResponses(responses: Record<string, any>): Record<string, any> | undefined {
        // Find first 2xx response
        for (const [statusCode, response] of Object.entries(responses)) {
            if (statusCode.startsWith('2') && typeof response === 'object' && response !== null) {
                const content = response.content || {};
                const jsonContent = content['application/json'];
                
                if (jsonContent && jsonContent.schema) {
                    return jsonContent.schema;
                }
            }
        }

        return undefined;
    }

    /**
     * Get tools filtered by tag.
     */
    getToolsByTag(apiSpec: OCPAPISpec, tag: string): OCPTool[] {
        return apiSpec.tools.filter(tool => 
            tool.tags && tool.tags.includes(tag)
        );
    }

    /**
     * Filter tools to only include those whose first resource segment matches includeResources.
     */
    private _filterToolsByResources(tools: OCPTool[], includeResources: string[], pathPrefix?: string): OCPTool[] {
        if (!includeResources || includeResources.length === 0) {
            return tools;
        }

        // Normalize resource names to lowercase for case-insensitive matching
        const normalizedResources = includeResources.map(r => r.toLowerCase());

        return tools.filter(tool => {
            let path = tool.path;
            
            // Strip path prefix if provided
            if (pathPrefix) {
                const prefixLower = pathPrefix.toLowerCase();
                const pathLower = path.toLowerCase();
                if (pathLower.startsWith(prefixLower)) {
                    path = path.substring(pathPrefix.length);
                }
            }
            
            // Extract path segments by splitting on both '/' and '.'
            const pathLower = path.toLowerCase();
            // Replace dots with slashes for uniform splitting
            const pathNormalized = pathLower.replace(/\./g, '/');
            // Split by '/' and filter out empty segments and parameter placeholders
            const segments = pathNormalized.split('/').filter(seg => seg && !seg.startsWith('{'));
            
            // Check if the first segment matches any of the includeResources
            return segments.length > 0 && normalizedResources.includes(segments[0]);
        });
    }

    /**
     * Search tools by name or description.
     */
    searchTools(apiSpec: OCPAPISpec, query: string): OCPTool[] {
        const lowerQuery = query.toLowerCase();
        
        return apiSpec.tools.filter(tool => 
            tool.name.toLowerCase().includes(lowerQuery) ||
            tool.description.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Generate human-readable tool documentation.
     */
    generateToolDocumentation(tool: OCPTool): string {
        const docLines = [
            `## ${tool.name}`,
            `**Method:** ${tool.method}`,
            `**Path:** ${tool.path}`,
            `**Description:** ${tool.description}`,
            ''
        ];

        if (Object.keys(tool.parameters).length > 0) {
            docLines.push('### Parameters:');
            for (const [paramName, paramInfo] of Object.entries(tool.parameters)) {
                const required = paramInfo.required ? ' (required)' : ' (optional)';
                const location = ` [${paramInfo.location || 'query'}]`;
                docLines.push(`- **${paramName}**${required}${location}: ${paramInfo.description || ''}`);
            }
            docLines.push('');
        }

        if (tool.tags && tool.tags.length > 0) {
            docLines.push(`**Tags:** ${tool.tags.join(', ')}`);
            docLines.push('');
        }

        return docLines.join('\n');
    }

    /**
     * Clear the discovery cache.
     */
    clearCache(): void {
        this.cache.clear();
    }
}
