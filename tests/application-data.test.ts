import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPLICATION_DATA_ENVIRONMENT_VARIABLE,
  configureApplicationDataRoot,
  getApplicationDataRoot,
  getElectronUserDataRoot,
} from "@main/application-data";

const originalApplicationDataRoot =
  process.env[APPLICATION_DATA_ENVIRONMENT_VARIABLE];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalApplicationDataRoot === undefined) {
    delete process.env[APPLICATION_DATA_ENVIRONMENT_VARIABLE];
  } else {
    process.env[APPLICATION_DATA_ENVIRONMENT_VARIABLE] =
      originalApplicationDataRoot;
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("application data root", () => {
  it("defaults to a single .agent-ppt directory under the user home", () => {
    expect(getApplicationDataRoot({
      environment: {},
      homeDirectory: join("C:", "Users", "tester"),
    })).toBe(join("C:", "Users", "tester", ".agent-ppt"));
  });

  it("uses AGENT_PPT_DATA_DIR only as an explicit service/test override", () => {
    expect(getApplicationDataRoot({
      environment: { AGENT_PPT_DATA_DIR: join("D:", "isolated-data") },
      homeDirectory: join("C:", "Users", "tester"),
    })).toBe(join("D:", "isolated-data"));
  });

  it("configures Electron userData before startup under the shared root", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "agent-ppt-home-"));
    temporaryDirectories.push(homeDirectory);
    const setPath = vi.fn();

    const configured = configureApplicationDataRoot(
      { setPath },
      {
        environment: {
          AGENT_PPT_DATA_DIR: join(homeDirectory, "stale-launch-override"),
        },
        homeDirectory,
      },
    );

    const expectedRoot = join(homeDirectory, ".agent-ppt");
    const expectedUserData = getElectronUserDataRoot(expectedRoot);
    expect(configured).toEqual({
      applicationDataRoot: expectedRoot,
      electronUserDataRoot: expectedUserData,
    });
    expect(process.env.AGENT_PPT_DATA_DIR).toBe(expectedRoot);
    expect(setPath).toHaveBeenCalledWith("userData", expectedUserData);
  });
});
