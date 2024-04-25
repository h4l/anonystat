import { OneOrMore } from "./_zod.ts";
import { z } from "./deps.ts";
import { assert, assertEquals } from "./dev_deps.ts";

Deno.test("OneOrMore", async (t) => {
  const Foo = z.object({ foo: z.string() });
  const OneOrMoreFoo = OneOrMore.create(Foo);

  await t.step("parses single value", () => {
    assertEquals(OneOrMoreFoo.parse({ foo: "a" }), [{ foo: "a" }]);
  });

  await t.step("parses array of values", () => {
    assertEquals(OneOrMoreFoo.parse([{ foo: "a" }]), [{ foo: "a" }]);
  });

  await t.step("rejects empty array of values", () => {
    const parse = OneOrMoreFoo.safeParse([]);
    assert(!parse.success);
    assertEquals(parse.error.issues.length, 1);
    assertEquals(
      parse.error.issues[0].code,
      z.ZodIssueCode.too_small,
    );
  });

  await t.step("rejects invalid value without unrelated array errors", () => {
    const parse = OneOrMoreFoo.safeParse({ foo: 42 });
    assert(!parse.success);

    const [issue, ...rest] = parse.error.issues;
    assertEquals(rest, []);

    assert(issue.code === z.ZodIssueCode.invalid_type);
    assertEquals(issue.expected, "string");
    assertEquals(issue.received, "number");
    assertEquals(issue.path, ["foo"]);
  });
});
