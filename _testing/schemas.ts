import { assert, assertEquals } from "../dev_deps.ts";

import { z } from "../deps.ts";

export function repeat<T>(value: T, times: number): T[] {
  const values = new Array(times);
  values.fill(value);
  return values;
}

export function repeatString(
  value: string,
  times: number,
  joiner: string = "",
): string {
  return repeat(value, times).join(joiner);
}

export const Input = Symbol("Input");

function getInput<Schema extends z.ZodTypeAny>(options: InputOptions<Schema>) {
  return "input" in options ? options.input : options.rawInput;
}

type InputOptions<Schema extends z.ZodTypeAny> = {
  input: z.input<Schema>;
} | { rawInput: unknown };

type MultipleInputOptions<Schema extends z.ZodTypeAny> = {
  inputs: ReadonlyArray<z.input<Schema>>;
} | { rawInputs: ReadonlyArray<unknown> };

function getInputs<Schema extends z.ZodTypeAny>(
  options: MultipleInputOptions<Schema>,
): ReadonlyArray<InputOptions<Schema>> {
  return "inputs" in options
    ? options.inputs.map((i) => ({ input: i }))
    : options.rawInputs.map((ri) => ({ rawInput: ri }));
}

export function assertParses<Schema extends z.ZodTypeAny>(
  { schema, expected = Input, ...inputs }: {
    schema: Schema;
    expected?: z.infer<Schema> | typeof Input;
  } & InputOptions<Schema>,
): void {
  const input = getInput(inputs);
  const result = schema.safeParse(input);
  if (!result.success) {
    assert(
      false,
      `Schema did not parse value: ${
        Deno.inspect({ input, errors: result.error.format()._errors })
      }`,
    );
  }
  assertEquals(result.data, expected === Input ? input : expected);
}

export function assertRejects<Schema extends z.ZodTypeAny>(
  { schema, ...inputs }: {
    schema: Schema;
  } & InputOptions<Schema>,
): void {
  const input = getInput(inputs);
  const result = schema.safeParse(input);
  if (result.success) {
    assert(
      false,
      `Schema parse unexpectedly succeeded: ${
        Deno.inspect({ input, result: result.data })
      }`,
    );
  }
}

export class SchemaAssertions<Schema extends z.ZodTypeAny> {
  constructor(readonly schema: Schema) {}

  assertParses(
    input: z.input<Schema>,
    expected: z.infer<Schema> | typeof Input = Input,
  ): void {
    assertParses({ schema: this.schema, input, expected });
  }

  assertParsesAll(
    options: MultipleInputOptions<Schema>,
  ): void {
    for (const inputOptions of getInputs(options)) {
      assertParses({ schema: this.schema, ...inputOptions });
    }
  }

  assertRejects(
    input: z.input<Schema>,
  ): void {
    assertRejects({ schema: this.schema, input });
  }

  assertRejectsAll(
    options: MultipleInputOptions<Schema>,
  ): void {
    for (const inputOptions of getInputs(options)) {
      assertRejects({ schema: this.schema, ...inputOptions });
    }
  }
}
