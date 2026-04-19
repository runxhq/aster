import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

export const RUNX_CONTROL_SCHEMA_ARTIFACTS = {
  verification_profile_catalog: {
    ref: "https://runx.ai/spec/governance/verification-profile.schema.json",
    file: "spec/verification-profile.schema.json",
  },
  workspace_change_plan_request: {
    ref: "urn:aster:schema:workspace-change-plan-request:v1",
    file: "spec/workspace-change-plan-request.schema.json",
  },
  issue_to_pr_request: {
    ref: "urn:aster:schema:issue-to-pr-request:v1",
    file: "spec/issue-to-pr-request.schema.json",
  },
  worker_request: {
    ref: "urn:aster:schema:worker-request:v1",
    file: "spec/worker-request.schema.json",
  },
  verification_report: {
    ref: "https://runx.ai/spec/governance/verification-report.schema.json",
    file: "spec/verification-report.schema.json",
  },
  aster_control: {
    ref: "urn:aster:schema:aster-control:v1",
    file: "spec/aster-control.schema.json",
  },
  selector_training_row: {
    ref: "urn:aster:schema:selector-training-row:v1",
    file: "spec/selector-training-row.schema.json",
  },
};

const schemaCache = new Map();

export function loadRunxControlSchemaSync(name, repoRoot = defaultRepoRoot) {
  const artifact = RUNX_CONTROL_SCHEMA_ARTIFACTS[name];
  if (!artifact) {
    throw new Error(`Unknown runx control schema '${name}'.`);
  }

  const schemaPath = path.join(path.resolve(repoRoot), artifact.file);
  const cached = schemaCache.get(schemaPath);
  if (cached) {
    return cached;
  }

  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  schemaCache.set(schemaPath, schema);
  return schema;
}

export function assertMatchesRunxControlSchema(name, value, options = {}) {
  const artifact = RUNX_CONTROL_SCHEMA_ARTIFACTS[name];
  if (!artifact) {
    throw new Error(`Unknown runx control schema '${name}'.`);
  }

  const label = options.label ?? name;
  const schema = loadRunxControlSchemaSync(name, options.repoRoot);

  try {
    assertSchema(value, schema, {
      label,
      rootSchema: schema,
      repoRoot: options.repoRoot ?? defaultRepoRoot,
    });
  } catch (error) {
    throw new Error(`${label} must match ${artifact.ref}: ${error.message}`);
  }

  return value;
}

function assertSchema(value, schema, state) {
  if (schema === true) {
    return;
  }
  if (schema === false) {
    throw new Error(`${state.label} is not allowed.`);
  }

  if (!isRecord(schema)) {
    throw new Error(`schema definition for ${state.label} must be an object.`);
  }

  if (schema.$ref) {
    const resolved = resolveSchemaRef(schema.$ref, state);
    return assertSchema(value, resolved.schema, {
      ...state,
      rootSchema: resolved.rootSchema,
    });
  }

  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) {
    throw new Error(`${state.label} must equal ${JSON.stringify(schema.const)}.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => isDeepStrictEqual(entry, value))) {
    throw new Error(`${state.label} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}.`);
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    throw new Error(`${state.label} must be ${formatType(schema.type)}.`);
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      throw new Error(`${state.label} must be at least ${schema.minLength} character(s).`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      throw new Error(`${state.label} must match pattern ${schema.pattern}.`);
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      throw new Error(`${state.label} must be a valid date-time string.`);
    }
  }

  if (typeof value === "number") {
    if (schema.type === "integer" && !Number.isInteger(value)) {
      throw new Error(`${state.label} must be an integer.`);
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      throw new Error(`${state.label} must be >= ${schema.minimum}.`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      throw new Error(`${state.label} must be <= ${schema.maximum}.`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      throw new Error(`${state.label} must contain at least ${schema.minItems} item(s).`);
    }
    if (schema.items !== undefined) {
      value.forEach((entry, index) => {
        assertSchema(entry, schema.items, {
          ...state,
          label: `${state.label}[${index}]`,
        });
      });
    }
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) {
      throw new Error(`${state.label} must declare at least ${schema.minProperties} propert${schema.minProperties === 1 ? "y" : "ies"}.`);
    }

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          throw new Error(`${state.label}.${key} is required.`);
        }
      }
    }

    if (schema.propertyNames !== undefined) {
      for (const key of keys) {
        assertSchema(key, schema.propertyNames, {
          ...state,
          label: `${state.label} property '${key}'`,
        });
      }
    }

    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        assertSchema(value[key], propertySchema, {
          ...state,
          label: `${state.label}.${key}`,
        });
      }
    }

    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        continue;
      }
      if (schema.additionalProperties === false) {
        throw new Error(`${state.label}.${key} is not allowed.`);
      }
      if (schema.additionalProperties && schema.additionalProperties !== true) {
        assertSchema(value[key], schema.additionalProperties, {
          ...state,
          label: `${state.label}.${key}`,
        });
      }
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const anyMatch = schema.anyOf.some((candidate) => {
      try {
        assertSchema(value, candidate, state);
        return true;
      } catch {
        return false;
      }
    });
    if (!anyMatch) {
      throw new Error(`${state.label} must match at least one permitted schema branch.`);
    }
  }

  if (Array.isArray(schema.oneOf)) {
    let matches = 0;
    let firstError;
    for (const candidate of schema.oneOf) {
      try {
        assertSchema(value, candidate, state);
        matches += 1;
      } catch (error) {
        if (!firstError) {
          firstError = error;
        }
      }
    }
    if (matches !== 1) {
      if (schema.oneOf.length === 1 && firstError) {
        throw firstError;
      }
      throw new Error(`${state.label} must match exactly one schema branch.`);
    }
  }
}

function resolveSchemaRef(ref, state) {
  if (ref.startsWith("#")) {
    return {
      schema: resolveJsonPointer(state.rootSchema, ref),
      rootSchema: state.rootSchema,
    };
  }

  const [baseRef, pointer] = ref.split("#", 2);
  const artifactEntry = Object.values(RUNX_CONTROL_SCHEMA_ARTIFACTS).find((artifact) => artifact.ref === baseRef)
    ?? Object.values(RUNX_CONTROL_SCHEMA_ARTIFACTS).find((artifact) => artifact.file.endsWith(path.basename(baseRef)));
  if (!artifactEntry) {
    throw new Error(`unsupported schema reference '${ref}'.`);
  }

  const rootSchema = JSON.parse(readFileSync(path.join(path.resolve(state.repoRoot), artifactEntry.file), "utf8"));
  const pointerRef = pointer
    ? `#${pointer.startsWith("/") ? pointer : `/${pointer}`}`
    : null;
  return {
    schema: pointerRef ? resolveJsonPointer(rootSchema, pointerRef) : rootSchema,
    rootSchema,
  };
}

function resolveJsonPointer(document, ref) {
  const segments = ref.replace(/^#\//, "").split("/").map(unescapeJsonPointerSegment);
  let current = document;
  for (const segment of segments) {
    if (!isRecord(current) && !Array.isArray(current)) {
      throw new Error(`unable to resolve schema pointer '${ref}'.`);
    }
    current = current[segment];
  }
  if (current === undefined) {
    throw new Error(`unable to resolve schema pointer '${ref}'.`);
  }
  return current;
}

function unescapeJsonPointerSegment(value) {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function matchesType(value, schemaType) {
  const allowedTypes = Array.isArray(schemaType) ? schemaType : [schemaType];
  return allowedTypes.some((type) => matchesSingleType(value, type));
}

function matchesSingleType(value, type) {
  if (type === "null") {
    return value === null;
  }
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return isPlainObject(value);
  }
  if (type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  return typeof value === type;
}

function formatType(schemaType) {
  const allowedTypes = Array.isArray(schemaType) ? schemaType : [schemaType];
  return allowedTypes.join(" or ");
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value) {
  return isPlainObject(value);
}
