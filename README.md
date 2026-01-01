# OCP JavaScript Library

Context-aware HTTP client framework for AI agents.

## Installation

```bash
npm install @opencontextprotocol/agent
# or with yarn
yarn add @opencontextprotocol/agent
```

## Quick Start

```typescript
import { OCPAgent } from '@opencontextprotocol/agent';

// Create an OCP agent
const agent = new OCPAgent(
    'api_explorer',
    'your-username',
    'my-project',
    'Explore GitHub API'
);

// Register an API from the registry (fast lookup)
const githubApi = await agent.registerApi('github');

// Or register from OpenAPI specification URL
// const githubApi = await agent.registerApi(
//     'github',
//     'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json'
// );

// List available tools
const tools = agent.listTools('github');
console.log(`Found ${tools.length} GitHub API tools`);

// Call a tool
const result = await agent.callTool(
    'usersGetAuthenticated',
    undefined,
    'github'
);
console.log(result);
```

## API Registration & Authentication

The `registerApi()` method supports multiple patterns:

```typescript
// 1. Registry lookup - fastest, uses community registry
const githubApi = await agent.registerApi('github');

// 2. Registry lookup with authentication
const githubApi = await agent.registerApi(
    'github',
    undefined,
    undefined,
    { 'Authorization': 'token ghp_your_token_here' }
);

// 3. Registry lookup with base URL override (e.g., GitHub Enterprise)
const gheApi = await agent.registerApi(
    'github',
    undefined,
    'https://github.company.com/api/v3',
    { 'Authorization': 'token ghp_enterprise_token' }
);

// 4. Direct OpenAPI spec URL
const api = await agent.registerApi(
    'my-api',
    'https://api.example.com/openapi.json'
);

// 5. Direct OpenAPI spec with base URL override and authentication
const api = await agent.registerApi(
    'my-api',
    'https://api.example.com/openapi.json',
    'https://staging-api.example.com',  // Override for testing
    { 'X-API-Key': 'your_api_key_here' }
);

// 6. Local OpenAPI file (JSON or YAML)
const api = await agent.registerApi(
    'local-api',
    'file:///path/to/openapi.yaml',
    'http://localhost:8000'
);

// Headers are automatically included in all tool calls
const result = await agent.callTool('usersGetAuthenticated', undefined, 'github');
```

## Core Components

- **OCPAgent**: Main agent class with API discovery and tool invocation
- **AgentContext**: Context management with persistent conversation tracking
- **OCPHTTPClient**: Context-aware HTTP client wrapper
- **OCPSchemaDiscovery**: OpenAPI specification parsing and tool extraction
- **Headers**: OCP context encoding/decoding for HTTP headers
- **Validation**: JSON schema validation for context objects

## API Reference

### OCPAgent

```typescript
const agent = new OCPAgent(agentType, user?, workspace?, agentGoal?, registryUrl?, enableCache?);
await agent.registerApi(name, specUrl?, baseUrl?, headers?);
agent.listTools(apiName?);
await agent.callTool(toolName, parameters?, apiName?);
```

### AgentContext

```typescript
const context = new AgentContext({ agent_type, user?, workspace? });
context.addInteraction(action, apiEndpoint?, result?, metadata?);
context.updateGoal(newGoal, summary?);
context.toDict();
```

### HTTP Client

```typescript
import { OCPHTTPClient, AgentContext } from '@opencontextprotocol/agent';

// Create context
const context = new AgentContext({
    agent_type: 'api_client',
    user: 'username',
    workspace: 'project'
});

// Create OCP-aware HTTP client
const client = new OCPHTTPClient(context, true, 'https://api.example.com');

// Make requests with automatic OCP context headers
const response = await client.request('GET', '/endpoint');
```

## Development

```bash
# Clone repository
git clone https://github.com/opencontextprotocol/ocp-javascript.git
cd ocp-javascript

# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm test -- --coverage

# Build for distribution
npm run build

# Run specific test file
npm test context.test.ts
```

## Project Structure

```
src/
├── index.ts             # Public API exports
├── agent.ts             # OCPAgent class
├── context.ts           # AgentContext class  
├── http_client.ts       # HTTP client wrappers
├── headers.ts           # Header encoding/decoding
├── schema_discovery.ts  # OpenAPI parsing
├── registry.ts          # Registry client
├── validation.ts        # JSON schema validation
└── errors.ts            # Error classes

tests/
├── agent.test.ts        # OCPAgent tests
├── context.test.ts      # AgentContext tests
├── http_client.test.ts  # HTTP client tests
├── headers.test.ts      # Header tests
├── schema_discovery.test.ts # Schema parsing tests
├── registry.test.ts     # Registry tests
└── validation.test.ts   # Validation tests
```

## TypeScript Support

This library is written in TypeScript and includes full type definitions. All exports are fully typed for excellent IDE support and type safety.

## License

MIT License - see LICENSE file.
