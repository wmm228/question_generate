const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const targets = [
  path.join(appRoot, "dist"),
  path.join(appRoot, "static", "generated"),
];

for (const target of targets) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}
