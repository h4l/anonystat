let defaultKvPath: string | undefined;
let defaultKv: Deno.Kv | undefined;

export function configureDefaultKv(path: string | undefined) {
  if (defaultKv !== undefined) {
    throw new Error("Default Kv has already been created");
  }
  defaultKvPath = path;
}

export async function getDefaultKv(): Promise<Deno.Kv> {
  if (defaultKv === undefined) {
    defaultKv = await Deno.openKv(defaultKvPath);
  }
  return defaultKv;
}
