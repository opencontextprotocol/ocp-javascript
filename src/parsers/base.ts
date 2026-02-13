/**
 * Base parser interface and shared types for API specification parsing.
 */

/**
 * Tool definition extracted from API specification
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
 * Abstract base class for API specification parsers.
 * 
 * Implement this interface to add support for new API specification formats
 * (e.g., Postman Collections, GraphQL schemas, Google Discovery format).
 */
export abstract class APISpecParser {
    /**
     * Determine if this parser can handle the given spec data.
     * 
     * @param specData - The raw specification data
     * @returns True if this parser can parse the spec
     */
    abstract canParse(specData: Record<string, any>): boolean;

    /**
     * Parse the specification and extract tools.
     * 
     * @param specData - The raw specification data
     * @param baseUrlOverride - Optional base URL override
     * @param includeResources - Optional resource filter
     * @param pathPrefix - Optional path prefix for filtering
     * @returns Parsed API specification with tools
     */
    abstract parse(
        specData: Record<string, any>,
        baseUrlOverride?: string,
        includeResources?: string[],
        pathPrefix?: string
    ): OCPAPISpec;

    /**
     * Get the human-readable name of this parser's format.
     * 
     * @returns Format name (e.g., "OpenAPI", "Postman Collection")
     */
    abstract getFormatName(): string;
}
