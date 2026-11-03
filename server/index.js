import { createApp } from "./app.js";
const service = createApp({
  adminPassword: process.env.ADMIN_PASSWORD,
  tokenSecret: process.env.TOKEN_SECRET,
  publicUrl: process.env.PUBLIC_URL,
  dbPath: process.env.DB_PATH,
  production: process.env.NODE_ENV === "production",
  trustProxy: process.env.TRUST_PROXY === "1",
});
const port = Number(process.env.PORT || 3001);
const server = service.app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `竞衡评分系统已启动：${process.env.PUBLIC_URL || `http://localhost:${port}`}`,
  ),
);
function shutdown() {
  service.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
