import { appendFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HOST = "127.0.0.1";
const MAINTENANCE_DATABASE = "postgres";
const CONNECT_TIMEOUT_SECONDS = 10;
const NAME_PATTERN = /^hp_run_[a-z0-9_]{1,56}$/;
const MAX_NAME_BYTES = 63;
const MAX_PORT_TRIES = 20;
const SCHEMA_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle/0001_init.sql");
const USAGE = "usage: node scripts/run-env.mjs <setup|teardown>";

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH", "CONNECT_TIMEOUT"]);

class UsageError extends Error {}

class StepError extends Error {
  constructor(step, cause) {
    super(cause?.message ?? String(cause), { cause });
    this.step = step;
  }
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new UsageError(`${name} is required`);
  }
  return value;
}

function runDatabaseName() {
  const id = requireEnv("SDLC_RUN_ID");
  const name = `hp_run_${id.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  if (!NAME_PATTERN.test(name)) {
    throw new UsageError(
      `SDLC_RUN_ID is ${id.length} characters long: its database name must be at most ${MAX_NAME_BYTES} bytes`,
    );
  }
  return name;
}

function parseDatabaseUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw new UsageError("DATABASE_URL is not a valid URL");
  }
}

function urlWithDatabase(base, database) {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url;
}

function connect(url) {
  return postgres(url.toString(), { max: 1, connect_timeout: CONNECT_TIMEOUT_SECONDS, onnotice: () => {} });
}

function isServerError(error) {
  return typeof error?.severity === "string";
}

function isConnectionError(error) {
  const code = error?.code;
  return typeof code === "string" && (CONNECTION_CODES.has(code) || code.startsWith("CONNECTION_"));
}

function decodedPassword(url) {
  try {
    return decodeURIComponent(url.password);
  } catch {
    return "";
  }
}

function scrub(line, url) {
  let text = line;
  for (const secret of [url.password, decodedPassword(url)]) {
    if (secret) {
      text = text.split(secret).join("***");
    }
  }
  return text.replace(/\s*[\r\n]+\s*/g, " ");
}

function describeFailure(error, url, command) {
  const cause = error instanceof StepError ? error.cause : error;
  let line;
  if (isServerError(cause)) {
    line = `${cause.message} (from the server named by DATABASE_URL)`;
  } else if (isConnectionError(cause)) {
    line = `cannot reach the Postgres server named by DATABASE_URL at host ${url.hostname} port ${url.port || "5432"}`;
  } else {
    const step = error instanceof StepError ? error.step : "running";
    line = `${command} failed ${step}: ${cause?.message ?? String(cause)}`;
  }
  return scrub(line, url);
}

async function inStep(step, work) {
  try {
    return await work();
  } catch (error) {
    throw new StepError(step, error);
  }
}

async function withClient(url, work) {
  const sql = connect(url);
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function pickPorts(appPort) {
  for (let attempt = 0; attempt < MAX_PORT_TRIES; attempt += 1) {
    const web = await freePort();
    const stub = await freePort();
    if (web !== stub && String(web) !== appPort && String(stub) !== appPort) {
      return { web, stub };
    }
  }
  throw new Error("could not find two free ports different from SDLC_APP_PORT");
}

async function setup(base, name, envFile) {
  const maintenance = urlWithDatabase(base, MAINTENANCE_DATABASE);
  await inStep(`creating the database ${name}`, () =>
    withClient(maintenance, (sql) => sql`CREATE DATABASE ${sql(name)}`),
  );
  const runUrl = urlWithDatabase(base, name);
  try {
    await inStep(`applying the schema file (${SCHEMA_FILE})`, () => withClient(runUrl, (sql) => sql.file(SCHEMA_FILE)));
    const ports = await inStep("picking free ports", () => pickPorts(process.env.SDLC_APP_PORT));
    await inStep(`writing SDLC_RUN_ENV (${envFile})`, async () =>
      appendFileSync(
        envFile,
        `DATABASE_URL=${runUrl.toString()}\nHP_E2E_APP_PORT=${ports.web}\nHP_E2E_GOOGLE_STUB_PORT=${ports.stub}\n`,
      ),
    );
  } catch (error) {
    await withClient(maintenance, (sql) => sql`DROP DATABASE IF EXISTS ${sql(name)} WITH (FORCE)`).catch(() => {});
    throw error;
  }
}

async function teardown(base, name) {
  const maintenance = urlWithDatabase(base, MAINTENANCE_DATABASE);
  await inStep(`dropping the database ${name}`, () =>
    withClient(maintenance, (sql) => sql`DROP DATABASE IF EXISTS ${sql(name)} WITH (FORCE)`),
  );
}

async function main() {
  const command = process.argv[2];
  if (command !== "setup" && command !== "teardown") {
    fail(USAGE, 2);
  }
  let base;
  let name;
  let envFile;
  try {
    base = requireEnv("DATABASE_URL");
    if (command === "setup") {
      envFile = requireEnv("SDLC_RUN_ENV");
    }
    name = runDatabaseName();
    base = parseDatabaseUrl(base);
  } catch (error) {
    if (error instanceof UsageError) {
      fail(error.message);
    }
    throw error;
  }
  try {
    if (command === "setup") {
      await setup(base, name, envFile);
    } else {
      await teardown(base, name);
    }
  } catch (error) {
    fail(describeFailure(error, base, command));
  }
}

await main();
