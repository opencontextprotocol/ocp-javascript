/**
 * Tests for OpenAPI parser functionality.
 */

import { OpenAPIParser } from '../src/parsers/openapi_parser.js';
import { OCPTool } from '../src/parsers/base.js';
import { SchemaDiscoveryError } from '../src/errors.js';

describe('OpenAPIParser', () => {
  let parser: OpenAPIParser;
  let sampleOpenapi3Spec: any;
  let swagger2Spec: any;

  beforeEach(() => {
    parser = new OpenAPIParser();

    sampleOpenapi3Spec = {
      openapi: '3.0.0',
      info: {
        title: 'Test API',
        version: '1.0.0',
        description: 'A test API'
      },
      servers: [{url: 'https://api.example.com'}],
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            summary: 'List users',
            parameters: [
              {
                name: 'limit',
                in: 'query',
                schema: {type: 'integer'},
                required: false
              }
            ],
            responses: {
              '200': {
                description: 'List of users',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {type: 'object'}
                    }
                  }
                }
              }
            }
          },
          post: {
            operationId: 'createUser',
            summary: 'Create user',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: {type: 'string'},
                      email: {type: 'string'}
                    },
                    required: ['name', 'email']
                  }
                }
              }
            },
            responses: {
              '201': {description: 'User created'}
            }
          }
        }
      }
    };

    swagger2Spec = {
      swagger: '2.0',
      info: {
        title: 'Swagger API',
        version: '1.0.0'
      },
      host: 'api.example.com',
      basePath: '/v1',
      schemes: ['https'],
      paths: {
        '/users': {
          get: {
            operationId: 'getUsers',
            summary: 'Get users',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                type: 'string'
              }
            ],
            responses: {
              '200': {
                description: 'User details',
                schema: {
                  type: 'object',
                  properties: {
                    id: {type: 'string'},
                    name: {type: 'string'}
                  }
                }
              }
            }
          },
          post: {
            operationId: 'createUser',
            summary: 'Create user',
            parameters: [
              {
                name: 'body',
                in: 'body',
                required: true,
                schema: {
                  type: 'object',
                  properties: {
                    name: {type: 'string'},
                    email: {type: 'string'}
                  },
                  required: ['name', 'email']
                }
              }
            ],
            responses: {
              '201': {description: 'User created'}
            }
          }
        }
      }
    };
  });

  // Parser detection tests
  test('can parse OpenAPI 3.x', () => {
    const spec = {openapi: '3.0.0', info: {}, paths: {}};
    expect(parser.canParse(spec)).toBe(true);
  });

  test('can parse Swagger 2.0', () => {
    const spec = {swagger: '2.0', info: {}, paths: {}};
    expect(parser.canParse(spec)).toBe(true);
  });

  test('cannot parse unknown', () => {
    const spec = {someformat: '1.0', data: {}};
    expect(parser.canParse(spec)).toBe(false);
  });

  test('get format name', () => {
    expect(parser.getFormatName()).toBe('OpenAPI');
  });

  // Version detection tests
  test('detect OpenAPI 3.0', () => {
    const spec = {openapi: '3.0.0'};
    const version = parser['detectSpecVersion'](spec);
    expect(version).toBe('openapi_3.0');
  });

  test('detect OpenAPI 3.1', () => {
    const spec = {openapi: '3.1.0'};
    const version = parser['detectSpecVersion'](spec);
    expect(version).toBe('openapi_3.1');
  });

  test('detect Swagger 2', () => {
    const spec = {swagger: '2.0'};
    const version = parser['detectSpecVersion'](spec);
    expect(version).toBe('swagger_2');
  });

  test('detect unsupported version', () => {
    const spec = {openapi: '4.0.0'};
    expect(() => parser['detectSpecVersion'](spec)).toThrow(SchemaDiscoveryError);
  });

  // OpenAPI 3.x parsing tests
  test('parse OpenAPI 3.x spec', () => {
    const apiSpec = parser.parse(sampleOpenapi3Spec);
    
    expect(apiSpec.title).toBe('Test API');
    expect(apiSpec.version).toBe('1.0.0');
    expect(apiSpec.description).toBe('A test API');
    expect(apiSpec.base_url).toBe('https://api.example.com');
    expect(apiSpec.tools.length).toBe(2);
  });

  test('parse OpenAPI 3.x tools', () => {
    const apiSpec = parser.parse(sampleOpenapi3Spec);
    
    const getTool = apiSpec.tools.find(t => t.method === 'GET');
    expect(getTool).not.toBeNull();
    expect(getTool!.name).toBe('listUsers');
    expect(getTool!.path).toBe('/users');
    expect('limit' in getTool!.parameters).toBe(true);
    
    const postTool = apiSpec.tools.find(t => t.method === 'POST');
    expect(postTool).not.toBeNull();
    expect(postTool!.name).toBe('createUser');
    expect('name' in postTool!.parameters).toBe(true);
    expect('email' in postTool!.parameters).toBe(true);
    expect(postTool!.parameters['name']['required']).toBe(true);
  });

  // Swagger 2.0 parsing tests
  test('parse Swagger 2.0 spec', () => {
    const apiSpec = parser.parse(swagger2Spec);
    
    expect(apiSpec.title).toBe('Swagger API');
    expect(apiSpec.version).toBe('1.0.0');
    expect(apiSpec.base_url).toBe('https://api.example.com/v1');
    expect(apiSpec.tools.length).toBe(2);
  });

  test('Swagger 2.0 base URL extraction', () => {
    const apiSpec = parser.parse(swagger2Spec);
    expect(apiSpec.base_url).toBe('https://api.example.com/v1');
  });

  test('Swagger 2.0 body parameters', () => {
    const apiSpec = parser.parse(swagger2Spec);
    
    const postTool = apiSpec.tools.find(t => t.method === 'POST');
    expect(postTool).not.toBeNull();
    expect('name' in postTool!.parameters).toBe(true);
    expect('email' in postTool!.parameters).toBe(true);
    expect(postTool!.parameters['name']['location']).toBe('body');
  });

  // Tool name normalization tests
  test('normalize tool name slash separators', () => {
    expect(parser['normalizeToolName']('meta/root')).toBe('metaRoot');
    expect(parser['normalizeToolName']('repos/disable-vulnerability-alerts')).toBe('reposDisableVulnerabilityAlerts');
  });

  test('normalize tool name underscore separators', () => {
    expect(parser['normalizeToolName']('admin_apps_approve')).toBe('adminAppsApprove');
    expect(parser['normalizeToolName']('get_users_list')).toBe('getUsersList');
  });

  test('normalize tool name pascal case', () => {
    expect(parser['normalizeToolName']('FetchAccount')).toBe('fetchAccount');
    expect(parser['normalizeToolName']('GetUserProfile')).toBe('getUserProfile');
  });

  test('normalize tool name numbers', () => {
    expect(parser['normalizeToolName']('v2010/Accounts')).toBe('v2010Accounts');
  });

  test('normalize tool name acronyms', () => {
    expect(parser['normalizeToolName']('SMS/send')).toBe('smsSend');
  });

  test('valid tool name', () => {
    expect(parser['isValidToolName']('metaRoot')).toBe(true);
    expect(parser['isValidToolName']('getUsersList')).toBe(true);
    expect(parser['isValidToolName']('')).toBe(false);
    expect(parser['isValidToolName']('123invalid')).toBe(false);
    expect(parser['isValidToolName']('___')).toBe(false);
  });

  // Resource filtering tests
  test('filter tools by resources', () => {
    const tools: OCPTool[] = [
      {name: 'reposGet', description: 'Get repo', method: 'GET', path: '/repos/{owner}', parameters: {}, response_schema: undefined},
      {name: 'issuesGet', description: 'Get issue', method: 'GET', path: '/issues/{id}', parameters: {}, response_schema: undefined}
    ];
    
    const filtered = parser['filterToolsByResources'](tools, ['repos']);
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('reposGet');
  });

  test('filter tools case insensitive', () => {
    const tools: OCPTool[] = [
      {name: 'reposGet', description: 'Get repo', method: 'GET', path: '/repos/{owner}', parameters: {}, response_schema: undefined}
    ];
    
    const filtered = parser['filterToolsByResources'](tools, ['REPOS']);
    expect(filtered.length).toBe(1);
  });

  test('filter tools with path prefix', () => {
    const tools: OCPTool[] = [
      {name: 'paymentsGet', description: 'Get payment', method: 'GET', path: '/v1/payments', parameters: {}, response_schema: undefined}
    ];
    
    const filtered = parser['filterToolsByResources'](tools, ['payments'], '/v1');
    expect(filtered.length).toBe(1);
  });

  // Base URL override tests
  test('base URL override', () => {
    const apiSpec = parser.parse(sampleOpenapi3Spec, 'https://custom.api.com');
    expect(apiSpec.base_url).toBe('https://custom.api.com');
  });

  // Resource filtering integration test
  test('parse with resource filtering', () => {
    const spec = {
      ...sampleOpenapi3Spec,
      paths: {
        ...sampleOpenapi3Spec.paths,
        '/repos/{id}': {
          get: {
            operationId: 'getRepo',
            summary: 'Get repo',
            responses: {'200': {description: 'OK'}}
          }
        }
      }
    };
    
    const apiSpec = parser.parse(spec, undefined, ['users']);
    expect(apiSpec.tools.length).toBe(2);
    expect(apiSpec.tools.every(tool => tool.path.includes('/users'))).toBe(true);
  });
});
