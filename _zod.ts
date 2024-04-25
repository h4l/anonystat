import { z } from "./deps.ts";

const oneOrMoreTypeName = "OneOrMore";

export interface OneOrMoreDef<
  T extends z.ZodTypeAny = z.ZodTypeAny,
> extends z.ZodTypeDef {
  type: z.ZodEffects<T, T[]>;
  arrayType: z.ZodArray<T>;
  typeName: typeof oneOrMoreTypeName;
}

type OneOrMoreOutput<T extends z.ZodTypeAny> = z.ZodArray<T>;

/** A Zod schema that matches a single value or an array of the same values.
 *
 * The difference from a .or() union is that errors are only reported for one of
 * the possible inputs, not both, so parse errors are clear.
 *
 * The type schema cannot itself be an array type.
 */
export class OneOrMore<T extends z.ZodTypeAny> extends z.ZodType<
  OneOrMoreOutput<T>["_output"],
  OneOrMoreDef<T>,
  z.ZodUnion<[T, OneOrMoreOutput<T>]>["_input"]
> {
  _parse(
    input: z.ParseInput,
  ): z.ParseReturnType<this["_output"]> {
    const { ctx } = this._processInputParams(input);
    if (ctx.common.async) throw new Error("async parse not implemented");

    // Unlike a .or() union, we only attempt to parse with a single schema. We
    // assume the input is a single value unless it's an array.
    const schema = Array.isArray(input.data)
      ? this._def.arrayType
      : this._def.type;

    return schema._parseSync({
      data: ctx.data,
      path: ctx.path,
      parent: ctx,
    });
  }

  static create = <T extends z.ZodTypeAny>(
    schema: T,
    params?: z.RawCreateParams,
  ): OneOrMore<T> => {
    const arrayType = z.array(schema, params).min(1, {
      message: "Arrays must contain one or more values",
    });

    // Hack... zod has a function processCreateParams() which validates params,
    // but does not export it. However all zod types create() function call it,
    // so the arrayType contains the result of validating params.
    const processedParams: z.ProcessedCreateParams = {
      errorMap: arrayType._def.errorMap,
      description: arrayType._def.description,
    };

    return new OneOrMore({
      type: schema.transform((v: T): T[] => [v]),
      arrayType,
      typeName: oneOrMoreTypeName,
      ...processedParams,
    });
  };
}

export function oneOrMore<SchemaT extends z.ZodTypeAny>(schema: SchemaT) {
  return OneOrMore.create(schema);
}
