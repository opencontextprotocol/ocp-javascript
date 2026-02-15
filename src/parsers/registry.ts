/**
 * Parser registry for managing API specification parsers.
 */

import { APISpecParser } from './base.js';
import { OpenAPIParser } from './openapi_parser.js';

/**
 * Registry for managing and discovering API specification parsers.
 * 
 * Automatically registers built-in parsers (OpenAPI) on initialization.
 * Custom parsers can be registered via register() method.
 */
export class ParserRegistry {
    private parsers: APISpecParser[];

    constructor(autoRegisterBuiltin: boolean = true) {
        this.parsers = [];
        
        if (autoRegisterBuiltin) {
            this.registerBuiltinParsers();
        }
    }

    /**
     * Register built-in parsers.
     */
    private registerBuiltinParsers(): void {
        this.register(new OpenAPIParser());
    }

    /**
     * Register a parser.
     * 
     * Parsers are checked in registration order, so register more specific
     * parsers before more general ones.
     * 
     * @param parser - Parser instance to register
     */
    register(parser: APISpecParser): void {
        this.parsers.push(parser);
    }

    /**
     * Find a parser that can handle the given spec data.
     * 
     * @param specData - Raw specification data
     * @returns First parser that can handle the spec, or null if none found
     */
    findParser(specData: Record<string, any>): APISpecParser | null {
        for (const parser of this.parsers) {
            if (parser.canParse(specData)) {
                return parser;
            }
        }
        return null;
    }

    /**
     * Get list of supported format names.
     * 
     * @returns List of format names from all registered parsers
     */
    getSupportedFormats(): string[] {
        return this.parsers.map(parser => parser.getFormatName());
    }

    /**
     * Get the number of registered parsers.
     * 
     * @returns Number of registered parsers
     */
    getParserCount(): number {
        return this.parsers.length;
    }
}
