import { closeSync, fchmodSync, ftruncateSync, openSync, writeFileSync } from "node:fs";

/** Restricts existing files as well as new files before writing credentials. */
export function writePrivateFile(path, contents) {
  const fd = openSync(path, "a", 0o600);
  try {
    fchmodSync(fd, 0o600);
    // Truncate only after permissions have been restricted.
    ftruncateSync(fd, 0);
    writeFileSync(fd, contents);
  } finally {
    closeSync(fd);
  }
}
