// In-memory filesystem for isomorphic-git inside a Worker. Copied (with TS
// annotations) from the Phase 2 inlined platform reference. The ARTIFACTS
// binding cannot read/write files, so all git work happens over this fs.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Entry =
  | { kind: "file"; data: Uint8Array; mtimeMs: number }
  | { kind: "dir"; children: Set<string>; mtimeMs: number };

// isomorphic-git branches on `err.code` (e.g. ENOENT → "file doesn't exist"),
// so our errors must carry the code, not just embed it in the message.
function fsError(code: string, path: string): Error {
  const err = new Error(`${code}: ${path}`) as Error & { code: string };
  err.code = code;
  return err;
}

class MemoryStats {
  constructor(private entry: Entry) {}
  get size() {
    return this.entry.kind === "file" ? this.entry.data.byteLength : 0;
  }
  get mtimeMs() {
    return this.entry.mtimeMs;
  }
  get ctimeMs() {
    return this.entry.mtimeMs;
  }
  get mode() {
    return this.entry.kind === "file" ? 0o100644 : 0o040000;
  }
  isFile() {
    return this.entry.kind === "file";
  }
  isDirectory() {
    return this.entry.kind === "dir";
  }
  isSymbolicLink() {
    return false;
  }
}

export class MemoryFS {
  encoder = new TextEncoder();
  decoder = new TextDecoder();
  entries = new Map<string, Entry>([
    ["/", { kind: "dir", children: new Set(), mtimeMs: Date.now() }],
  ]);
  promises = {
    readFile: this.readFile.bind(this),
    writeFile: this.writeFile.bind(this),
    unlink: this.unlink.bind(this),
    readdir: this.readdir.bind(this),
    mkdir: this.mkdir.bind(this),
    rmdir: this.rmdir.bind(this),
    stat: this.stat.bind(this),
    lstat: this.lstat.bind(this),
    readlink: this.readlink.bind(this),
    symlink: this.symlink.bind(this),
  };
  normalize(input: string): string {
    const segments: string[] = [];
    for (const part of input.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        segments.pop();
        continue;
      }
      segments.push(part);
    }
    return `/${segments.join("/")}` || "/";
  }
  parent(path: string): string {
    const n = this.normalize(path);
    if (n === "/") return "/";
    const parts = n.split("/").filter(Boolean);
    parts.pop();
    return parts.length ? `/${parts.join("/")}` : "/";
  }
  basename(path: string): string {
    return this.normalize(path).split("/").filter(Boolean).pop() ?? "";
  }
  getEntry(path: string): Entry | undefined {
    return this.entries.get(this.normalize(path));
  }
  requireEntry(path: string): Entry {
    const e = this.getEntry(path);
    if (!e) throw fsError("ENOENT", path);
    return e;
  }
  requireDir(path: string): Extract<Entry, { kind: "dir" }> {
    const e = this.requireEntry(path);
    if (e.kind !== "dir") throw fsError("ENOTDIR", path);
    return e;
  }
  async mkdir(path: string, options?: any) {
    const target = this.normalize(path);
    if (target === "/") return;
    const recursive =
      typeof options === "object" && options !== null && options.recursive;
    const parent = this.parent(target);
    if (!this.entries.has(parent)) {
      if (!recursive) throw fsError("ENOENT", parent);
      await this.mkdir(parent, { recursive: true });
    }
    if (this.entries.has(target)) return;
    this.entries.set(target, {
      kind: "dir",
      children: new Set(),
      mtimeMs: Date.now(),
    });
    this.requireDir(parent).children.add(this.basename(target));
  }
  async writeFile(path: string, data: string | Uint8Array | ArrayBuffer) {
    const target = this.normalize(path);
    await this.mkdir(this.parent(target), { recursive: true });
    const bytes =
      typeof data === "string"
        ? this.encoder.encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
    this.entries.set(target, { kind: "file", data: bytes, mtimeMs: Date.now() });
    this.requireDir(this.parent(target)).children.add(this.basename(target));
  }
  async readFile(path: string, options?: any) {
    const entry = this.requireEntry(path);
    if (entry.kind !== "file") throw fsError("EISDIR", path);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? this.decoder.decode(entry.data) : entry.data;
  }
  async readdir(path: string) {
    return [...this.requireDir(path).children].sort();
  }
  async unlink(path: string) {
    const target = this.normalize(path);
    const e = this.requireEntry(target);
    if (e.kind !== "file") throw fsError("EISDIR", path);
    this.entries.delete(target);
    this.requireDir(this.parent(target)).children.delete(this.basename(target));
  }
  async rmdir(path: string) {
    const target = this.normalize(path);
    const e = this.requireDir(target);
    if (e.children.size > 0) throw fsError("ENOTEMPTY", path);
    this.entries.delete(target);
    this.requireDir(this.parent(target)).children.delete(this.basename(target));
  }
  async stat(path: string) {
    return new MemoryStats(this.requireEntry(path));
  }
  async lstat(path: string) {
    return this.stat(path);
  }
  // Symlinks are not used by the regular-file commit/clone flow, but
  // isomorphic-git binds these methods unconditionally — they must exist.
  async readlink(path: string): Promise<string> {
    throw fsError("EINVAL", path);
  }
  async symlink(_target: string, path: string): Promise<void> {
    throw fsError("ENOSYS", path);
  }
}
