/// <reference lib="webworker" />
import { readAppleHealthExport } from "../utils/healthExport";

/** Reads an Apple Health export off the main thread so the app stays responsive on gigabyte files. */
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const result = await readAppleHealthExport(event.data.file, (fraction, progress) => self.postMessage({ type: "progress", fraction, progress }));
    self.postMessage({ type: "done", ...result });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "The export could not be read." });
  }
};
