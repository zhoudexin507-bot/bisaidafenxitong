import {
  openDatabase,
  defaultSettings,
  saveSettings,
  transaction,
  audit,
} from "../server/db.js";
import { randomUUID } from "node:crypto";
const db = openDatabase(process.env.DB_PATH || "./data/competition.sqlite");
if (
  db.prepare("SELECT COUNT(*) AS n FROM projects").get().n ||
  db.prepare("SELECT COUNT(*) AS n FROM judges").get().n ||
  db.prepare("SELECT COUNT(*) AS n FROM awards").get().n
) {
  db.close();
  throw new Error("数据库非空，演示数据不会覆盖现有比赛。");
}
transaction(db, () => {
  saveSettings(db, {
    ...defaultSettings,
    title: "2026 年度岗位技能比武",
    subtitle: "精于技艺 · 匠心致远",
    status: "running",
    demo: true,
    testCompleted: true,
  });
  const judges = ["张明远", "李文静", "王建国", "陈思源", "刘志宏"].map(
    (name, i) => {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO judges(id,name,title,expires_at) VALUES (?,?,?,?)",
      ).run(
        id,
        name,
        i === 0 ? "主评委 / 技术专家" : "专业评委",
        Date.now() + 48 * 3600000,
      );
      return id;
    },
  );
  const projects = [
    ["精密装配与工艺优化", "第一代表队", "closed"],
    ["智能设备故障诊断", "第二代表队", "closed"],
    ["应急处置与协同作业", "第三代表队", "open"],
    ["数字化生产线调试", "第四代表队", "pending"],
    ["安全操作标准演示", "第五代表队", "pending"],
    ["质量检测与分析", "第六代表队", "pending"],
  ];
  projects.forEach(([name, team, status], i) => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO projects(id,name,team,description,position,status) VALUES (?,?,?,?,?,?)",
    ).run(
      id,
      name,
      team,
      "围绕岗位核心技能，综合考察专业能力、操作规范与现场表现。",
      i + 1,
      status,
    );
    const totals =
      i === 0
        ? [92, 94, 93, 96, 95]
        : i === 1
          ? [91, 93, 92.5, 94, 90]
          : i === 2
            ? [95, 94.5, 96]
            : [];
    totals.forEach((total, j) =>
      db
        .prepare("INSERT INTO entries VALUES ('official',1,?,?,?,?)")
        .run(
          id,
          judges[j],
          Math.round(total * 100),
          new Date(Date.now() - (10 - i * 2 - j) * 60_000).toISOString(),
        ),
    );
  });
  db.prepare("INSERT INTO awards VALUES (?,?,?,?,?)").run(
    randomUUID(),
    "最佳协作奖",
    "王晓峰",
    "表彰出色的团队协作与现场组织能力",
    1,
  );
  audit(db, "系统", "加载演示数据", { demo: true });
});
db.close();
console.log(
  "演示数据已创建（5 位评委、6 个项目）。此数据库用于演示，正式比赛请使用新数据库。",
);
