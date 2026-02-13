/**
 * OpenAPI 2.0/3.x parser for extracting tools from OpenAPI specifications.
 */

import { APISpecParser, OCPAPISpec, OCPTool } from './base.js';
import { SchemaDiscoveryError } from '../errors.js';

// Configuration constants
const DEFAULT_API_TITLE = 'Unknown API';
const DEFAULT_API_VERSION = '1.0.0';
const SUPPORTED_HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Parser for OpenAPI 2.0 (Swagger) and OpenAPI 3.x specifications.
 */
export class OpenAPIParser extends APISpecParser {
    private specVersion?: string;

    canParse(specData: Record<string, any>): boolean {
        return 'swagger' in specData || 'openapi' in specData;
    }

    parse(
        specData: Record<string, any>,
        baseUrlOverride?: string,
        includeResources?: string[],
        pathPrefix?: string
    ): OCPAPISpec {
        this.specVersion = this.detectSpecVersion(specData);
        const apiSpec = this.parseOpenApiSpec(specData, baseUrlOverride);
        
        // Apply resource filtering if specified
        if (includeResources) {
            const filteredTools = this.filterToolsByResources(apiSpec.tools, includeResources, pathPrefix);
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
    }

    getFormatName(): string {
        return 'OpenAPI';
    }

    /**
     * Detect OpenAPI/Swagger version from spec.
     * 
     * @returns Version string: 'swagger_2', 'openapi_3.0', 'openapi_3.1', 'openapi_3.2'
     */
    private detectSpecVersion(spec: Record<string, any>): string {
        if ('swagger' in spec) {
            const swaggerVersion = spec.swagger;
            if (typeof swaggerVersion === 'string' && swaggerVersion.startsWith('2.')) {
                return 'swagger_2';
            }
            throw new SchemaDiscoveryError(`Unsupported Swagger version: ${swaggerVersion}`);
        } else if ('openapi' in spec) {
            const openapiVersion = spec.openapi;
            if (typeof openapiVersion === 'string') {
                if (openapiVersion.startsWith('3.0')) {
                    return 'openapi_3.0';
                } else if (openapiVersion.startsWith('3.1')) {
                    return 'openapi_3.1';
                } else if (openapiVersion.startsWith('3.2')) {
                    return 'openapi_3.2';
                }
            }
            throw new SchemaDiscoveryError(`Unsupported OpenAPI version: ${openapiVersion}`);
        }
        
        throw new SchemaDiscoveryError('Unable to detect spec version: missing "swagger" or "openapi" field');
    }

    /**
     * Parse OpenAPI specification and extract tools with lazy $ref resolution.
     */
    private parseOpenApiSpec(spec: Record<string, any>, baseUrlOverride?: string): OCPAPISpec {
        // Initialize memoization cache for lazy $ref resolution
        const memoCache: Record<string, any> = {};
        
        // Extract API info
        const info = spec.info || {};
        const title = info.title || DEFAULT_API_TITLE;
        const version = info.version || DEFAULT_API_VERSION;
        const description = info.description || '';

        // Extract base URL (version-specific)
        let baseUrl = baseUrlOverride;
        if (!baseUrl) {
            baseUrl = this.extractBaseUrl(spec);
        }

        // Extract tools from paths
        const tools: OCPTool[] = [];
        const paths = spec.paths || {};

        for (const [path, pathItem] of Object.entries(paths)) {
            if (typeof pathItem !== 'object' || pathItem === null) continue;

            for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
                if (!SUPPORTED_HTTP_METHODS.includes(method.toLowerCase())) {
                    continue;
                }

                const tool = this.createToolFromOperation(path, method, operation, spec, memoCache);
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
     * Extract base URL from spec (version-aware).
     */
    private extractBaseUrl(spec: Record<string, any>): string {
        if (this.specVersion === 'swagger_2') {
            // Swagger 2.0: construct from host, basePath, and schemes
            const schemes = spec.schemes || ['https'];
            const host = spec.host || '';
            const basePath = spec.basePath || '';
            
            if (host) {
                const scheme = schemes.length > 0 ? schemes[0] : 'https';
                return `${scheme}://${host}${basePath}`;
            }
            return '';
        } else {
            // OpenAPI 3.x: use servers array
            if (spec.servers && spec.servers.length > 0) {
                return spec.servers[0].url || '';
            }
            return '';
        }
    }

    /**
     * Create tool definition from OpenAPI operation.
     */
    private createToolFromOperation(
        path: string, 
        method: string, 
        operation: Record<string, any>,
        specData: Record<string, any>,
        memoCache: Record<string, any>
    ): OCPTool | null {
        if (!operation || typeof operation !== 'object') {
            return null;
        }

        // Generate tool name with proper validation and fallback logic
        const operationId = operation.operationId;
        let toolName: string | null = null;
        
        // Try operationId first
        if (operationId) {
            const normalizedName = this.normalizeToolName(operationId);
            if (this.isValidToolName(normalizedName)) {
                toolName = normalizedName;
            }
        }
        
        // If operationId failed, try fallback naming
        if (!toolName) {
            // Generate name from path and method
            const cleanPath = path.replace(/\//g, '_').replace(/[{}]/g, '');
            const fallbackName = `${method.toLowerCase()}${cleanPath}`;
            const normalizedFallback = this.normalizeToolName(fallbackName);
            if (this.isValidToolName(normalizedFallback)) {
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

        // Parse parameters (version-aware)
        const parameters = this.parseParameters(operation.parameters || [], specData, memoCache);

        // Add request body parameters (version-specific)
        if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
            if (this.specVersion === 'swagger_2') {
                // Swagger 2.0: body is in parameters array
                for (const param of (operation.parameters || [])) {
                    const bodyParams = this.parseSwagger2BodyParameter(param, specData, memoCache);
                    Object.assign(parameters, bodyParams);
                }
            } else {
                // OpenAPI 3.x: separate requestBody field
                if (operation.requestBody) {
                    const bodyParams = this.parseOpenApi3RequestBody(operation.requestBody, specData, memoCache);
                    Object.assign(parameters, bodyParams);
                }
            }
        }

        // Parse response schema
        const responseSchema = this.parseResponses(operation.responses || {}, specData, memoCache);

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
    private normalizeToolName(name: string): string {
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
    private isValidToolName(name: string): boolean {
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
     * Parse OpenAPI parameters with lazy $ref resolution.
     */
    private parseParameters(
        parameters: any[], 
        specData: Record<string, any>,
        memoCache: Record<string, any>
    ): Record<string, any> {
        const result: Record<string, any> = {};

        for (const param of parameters) {
            if (!param || typeof param !== 'object') continue;

            const name = param.name;
            if (!name) continue;

            const paramSchema: Record<string, any> = {
                description: param.description || '',
                required: param.required || false,
                location: param.in || 'query',
                type: 'string'  // Default type
            };

            // Extract type from schema
            const schema = param.schema || {};
            if (schema) {
                // Resolve any $refs in the parameter schema
                const resolvedSchema = this.resolveRefs(schema, specData, [], memoCache);
                paramSchema.type = resolvedSchema.type || 'string';
                if ('enum' in resolvedSchema) {
                    paramSchema.enum = resolvedSchema.enum;
                }
                if ('format' in resolvedSchema) {
                    paramSchema.format = resolvedSchema.format;
                }
            }

            result[name] = paramSchema;
        }

        return result;
    }

    /**
     * Parse OpenAPI 3.x request body with lazy $ref resolution.
     */
    private parseOpenApi3RequestBody(
        requestBody: any,
        specData: Record<string, any>,
        memoCache: Record<string, any>
    ): Record<string, any> {
        if (!requestBody || typeof requestBody !== 'object') {
            return {};
        }

        const content = requestBody.content || {};
        const jsonContent = content['application/json'];
        
        if (!jsonContent || !jsonContent.schema) {
            return {};
        }

        // Resolve the schema if it contains $refs
        const schema = this.resolveRefs(jsonContent.schema, specData, [], memoCache);
        
        // Handle object schemas
        if (schema.type === 'object') {
            const properties = schema.properties || {};
            const required = schema.required || [];
            
            const result: Record<string, any> = {};

            for (const [name, propSchema] of Object.entries(properties)) {
                if (typeof propSchema !== 'object' || propSchema === null) continue;
                
                const prop = propSchema as Record<string, any>;
                result[name] = {
                    description: prop.description || '',
                    required: required.includes(name),
                    location: 'body',
                    type: prop.type || 'string'
                };
                
                if ('enum' in prop) {
                    result[name].enum = prop.enum;
                }
            }

            return result;
        }

        return {};
    }

    /**
     * Parse Swagger 2.0 body parameter into parameters.
     */
    private parseSwagger2BodyParameter(
        param: any,
        specData: Record<string, any>,
        memoCache: Record<string, any>
    ): Record<string, any> {
        if (!param || typeof param !== 'object' || param.in !== 'body' || !param.schema) {
            return {};
        }

        // Resolve the schema if it contains $refs
        const schema = this.resolveRefs(param.schema, specData, [], memoCache);
        
        // Handle object schemas
        if (schema.type === 'object') {
            const properties = schema.properties || {};
            const required = schema.required || [];
            
            const result: Record<string, any> = {};

            for (const [name, propSchema] of Object.entries(properties)) {
                if (typeof propSchema !== 'object' || propSchema === null) continue;
                
                const prop = propSchema as Record<string, any>;
                result[name] = {
                    description: prop.description || '',
                    required: required.includes(name),
                    location: 'body',
                    type: prop.type || 'string'
                };
                
                if ('enum' in prop) {
                    result[name].enum = prop.enum;
                }
            }

            return result;
        }

        return {};
    }

    /**
     * Parse OpenAPI responses with lazy $ref resolution (version-aware).
     */
    private parseResponses(
        responses: Record<string, any>,
        specData: Record<string, any>,
        memoCache: Record<string, any>
    ): Record<string, any> | undefined {
        // Find first 2xx response
        for (const [statusCode, response] of Object.entries(responses)) {
            if (statusCode.startsWith('2') && typeof response === 'object' && response !== null) {
                if (this.specVersion === 'swagger_2') {
                    // Swagger 2.0: schema is directly in response
                    if (response.schema) {
                        // Resolve the schema if it contains $refs
                        return this.resolveRefs(response.schema, specData, [], memoCache);
                    }
                } else {
                    // OpenAPI 3.x: schema is in content.application/json
                    const content = response.content || {};
                    const jsonContent = content['application/json'];
                    
                    if (jsonContent && jsonContent.schema) {
                        // Resolve the schema if it contains $refs
                        return this.resolveRefs(jsonContent.schema, specData, [], memoCache);
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Recursively resolve $ref references in OpenAPI spec with polymorphic keyword handling.
     * 
     * @param obj - Current object being processed (object, array, or primitive)
     * @param root - Root spec document for looking up references
     * @param resolutionStack - Stack of refs currently being resolved (for circular detection)
     * @param memo - Memoization cache to store resolved references
     * @param insidePolymorphicKeyword - True if currently inside anyOf/oneOf/allOf
     * @returns Object with all resolvable $refs replaced by their definitions
     */
    private resolveRefs(
        obj: any,
        root?: Record<string, any>,
        resolutionStack: string[] = [],
        memo: Record<string, any> = {},
        insidePolymorphicKeyword: boolean = false
    ): any {
        // Initialize on first call
        if (root === undefined) {
            root = obj;
        }

        // Handle object types
        if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
            // Check for polymorphic keywords - process with flag set
            if ('anyOf' in obj) {
                const result: Record<string, any> = {
                    anyOf: obj.anyOf.map((item: any) => 
                        this.resolveRefs(item, root, resolutionStack, memo, true)
                    )
                };
                // Include other keys if present
                for (const [k, v] of Object.entries(obj)) {
                    if (k !== 'anyOf') {
                        result[k] = this.resolveRefs(v, root, resolutionStack, memo, insidePolymorphicKeyword);
                    }
                }
                return result;
            }
            
            if ('oneOf' in obj) {
                const result: Record<string, any> = {
                    oneOf: obj.oneOf.map((item: any) => 
                        this.resolveRefs(item, root, resolutionStack, memo, true)
                    )
                };
                for (const [k, v] of Object.entries(obj)) {
                    if (k !== 'oneOf') {
                        result[k] = this.resolveRefs(v, root, resolutionStack, memo, insidePolymorphicKeyword);
                    }
                }
                return result;
            }
            
            if ('allOf' in obj) {
                const result: Record<string, any> = {
                    allOf: obj.allOf.map((item: any) => 
                        this.resolveRefs(item, root, resolutionStack, memo, true)
                    )
                };
                for (const [k, v] of Object.entries(obj)) {
                    if (k !== 'allOf') {
                        result[k] = this.resolveRefs(v, root, resolutionStack, memo, insidePolymorphicKeyword);
                    }
                }
                return result;
            }
            
            // Check if this is a $ref
            if ('$ref' in obj && Object.keys(obj).length === 1) {
                const refPath = obj.$ref as string;
                
                // Only handle internal refs (start with #/)
                if (!refPath.startsWith('#/')) {
                    return obj;
                }
                
                // If inside polymorphic keyword, check if ref points to an object
                if (insidePolymorphicKeyword) {
                    try {
                        const resolved = this.lookupRef(root!, refPath);
                        if (resolved !== null) {
                            // Check if it's an object schema
                            if (resolved.type === 'object' || 'properties' in resolved) {
                                // Keep the $ref unresolved for object schemas
                                return obj;
                            }
                        }
                    } catch {
                        // If lookup fails, keep the ref
                        return obj;
                    }
                }
                
                // Check memo cache
                if (refPath in memo) {
                    return memo[refPath];
                }
                
                // Check for circular reference
                if (resolutionStack.includes(refPath)) {
                    // Return a placeholder to break the cycle
                    const placeholder = { type: 'object', description: 'Circular reference' };
                    memo[refPath] = placeholder;
                    return placeholder;
                }
                
                // Resolve the reference
                try {
                    const resolved = this.lookupRef(root!, refPath);
                    if (resolved !== null) {
                        // Recursively resolve the resolved object with updated stack
                        const newStack = [...resolutionStack, refPath];
                        const resolvedObj = this.resolveRefs(resolved, root, newStack, memo, insidePolymorphicKeyword);
                        memo[refPath] = resolvedObj;
                        return resolvedObj;
                    }
                } catch {
                    // If lookup fails, return a placeholder
                    const placeholder = { type: 'object', description: 'Unresolved reference' };
                    memo[refPath] = placeholder;
                    return placeholder;
                }
                
                return obj;
            }
            
            // Not a $ref, recursively process all values
            const result: Record<string, any> = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.resolveRefs(value, root, resolutionStack, memo, insidePolymorphicKeyword);
            }
            return result;
        }
        
        // Handle array types
        if (Array.isArray(obj)) {
            return obj.map(item => this.resolveRefs(item, root, resolutionStack, memo, insidePolymorphicKeyword));
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
    private lookupRef(root: Record<string, any>, refPath: string): any {
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
     * Filter tools to only include those whose first resource segment matches includeResources.
     */
    private filterToolsByResources(tools: OCPTool[], includeResources: string[], pathPrefix?: string): OCPTool[] {
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
}
