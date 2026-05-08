import fs from "fs";
import net from "net";

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

function probeLocalPort(port: number, timeoutMs = 750): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isValidPort(port)) {
      resolve(false);
      return;
    }
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finalize = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finalize(true));
    socket.once("error", () => finalize(false));
    socket.setTimeout(timeoutMs, () => finalize(false));
  });
}

export async function acquireSingleInstanceLockSafe(
  lockPath: string,
  port: number,
  startupId: string,
): Promise<void> {
  try {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, "utf-8").trim();
      if (raw) {
        const lock = JSON.parse(raw) as { pid?: number; port?: number };
        const lockedPort = isValidPort(Number(lock.port)) ? Number(lock.port) : port;
        if (await probeLocalPort(lockedPort)) {
          throw new Error(`Tutor server already running at http://localhost:${lockedPort}`);
        }
        if (lock.pid && lock.pid !== process.pid && isProcessAlive(lock.pid)) {
          console.warn(
            `[Tutor] stale lock detected for pid=${lock.pid}; port ${lockedPort} is unreachable, refreshing lock without terminating that process`,
          );
        }
      }
      try {
        fs.rmSync(lockPath, { force: true });
      } catch (cleanupError) {
        void cleanupError;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Tutor server already running")) {
      throw error;
    }
    console.warn(`[Tutor] failed to read previous server lock: ${String(error)}`);
  }

  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    port,
    startupId,
    createdAt: new Date().toISOString(),
  }, null, 2), "utf-8");
}

export function releaseSingleInstanceLock(lockPath: string): void {
  try {
    if (!fs.existsSync(lockPath)) {
      return;
    }
    const raw = fs.readFileSync(lockPath, "utf-8").trim();
    if (!raw) {
      fs.rmSync(lockPath, { force: true });
      return;
    }
    const lock = JSON.parse(raw) as { pid?: number };
    if (!lock.pid || lock.pid === process.pid) {
      fs.rmSync(lockPath, { force: true });
    }
  } catch (error) {
    void error;
  }
}
