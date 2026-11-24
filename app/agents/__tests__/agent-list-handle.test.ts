// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AgentList from "../AgentList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const agent = {
  btcAddress: "bc1qdirectorysearchfixture",
  stxAddress: "SPDIRECTORYSEARCHFIXTURE",
  stxPublicKey: "fixture-public-key",
  verifiedAt: "2026-11-01T00:00:00Z",
  owner: "sample_owner",
};
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(AgentList, { agents: [agent] })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each([
  ["unknown_owner", false],
  ["sample_owner", true],
  ["@sample_owner", true],
] as const)("searches the directory for %s", async (query, shouldMatch) => {
  const row = () => host.querySelector("tbody tr a[href='/agents/" + agent.btcAddress + "']");
  expect(row()?.textContent).toContain("@sample_owner");
  const input = host.querySelector<HTMLInputElement>("input[placeholder*='X handle']")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input.value).toBe(query);
  expect(row() !== null, `The fixture agent should match "${query}": ${shouldMatch}`).toBe(shouldMatch);
});
