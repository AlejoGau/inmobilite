/**
 * A tiny React renderer for component tests in node (vitest runs without a DOM).
 *
 * Host elements (`<div>`, `<button>`…) become plain objects that keep their
 * props, so a test can read classes and text and call handlers directly
 * (`node.props.onClick()`). It reuses the react-reconciler build that
 * @react-three/fiber ships for this exact React version, so hooks, effects,
 * Suspense and error boundaries behave as they do in the browser.
 *
 * Test-only: nothing in the app imports it.
 */

import { act, createContext, type ReactNode } from "react";
import createReconciler from "@react-three/fiber/react-reconciler";
import { ConcurrentRoot, DefaultEventPriority, NoEventPriority } from "@react-three/fiber/react-reconciler/constants";

// Tells React that every update in a test goes through act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Record<string, unknown>;

export interface TestText {
  kind: "text";
  text: string;
  hidden: boolean;
}

export interface TestNode {
  kind: "element";
  type: string;
  props: Props;
  children: Array<TestNode | TestText>;
  /** Set by Suspense while it shows a fallback. */
  hidden: boolean;
  /** Layout stand-ins: tests set them to model the viewport. */
  clientWidth: number;
  clientHeight: number;
  focus(): void;
  blur(): void;
}

interface TestContainer {
  children: Array<TestNode | TestText>;
}

type Child = TestNode | TestText;

function createNode(type: string, props: Props): TestNode {
  return { kind: "element", type, props, children: [], hidden: false, clientWidth: 1440, clientHeight: 900, focus() {}, blur() {} };
}

function detach(parent: TestNode | TestContainer, child: Child): void {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
}

function append(parent: TestNode | TestContainer, child: Child): void {
  detach(parent, child);
  parent.children.push(child);
}

function insertBefore(parent: TestNode | TestContainer, child: Child, before: Child): void {
  detach(parent, child);
  parent.children.splice(parent.children.indexOf(before), 0, child);
}

let updatePriority: number = NoEventPriority;

/** React only needs a non-null host context; these hosts have no namespaces. */
const HOST_CONTEXT = {};

const reconciler = createReconciler({
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  warnsIfNotActing: true,
  createInstance: (type: string, props: Props) => createNode(type, props),
  createTextInstance: (text: string): TestText => ({ kind: "text", text, hidden: false }),
  appendInitialChild: append,
  appendChild: append,
  appendChildToContainer: append,
  insertBefore,
  insertInContainerBefore: insertBefore,
  removeChild: detach,
  removeChildFromContainer: detach,
  commitUpdate(node: TestNode, _type: string, _prevProps: Props, nextProps: Props) {
    node.props = nextProps;
  },
  commitTextUpdate(textNode: TestText, _prev: string, next: string) {
    textNode.text = next;
  },
  hideInstance(node: TestNode) {
    node.hidden = true;
  },
  unhideInstance(node: TestNode) {
    node.hidden = false;
  },
  hideTextInstance(textNode: TestText) {
    textNode.hidden = true;
  },
  unhideTextInstance(textNode: TestText) {
    textNode.hidden = false;
  },
  clearContainer(container: TestContainer) {
    container.children = [];
  },
  resetTextContent() {},
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => HOST_CONTEXT,
  getChildHostContext: () => HOST_CONTEXT,
  getPublicInstance: (instance: Child) => instance,
  prepareForCommit: () => null,
  resetAfterCommit() {},
  preparePortalMount() {},
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  detachDeletedInstance() {},
  NotPendingTransition: null,
  // The typings want React's internal context type; a public context is what react-dom passes too.
  HostTransitionContext: createContext(null) as never,
  setCurrentUpdatePriority(priority: number) {
    updatePriority = priority;
  },
  getCurrentUpdatePriority: () => updatePriority,
  resolveUpdatePriority: () => (updatePriority !== NoEventPriority ? updatePriority : DefaultEventPriority),
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
});

/**
 * An error that no boundary catches makes `renderForTest`, `update`,
 * `interact` and `settle` reject (React's act() rethrows it): in the app it
 * would replace the whole page.
 */
export interface TestRoot {
  /** Re-renders the root with a new element. */
  update(element: ReactNode): Promise<void>;
  unmount(): Promise<void>;
  /** Every element on screen, depth first. Suspense-hidden ones are skipped. */
  findAll(predicate: (node: TestNode) => boolean): TestNode[];
  /** The visible text of the whole tree. */
  text(): string;
  /** Errors an error boundary caught. */
  caughtErrors: unknown[];
}

export async function renderForTest(element: ReactNode): Promise<TestRoot> {
  const container: TestContainer = { children: [] };
  const caughtErrors: unknown[] = [];
  const root = reconciler.createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    "",
    // Never called inside act(), which rethrows uncaught errors instead.
    (error) => {
      throw error;
    },
    (error) => caughtErrors.push(error),
    () => {},
    () => {},
  );

  const render = (next: ReactNode) =>
    act(async () => {
      reconciler.updateContainer(next, root, null, null);
    });

  await render(element);

  return {
    update: render,
    unmount: () => render(null),
    findAll: (predicate) => visibleNodes(container.children).filter(predicate),
    text: () => textOf(container.children),
    caughtErrors,
  };
}

/**
 * Runs `fn` (calls a handler, answers a pending request…) and flushes the
 * renders it causes. A promise `fn` returns is not awaited: a click may start
 * work that the test settles later.
 */
export async function interact(fn: () => unknown): Promise<void> {
  await act(async () => {
    fn();
  });
}

/** Awaits `fn` inside act(), e.g. `vi.waitFor(...)` until async work has landed. */
export async function settle(fn: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await fn();
  });
}

function visibleNodes(children: Child[]): TestNode[] {
  return children.flatMap((child) =>
    child.kind === "element" && !child.hidden ? [child, ...visibleNodes(child.children)] : [],
  );
}

export function textOf(children: Child[] | TestNode): string {
  const list = Array.isArray(children) ? children : children.children;
  return list
    .map((child) => (child.hidden ? "" : child.kind === "text" ? child.text : textOf(child.children)))
    .join("");
}

export function hasClass(node: TestNode, className: string): boolean {
  return typeof node.props.className === "string" && node.props.className.split(/\s+/).includes(className);
}
