/**
 * Schema Validation - JSON schema validation for OCP context objects.
 * 
 * Validates agent contexts against the OCP specification schemas.
 */

import { Validator } from 'jsonschema';
import { AgentContext } from './context.js';
import ocpContextSchema from './schemas/ocp-context.json' with { type: 'json' };

// Load schema from braided specification file
export const OCP_CONTEXT_SCHEMA = ocpContextSchema;

// Create validator instance
const validator = new Validator();

/**
 * Result of schema validation.
 * 
 * Provides validation status and error details for OCP context validation.
 * Supports boolean conversion for simple valid/invalid checks.
 */
export class ValidationResult {
  public valid: boolean;
  public errors: string[];

  constructor(valid: boolean, errors?: string[]) {
    this.valid = valid;
    this.errors = errors || [];
  }

  valueOf(): boolean {
    return this.valid;
  }

  toString(): string {
    if (this.valid) {
      return 'Valid OCP context';
    }
    return `Invalid OCP context: ${this.errors.join('; ')}`;
  }
}

/**
 * Validate an AgentContext against the OCP schema
 */
export function validateContext(context: AgentContext): ValidationResult {
  try {
    const contextDict = context.toDict();
    return validateContextDict(contextDict);
  } catch (e) {
    return new ValidationResult(false, [`Validation error: ${e}`]);
  }
}

/**
 * Validate a context dictionary against the OCP schema
 */
export function validateContextDict(contextDict: Record<string, any>): ValidationResult {
  try {
    const result = validator.validate(contextDict, OCP_CONTEXT_SCHEMA);
    
    if (result.valid) {
      return new ValidationResult(true);
    }
    
    const errors = result.errors.map(err => err.toString());
    return new ValidationResult(false, errors);
  } catch (e) {
    return new ValidationResult(false, [`Validation error: ${e}`]);
  }
}

/**
 * Get the OCP context JSON schema
 */
export function getSchema(): Record<string, any> {
  return { ...OCP_CONTEXT_SCHEMA };
}

/**
 * Validate and attempt to fix a context object
 */
export function validateAndFixContext(context: AgentContext): [AgentContext, ValidationResult] {
  // Make a copy to avoid modifying original
  const fixed = AgentContext.fromDict(context.toDict());
  
  // Fix common issues
  if (!fixed.context_id.startsWith('ocp-')) {
    fixed.context_id = `ocp-${fixed.context_id}`;
  }
  
  // Ensure required collections exist
  if (typeof fixed.session !== 'object' || fixed.session === null) {
    fixed.session = {};
  }
  
  if (!Array.isArray(fixed.history)) {
    fixed.history = [];
  }
  
  if (typeof fixed.api_specs !== 'object' || fixed.api_specs === null) {
    fixed.api_specs = {};
  }
  
  // Validate the fixed context
  const result = validateContext(fixed);
  
  return [fixed, result];
}
