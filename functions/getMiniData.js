// ============================================================
// getData.js - GitHubからJSONデータを取得
// ============================================================

exports.handler = async function (event, context) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const GITHUB_REPO  = process.env.GITHUB_REPO;
  const FILE_PATH    = "mini/data/mini.json";

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`GitHub API: ${response.status} - ${JSON.stringify(err)}`);
    }

    const fileData = await response.json();
    const content  = Buffer.from(fileData.content, "base64").toString("utf-8");
    const parsed   = JSON.parse(content);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ data: parsed, sha: fileData.sha }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
