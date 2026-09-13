import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OUTPUT_PROFILES,
  ProductionPolicyCatalog,
  ProductionPolicyCatalogError,
  defaultProductionPolicyCatalog
} from "../src/production/production-policy-catalog.js";

function fixtures() {
  return {
    outputProfiles: JSON.parse(readFileSync(new URL("../production-catalogs/output-profiles.v1.json", import.meta.url), "utf8")),
    stylePlaybooks: JSON.parse(readFileSync(new URL("../production-catalogs/style-playbooks.v1.json", import.meta.url), "utf8"))
  };
}

test("production policy catalogs expose three versioned profiles and five optional playbooks", () => {
  const profiles = defaultProductionPolicyCatalog.listOutputProfiles();
  const playbooks = defaultProductionPolicyCatalog.listStylePlaybooks();

  assert.deepEqual(profiles.map((profile) => profile.id), [
    "local-portrait-h264-v1",
    "local-landscape-h264-v1",
    "local-square-h264-v1"
  ]);
  assert.deepEqual(playbooks.map((playbook) => playbook.id), [
    "educational-code", "talking-head", "short-form", "product-demo", "minimal-editorial"
  ]);
  assert.ok(profiles.every((profile) => profile.version === "1.0"));
  assert.ok(playbooks.every((playbook) => playbook.version === "1.0" && playbook.optional === true));
  assert.deepEqual(defaultProductionPolicyCatalog.versions(), {
    outputProfiles: "1.0", stylePlaybooks: "1.0"
  });
});

test("production policy selection never applies a style playbook implicitly", () => {
  const withoutPlaybook = defaultProductionPolicyCatalog.resolve({
    profileId: "local-portrait-h264-v1"
  });
  assert.equal(withoutPlaybook.stylePlaybook, null);
  assert.deepEqual(withoutPlaybook.selection, {
    profileId: "local-portrait-h264-v1",
    playbookId: null,
    playbookSelectedExplicitly: false
  });

  const explicit = defaultProductionPolicyCatalog.resolve({
    profileId: "local-landscape-h264-v1",
    playbookId: "educational-code"
  });
  assert.equal(explicit.stylePlaybook.id, "educational-code");
  assert.equal(explicit.selection.playbookSelectedExplicitly, true);
});

test("catalog API returns defensive copies and freezes the compatibility profile map", () => {
  const profile = defaultProductionPolicyCatalog.readOutputProfile("local-portrait-h264-v1");
  profile.visualPolicy.caption.maximumLines = 99;
  assert.equal(
    defaultProductionPolicyCatalog.readOutputProfile("local-portrait-h264-v1").visualPolicy.caption.maximumLines,
    2
  );

  const playbooks = defaultProductionPolicyCatalog.listStylePlaybooks();
  playbooks[0].profileHints.push("invented-profile");
  assert.equal(defaultProductionPolicyCatalog.listStylePlaybooks()[0].profileHints.includes("invented-profile"), false);
  assert.equal(Object.isFrozen(OUTPUT_PROFILES), true);
  assert.equal(Object.isFrozen(OUTPUT_PROFILES["local-portrait-h264-v1"].visualPolicy.caption), true);
});

test("catalog rejects malformed data, unknown references, and unsupported API fields", () => {
  const values = fixtures();
  values.outputProfiles.profiles[0].width = 1920;
  assert.throws(() => new ProductionPolicyCatalog(values), ProductionPolicyCatalogError);

  const unknownReference = fixtures();
  unknownReference.stylePlaybooks.playbooks[0].profileHints.push("unknown-profile");
  assert.throws(() => new ProductionPolicyCatalog(unknownReference), /unknown output profiles/);

  const implicit = fixtures();
  implicit.stylePlaybooks.selectionMode = "implicit";
  assert.throws(() => new ProductionPolicyCatalog(implicit), /optional and explicitly selected/);

  assert.throws(
    () => defaultProductionPolicyCatalog.resolve({ profileId: "local-square-h264-v1", provider: "invented" }),
    /unsupported fields/
  );
  assert.throws(() => defaultProductionPolicyCatalog.resolve(null), /must be an object/);
  assert.throws(
    () => defaultProductionPolicyCatalog.resolve({ profileId: "local-square-h264-v1", playbookId: "missing" }),
    /Unknown style playbook/
  );
});
