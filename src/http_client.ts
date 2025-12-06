/**
 * OCP HTTP Client
 * 
 * HTTP client wrapper that automatically injects OCP context headers.
 */

import { AgentContext } from './context.js';
import { createOCPHeaders } from './headers.js';

/**
 * HTTP request options
 */
interface RequestOptions {
    params?: Record<string, string | number | boolean>;
    json?: any;
    headers?: Record<string, string>;
    timeout?: number;
}

/**
 * HTTP response wrapper
 */
export interface OCPResponse {
    status: number;
    statusText: string;
    ok: boolean;
    headers: Headers;
    data: any;
    text: string;
    json: () => Promise<any>;
}

/**
 * OCP HTTP Client
 * 
 * Wraps HTTP requests to automatically inject OCP context headers
 * and log interactions.
 */
export class OCPHTTPClient {
    private context: AgentContext;
    private autoUpdateContext: boolean;
    private baseUrl?: string;

    constructor(context: AgentContext, autoUpdateContext: boolean = true, baseUrl?: string) {
        this.context = context;
        this.autoUpdateContext = autoUpdateContext;
        this.baseUrl = baseUrl?.replace(/\/$/, ''); // Remove trailing slash
    }

    /**
     * Prepare headers with OCP context.
     */
    private _prepareHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
        const ocpHeaders = createOCPHeaders(this.context);
        
        return {
            ...ocpHeaders,
            ...additionalHeaders
        };
    }

    /**
     * Log API interaction to context.
     */
    private _logInteraction(method: string, url: string, response?: OCPResponse, error?: Error): void {
        if (!this.autoUpdateContext) {
            return;
        }

        // Parse API endpoint
        const parsedUrl = new URL(url);
        const endpoint = `${method.toUpperCase()} ${parsedUrl.pathname}`;
        
        // Get status code from response
        const statusCode = response?.status;
        
        // Determine result string
        let result: string | undefined;
        if (error) {
            result = `Error: ${error.message}`;
        } else if (statusCode !== undefined) {
            result = `HTTP ${statusCode}`;
        }

        // Build interaction metadata
        const metadata: Record<string, any> = {
            method: method.toUpperCase(),
            url: url,
            domain: parsedUrl.hostname,
            success: !error && statusCode ? statusCode >= 200 && statusCode < 300 : false,
        };

        if (statusCode !== undefined) {
            metadata.status_code = statusCode;
        }

        if (error) {
            metadata.error = error.message;
        }

        this.context.addInteraction(
            `api_call_${method.toLowerCase()}`,
            endpoint,
            result,
            metadata
        );
    }

    /**
     * Make HTTP request.
     */
    async request(method: string, url: string, options: RequestOptions = {}): Promise<OCPResponse> {
        const { params, json, headers, timeout = 30000 } = options;

        // Handle base URL for relative URLs
        let finalUrl: URL;
        if (this.baseUrl && !url.startsWith('http://') && !url.startsWith('https://')) {
            finalUrl = new URL(`${this.baseUrl}${url}`);
        } else {
            finalUrl = new URL(url);
        }
        
        // Add query parameters
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                finalUrl.searchParams.append(key, String(value));
            }
        }

        // Prepare headers
        const finalHeaders = this._prepareHeaders(headers);
        
        // Add content-type for JSON
        if (json !== undefined) {
            finalHeaders['Content-Type'] = 'application/json';
        }

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(finalUrl.toString(), {
                method: method.toUpperCase(),
                headers: finalHeaders,
                body: json !== undefined ? JSON.stringify(json) : undefined,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Read response text
            const text = await response.text();
            
            // Parse JSON if possible
            let data: any;
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }

            const ocpResponse: OCPResponse = {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok,
                headers: response.headers,
                data,
                text,
                json: async () => JSON.parse(text)
            };

            this._logInteraction(method, finalUrl.toString(), ocpResponse);

            return ocpResponse;

        } catch (error) {
            clearTimeout(timeoutId);
            
            const err = error instanceof Error ? error : new Error(String(error));
            this._logInteraction(method, finalUrl.toString(), undefined, err);
            
            throw err;
        }
    }

    /**
     * GET request.
     */
    async get(url: string, options: RequestOptions = {}): Promise<OCPResponse> {
        return this.request('GET', url, options);
    }

    /**
     * POST request.
     */
    async post(url: string, options: RequestOptions = {}): Promise<OCPResponse> {
        return this.request('POST', url, options);
    }

    /**
     * PUT request.
     */
    async put(url: string, options: RequestOptions = {}): Promise<OCPResponse> {
        return this.request('PUT', url, options);
    }

    /**
     * DELETE request.
     */
    async delete(url: string, options: RequestOptions = {}): Promise<OCPResponse> {
        return this.request('DELETE', url, options);
    }

    /**
     * PATCH request.
     */
    async patch(url: string, options: RequestOptions = {}): Promise<OCPResponse> {
        return this.request('PATCH', url, options);
    }
}

/**
 * Create API-specific HTTP client.
 * 
 * @param baseUrl - API base URL
 * @param context - Agent context
 * @param headers - Optional headers to include in all requests
 * @returns Configured HTTP client
 */
export function wrapApi(baseUrl: string, context: AgentContext, headers?: Record<string, string>): OCPHTTPClient {
    const client = new OCPHTTPClient(context, true, baseUrl);
    
    // Override request method to add additional headers if provided
    if (headers) {
        const originalRequest = client.request.bind(client);
        client.request = (method: string, url: string, options: RequestOptions = {}) => {
            const opts = { ...options };
            opts.headers = { ...headers, ...opts.headers };
            return originalRequest(method, url, opts);
        };
    }

    return client;
}
