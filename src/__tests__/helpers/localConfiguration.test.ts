const configure = require("../../../app.config");
const production = require("../../../app.json").expo;

test("normal app configuration is returned unchanged", () => {
  const previous = process.env.WELLPING_LOCAL_ONLY;
  delete process.env.WELLPING_LOCAL_ONLY;
  try {
    expect(configure({ config: production })).toBe(production);
  } finally {
    if (previous === undefined) delete process.env.WELLPING_LOCAL_ONLY;
    else process.env.WELLPING_LOCAL_ONLY = previous;
  }
});

test("local runner uses a separate entry, identifiers, and no OTA or deep links", () => {
  const previous = process.env.WELLPING_LOCAL_ONLY;
  process.env.WELLPING_LOCAL_ONLY = "1";
  try {
    const local = configure({ config: production });
    expect(local.scheme).toBe("wellping-local");
    expect(local.extra.wellpingLocalOnly).toBe(true);
    expect(local.updates.enabled).toBe(false);
    expect(local.owner).toBeUndefined();
    expect(local.slug).not.toBe(production.slug);
    expect(local.ios.bundleIdentifier).not.toBe(
      production.ios.bundleIdentifier,
    );
    expect(local.android.package).not.toBe(production.android.package);
    expect(local.ios.associatedDomains).toEqual([]);
    expect(local.android.intentFilters).toEqual([]);
    expect(production.updates.enabled).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.WELLPING_LOCAL_ONLY;
    else process.env.WELLPING_LOCAL_ONLY = previous;
  }
});
