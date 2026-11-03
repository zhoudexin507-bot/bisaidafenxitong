import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env 已存在，保留现有配置。");
  process.exit(0);
}
const password = randomBytes(15).toString("base64url");
writeFileSync(
  ".env",
  `PORT=3001\nHOST=127.0.0.1\nPUBLIC_URL=http://localhost:3001\nADMIN_PASSWORD=${password}\nTOKEN_SECRET=${randomBytes(48).toString("hex")}\nDB_PATH=./data/competition.sqlite\nNODE_ENV=development\nTRUST_PROXY=0\n`,
  { mode: 0o600 },
);
console.log(
  `配置已生成。管理员密码：${password}\n请妥善保存；.env 已被 Git 忽略。公网部署前请按 DEPLOY.md 修改配置。`,
);
