import { describe, expect, it } from "vitest";
import { isFreshInstallation, terminalHeight, type Config } from "./model";

describe("fresh-install onboarding", () => {
  const empty: Config = { repositories: [], profiles: [] };
  it("shows onboarding for a fresh install only", () =>
    expect(isFreshInstallation(empty, [])).toBe(true));
  it("does not reappear after setup or after all connections were forgotten", () => {
    expect(
      isFreshInstallation({ ...empty, onboardingComplete: true }, []),
    ).toBe(false);
    expect(
      isFreshInstallation(
        {
          ...empty,
          repositories: [{ id: "r", name: "Existing", location: "/backup" }],
        },
        [],
      ),
    ).toBe(false);
  });
  it("recognizes older installs from their operation history", () =>
    expect(
      isFreshInstallation(empty, [
        {
          time: "2026-01-01T00:00:00Z",
          action: "info",
          repositoryId: "r",
          profileId: null,
          exitCode: 0,
          message: "Completed",
        },
      ]),
    ).toBe(false));
});
describe("persisted terminal height", () => {
  it("uses a sensible default when storage is missing or corrupt", () => {
    for (const value of [null, "", "bad", "Infinity"])
      expect(terminalHeight(value)).toBe(280);
  });
  it("restores and bounds stored panel heights", () => {
    expect(terminalHeight("420")).toBe(420);
    expect(terminalHeight("1")).toBe(120);
    expect(terminalHeight("999999")).toBe(2000);
  });
});
