#!/usr/bin/env node

// Node version gate — uses only syntax parseable by Node 4+
// so old runtimes get a clear error instead of "Unexpected token"
var major = Number(process.versions.node.split(".")[0]);

if (major >= 18) {
  // Safe on Node 18+ — dynamic import hidden from old parsers via eval
  var path = require("path");
  var entry = path.join(__dirname, "..", "dist", "src", "index.js");
  eval('import("file://" + entry.replace(/\\\\/g, "/"))');
} else {
  // Try to find a modern Node and re-exec with it
  var fs = require("fs");
  var child_process = require("child_process");
  var path = require("path");

  var candidates = [];

  // Check nvm installations
  var nvmDir = process.env.NVM_DIR || path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".nvm"
  );
  var versionsDir = path.join(nvmDir, "versions", "node");
  try {
    var dirs = fs.readdirSync(versionsDir);
    dirs.forEach(function (d) {
      var m = d.match(/^v(\d+)\./);
      if (m && Number(m[1]) >= 18) {
        candidates.push({
          major: Number(m[1]),
          node: path.join(versionsDir, d, "bin", "node"),
        });
      }
    });
  } catch (e) { /* nvm not installed */ }

  // Check common Homebrew / system paths
  [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/usr/bin/node",
  ].forEach(function (p) {
    try {
      if (fs.statSync(p)) candidates.push({ major: 0, node: p });
    } catch (e) { /* not found */ }
  });

  // Sort nvm versions descending so we prefer the newest
  candidates.sort(function (a, b) { return b.major - a.major; });

  // Find first candidate that's actually >= 18
  var found = null;
  for (var i = 0; i < candidates.length; i++) {
    try {
      var out = child_process.execFileSync(
        candidates[i].node,
        ["-e", "process.stdout.write(process.versions.node.split('.')[0])"],
        { timeout: 3000 }
      );
      if (Number(out) >= 18) {
        found = candidates[i].node;
        break;
      }
    } catch (e) { /* skip broken installs */ }
  }

  if (found) {
    // Re-exec this script with the modern Node
    var result = child_process.spawnSync(found, [__filename].concat(process.argv.slice(2)), {
      stdio: "inherit",
      env: process.env,
    });
    process.exit(result.status || 0);
  } else {
    process.stderr.write(
      "\x1b[31mfoc-cli requires Node.js >= 18 (current: " +
        process.version +
        ")\x1b[0m\n" +
        "Upgrade with:  nvm install 22 && nvm use 22\n"
    );
    process.exit(1);
  }
}
