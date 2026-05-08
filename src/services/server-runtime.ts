import { spawn, type ChildProcess } from "child_process";
import net from "net";

export interface ServerRuntime {
  trackChildProcess(proc: ChildProcess): ChildProcess;
  killProcessTree(proc: ChildProcess | null | undefined): void;
  trackSocket(socket: net.Socket): void;
  destroyOpenSockets(): void;
  destroyTrackedChildProcesses(): void;
}

export function createServerRuntime(): ServerRuntime {
  const childProcesses = new Set<ChildProcess>();
  const openSockets = new Set<net.Socket>();

  function killTrackedProcess(proc: ChildProcess | null | undefined): void {
    if (!proc?.pid) {
      return;
    }
    try {
      spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } catch (error) {
      void error;
    }
  }

  return {
    trackChildProcess(proc: ChildProcess): ChildProcess {
      childProcesses.add(proc);
      const cleanup = () => childProcesses.delete(proc);
      proc.once("exit", cleanup);
      proc.once("close", cleanup);
      return proc;
    },
    killProcessTree(proc: ChildProcess | null | undefined): void {
      killTrackedProcess(proc);
    },
    trackSocket(socket: net.Socket): void {
      openSockets.add(socket);
      socket.on("close", () => openSockets.delete(socket));
    },
    destroyOpenSockets(): void {
      for (const socket of Array.from(openSockets)) {
        socket.destroy();
      }
    },
    destroyTrackedChildProcesses(): void {
      for (const proc of Array.from(childProcesses)) {
        killTrackedProcess(proc);
      }
    },
  };
}
