import fs from "fs";
import path from "path";

import { exec } from "@actions/exec";
import { rmRF } from "@actions/io";
import anyTest, { TestInterface } from "ava";

import {
  runQuery,
  getBqrsInfo,
  getDatabaseMetadata,
  BQRSInfo,
  getRemoteQueryPackDefaultQuery,
} from "./codeql";
import {
  createResultIndex,
  ErrorIndexItem,
  SuccessIndexItem,
} from "./interpret";

const test = anyTest as TestInterface<{ db: string; tmpDir: string }>;

test.before(async (t) => {
  const tmpDir = path.resolve(fs.mkdtempSync("tmp"));
  t.context.tmpDir = tmpDir;

  const projectDir = path.join(tmpDir, "project");
  const dbDir = path.join(tmpDir, "db");
  fs.mkdirSync(projectDir);
  const testFile = path.join(projectDir, "test.js");
  fs.writeFileSync(testFile, "const x = 1;");

  await exec("codeql", [
    "database",
    "create",
    "--language=javascript",
    `--source-root=${projectDir}`,
    dbDir,
  ]);

  const dbZip = path.join(tmpDir, "database.zip");
  await exec("codeql", ["database", "bundle", `--output=${dbZip}`, dbDir]);
  t.context.db = dbZip;
});

test.after(async (t) => {
  if (t.context?.tmpDir !== undefined) {
    await rmRF(t.context.tmpDir);
  }
});

test("running a query in a pack", async (t) => {
  const queryPack = path.resolve("testdata/test_pack");
  const tmpDir = fs.mkdtempSync("tmp");
  const cwd = process.cwd();
  process.chdir(tmpDir);
  try {
    await runQuery("codeql", t.context.db, "a/b", queryPack);

    t.true(
      fs
        .readFileSync(path.join("results", "results.md"), "utf-8")
        .includes("| 0 | 1 |")
    );
    t.true(fs.existsSync(path.join("results", "results.bqrs")));
    t.true(fs.existsSync(path.join("results", "results.csv")));

    const bqrsInfo: BQRSInfo = await getBqrsInfo(
      "codeql",
      path.join("results", "results.bqrs")
    );
    t.is(1, bqrsInfo.resultSets.length);
    t.is("#select", bqrsInfo.resultSets[0].name);
    t.true(bqrsInfo.compatibleQueryKinds.includes("Table"));
  } finally {
    process.chdir(cwd);
    await rmRF(tmpDir);
  }
});

test("getting the commit SHA and CLI version from a database", async (t) => {
  const tmpDir = fs.mkdtempSync("tmp");
  try {
    fs.writeFileSync(
      path.join(tmpDir, "codeql-database.yml"),
      `---
sourceLocationPrefix: "hello-world"
baselineLinesOfCode: 1
unicodeNewlines: true
columnKind: "utf16"
primaryLanguage: "javascript"
creationMetadata:
  sha: "ccf1e13626d97b009b4da78f719f028d9f7cdf80"
  cliVersion: "2.7.2"
  creationTime: "2021-11-08T12:58:40.345998Z"
`
    );
    t.is(
      getDatabaseMetadata(tmpDir).creationMetadata?.sha,
      "ccf1e13626d97b009b4da78f719f028d9f7cdf80"
    );
    t.is(getDatabaseMetadata(tmpDir).creationMetadata?.cliVersion, "2.7.2");
  } finally {
    await rmRF(tmpDir);
  }
});

test("getting the commit SHA when codeql-database.yml exists, but does not contain SHA", async (t) => {
  const tmpDir = fs.mkdtempSync("tmp");
  try {
    fs.writeFileSync(
      path.join(tmpDir, "codeql-database.yml"),
      `---
sourceLocationPrefix: "hello-world"
baselineLinesOfCode: 17442
unicodeNewlines: true
columnKind: "utf16"
primaryLanguage: "javascript"
`
    );
    t.is(getDatabaseMetadata(tmpDir).creationMetadata?.sha, undefined);
  } finally {
    await rmRF(tmpDir);
  }
});

test("getting the commit SHA when codeql-database.yml exists, but is invalid", async (t) => {
  const tmpDir = fs.mkdtempSync("tmp");
  try {
    fs.writeFileSync(
      path.join(tmpDir, "codeql-database.yml"),
      `    foo:"
bar
`
    );
    t.is(getDatabaseMetadata(tmpDir).creationMetadata?.sha, undefined);
  } finally {
    await rmRF(tmpDir);
  }
});

test("getting the commit SHA when the codeql-database.yml does not exist", async (t) => {
  const tmpDir = fs.mkdtempSync("tmp");
  try {
    t.is(getDatabaseMetadata(tmpDir).creationMetadata?.sha, undefined);
  } finally {
    await rmRF(tmpDir);
  }
});

test("creating a result index", async (t) => {
  const queryPack = path.resolve("testdata/test_pack");
  const responsePath = path.resolve("testdata/test_download_response");
  const tmpDir = fs.mkdtempSync("tmp");
  const cwd = process.cwd();
  process.chdir(tmpDir);
  try {
    const output = await runQuery("codeql", t.context.db, "a/b", queryPack);
    const outputDir = path.dirname(output[0]); // We know that all output files are in the same directory.
    const downloadResponse = {
      artifactName: "123",
      downloadPath: outputDir,
    };

    const downloadResponse2 = {
      artifactName: "124-error",
      downloadPath: responsePath,
    };
    const result = await createResultIndex(
      [downloadResponse],
      [downloadResponse2]
    );

    t.is(result.length, 2);
    const successItem = result[0] as SuccessIndexItem;
    t.is(successItem.nwo, "a/b");
    t.is(successItem.id, "123");
    t.is(successItem.results_count, 3);
    t.true(successItem.bqrs_file_size > 0);
    const errorItem = result[1] as ErrorIndexItem;
    t.is(errorItem.nwo, "a/c");
    t.is(errorItem.id, "124");
    t.is(errorItem.error, "Ceci n'est pas un error message.");
  } finally {
    process.chdir(cwd);
    await rmRF(tmpDir);
  }
});

test("getting the default query from a pack", async (t) => {
  t.is(
    await getRemoteQueryPackDefaultQuery("codeql", "testdata/test_pack"),
    path.resolve("testdata/test_pack/x/query.ql")
  );
});
