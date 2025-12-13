/**
 * Tests for OCP schema discovery functionality.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { OCPSchemaDiscovery } from '../src/schema_discovery.js';
import type { OCPAPISpec, OCPTool } from '../src/schema_discovery.js';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('OCP Schema Discovery', () => {
  let discovery: OCPSchemaDiscovery;

  const sampleOpenApiSpec = {
    openapi: '3.0.0',
    info: {
      title: 'Test API',
      version: '1.0.0',
    },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/users': {
        get: {
          summary: 'List users',
          description: 'Get a list of all users',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer' },
              required: false,
            },
          ],
          responses: {
            '200': {
              description: 'List of users',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create user',
          description: 'Create a new user',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                  required: ['name', 'email'],
                },
              },
            },
          },
        },
      },
      '/users/{id}': {
        get: {
          summary: 'Get user',
          description: 'Get a specific user by ID',
          parameters: [
            {
              name: 'id',
              in: 'path',
              schema: { type: 'string' },
              required: true,
            },
          ],
        },
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    discovery = new OCPSchemaDiscovery();
  });

  describe('Parse OpenAPI Spec', () => {
    test('parse openapi spec', () => {
      const apiSpec = (discovery as any)._parseOpenApiSpec(
        sampleOpenApiSpec,
        'https://api.example.com'
      );

      expect(apiSpec.title).toBe('Test API');
      expect(apiSpec.version).toBe('1.0.0');
      expect(apiSpec.base_url).toBe('https://api.example.com');
      expect(apiSpec.tools.length).toBe(3); // GET /users, POST /users, GET /users/{id}
    });

    test('generate tools from spec', () => {
      const apiSpec = (discovery as any)._parseOpenApiSpec(
        sampleOpenApiSpec,
        'https://api.example.com'
      );

      const tools = apiSpec.tools;
      expect(tools.length).toBe(3); // GET /users, POST /users, GET /users/{id}

      // Check that we have the expected tools with deterministic names
      const toolNames = tools.map((t: OCPTool) => t.name);
      const expectedNames = ['getUsers', 'postUsers', 'getUsersId'];

      for (const expectedName of expectedNames) {
        expect(toolNames).toContain(expectedName);
      }

      // Check GET /users tool
      const getUsers = tools.find((t: OCPTool) => t.name === 'getUsers');
      expect(getUsers).toBeDefined();
      expect(getUsers!.method).toBe('GET');
      expect(getUsers!.path).toBe('/users');
      expect(getUsers!.description).toBe('Get a list of all users');
      expect(getUsers!.parameters['limit']).toBeDefined();
      expect(getUsers!.parameters['limit'].type).toBe('integer');
      expect(getUsers!.parameters['limit'].location).toBe('query');
      expect(getUsers!.parameters['limit'].required).toBe(false);
      expect(getUsers!.response_schema).toBeDefined();
      expect(getUsers!.response_schema!.type).toBe('array');

      // Check POST /users tool
      const postUsers = tools.find((t: OCPTool) => t.name === 'postUsers');
      expect(postUsers).toBeDefined();
      expect(postUsers!.method).toBe('POST');
      expect(postUsers!.path).toBe('/users');
      expect(postUsers!.parameters['name']).toBeDefined();
      expect(postUsers!.parameters['email']).toBeDefined();
      expect(postUsers!.parameters['name'].required).toBe(true);
      expect(postUsers!.parameters['email'].required).toBe(true);
      expect(postUsers!.response_schema).toBeUndefined();

      // Check GET /users/{id} tool
      const getUsersId = tools.find((t: OCPTool) => t.name === 'getUsersId');
      expect(getUsersId).toBeDefined();
      expect(getUsersId!.method).toBe('GET');
      expect(getUsersId!.path).toBe('/users/{id}');
      expect(getUsersId!.parameters['id']).toBeDefined();
      expect(getUsersId!.parameters['id'].location).toBe('path');
      expect(getUsersId!.parameters['id'].required).toBe(true);
      expect(getUsersId!.response_schema).toBeUndefined();
    });
  });

  describe('Discover API', () => {
    test('discover api success', async () => {
      // Mock fetch response
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => sampleOpenApiSpec,
      } as Response);

      const apiSpec = await discovery.discoverApi('https://api.example.com/openapi.json');

      expect(apiSpec.title).toBe('Test API');
      expect(apiSpec.tools.length).toBe(3);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('discover api with base url override', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => sampleOpenApiSpec,
      } as Response);

      const apiSpec = await discovery.discoverApi(
        'https://api.example.com/openapi.json',
        'https://custom.example.com'
      );

      expect(apiSpec.base_url).toBe('https://custom.example.com');
    });

    test('discover api failure', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
        new Error('Network error')
      );

      await expect(
        discovery.discoverApi('https://api.example.com/openapi.json')
      ).rejects.toThrow('Network error');
    });
  });

  describe('Search Tools', () => {
    test('search tools', () => {
      // Create some sample tools
      const tools: OCPTool[] = [
        {
          name: 'list_users',
          description: 'Get all users from the system',
          method: 'GET',
          path: '/users',
          parameters: {},
          response_schema: undefined,
          operation_id: undefined,
          tags: [],
        },
        {
          name: 'create_user',
          description: 'Create a new user account',
          method: 'POST',
          path: '/users',
          parameters: {},
          response_schema: undefined,
          operation_id: undefined,
          tags: [],
        },
        {
          name: 'list_orders',
          description: 'Get customer orders',
          method: 'GET',
          path: '/orders',
          parameters: {},
          response_schema: undefined,
          operation_id: undefined,
          tags: [],
        },
      ];

      const apiSpec: OCPAPISpec = {
        title: 'Test API',
        version: '1.0.0',
        base_url: 'https://api.example.com',
        description: 'A test API for testing purposes',
        tools: tools,
        raw_spec: {},
      };

      // Test search by name
      const userTools = discovery.searchTools(apiSpec, 'user');
      expect(userTools.length).toBe(2);
      expect(
        userTools.every(
          (tool) =>
            tool.name.toLowerCase().includes('user') ||
            tool.description.toLowerCase().includes('user')
        )
      ).toBe(true);

      // Test search by description
      const createTools = discovery.searchTools(apiSpec, 'create');
      expect(createTools.length).toBe(1);
      expect(createTools[0].name).toBe('create_user');

      // Test no matches
      const noMatches = discovery.searchTools(apiSpec, 'nonexistent');
      expect(noMatches.length).toBe(0);
    });
  });

  describe('Generate Documentation', () => {
    test('generate tool documentation', () => {
      const tool: OCPTool = {
        name: 'create_user',
        description: 'Create a new user account',
        method: 'POST',
        path: '/users',
        parameters: {
          name: {
            type: 'string',
            description: "User's full name",
            required: true,
            location: 'body',
          },
          email: {
            type: 'string',
            description: "User's email address",
            required: true,
            location: 'body',
          },
          age: {
            type: 'integer',
            description: "User's age",
            required: false,
            location: 'body',
          },
        },
        response_schema: undefined,
        operation_id: undefined,
        tags: [],
      };

      const doc = discovery.generateToolDocumentation(tool);

      expect(doc).toContain('create_user');
      expect(doc).toContain('Create a new user account');
      expect(doc).toContain('POST');
      expect(doc).toContain('/users');
      expect(doc).toContain('name');
      expect(doc).toContain('email');
      expect(doc).toContain('age');
      expect(doc.toLowerCase()).toContain('required');
    });
  });

  describe('OCPTool', () => {
    test('tool creation', () => {
      const tool: OCPTool = {
        name: 'test_tool',
        description: 'A test tool',
        method: 'GET',
        path: '/test',
        parameters: { param: { type: 'string' } },
        response_schema: undefined,
        operation_id: undefined,
        tags: [],
      };

      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.method).toBe('GET');
      expect(tool.path).toBe('/test');
      expect(tool.parameters['param'].type).toBe('string');
    });
  });

  describe('OCPAPISpec', () => {
    test('api spec creation', () => {
      const tools: OCPTool[] = [
        {
          name: 'tool1',
          description: 'Description 1',
          method: 'GET',
          path: '/path1',
          parameters: {},
          response_schema: undefined,
          operation_id: undefined,
          tags: [],
        },
        {
          name: 'tool2',
          description: 'Description 2',
          method: 'POST',
          path: '/path2',
          parameters: {},
          response_schema: undefined,
          operation_id: undefined,
          tags: [],
        },
      ];

      const apiSpec: OCPAPISpec = {
        title: 'Test API',
        version: '1.0.0',
        base_url: 'https://api.example.com',
        description: 'A test API for testing purposes',
        tools: tools,
        raw_spec: {},
      };

      expect(apiSpec.title).toBe('Test API');
      expect(apiSpec.version).toBe('1.0.0');
      expect(apiSpec.base_url).toBe('https://api.example.com');
      expect(apiSpec.description).toBe('A test API for testing purposes');
      expect(apiSpec.tools.length).toBe(2);
      expect(apiSpec.tools[0].name).toBe('tool1');
      expect(apiSpec.tools[1].name).toBe('tool2');
    });
  });

  describe('Resource Filtering', () => {
    const openApiSpecWithResources = {
      openapi: '3.0.0',
      info: { title: 'GitHub API', version: '3.0' },
      servers: [{ url: 'https://api.github.com' }],
      paths: {
        '/repos/{owner}/{repo}': {
          get: {
            operationId: 'repos/get',
            summary: 'Get a repository',
            parameters: [
              { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'repo', in: 'path', required: true, schema: { type: 'string' } }
            ],
            responses: { '200': { description: 'Repository details' } }
          }
        },
        '/user/repos': {
          get: {
            operationId: 'repos/listForAuthenticatedUser',
            summary: 'List user repositories',
            responses: { '200': { description: 'List of repositories' } }
          }
        },
        '/repos/{owner}/{repo}/issues': {
          get: {
            operationId: 'issues/listForRepo',
            summary: 'List repository issues',
            parameters: [
              { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'repo', in: 'path', required: true, schema: { type: 'string' } }
            ],
            responses: { '200': { description: 'List of issues' } }
          }
        },
        '/orgs/{org}/members': {
          get: {
            operationId: 'orgs/listMembers',
            summary: 'List organization members',
            parameters: [
              { name: 'org', in: 'path', required: true, schema: { type: 'string' } }
            ],
            responses: { '200': { description: 'List of members' } }
          }
        }
      }
    };

    const toolsWithResources: OCPTool[] = [
      {
        name: 'reposGet',
        description: 'Get a repository',
        method: 'GET',
        path: '/repos/{owner}/{repo}',
        parameters: {},
        operation_id: 'repos/get',
        tags: ['repos']
      },
      {
        name: 'reposListForAuthenticatedUser',
        description: 'List user repositories',
        method: 'GET',
        path: '/user/repos',
        parameters: {},
        operation_id: 'repos/listForAuthenticatedUser',
        tags: ['repos']
      },
      {
        name: 'issuesListForRepo',
        description: 'List repository issues',
        method: 'GET',
        path: '/repos/{owner}/{repo}/issues',
        parameters: {},
        operation_id: 'issues/listForRepo',
        tags: ['issues']
      },
      {
        name: 'orgsListMembers',
        description: 'List organization members',
        method: 'GET',
        path: '/orgs/{org}/members',
        parameters: {},
        operation_id: 'orgs/listMembers',
        tags: ['orgs']
      }
    ];

    test('_filterToolsByResources with single resource', () => {
      const filtered = (discovery as any)._filterToolsByResources(toolsWithResources, ['repos']);
      
      expect(filtered.length).toBe(2); // /repos/{owner}/{repo}, /repos/{owner}/{repo}/issues (NOT /user/repos)
      const paths = new Set(filtered.map((tool: OCPTool) => tool.path));
      expect(paths.has('/repos/{owner}/{repo}')).toBe(true);
      expect(paths.has('/repos/{owner}/{repo}/issues')).toBe(true);
    });

    test('_filterToolsByResources with multiple resources', () => {
      const filtered = (discovery as any)._filterToolsByResources(toolsWithResources, ['repos', 'orgs']);
      
      expect(filtered.length).toBe(3); // /repos/..., /repos/.../issues, /orgs/... (NOT /user/repos)
    });

    test('_filterToolsByResources case insensitive', () => {
      const filtered = (discovery as any)._filterToolsByResources(toolsWithResources, ['REPOS', 'Orgs']);
      
      expect(filtered.length).toBe(3);
    });

    test('_filterToolsByResources with no matches', () => {
      const filtered = (discovery as any)._filterToolsByResources(toolsWithResources, ['payments', 'customers']);
      
      expect(filtered.length).toBe(0);
    });

    test('_filterToolsByResources with empty includeResources', () => {
      const filtered = (discovery as any)._filterToolsByResources(toolsWithResources, []);
      
      expect(filtered.length).toBe(4);
      expect(filtered).toEqual(toolsWithResources);
    });

    test('_filterToolsByResources with undefined includeResources', () => {
      const filtered = (discovery as any)._filterToolsByResources(toolsWithResources, undefined);
      
      expect(filtered.length).toBe(4);
      expect(filtered).toEqual(toolsWithResources);
    });

    test('_filterToolsByResources exact match', () => {
      const tools = [
        { name: 'listPaymentMethods', description: 'List payment methods', method: 'GET', path: '/payment_methods', parameters: {} },
        { name: 'createPaymentIntent', description: 'Create payment intent', method: 'POST', path: '/payment_intents', parameters: {} },
        { name: 'listPayments', description: 'List payments', method: 'GET', path: '/payments', parameters: {} }
      ];
      
      // Filter for "payment" should not match any (no exact segment match)
      const filtered1 = (discovery as any)._filterToolsByResources(tools, ['payment']);
      expect(filtered1.length).toBe(0); // "payment" doesn't exactly match any first segment
      
      // Filter for "payments" should match the exact first segment
      const filtered2 = (discovery as any)._filterToolsByResources(tools, ['payments']);
      expect(filtered2.length).toBe(1);
      expect(filtered2[0].path).toBe('/payments');
      
      // Filter for "payment_methods" should match
      const filtered3 = (discovery as any)._filterToolsByResources(tools, ['payment_methods']);
      expect(filtered3.length).toBe(1);
      expect(filtered3[0].path).toBe('/payment_methods');
    });

    test('_filterToolsByResources with dots', () => {
      const tools = [
        { name: 'conversationsReplies', description: 'Get conversation replies', method: 'GET', path: '/conversations.replies', parameters: {} },
        { name: 'conversationsHistory', description: 'Get conversation history', method: 'GET', path: '/conversations.history', parameters: {} },
        { name: 'chatPostMessage', description: 'Post a message', method: 'POST', path: '/chat.postMessage', parameters: {} }
      ];
      
      // Filter for "conversations" should match both conversation endpoints
      const filtered1 = (discovery as any)._filterToolsByResources(tools, ['conversations']);
      expect(filtered1.length).toBe(2);
      expect(filtered1.every((tool: any) => tool.path.includes('conversations'))).toBe(true);
      
      // Filter for "chat" should match the chat endpoint
      const filtered2 = (discovery as any)._filterToolsByResources(tools, ['chat']);
      expect(filtered2.length).toBe(1);
      expect(filtered2[0].path).toBe('/chat.postMessage');
    });

    test('_filterToolsByResources no substring match', () => {
      const tools = [
        { name: 'listRepos', description: 'List repos', method: 'GET', path: '/repos/{owner}/{repo}', parameters: {} },
        { name: 'listRepositories', description: 'List enterprise repositories', method: 'GET', 
          path: '/enterprises/{enterprise}/code-security/configurations/{config_id}/repositories', parameters: {} }
      ];
      
      // Filter for "repos" should match "/repos/{owner}/{repo}"
      // Should NOT match "/enterprises/.../repositories" (repos != repositories)
      const filtered1 = (discovery as any)._filterToolsByResources(tools, ['repos']);
      expect(filtered1.length).toBe(1);
      expect(filtered1[0].path).toBe('/repos/{owner}/{repo}');
      
      // Filter for "repositories" should not match (first segment is "enterprises")
      const filtered2 = (discovery as any)._filterToolsByResources(tools, ['repositories']);
      expect(filtered2.length).toBe(0);
      
      // Filter for "enterprises" should match the enterprise endpoint
      const filtered3 = (discovery as any)._filterToolsByResources(tools, ['enterprises']);
      expect(filtered3.length).toBe(1);
      expect(filtered3[0].path.includes('/enterprises')).toBe(true);
    });

    test('_filterToolsByResources with path prefix', () => {
      const tools = [
        { name: 'listPayments', description: 'List payments', method: 'GET', path: '/v1/payments', parameters: {} },
        { name: 'createCharge', description: 'Create charge', method: 'POST', path: '/v1/charges', parameters: {} },
        { name: 'legacyPayment', description: 'Legacy payment', method: 'GET', path: '/v2/payments', parameters: {} }
      ];
      
      // Filter for "payments" with /v1 prefix
      const filtered1 = (discovery as any)._filterToolsByResources(tools, ['payments'], '/v1');
      expect(filtered1.length).toBe(1);
      expect(filtered1[0].path).toBe('/v1/payments');
      
      // Filter for "payments" with /v2 prefix
      const filtered2 = (discovery as any)._filterToolsByResources(tools, ['payments'], '/v2');
      expect(filtered2.length).toBe(1);
      expect(filtered2[0].path).toBe('/v2/payments');
      
      // Filter without prefix - no matches (first segment is "v1" or "v2")
      const filtered3 = (discovery as any)._filterToolsByResources(tools, ['payments']);
      expect(filtered3.length).toBe(0);
    });

    test('_filterToolsByResources first segment only', () => {
      const tools = [
        { name: 'listRepoIssues', description: 'List repo issues', method: 'GET', path: '/repos/{owner}/{repo}/issues', parameters: {} },
        { name: 'listUserRepos', description: 'List user repos', method: 'GET', path: '/user/repos', parameters: {} }
      ];
      
      // Filter for "repos" - should match /repos/... but NOT /user/repos (first segment is "user")
      const filtered1 = (discovery as any)._filterToolsByResources(tools, ['repos']);
      expect(filtered1.length).toBe(1);
      expect(filtered1[0].path).toBe('/repos/{owner}/{repo}/issues');
      
      // Filter for "user" - should match /user/repos
      const filtered2 = (discovery as any)._filterToolsByResources(tools, ['user']);
      expect(filtered2.length).toBe(1);
      expect(filtered2[0].path).toBe('/user/repos');
      
      // Filter for "issues" - should NOT match anything (issues is not first segment)
      const filtered3 = (discovery as any)._filterToolsByResources(tools, ['issues']);
      expect(filtered3.length).toBe(0);
    });

    test('discoverApi with includeResources parameter', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => openApiSpecWithResources,
      } as Response);

      const apiSpec = await discovery.discoverApi(
        'https://api.github.com/openapi.json',
        undefined,
        ['repos']
      );

      expect(apiSpec.tools.length).toBe(2);
      expect(apiSpec.tools.every(tool => tool.path.toLowerCase().startsWith('/repos'))).toBe(true);
    });

    test('discoverApi with multiple includeResources', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => openApiSpecWithResources,
      } as Response);

      const apiSpec = await discovery.discoverApi(
        'https://api.github.com/openapi.json',
        undefined,
        ['repos', 'orgs']
      );

      expect(apiSpec.tools.length).toBe(3);
    });

    test('discoverApi without includeResources returns all tools', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => openApiSpecWithResources,
      } as Response);

      const apiSpec = await discovery.discoverApi('https://api.github.com/openapi.json');

      expect(apiSpec.tools.length).toBe(4);
    });
  });
});
