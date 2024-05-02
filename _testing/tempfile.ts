import { Closer } from "../deps.ts";

/** A reference to a temporary file that's deleted when disposed.
 *
 * ```ts
 * using file = await Deno.open("/foo/bar.txt", { read: true });
 * const fileInfo = await file.stat();
 * if (fileInfo.isFile) {
 *   const buf = new Uint8Array(100);
 *   const numberOfBytesRead = await file.read(buf); // 11 bytes
 *   const text = new TextDecoder().decode(buf);  // "hello world"
 * }
 * ```
 */
export class TemporaryFile implements Closer, Disposable {
  constructor(readonly path: string) {}

  /** Create a TemporaryFile, like {@linkcode Deno.makeTempFile}. */
  static async create(
    options: Deno.MakeTempOptions = {},
  ): Promise<TemporaryFile> {
    return new TemporaryFile(await Deno.makeTempFile(options));
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #closed: boolean = false;
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    Deno.remove(this.path).catch(() => {});
  }
}
