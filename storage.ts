let defaultKvPath: string | undefined;
let defaultKv: Promise<Deno.Kv> | undefined;

export function configureDefaultKv(path: string | undefined) {
  if (defaultKv !== undefined) {
    throw new Error("Default Kv has already been created");
  }
  defaultKvPath = path;
}

export async function getDefaultKv(): Promise<Deno.Kv> {
  if (defaultKv === undefined) {
    defaultKv = Deno.openKv(defaultKvPath);
  }

  const awaitedKv = defaultKv;
  try {
    return await awaitedKv;
  } catch (e) {
    if (awaitedKv === defaultKv) defaultKv = undefined;
    throw e;
  }
}
