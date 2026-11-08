import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";

// A valid 1x1 transparent PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("background images require admin, validate content, persist, serve cached and clear", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request("/admin/backgrounds/home", "PUT", png, undefined, {
        "Content-Type": "image/png",
      })
    ).status,
    401,
  );
  await f.login();
  const put = (kind, body, type) =>
    f.request(`/admin/backgrounds/${kind}`, "PUT", body, undefined, {
      "Content-Type": type,
    });
  assert.equal((await put("banner", png, "image/png")).status, 404);
  assert.equal(
    (await put("home", Buffer.from("definitely not an image"), "image/png"))
      .status,
    400,
  );
  // Non-image JSON bodies are rejected by the image route itself.
  assert.equal(
    (await f.request("/admin/backgrounds/home", "PUT", { a: 1 })).status,
    400,
  );
  await f.ok("/admin/backgrounds/home", "PUT", png, { "Content-Type": "image/png" });
  const served = await fetch(`${f.base}/backgrounds/home`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("cache-control"), "no-cache");
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(png));
  const state = await f.state();
  assert.ok(state.backgrounds.home > 0);
  const versioned = await fetch(`${f.base}/backgrounds/home?v=${state.backgrounds.home}`);
  assert.match(versioned.headers.get("cache-control"), /immutable/);
  const { archiveId } = await f.ok("/admin/competitions/new", "POST", { epoch: state.settings.epoch });
  const archive = (await f.request(`/admin/archives/${archiveId}`)).data;
  assert.equal(archive.backgrounds[0].dataBase64, png.toString("base64"));
  assert.ok((await f.request("/state")).data.backgrounds.home > 0);
  assert.equal((await fetch(`${f.base}/backgrounds/awards`)).status, 404);
  await f.ok("/admin/backgrounds/home", "DELETE", {});
  assert.equal((await fetch(`${f.base}/backgrounds/home`)).status, 404);
  assert.equal((await f.state()).backgrounds.home, undefined);
  // Replacing the same kind bumps the version used as cache buster.
  await f.ok("/admin/backgrounds/awards", "PUT", png, { "Content-Type": "image/png" });
  const first = (await f.state()).backgrounds.awards;
  await new Promise((r) => setTimeout(r, 5));
  await f.ok("/admin/backgrounds/awards", "PUT", png, { "Content-Type": "image/png" });
  assert.ok((await f.state()).backgrounds.awards > first);
});

test("home scene switches like other stage covers and returns via the presenter", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.configure();
  const version = (await f.state()).settings.stage?.version || 0;
  assert.equal(
    (
      await f.request("/admin/stage", "POST", {
        action: "scene",
        scene: "welcome",
        version,
      })
    ).status,
    400,
  );
  await f.ok("/admin/stage", "POST", {
    action: "scene",
    scene: "home",
    message: "",
    seconds: 0,
    version,
  });
  const stage = (await f.state()).settings.stage;
  assert.equal(stage.scene, "home");
  const ps = (await f.request("/admin/presenter/state")).data;
  assert.equal(ps.presenter.next.type, "returnStage");
  await f.ok("/admin/presenter/next", "POST", { key: ps.presenter.next.key });
  assert.equal((await f.state()).settings.stage.scene, "live");
});
