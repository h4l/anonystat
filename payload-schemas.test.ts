import { assertEquals } from "./dev_deps.ts";

import { AnyEvent, ParameterValue, UserProperties } from "./payload-schemas.ts";
import { repeat, repeatString, SchemaAssertions } from "./test-utils.ts";
import { ParameterName } from "./payload-schemas.ts";
import { EventName } from "./payload-schemas.ts";
import { AnyItem, AnyPayload } from "./payload-schemas.ts";
import { z } from "./deps.ts";

Deno.test("ParameterValue", () => {
  const sa = new SchemaAssertions(ParameterValue);

  sa.assertParses("");
  sa.assertParses("a");
  sa.assertParses(repeatString("a", 100));
  sa.assertRejects(repeatString("a", 101));

  sa.assertParses(-1);
  sa.assertParses(0);
  sa.assertParses(1.234);
  sa.assertRejects(NaN);
});

Deno.test("ParameterName", () => {
  const sa = new SchemaAssertions(ParameterName);

  sa.assertParsesAll({ inputs: ["a", "Foo_bar_", "a1"] });
  sa.assertRejectsAll({ inputs: ["", "_", "1a"] });
});

Deno.test("EventName", () => {
  const sa = new SchemaAssertions(EventName);

  sa.assertParsesAll({ inputs: ["a", "Foo_bar_", "a1"] });
  sa.assertRejectsAll({ inputs: ["", "_", "1a"] });
  sa.assertRejectsAll({ inputs: ["ad_click", "error"] }); // reserved names
});

Deno.test("AnyItem", () => {
  const sa = new SchemaAssertions(AnyItem);

  sa.assertParsesAll({
    inputs: [
      {},
      { foo_bar_: 1, BarBaz: "yes" },
      // max length
      { [repeatString("a", 40)]: repeatString("a", 100) },
    ],
  });

  sa.assertRejectsAll({
    inputs: [
      // name too long
      { [repeatString("a", 41)]: "" },
      // value too long
      { a: repeatString("a", 101) },
    ],
  });
  sa.assertRejectsAll({
    rawInputs: [
      // only string/number values
      { a: [] },
      { a: true },
    ],
  });
});

Deno.test("UserProperties", () => {
  const sa = new SchemaAssertions(UserProperties);

  sa.assertParsesAll({
    inputs: [
      {},
      { foo_123: { value: 1 }, Bar_Baz1: { value: "yes" } },
      // max length
      { [repeatString("a", 24)]: { value: repeatString("a", 36) } },
      // max events
      Object.fromEntries(
        repeat(null, 25).map((_, i) => [`prop${i}`, { value: "foo" }]),
      ),
    ],
  });

  sa.assertRejectsAll({
    inputs: [
      // names must start with [a-zA-Z]
      { _foo: { value: 0 } },
      // names are alpha-numeric and _. This isn't documented, but is reported
      // as an error by GA4's /debug/mp/collect validation endpoint.
      ...(["a ", "a$", "a💥"].map((n) => ({ [n]: { value: 0 } }))),
      // name too long
      { [repeatString("a", 25)]: { value: 0 } },
      // value too long
      { a: { value: repeatString("a", 37) } },
    ],
  });

  sa.assertRejectsAll({
    rawInputs: [
      // only string / number values
      { _foo: { value: true } },
    ],
  });
});

Deno.test("AnyEvent", () => {
  const sa = new SchemaAssertions(AnyEvent);

  sa.assertParsesAll({
    inputs: [
      // no params
      { name: "foo" },
      // empty params
      { name: "foo", params: {} },
      {
        name: "foo",
        params: { bar: 1, baz: "A" },
      },
      // params can contain items array
      {
        name: "foo",
        params: { bar: 1, baz: "A", items: [{ boz: "x" }] },
      },
      {
        name: "foo",
        params: { bar: 1, baz: "A", items: repeat({ boz: "x" }, 10) },
      },
    ],
  });

  sa.assertRejectsAll({
    inputs: [
      // only "items" can contain an items array
      {
        name: "foo",
        params: { not_items: [{ boz: "x" }] },
      },
      // reserved name
      { name: "ad_click", params: {} },
      // 10 items max
      {
        name: "too_many_items",
        params: { bar: 1, baz: "A", items: repeat({ boz: "x" }, 11) },
      },
    ],
  });
});

Deno.test("AnyPayload", () => {
  const sa = new SchemaAssertions(AnyPayload);

  const validPayload: AnyPayload = {
    client_id: "example",
    events: [],
  };

  // Docs say timestamp_micros is a number, but the Event Builder tool generates
  // decimal integer strings.
  sa.assertParses({
    ...validPayload,
    timestamp_micros: "42",
  }, {
    ...validPayload,
    timestamp_micros: 42,
  });

  sa.assertRejectsAll({
    inputs: [
      { ...validPayload, timestamp_micros: -4 },
      { ...validPayload, timestamp_micros: "-4" },
      { ...validPayload, timestamp_micros: " " },
    ],
  });

  sa.assertParsesAll({
    inputs: [
      {
        client_id: "example",
        timestamp_micros: 42,
        events: [],
      },
      {
        client_id: "FEF03583-D7D4-478A-A267-809D1117A863",
        events: [{
          name: "example",
          params: {
            foo: "bar",
            items: [{ baz: 42 }],
          },
        }],
      },
      {
        client_id: "FEF03583-D7D4-478A-A267-809D1117A863",
        events: repeat({
          name: "example",
          params: {
            foo: "bar",
            items: repeat({ baz: 42 }, 10),
          },
        }, 25),
      },
    ],
  });

  sa.assertRejectsAll({
    inputs: [
      // Too many items
      {
        client_id: "FEF03583-D7D4-478A-A267-809D1117A863",
        events: [{
          name: "example",
          params: {
            foo: "bar",
            items: repeat({ baz: 42 }, 11),
          },
        }],
      },
      // Too many events
      {
        client_id: "FEF03583-D7D4-478A-A267-809D1117A863",
        events: repeat({
          name: "example",
          params: { foo: "bar" },
        }, 26),
      },
    ],
  });
});
