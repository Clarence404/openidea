import { afterEach, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorDocContext } from "@/editor/api";
import type { PluginEvent } from "@/bindings";
import { pluginLineMarkerGutter } from "./lineMarkerGutter";
import { pluginIconName } from "./pluginIcon";
import { projectMarkerIcon } from "./markerIcons";
const mock = vi.hoisted(() => ({
  markers: vi.fn(),
  assets: vi.fn(),
  event: undefined as ((event: PluginEvent) => void) | undefined,
  off: vi.fn(),
}));
vi.mock(import("@/platform/ipc"), async (original) => {
  const actual = await original();
  return { ...actual, commands: { ...actual.commands, pluginLineMarkers: mock.markers } };
});
vi.mock("./backend", () => ({
  pluginsBackend: () => ({
    assets: mock.assets,
    onEvent: (fn: (event: PluginEvent) => void) => {
      mock.event = fn;
      return mock.off;
    },
  }),
}));
vi.mock("./navigationButton", () => ({ navigationButton: () => document.createElement("button") }));
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("withdraws old interactive markers on reload and does not refresh on idle status changes", async () => {
  vi.useFakeTimers();
  mock.markers.mockResolvedValue({
    status: "ok",
    data: [{ pluginId: "test", line: 0, icon: "navigate", tooltip: "old", target: null }],
  });
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "select", extensions: pluginLineMarkerGutter({ doc: 1 } as EditorDocContext) }),
  });
  await vi.advanceTimersByTimeAsync(450);
  expect(view.dom.querySelector(".cm-openidea-gutter-pluginMarkers")).not.toBeNull();
  const calls = mock.markers.mock.calls.length;
  mock.event!({ type: "commandsChanged" });
  await vi.advanceTimersByTimeAsync(450);
  expect(mock.markers).toHaveBeenCalledTimes(calls);
  mock.markers.mockResolvedValue({ status: "ok", data: [] });
  mock.event!({ type: "documentIndexesChanged" });
  expect(view.dom.querySelector(".cm-openidea-gutter-pluginMarkers")).toBeNull();
  await vi.advanceTimersByTimeAsync(450);
  expect(view.dom.querySelector(".cm-openidea-gutter-pluginMarkers")).toBeNull();
  view.destroy();
  view = undefined;
  expect(mock.off).toHaveBeenCalledOnce();
});

it("asks an empty answer again: with growing delays on opening, once when it would remove the markers", async () => {
  vi.useFakeTimers();
  const marker = {
    status: "ok",
    data: [{ pluginId: "test", line: 0, icon: "navigate", tooltip: "to xml", target: null }],
  };
  const none = { status: "ok", data: [] };
  // The provider was still starting (or ran past the editor's deadline) as the project opened.
  mock.markers.mockResolvedValueOnce(none).mockResolvedValueOnce(none).mockResolvedValue(marker);
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "mapper", extensions: pluginLineMarkerGutter({ doc: 1 } as EditorDocContext) }),
  });
  await vi.advanceTimersByTimeAsync(450);
  expect(view.dom.querySelector(".cm-plugin-mapping-button")).toBeNull();
  await vi.advanceTimersByTimeAsync(1500);
  expect(mock.markers).toHaveBeenCalledTimes(2);
  expect(view.dom.querySelector(".cm-plugin-mapping-button")).toBeNull();
  await vi.advanceTimersByTimeAsync(3000);
  expect(mock.markers).toHaveBeenCalledTimes(3);
  expect(view.dom.querySelector(".cm-plugin-mapping-button")).not.toBeNull();

  // An empty answer after an edit keeps the shown markers until a second answer confirms it.
  mock.markers.mockResolvedValueOnce(none).mockResolvedValueOnce(none);
  view.dispatch({ changes: { from: 6, insert: "s" } });
  await vi.advanceTimersByTimeAsync(450);
  expect(view.dom.querySelector(".cm-plugin-mapping-button")).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1500);
  expect(mock.markers).toHaveBeenCalledTimes(5);
  expect(view.dom.querySelector(".cm-plugin-mapping-button")).toBeNull();
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.markers).toHaveBeenCalledTimes(5);
});

it("stops asking a document without markers once the delays are used up", async () => {
  vi.useFakeTimers();
  mock.markers.mockResolvedValue({ status: "ok", data: [] });
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "plain", extensions: pluginLineMarkerGutter({ doc: 1 } as EditorDocContext) }),
  });
  await vi.advanceTimersByTimeAsync(120000);
  // The first answer and five more.
  expect(mock.markers).toHaveBeenCalledTimes(6);
  view.dispatch({ changes: { from: 5, insert: "!" } });
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.markers).toHaveBeenCalledTimes(7);
});

it("renders ordinary and custom registered icons alongside legacy marker aliases", async () => {
  vi.useFakeTimers();
  const icon = pluginIconName("markers", {
    light: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
    dark: null,
  });
  mock.markers.mockResolvedValue({
    status: "ok",
    data: ["run", "database", icon].map((icon, line) => ({
      pluginId: "markers",
      line,
      icon,
      tooltip: `marker ${line}`,
      target: null,
    })),
  });
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "legacy\nordinary\ncustom",
      extensions: pluginLineMarkerGutter({ doc: 1 } as EditorDocContext),
    }),
  });
  await vi.advanceTimersByTimeAsync(450);
  const markers = view.dom.querySelectorAll(".cm-plugin-mapping-button");
  expect(markers).toHaveLength(3);
  expect([...markers].map((el) => el.getAttribute("aria-label"))).toEqual(["marker 0", "marker 1", "marker 2"]);
  expect(markers[0]!.innerHTML).not.toBe(markers[1]!.innerHTML);
  expect(markers[2]!.querySelector("circle")).not.toBeNull();
});

it("refreshes a fallback when the package icon declaration arrives after its markers", async () => {
  vi.useFakeTimers();
  mock.markers.mockResolvedValue({
    status: "ok",
    data: [{ pluginId: "late", line: 0, icon: "icons/late.svg", tooltip: "late icon", target: null }],
  });
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "late", extensions: pluginLineMarkerGutter({ doc: 1 } as EditorDocContext) }),
  });
  await vi.advanceTimersByTimeAsync(450);
  expect(view.dom.querySelector(".cm-plugin-mapping-button circle")).toBeNull();
  mock.assets.mockResolvedValue([
    ["markerIcon/late/light", '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>'],
  ]);
  const remove = projectMarkerIcon("late", { id: "late", icon: "icons/late.svg" });
  try {
    await vi.advanceTimersByTimeAsync(450);
    expect(view.dom.querySelector(".cm-plugin-mapping-button circle")).not.toBeNull();
  } finally {
    remove();
  }
});
