import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTROL_SCHEMA_REFS,
  collectWorkerValidationIssues,
  normalizeAutomationBranchName,
  normalizeWorkerRequest,
  normalizeIssueToPrRequest,
  normalizeWorkspaceChangePlanRequest,
  resolveVerificationPlan,
  validateVerificationProfileCatalog,
} from "./aster-v1-contracts.mjs";
import { loadRunxControlSchemaSync } from "./runx-control-schemas.mjs";

const catalog = validateVerificationProfileCatalog({
  version: "runx.verification_profile_catalog.v2",
  repo_defaults: {
    "runxhq/aster": "aster.site-ci",
  },
  profiles: {
    "aster.site-ci": {
      repo: "runxhq/aster",
      description: "Run the site CI checks.",
      bootstrap_commands: ["npm --prefix site ci"],
      commands: ["npm run site:ci"],
    },
  },
});

test("normalizeIssueToPrRequest applies the repo default verification profile", () => {
  const request = normalizeIssueToPrRequest(
    {
      issue_title: "Fix docs drift",
      source: "github_issue",
      source_id: "101",
    },
    {
      defaultRepo: "runxhq/aster",
      catalog,
    },
  );

  assert.equal(request.target_repo, "runxhq/aster");
  assert.equal(request.size, "small");
  assert.equal(request.verification_profile, "aster.site-ci");
});

test("normalizeIssueToPrRequest rejects out-of-scope repos", () => {
  assert.throws(() => {
    normalizeIssueToPrRequest(
      {
        issue_title: "Fix docs drift",
        source: "github_issue",
        source_id: "101",
        target_repo: "vercel/next.js",
      },
      { catalog },
    );
  }, /outside prerelease v1 scope/);
});

test("normalizeIssueToPrRequest preserves an explicit verification profile when no catalog is provided", () => {
  const request = normalizeIssueToPrRequest({
    issue_title: "Fix docs drift",
    source: "github_issue",
    source_id: "101",
    verification_profile: "aster.site-ci",
  }, {
    defaultRepo: "runxhq/aster",
  });

  assert.equal(request.verification_profile, "aster.site-ci");
  assert.ok(!Object.hasOwn(request, "validation_commands"));
});

test("normalizeIssueToPrRequest rejects direct publication branches outside runx/*", () => {
  assert.throws(() => {
    normalizeIssueToPrRequest({
      issue_title: "Fix docs drift",
      source: "github_issue",
      source_id: "101",
      branch: "main",
    }, {
      defaultRepo: "runxhq/aster",
      catalog,
    });
  }, /issue_to_pr_request\.branch/);
});

test("normalizeAutomationBranchName accepts bounded automation branches", () => {
  assert.equal(
    normalizeAutomationBranchName("runx/issue-101-docs-drift"),
    "runx/issue-101-docs-drift",
  );
});

test("resolveVerificationPlan maps legacy validation commands onto a declared profile", () => {
  const resolved = resolveVerificationPlan({
    catalog,
    targetRepo: "runxhq/aster",
    issueToPrRequest: {
      issue_title: "Fix docs drift",
      source: "github_issue",
      source_id: "101",
      validation_commands: ["npm run site:ci"],
    },
  });

  assert.equal(resolved.profile_id, "aster.site-ci");
  assert.equal(resolved.compatibility_mode, "legacy_validation_command_mapping");
  assert.deepEqual(resolved.bootstrap_commands, ["npm --prefix site ci"]);
  assert.deepEqual(resolved.commands, ["npm run site:ci"]);
});

test("collectWorkerValidationIssues filters invalid worker requests", () => {
  const result = collectWorkerValidationIssues(
    [
      {
        worker: "issue-to-pr",
        issue_to_pr_request: {
          issue_title: "Fix docs drift",
          source: "github_issue",
          source_id: "101",
        },
      },
      {
        worker: "issue-to-pr",
        issue_to_pr_request: {
          issue_title: "Cross-repo mutation",
          source: "github_issue",
          source_id: "102",
          target_repo: "acme/api",
        },
      },
    ],
    {
      defaultRepo: "runxhq/aster",
      catalog,
    },
  );

  assert.equal(result.accepted.length, 1);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /outside prerelease v1 scope/);
});

test("normalizeWorkerRequest rejects schema-invalid extra properties", () => {
  assert.throws(() => {
    normalizeWorkerRequest({
      worker: "issue-to-pr",
      issue_to_pr_request: {
        issue_title: "Fix docs drift",
        source: "github_issue",
        source_id: "101",
      },
      target_repo: "runxhq/aster",
    }, {
      defaultRepo: "runxhq/aster",
      catalog,
    });
  }, /urn:aster:schema:worker-request:v1/);
});

test("normalizeWorkspaceChangePlanRequest preserves structured target surfaces", () => {
  const request = normalizeWorkspaceChangePlanRequest(
    {
      objective: "Roll out the docs fix",
      project_context: "aster workspace",
      target_surfaces: [
        {
          surface: "runxhq/aster",
          kind: "repo",
          mutating: true,
          rationale: "Single prerelease repo scope.",
        },
      ],
      shared_invariants: ["No external mutation."],
      success_criteria: ["One bounded plan exists before changes start."],
    },
    {
      targetRepo: "runxhq/aster",
    },
  );

  assert.equal(request.target_surfaces.length, 1);
  assert.equal(request.target_surfaces[0].surface, "runxhq/aster");
  assert.equal(request.target_surfaces[0].mutating, true);
});

test("local runx control schema mirrors stay aligned with the published schema ids", () => {
  for (const [name, ref] of Object.entries(CONTROL_SCHEMA_REFS)) {
    const schema = loadRunxControlSchemaSync(name);
    assert.equal(schema.$id, ref);
  }
});
