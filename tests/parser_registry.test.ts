/**
 * Tests for parser registry functionality.
 */

import { ParserRegistry, OpenAPIParser } from '../src/parsers/index.js';

describe('ParserRegistry', () => {
  test('registry initialization empty', () => {
    const registry = new ParserRegistry(false);
    expect(registry.getParserCount()).toBe(0);
    expect(registry.getSupportedFormats()).toEqual([]);
  });

  test('registry initialization with builtin', () => {
    const registry = new ParserRegistry(true);
    expect(registry.getParserCount()).toBeGreaterThan(0);
    expect(registry.getSupportedFormats()).toContain('OpenAPI');
  });

  test('register parser', () => {
    const registry = new ParserRegistry(false);
    const parser = new OpenAPIParser();
    
    registry.register(parser);
    
    expect(registry.getParserCount()).toBe(1);
    expect(registry.getSupportedFormats()).toContain('OpenAPI');
  });

  test('find parser OpenAPI', () => {
    const registry = new ParserRegistry(true);
    const openapi3Spec = {
      openapi: '3.0.0',
      info: {title: 'Test', version: '1.0.0'},
      paths: {}
    };
    
    const parser = registry.findParser(openapi3Spec);
    expect(parser).not.toBeNull();
    expect(parser!.getFormatName()).toBe('OpenAPI');
  });

  test('find parser Swagger', () => {
    const registry = new ParserRegistry(true);
    const swagger2Spec = {
      swagger: '2.0',
      info: {title: 'Test', version: '1.0.0'},
      paths: {}
    };
    
    const parser = registry.findParser(swagger2Spec);
    expect(parser).not.toBeNull();
    expect(parser!.getFormatName()).toBe('OpenAPI');
  });

  test('find parser no match', () => {
    const registry = new ParserRegistry(true);
    const unknownSpec = {
      someFormat: '1.0',
      data: {}
    };
    
    const parser = registry.findParser(unknownSpec);
    expect(parser).toBeNull();
  });

  test('multiple parsers registration', () => {
    const registry = new ParserRegistry(false);
    const parser1 = new OpenAPIParser();
    
    registry.register(parser1);
    
    expect(registry.getParserCount()).toBe(1);
    const formats = registry.getSupportedFormats();
    expect(formats).toContain('OpenAPI');
  });

  test('parser order matters', () => {
    const registry = new ParserRegistry(false);
    const parser1 = new OpenAPIParser();
    registry.register(parser1);
    
    const openapi3Spec = {
      openapi: '3.0.0',
      info: {title: 'Test', version: '1.0.0'},
      paths: {}
    };
    
    const foundParser = registry.findParser(openapi3Spec);
    expect(foundParser).not.toBeNull();
    expect(foundParser!.getFormatName()).toBe('OpenAPI');
  });
});
