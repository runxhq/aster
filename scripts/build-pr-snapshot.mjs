import { execFileSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
const report = JSON.parse(
  execFileSync(
    "gh",
    [
      "pr",
      "view",
      options.pr,
      "--repo",
      options.repo,
      "--json",
      "number,title,body,url,author,headRefName,headRefOid,baseRefName,isDraft,state,reviewDecision,files,comments,reviews,labels",
    ],
    {
      encoding: "utf8",
    },
  ),
);
const issueMetadata = JSON.parse(
  execFileSync(
    "gh",
    [
      "api",
      `repos/${options.repo}/issues/${options.pr}`,
      "--jq",
      "{ authorAssociation: .author_association }",
    ],
    {
      encoding: "utf8",
    },
  ),
);

const snapshot = {
  pr_number: report.number,
  url: report.url,
  title: report.title,
  body: report.body,
  author: report.author?.login,
  author_association: issueMetadata.authorAssociation ?? null,
  head_ref: report.headRefName,
  head_sha: report.headRefOid,
  base_ref: report.baseRefName,
  draft: report.isDraft,
  state: report.state,
  review_decision: report.reviewDecision,
  labels: (report.labels ?? []).map((label) => label.name),
  comment_count: (report.comments ?? []).length,
  review_count: (report.reviews ?? []).length,
  files: (report.files ?? []).map((file) => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
  })),
  recent_comments: (report.comments ?? []).slice(-5).map((comment) => ({
    author: comment.author?.login,
    body: comment.body,
    created_at: comment.createdAt,
  })),
  recent_reviews: (report.reviews ?? []).slice(-5).map((review) => ({
    author: review.author?.login,
    state: review.state,
    body: review.body,
    submitted_at: review.submittedAt,
  })),
};

process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--pr") {
      options.pr = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.repo || !options.pr) {
    throw new Error("--repo and --pr are required.");
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}
