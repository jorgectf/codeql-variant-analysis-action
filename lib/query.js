"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const process_1 = require("process");
const artifact_1 = require("@actions/artifact");
const core_1 = require("@actions/core");
const codeql_1 = require("./codeql");
async function run() {
    try {
        const query = core_1.getInput("query", { required: true });
        const language = core_1.getInput("language", { required: true });
        const repos = JSON.parse(core_1.getInput("repositories", { required: true }));
        const codeql = core_1.getInput("codeql", { required: true });
        for (const repo of repos) {
            if (repo.token) {
                core_1.setSecret(repo.token);
            }
            if (repo.pat) {
                core_1.setSecret(repo.pat);
            }
        }
        // 1. Use the GitHub API to download the database using token
        const curDir = process_1.cwd();
        for (const repo of repos) {
            const workDir = fs_1.mkdtempSync(path_1.default.join(curDir, repo.id.toString()));
            process_1.chdir(workDir);
            // 1. Use the GitHub API to download the database using token
            const dbZip = await codeql_1.downloadDatabase(repo.id, language, repo.token, repo.pat);
            // 2. Run the query
            await codeql_1.runQuery(codeql, language, dbZip, query, repo.nwo);
            // 3. Upload the results as an artifact
            const artifactClient = artifact_1.create();
            await artifactClient.uploadArtifact(repo.id.toString(), // name
            [
                "results/results.bqrs",
                "results/results.csv",
                "results/results.md",
                "results/nwo.txt",
            ], // files
            "results", // rootdirectory
            { continueOnError: false, retentionDays: 1 });
        }
    }
    catch (error) {
        core_1.setFailed(error.message);
    }
}
void run();
//# sourceMappingURL=query.js.map