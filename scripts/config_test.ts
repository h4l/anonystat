import { ConfigValueEnvarName } from "../config.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertMatch,
  assertSnapshot,
  fromFileUrl,
  Stub,
  stub,
} from "../dev_deps.ts";
import { main } from "./config.ts";

Deno.test("--help shows help", async (t) => {
  using consoleOutput = new ConsoleOutputCapturer();
  await assertExits(main(["--help"]), 0);
  await assertSnapshot(t, consoleOutput.getMergedOutput());
});

Deno.test("loads config from environment", async (t) => {
  using consoleOutput = new ConsoleOutputCapturer();
  using _env = OverrideEnv.withObj({
    ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID: "a",
    ANONYSTAT_DATA_STREAM_IN_API_SECRET: "b",
    ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID: "c",
    ANONYSTAT_DATA_STREAM_OUT_API_SECRET: "d",
  });
  await assertExits(main([]), 0);
  await assertSnapshot(t, consoleOutput.getMergedOutput());
});

Deno.test("loads config from argument file", async (t) => {
  using consoleOutput = new ConsoleOutputCapturer();
  using _env = OverrideEnv.withObj({});
  await assertExits(
    main([fromFileUrl(import.meta.resolve("../data/config_minimal.json"))]),
    0,
  );
  await assertSnapshot(t, consoleOutput.getMergedOutput());
});

Deno.test("--format env-vars cannot represent configs with multiple forwarding rules", async (t) => {
  await assertSnapshot(
    t,
    await run({
      format: "env-vars",
      inputFile: "../data/config_multiple.json",
      exitCode: 1,
    }),
  );
});

Deno.test("--format env-vars represents configs with one forwarding rule as individual vars", async (t) => {
  await assertSnapshot(
    t,
    await run({
      format: "env-vars",
      inputFile: "../data/config_single.json",
    }),
  );
});

Deno.test("--format env represents configs with one forwarding rule as individual vars", async (t) => {
  await assertSnapshot(
    t,
    await run({
      format: "env",
      inputFile: "../data/config_single.json",
    }),
  );
});

Deno.test("--format env represents configs with multiple forwarding rule as JSON var", async (t) => {
  await assertSnapshot(
    t,
    await run({
      format: "env",
      inputFile: "../data/config_multiple.json",
    }),
  );
});

Deno.test("--format env-json represents configs with one forwarding rule as JSON var", async (t) => {
  await assertSnapshot(
    t,
    await run({
      format: "env-json",
      inputFile: "../data/config_single.json",
    }),
  );
});

Deno.test("--format json prints indented JSON", async (t) => {
  await assertSnapshot(
    t,
    await run({
      format: "json",
      inputFile: "../data/config_minimal.json",
    }),
  );
});

Deno.test("--format json with --compact prints compact JSON", async (t) => {
  await assertSnapshot(
    t,
    await run({
      format: "json",
      compact: true,
      inputFile: "../data/config_minimal.json",
    }),
  );
});

Deno.test("--format markdown prints a markdown doc with every config format", async (t) => {
  await assertSnapshot(
    t,
    await run({
      format: "markdown",
      compact: true,
      inputFile: "../data/config_minimal.json",
    }),
  );
});

Deno.test("default format is 'env'", async () => {
  const defaultOutput = await run({
    compact: true,
    inputFile: "../data/config_minimal.json",
  });
  const envOutput = await run({
    compact: true,
    format: "env",
    inputFile: "../data/config_minimal.json",
  });
  assertEquals(defaultOutput, envOutput);
});

Deno.test("-e/--override", async (t) => {
  await t.step(
    "non-in/out data stream values override both in and out",
    async () => {
      const a = await run({
        inputFile: "../data/config_single.json",
        override: {
          ANONYSTAT_DATA_STREAM_API_SECRET: "overridden_secret",
          ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "overridden_id",
        },
      });
      const b = await run({
        inputFile: "../data/config_single.json",
        override: {
          ANONYSTAT_DATA_STREAM_IN_API_SECRET: "overridden_secret",
          ANONYSTAT_DATA_STREAM_OUT_API_SECRET: "overridden_secret",
          ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID: "overridden_id",
          ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID: "overridden_id",
        },
      });
      assertEquals(a, b);
    },
  );

  await t.step(
    "overrides replace all values from initial config",
    async () => {
      const vars: Record<ConfigValueEnvarName, string> = {
        ANONYSTAT_ALLOW_DEBUG: "false",
        ANONYSTAT_DATA_STREAM_API_SECRET: "overridden by in/out",
        ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "overridden by in/out",
        ANONYSTAT_DATA_STREAM_IN_API_SECRET: "s0",
        ANONYSTAT_DATA_STREAM_OUT_API_SECRET: "s1",
        ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID: "i0",
        ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID: "i1",
        ANONYSTAT_DESTINATION: "https://override.example.com/mp/collect",
        ANONYSTAT_LISTEN_HOSTNAME: "override.localhost",
        ANONYSTAT_LISTEN_PORT: "9001",
        ANONYSTAT_USER_ID_EXISTING: "keep",
        ANONYSTAT_USER_ID_LIFETIME: "R/2024-01-01/P1W",
        ANONYSTAT_USER_ID_SCRAMBLING_SECRET: "osec",
      };
      const a = await run({
        // config_single has a value for every field
        inputFile: "../data/config_single.json",
        override: vars,
      });
      const b = await run({ env: vars });
      // a overrides all existing values from the file with vars, so it should
      // be equivalent to just loading the vars directly.
      assertEquals(a, b);
    },
  );

  await t.step(
    "overrides are pulled from the environment when no =<value> is used",
    async () => {
      const a = await run({
        inputFile: "../data/config_minimal.json",
        env: {
          ANONYSTAT_LISTEN_HOSTNAME: "foo",
        },
        override: { "*": null },
      });
      const b = await run({
        env: {
          ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "G-ABCDE12345",
          ANONYSTAT_DATA_STREAM_API_SECRET: "Ab12Ab12Ab12Ab12Ab12Ab",
          ANONYSTAT_LISTEN_HOSTNAME: "foo",
        },
      });
      assertEquals(a, b);
    },
  );
});

type Format = "markdown" | "json" | "env" | "env-json" | "env-vars";

async function run(
  options: {
    format?: Format;
    inputFile?: string;
    exitCode?: number;
    compact?: boolean;
    env?: Partial<Record<ConfigValueEnvarName, string>>;
    override?: Partial<Record<ConfigValueEnvarName | "*", string | null>>;
  },
): Promise<string> {
  const args: string[] = [];
  if (options.format) {
    args.push("--format", options.format);
  }
  if (options.compact) args.push("--compact");
  if (options.inputFile !== undefined) {
    args.push(fromFileUrl(import.meta.resolve(options.inputFile)));
  }
  for (const [name, value] of Object.entries(options.override ?? {})) {
    if (value === undefined) continue;
    if (value === null) args.push("-e", name);
    else args.push("-e", `${name}=${value}`);
  }

  using consoleOutput = new ConsoleOutputCapturer();
  using _env = OverrideEnv.withObj(options.env ?? {});
  await assertExits(
    main(args),
    options.exitCode ?? 0,
  );
  return consoleOutput.getMergedOutput();
}

async function assertExits(
  promise: PromiseLike<void>,
  code: number,
): Promise<void> {
  try {
    return await promise;
  } catch (e) {
    assertInstanceOf(e, Error);
    assertMatch(
      e.message,
      new RegExp(`\\bTest case attempted to exit with exit code: ${code}\\b`),
    );
  }
}

type ConsoleSrc = "log" | "error";
type OutputLine = { src: ConsoleSrc; line: string };

/** Record console.log/error output and prevent writes to stdout/stderr. */
class ConsoleOutputCapturer {
  outputLines: OutputLine[] = [];
  log: Stub<Console, unknown[], void>;
  error: Stub<Console, unknown[], void>;

  constructor() {
    this.log = stub(console, "log", this.getConsoleMethodStub("log"));
    this.error = stub(console, "error", this.getConsoleMethodStub("error"));
  }

  private getConsoleMethodStub(src: ConsoleSrc): (...args: unknown[]) => void {
    return (...args: unknown[]) => {
      this.outputLines.push(
        ...ConsoleOutputCapturer.mergeAndSplitLogArgs(args)
          .map((line) => ({ src, line } as const)),
      );
    };
  }

  private static mergeAndSplitLogArgs(args: unknown[]): string[] {
    return args.map((x) => String(x)).join(" ").split("\n");
  }

  getMergedOutput(): string {
    return this.outputLines.map(({ src, line }) =>
      `${src === "log" ? "out" : "err"}|${line}`
    ).join("\n");
  }

  [Symbol.dispose]() {
    this.log[Symbol.dispose]();
    this.error[Symbol.dispose]();
  }
}

/** Mock Deno.env to return values from a Map. */
class OverrideEnv {
  readonly get: Stub<Deno.Env, [key: string], string | undefined>;
  readonly set: Stub<Deno.Env, [key: string, value: string], void>;
  constructor(readonly env: Map<string, string>) {
    this.get = stub(Deno.env, "get", (key) => this.env.get(key));
    this.set = stub(Deno.env, "set", (key, value) => {
      this.env.set(key, value);
    });
  }

  static with(
    entries?: Iterable<readonly [string, string]> | null,
  ): OverrideEnv {
    return new OverrideEnv(new Map(entries));
  }

  static withObj(object?: Record<string, string>): OverrideEnv {
    return OverrideEnv.with(Object.entries(object ?? {}));
  }

  [Symbol.dispose]() {
    this.get[Symbol.dispose]();
    this.set[Symbol.dispose]();
  }
}
