// @vitest-environment node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const SCRIPT = "scripts/run-env.mjs";
const PASSWORD = "s3cretPassw0rdXyz";
const withPath = (base: string, database: string): string => {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
};

const admin = postgres(withPath(databaseUrl, "postgres"), { max: 1, onnotice: () => {} });
const tempDirs: string[] = [];
const created = new Set<string>();

const uniqueId = (): string => `t83_${randomBytes(6).toString("hex")}`;
const dbName = (id: string): string => `hp_run_${id.toLowerCase()}`;

const track = (name: string): string => {
  created.add(name);
  return name;
};

const tempEnvFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "run-env-"));
  tempDirs.push(dir);
  return join(dir, "run.env");
};

const run = (command: string | undefined, env: Record<string, string | undefined>) => {
  const childEnv: Record<string, string | undefined> = { ...process.env, ...env };
  for (const key of Object.keys(childEnv)) {
    if (childEnv[key] === undefined) delete childEnv[key];
  }
  const args = command === undefined ? [SCRIPT] : [SCRIPT, command];
  const result = spawnSync(process.execPath, args, { env: childEnv as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}`, stderr: result.stderr };
};

const databaseExists = async (name: string): Promise<boolean> => {
  const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  return rows.length === 1;
};

const dropDatabase = (name: string) => admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);

const closedPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

const closedPortUrl = async (): Promise<{ url: string; port: number }> => {
  const port = await closedPort();
  return { url: `postgres://u:${PASSWORD}@127.0.0.1:${port}/hp_83`, port };
};

const bind = (port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });

const parseEnvFile = (file: string): Record<string, string> =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );

beforeAll(async () => {
  await admin`SELECT 1`;
});

afterEach(async () => {
  for (const name of created) {
    await dropDatabase(name);
  }
  created.clear();
});

afterAll(async () => {
  try {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  } finally {
    await admin.end();
  }
});

describe("scripts/run-env.mjs", () => {
  it("T-001-83/AC-1 setup creates the run database with the schema and appends the three env lines", async () => {
    const id = uniqueId().toUpperCase().replace("_", "-");
    const name = track(`hp_run_${id.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`);
    const envFile = tempEnvFile();
    const appPort = "3999";

    const result = run("setup", {
      DATABASE_URL: databaseUrl,
      SDLC_RUN_ID: id,
      SDLC_RUN_ENV: envFile,
      SDLC_APP_PORT: appPort,
    });

    expect(result.status, result.output).toBe(0);
    expect(await databaseExists(name)).toBe(true);
    const lines = readFileSync(envFile, "utf8").split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(3);
    const env = parseEnvFile(envFile);
    expect(Object.keys(env).sort()).toEqual(["DATABASE_URL", "HP_E2E_APP_PORT", "HP_E2E_GOOGLE_STUB_PORT"]);
    expect(env.DATABASE_URL).toBe(withPath(databaseUrl, name));
    expect(env.HP_E2E_APP_PORT).toMatch(/^[0-9]+$/);
    expect(env.HP_E2E_GOOGLE_STUB_PORT).toMatch(/^[0-9]+$/);
    expect(env.HP_E2E_APP_PORT).not.toBe(env.HP_E2E_GOOGLE_STUB_PORT);
    expect(env.HP_E2E_APP_PORT).not.toBe(appPort);
    expect(env.HP_E2E_GOOGLE_STUB_PORT).not.toBe(appPort);
    await bind(Number(env.HP_E2E_APP_PORT));
    await bind(Number(env.HP_E2E_GOOGLE_STUB_PORT));

    const runDb = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const rows = await runDb`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounts'
      `;
      expect(rows).toHaveLength(1);
    } finally {
      await runDb.end();
    }
  });

  it("T-001-83/AC-2 teardown drops the run database, is repeatable, and refuses a missing or over-long id", async () => {
    const id = uniqueId();
    const name = track(dbName(id));
    const envFile = tempEnvFile();
    const setupResult = run("setup", {
      DATABASE_URL: databaseUrl,
      SDLC_RUN_ID: id,
      SDLC_RUN_ENV: envFile,
      SDLC_APP_PORT: "3999",
    });
    expect(setupResult.status, setupResult.output).toBe(0);
    const runUrl = parseEnvFile(envFile).DATABASE_URL;
    expect(await databaseExists(name)).toBe(true);

    const first = run("teardown", { DATABASE_URL: runUrl, SDLC_RUN_ID: id });
    expect(first.status, first.output).toBe(0);
    expect(await databaseExists(name)).toBe(false);
    const second = run("teardown", { DATABASE_URL: runUrl, SDLC_RUN_ID: id });
    expect(second.status, second.output).toBe(0);

    const sentinel = track(dbName(uniqueId()));
    await admin.unsafe(`CREATE DATABASE "${sentinel}"`);
    for (const runId of [undefined, ""]) {
      const refused = run("teardown", { DATABASE_URL: databaseUrl, SDLC_RUN_ID: runId });
      expect(refused.status).not.toBe(0);
      expect(refused.output).toContain("SDLC_RUN_ID is required");
    }
    expect(await databaseExists(sentinel)).toBe(true);

    const longId = `t83_${randomBytes(8).toString("hex")}${"a".repeat(40)}`.slice(0, 57);
    expect(longId).toHaveLength(57);
    const truncated = track(`hp_run_${longId.slice(0, 56)}`);
    await admin.unsafe(`CREATE DATABASE "${truncated}"`);
    const closed = await closedPortUrl();
    for (const command of ["setup", "teardown"]) {
      for (const url of [closed.url, databaseUrl]) {
        const result = run(command, {
          DATABASE_URL: url,
          SDLC_RUN_ID: longId,
          SDLC_RUN_ENV: tempEnvFile(),
          SDLC_APP_PORT: "3999",
        });
        expect(result.status).not.toBe(0);
        expect(result.output).toContain("SDLC_RUN_ID");
        expect(result.output).toContain("57");
        expect(result.output).not.toContain(String(closed.port));
        expect(result.output).not.toContain("DATABASE_URL");
      }
    }
    expect(await databaseExists(truncated)).toBe(true);
    expect(await databaseExists(sentinel)).toBe(true);
  });

  it("T-001-83/AC-3 setup reports an unreachable server and bad input without leaking the password", async () => {
    const closed = await closedPortUrl();
    const envFile = tempEnvFile();
    const id = uniqueId();
    track(dbName(id));

    const started = Date.now();
    const unreachable = run("setup", {
      DATABASE_URL: closed.url,
      SDLC_RUN_ID: id,
      SDLC_RUN_ENV: envFile,
      SDLC_APP_PORT: "3999",
    });
    expect(Date.now() - started).toBeLessThan(15000);
    expect(unreachable.status).not.toBe(0);
    expect(unreachable.output).toContain("127.0.0.1");
    expect(unreachable.output).toContain(String(closed.port));
    expect(unreachable.output).toContain("DATABASE_URL");
    expect(unreachable.output).not.toContain(PASSWORD);
    expect(!existsSync(envFile) || readFileSync(envFile, "utf8") === "").toBe(true);

    for (const command of ["setup", "teardown"]) {
      const unset = run(command, { DATABASE_URL: undefined, SDLC_RUN_ID: id, SDLC_RUN_ENV: envFile });
      expect(unset.status).not.toBe(0);
      expect(unset.output).toContain("DATABASE_URL is required");

      const unparsable = run(command, {
        DATABASE_URL: `postgres://u:${PASSWORD}@[bad`,
        SDLC_RUN_ID: id,
        SDLC_RUN_ENV: envFile,
      });
      expect(unparsable.status).not.toBe(0);
      expect(unparsable.stderr.trim().split("\n")).toHaveLength(1);
      expect(unparsable.output).toContain("DATABASE_URL");
      expect(unparsable.output).not.toContain(PASSWORD);
    }

    const noEnv = run("setup", { DATABASE_URL: databaseUrl, SDLC_RUN_ID: id, SDLC_RUN_ENV: undefined });
    expect(noEnv.status).not.toBe(0);
    expect(noEnv.output).toContain("SDLC_RUN_ENV is required");
    expect(await databaseExists(dbName(id))).toBe(false);
  });

  it("T-001-84/AC-1 setup names SDLC_RUN_ENV when the env file cannot be written, and drops the run database", async () => {
    const id = uniqueId();
    const name = track(dbName(id));
    const dir = mkdtempSync(join(tmpdir(), "run-env-"));
    tempDirs.push(dir);
    const envFile = join(dir, "never-created", "run.env");
    const password = decodeURIComponent(new URL(databaseUrl).password);

    const result = run("setup", {
      DATABASE_URL: databaseUrl,
      SDLC_RUN_ID: id,
      SDLC_RUN_ENV: envFile,
      SDLC_APP_PORT: "3999",
    });

    expect(result.status).toBe(1);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("SDLC_RUN_ENV");
    expect(result.stderr).not.toContain("cannot reach");
    if (password !== "") expect(result.output).not.toContain(password);
    expect(await databaseExists(name)).toBe(false);
  });

  it("a closed-port DATABASE_URL still prints the connection line", async () => {
    const closed = await closedPortUrl();
    const result = run("setup", {
      DATABASE_URL: closed.url,
      SDLC_RUN_ID: uniqueId(),
      SDLC_RUN_ENV: tempEnvFile(),
      SDLC_APP_PORT: "3999",
    });
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("cannot reach the Postgres server named by DATABASE_URL");
    expect(result.stderr).toContain(String(closed.port));
    expect(result.output).not.toContain(PASSWORD);
  });

  it("an unset SDLC_RUN_ID or SDLC_RUN_ENV is refused before any connection is tried", async () => {
    const closed = await closedPortUrl();
    const noId = run("setup", { DATABASE_URL: closed.url, SDLC_RUN_ID: undefined, SDLC_RUN_ENV: tempEnvFile() });
    expect(noId.status).toBe(1);
    expect(noId.stderr).toContain("SDLC_RUN_ID is required");
    expect(noId.stderr).not.toContain("cannot reach");

    const noEnv = run("setup", { DATABASE_URL: closed.url, SDLC_RUN_ID: uniqueId(), SDLC_RUN_ENV: undefined });
    expect(noEnv.status).toBe(1);
    expect(noEnv.stderr).toContain("SDLC_RUN_ENV is required");
    expect(noEnv.stderr).not.toContain("cannot reach");
  });

  it("teardown takes the database name from SDLC_RUN_ID, not from DATABASE_URL's path", async () => {
    const id = uniqueId();
    const name = track(dbName(id));
    const other = track(dbName(uniqueId()));
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    await admin.unsafe(`CREATE DATABASE "${other}"`);

    const result = run("teardown", { DATABASE_URL: withPath(databaseUrl, other), SDLC_RUN_ID: id });

    expect(result.status, result.output).toBe(0);
    expect(await databaseExists(name)).toBe(false);
    expect(await databaseExists(other)).toBe(true);
  });
});
