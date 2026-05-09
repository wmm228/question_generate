import { acquireSingleInstanceLockSafe, releaseSingleInstanceLock } from "./services/server-lock";
import { createServerRuntime } from "./services/server-runtime";
import { loadTutorServerEnvironment, resolveTutorServerPaths } from "./services/server-paths";
import { applyTutorLaunchProfile } from "./services/tutor-launch-profile";
import { createTutorApp, type TutorApp } from "./services/tutor-app";

const STARTUP_ID = `${Date.now()}-${process.pid}`;

async function main(): Promise<void> {
  const launchProfile = applyTutorLaunchProfile(process.env.TUTOR_START_PROFILE);
  const paths = resolveTutorServerPaths({
    currentWorkingDirectory: process.cwd(),
    runtimeDirectory: __dirname,
  });
  const environment = loadTutorServerEnvironment(paths.envPath);
  const runtime = createServerRuntime();
  const tutorApp = await createTutorApp({
    startupId: STARTUP_ID,
    runtime,
    paths,
    environment,
  });
  const { app } = tutorApp;

  let shuttingDown = false;

  await acquireSingleInstanceLockSafe(paths.serverLockPath, environment.port, STARTUP_ID).catch((error) => {
    console.error(`[Tutor] startup lock acquisition failed pid=${process.pid}`, error);
    process.exit(1);
  });

  const server = app.listen(environment.port, "0.0.0.0", () => {
    console.log(
      `[Tutor] listening at http://localhost:${environment.port} pid=${process.pid} startupId=${STARTUP_ID} profile=${launchProfile}`,
    );
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    releaseSingleInstanceLock(paths.serverLockPath);
    console.error(`[Tutor] startup failed pid=${process.pid}`, err);
    process.exit(1);
  });

  server.on("connection", (socket) => {
    runtime.trackSocket(socket);
    if (shuttingDown) {
      socket.destroy();
    }
  });

  function shutdown(signal: string): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[Tutor] received shutdown signal=${signal} pid=${process.pid}`);
    runtime.destroyOpenSockets();
    runtime.destroyTrackedChildProcesses();
    void closeTutorApp(tutorApp);
    releaseSingleInstanceLock(paths.serverLockPath);
    server.close(() => {
      console.log(`[Tutor] server closed pid=${process.pid}`);
      process.exit(0);
    });
    setTimeout(() => {
      console.error(`[Tutor] shutdown timed out pid=${process.pid}`);
      process.exit(1);
    }, 3000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function closeTutorApp(tutorApp: TutorApp): Promise<void> {
  try {
    await tutorApp.close();
  } catch (error) {
    console.error(`[Tutor] app shutdown failed pid=${process.pid}`, error);
  }
}

void main().catch((error) => {
  console.error(`[Tutor] startup bootstrap failed pid=${process.pid}`, error);
  process.exit(1);
});
