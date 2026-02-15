/**
 * OCP Schema Discovery
 * 
 * Automatic API discovery and tool generation from various API specification
 * formats (OpenAPI, Postman, GraphQL, etc.), enabling context-aware API interactions 
 * with zero infrastructure requirements.
 */

import { SchemaDiscoveryError } from './errors.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { ParserRegistry } from './parsers/registry.js';
import { APISpecParser, OCPTool, OCPAPISpec } from './parsers/base.js';

// Re-export for backward compatibility
export { OCPTool, OCPAPISpec } from './parsers/base.js';

/**
 * OCP Schema Discovery Client
 * 
 * Discovers and parses API specifications to extract available tools.
 * Supports multiple formats through extensible parser registry.
 */
export class OCPSchemaDiscovery {
    private cache: Map<string, OCPAPISpec>;
    private parserRegistry: ParserRegistry;

    constructor(parserRegistry?: ParserRegistry) {
        this.cache = new Map();
        this.parserRegistry = parserRegistry || new ParserRegistry();
    }

    /**
     * Discover API from various API specification formats.
     * 
     * @param specPath - URL or file path to API specification (JSON or YAML)
     * @param baseUrl - Optional override for API base URL
     * @param includeResources - Optional list of resource names to filter tools by (case-insensitive, first resource segment matching)
     * @param pathPrefix - Optional path prefix to strip before filtering (e.g., '/v1', '/api/v2')
     * @returns API specification with extracted tools
     */
    async discoverApi(specPath: string, baseUrl?: string, includeResources?: string[], pathPrefix?: string): Promise<OCPAPISpec> {
        // Normalize cache key (absolute path for files, URL as-is)
        const cacheKey = this.normalizeCacheKey(specPath);
        
        // Check cache
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey)!;
            
            // Apply resource filtering if specified (only on cached specs)
            if (includeResources) {
                const parser = this.parserRegistry.findParser(cached.raw_spec);
                if (parser) {
                    return parser.parse(cached.raw_spec, baseUrl || cached.base_url, includeResources, pathPrefix);
                }
            }
            
            return cached;
        }

        try {
            const spec = await this.fetchSpec(specPath);
            
            // Find appropriate parser
            const parser = this.parserRegistry.findParser(spec);
            if (!parser) {
                const supportedFormats = this.parserRegistry.getSupportedFormats();
                throw new SchemaDiscoveryError(
                    `Unsupported API specification format. ` +
                    `Supported formats: ${supportedFormats.join(', ')}`
                );
            }
            
            // Parse using the appropriate parser
            const parsedSpec = parser.parse(spec, baseUrl, includeResources, pathPrefix);
            
            // Cache for future use (cache the unfiltered version)
            if (!includeResources) {
                this.cache.set(cacheKey, parsedSpec);
            } else {
                // Cache the original without filters
                const unfilteredSpec = parser.parse(spec, baseUrl, undefined, undefined);
                this.cache.set(cacheKey, unfilteredSpec);
            }
            
            return parsedSpec;
            
        } catch (error) {
            if (error instanceof SchemaDiscoveryError) {
                throw error;
            }
            throw new SchemaDiscoveryError(
                `Failed to discover API: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Normalize cache key: URLs as-is, file paths to absolute.
     */
    private normalizeCacheKey(specPath: string): string {
        if (specPath.startsWith('http://') || specPath.startsWith('https://')) {
            return specPath;
        }
        // Expand ~ and resolve to absolute path
        let expanded = specPath;
        if (specPath === '~' || specPath.startsWith('~/')) {
            expanded = specPath.replace(/^~/, homedir());
        }
        return resolve(expanded);
    }

    /**
     * Fetch API spec from URL or local file.
     */
    private async fetchSpec(specPath: string): Promise<Record<string, any>> {
        if (specPath.startsWith('http://') || specPath.startsWith('https://')) {
            return this.fetchFromUrl(specPath);
        } else {
            return this.fetchFromFile(specPath);
        }
    }

    /**
     * Fetch API specification from URL.
     */
    private async fetchFromUrl(url: string): Promise<Record<string, any>> {
        try {
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json() as Record<string, any>;
            
        } catch (error) {
            throw new SchemaDiscoveryError(
                `Failed to fetch OpenAPI spec from ${url}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Load API specification from local JSON or YAML file.
     */
    private fetchFromFile(filePath: string): Record<string, any> {
        try {
            // Expand ~ for home directory
            let expandedPath = filePath;
            if (filePath === '~' || filePath.startsWith('~/')) {
                expandedPath = filePath.replace(/^~/, homedir());
            }
            
            // Resolve to absolute path
            const resolvedPath = resolve(expandedPath);
            
            // Check file extension
            const lowerPath = resolvedPath.toLowerCase();
            const isJson = lowerPath.endsWith('.json');
            const isYaml = lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml');
            
            if (!isJson && !isYaml) {
                const ext = resolvedPath.substring(resolvedPath.lastIndexOf('.'));
                throw new SchemaDiscoveryError(
                    `Unsupported file format: ${ext}. Supported formats: .json, .yaml, .yml`
                );
            }
            
            // Read file
            const content = readFileSync(resolvedPath, 'utf-8');
            
            // Parse based on format
            if (isJson) {
                return JSON.parse(content);
            } else {
                return yaml.load(content) as Record<string, any>;
            }
            
        } catch (error) {
            if (error instanceof SchemaDiscoveryError) {
                throw error;
            }
            // YAML errors
            if (error instanceof yaml.YAMLException) {
                throw new SchemaDiscoveryError(`Invalid YAML in file ${filePath}: ${error.message}`);
            }
            // JSON errors
            if (error instanceof SyntaxError) {
                throw new SchemaDiscoveryError(`Invalid JSON in file ${filePath}: ${error.message}`);
            }
            // File not found
            if ((error as any).code === 'ENOENT') {
                throw new SchemaDiscoveryError(`File not found: ${filePath}`);
            }
            throw new SchemaDiscoveryError(
                `Failed to load spec from ${filePath}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
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

    /**
     * Get list of supported API specification formats.
     * 
     * @returns List of format names (e.g., ['OpenAPI', 'Postman Collection'])
     */
    getSupportedFormats(): string[] {
        return this.parserRegistry.getSupportedFormats();
    }

    /**
     * Register a custom parser for additional API specification formats.
     * 
     * @param parser - An instance of APISpecParser
     * 
     * @example
     * ```typescript
     * import { APISpecParser, OCPAPISpec } from 'ocp-agent';
     * 
     * class MyCustomParser extends APISpecParser {
     *     canParse(specData: Record<string, any>): boolean {
     *         return 'myformat' in specData;
     *     }
     *     
     *     parse(specData: Record<string, any>, baseUrlOverride?: string): OCPAPISpec {
     *         // Parse logic here
     *         return { ... };
     *     }
     *     
     *     getFormatName(): string {
     *         return "My Custom Format";
     *     }
     * }
     * 
     * const discovery = new OCPSchemaDiscovery();
     * discovery.registerParser(new MyCustomParser());
     * ```
     */
    registerParser(parser: APISpecParser): void {
        this.parserRegistry.register(parser);
    }
}
