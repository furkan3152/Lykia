/**
 * A small zod (v3 API) to JSON Schema (draft 2020-12, as used by OpenAPI
 * 3.1) converter. It covers what the API's request and response schemas use:
 * objects (strict or not), strings with formats and patterns, numbers,
 * booleans, enums, literals, arrays, tuples, unions (discriminated or not),
 * intersections, records, optional / nullable / default, effects
 * (refine, transform, preprocess: the input side is documented) and pipes.
 * Anything else becomes `{}` (any value), never an error.
 */
import type { ZodTypeAny } from "zod";

export type JsonSchema = { [key: string]: unknown };

interface Def {
  readonly typeName?: string;
  readonly [key: string]: unknown;
}

function defOf(schema: ZodTypeAny): Def {
  return (schema as unknown as { _def: Def })._def;
}

function withDescription(schema: ZodTypeAny, out: JsonSchema): JsonSchema {
  const description = (schema as unknown as { description?: string }).description;
  return description ? { ...out, description } : out;
}

function stringSchema(def: Def): JsonSchema {
  const out: JsonSchema = { type: "string" };
  for (const check of (def.checks as { kind: string; value?: unknown; regex?: RegExp }[] | undefined) ?? []) {
    switch (check.kind) {
      case "min":
        out.minLength = check.value;
        break;
      case "max":
        out.maxLength = check.value;
        break;
      case "length":
        out.minLength = check.value;
        out.maxLength = check.value;
        break;
      case "regex":
        if (check.regex) out.pattern = check.regex.source;
        break;
      case "email":
        out.format = "email";
        break;
      case "url":
        out.format = "uri";
        break;
      case "uuid":
        out.format = "uuid";
        break;
      case "datetime":
        out.format = "date-time";
        break;
      case "date":
        out.format = "date";
        break;
      case "ip":
        out.format = "ip";
        break;
      default:
        break;
    }
  }
  return out;
}

function numberSchema(def: Def): JsonSchema {
  const out: JsonSchema = { type: "number" };
  for (const check of (def.checks as { kind: string; value?: number; inclusive?: boolean }[] | undefined) ?? []) {
    if (check.kind === "int") out.type = "integer";
    else if (check.kind === "min") out[check.inclusive === false ? "exclusiveMinimum" : "minimum"] = check.value;
    else if (check.kind === "max") out[check.inclusive === false ? "exclusiveMaximum" : "maximum"] = check.value;
    else if (check.kind === "multipleOf") out.multipleOf = check.value;
  }
  return out;
}

/** True when the schema accepts `undefined` (optional or defaulted), so the property is not required. */
export function isOptional(schema: ZodTypeAny): boolean {
  const def = defOf(schema);
  if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") return true;
  if (def.typeName === "ZodEffects") return isOptional(def.schema as ZodTypeAny);
  if (def.typeName === "ZodNullable") return isOptional(def.innerType as ZodTypeAny);
  try {
    return schema.safeParse(undefined).success;
  } catch {
    return false;
  }
}

export function zodToJsonSchema(schema: ZodTypeAny | undefined, depth = 0): JsonSchema {
  if (!schema || depth > 24) return {};
  const def = defOf(schema);
  const recur = (s: unknown) => zodToJsonSchema(s as ZodTypeAny, depth + 1);
  let out: JsonSchema;
  switch (def.typeName) {
    case "ZodString":
      out = stringSchema(def);
      break;
    case "ZodNumber":
      out = numberSchema(def);
      break;
    case "ZodBigInt":
      out = { type: "string", pattern: "^-?\\d+$" };
      break;
    case "ZodBoolean":
      out = { type: "boolean" };
      break;
    case "ZodDate":
      out = { type: "string", format: "date-time" };
      break;
    case "ZodNull":
      out = { type: "null" };
      break;
    case "ZodLiteral":
      out = { const: def.value };
      break;
    case "ZodEnum":
      out = { type: "string", enum: [...(def.values as string[])] };
      break;
    case "ZodNativeEnum":
      {
        const values = def.values as Record<string, string | number>;
        out = { enum: Object.keys(values).filter((k) => typeof values[values[k] as string] !== "number").map((k) => values[k]) };
      }
      break;
    case "ZodArray": {
      out = { type: "array", items: recur(def.type) };
      const min = def.minLength as { value: number } | null;
      const max = def.maxLength as { value: number } | null;
      const exact = def.exactLength as { value: number } | null;
      if (min) out.minItems = min.value;
      if (max) out.maxItems = max.value;
      if (exact) {
        out.minItems = exact.value;
        out.maxItems = exact.value;
      }
      break;
    }
    case "ZodTuple":
      out = { type: "array", prefixItems: (def.items as ZodTypeAny[]).map(recur), minItems: (def.items as ZodTypeAny[]).length, ...(def.rest ? { items: recur(def.rest) } : { maxItems: (def.items as ZodTypeAny[]).length }) };
      break;
    case "ZodSet":
      out = { type: "array", uniqueItems: true, items: recur(def.valueType) };
      break;
    case "ZodObject": {
      const shape = (typeof def.shape === "function" ? (def.shape as () => Record<string, ZodTypeAny>)() : (def.shape as Record<string, ZodTypeAny>)) ?? {};
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [name, value] of Object.entries(shape)) {
        properties[name] = recur(value);
        if (!isOptional(value)) required.push(name);
      }
      out = { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
      const catchall = def.catchall as ZodTypeAny | undefined;
      const catchallName = catchall ? defOf(catchall).typeName : undefined;
      if (catchall && catchallName !== "ZodNever") out.additionalProperties = recur(catchall);
      else if (def.unknownKeys === "strict") out.additionalProperties = false;
      break;
    }
    case "ZodRecord":
      out = { type: "object", additionalProperties: recur(def.valueType) };
      break;
    case "ZodMap":
      out = { type: "object", additionalProperties: recur(def.valueType) };
      break;
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = (Array.isArray(def.options) ? def.options : [...(def.options as Map<unknown, ZodTypeAny>).values()]) as ZodTypeAny[];
      out = { anyOf: options.map(recur) };
      break;
    }
    case "ZodIntersection":
      out = { allOf: [recur(def.left), recur(def.right)] };
      break;
    case "ZodOptional":
      out = recur(def.innerType);
      break;
    case "ZodNullable": {
      const inner = recur(def.innerType);
      out = typeof inner.type === "string" && Object.keys(inner).length <= 3 && !("enum" in inner) ? { ...inner, type: [inner.type, "null"] } : { anyOf: [inner, { type: "null" }] };
      break;
    }
    case "ZodDefault": {
      const inner = recur(def.innerType);
      let value: unknown;
      try {
        value = (def.defaultValue as () => unknown)();
      } catch {
        value = undefined;
      }
      out = value === undefined ? inner : { ...inner, default: value };
      break;
    }
    case "ZodCatch":
    case "ZodReadonly":
    case "ZodBranded":
      out = recur(def.innerType ?? def.type);
      break;
    case "ZodLazy":
      out = depth > 8 ? {} : recur((def.getter as () => ZodTypeAny)());
      break;
    case "ZodEffects":
      out = recur(def.schema);
      break;
    case "ZodPipeline":
      out = recur(def.in);
      break;
    case "ZodPromise":
      out = recur(def.type);
      break;
    default:
      out = {};
  }
  return withDescription(schema, out);
}
