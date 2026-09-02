import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  createToolDefinitions,
  DeveloperToolAdapter,
  registerNativeDefinitions,
  type NativeModelContext,
  type ToolHandlers,
} from "./registry";
import type { ToolExecutionAnalytics } from "../analytics/schema";

export type WebMcpCapability = "native" | "adapter" | "registration-error";

export interface WebMcpAdapterWindow {
  listTools: DeveloperToolAdapter["listTools"];
  invoke: DeveloperToolAdapter["invoke"];
}

export function useWebMcp(
  handlers: ToolHandlers,
  state: {
    hasSelection: boolean;
    onToolExecution?: (execution: ToolExecutionAnalytics) => void;
  },
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const stableHandlersRef = useRef<ToolHandlers | null>(null);
  if (!stableHandlersRef.current) {
    stableHandlersRef.current = forwardingHandlers(handlersRef);
  }
  const stableHandlers = stableHandlersRef.current;
  const executionObserverRef = useRef(state.onToolExecution);
  executionObserverRef.current = state.onToolExecution;
  const stableExecutionObserverRef = useRef<
    ((execution: ToolExecutionAnalytics) => void) | null
  >(null);
  if (!stableExecutionObserverRef.current) {
    stableExecutionObserverRef.current = (execution) =>
      executionObserverRef.current?.(execution);
  }
  const stableExecutionObserver = stableExecutionObserverRef.current;
  const adapterRef = useRef<DeveloperToolAdapter | null>(null);
  if (!adapterRef.current) adapterRef.current = new DeveloperToolAdapter();
  const adapter = adapterRef.current;
  const [capability, setCapability] = useState<WebMcpCapability>(() =>
    getNativeContext() ? "native" : "adapter",
  );
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [capabilityResolved, setCapabilityResolved] = useState(
    () => !getNativeContext(),
  );
  const hasSelection = state.hasSelection;
  const baseDefinitions = useMemo(
    () =>
      createToolDefinitions(stableHandlers, {
        hasSelection: false,
        onToolExecution: stableExecutionObserver,
      }),
    [stableExecutionObserver, stableHandlers],
  );
  const selectionDefinition = useMemo(
    () =>
      createToolDefinitions(stableHandlers, {
        hasSelection: true,
        onToolExecution: stableExecutionObserver,
      }).find(
        (definition) => definition.name === "read_selection",
      ) ?? null,
    [stableExecutionObserver, stableHandlers],
  );
  const definitions = useMemo(
    () =>
      hasSelection && selectionDefinition
        ? [...baseDefinitions, selectionDefinition].sort((left, right) =>
            left.name.localeCompare(right.name),
          )
        : baseDefinitions,
    [baseDefinitions, hasSelection, selectionDefinition],
  );

  adapter.replace(definitions);

  useEffect(() => {
    const windowAdapter: WebMcpAdapterWindow = {
      listTools: adapter.listTools.bind(adapter),
      invoke: adapter.invoke.bind(adapter),
    };
    window.__EXCALIDRAW_WEBMCP_ADAPTER__ = windowAdapter;
    return () => {
      if (window.__EXCALIDRAW_WEBMCP_ADAPTER__ === windowAdapter) {
        delete window.__EXCALIDRAW_WEBMCP_ADAPTER__;
      }
    };
  }, [adapter]);

  useEffect(() => {
    const context = getNativeContext();
    if (!context) {
      setCapability("adapter");
      setRegistrationError(null);
      setCapabilityResolved(true);
      return;
    }

    setCapabilityResolved(false);
    const lifecycle = registerNativeDefinitions(context, baseDefinitions);
    let active = true;
    lifecycle.ready
      .then(() => {
        if (!active) return;
        setCapability("native");
        setRegistrationError(null);
        setCapabilityResolved(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCapability("registration-error");
        setCapabilityResolved(true);
        setRegistrationError(
          error instanceof Error ? error.message : "Native registration failed.",
        );
      });

    return () => {
      active = false;
      lifecycle.cleanup();
    };
  }, [baseDefinitions]);

  useEffect(() => {
    const context = getNativeContext();
    if (!context || !hasSelection || !selectionDefinition) return;

    const lifecycle = registerNativeDefinitions(context, [selectionDefinition]);
    let active = true;
    lifecycle.ready.catch((error: unknown) => {
      if (!active) return;
      setCapability("registration-error");
      setCapabilityResolved(true);
      setRegistrationError(
        error instanceof Error
          ? error.message
          : "Selection tool registration failed.",
      );
    });
    return () => {
      active = false;
      lifecycle.cleanup();
    };
  }, [hasSelection, selectionDefinition]);

  return {
    adapter,
    capability,
    capabilityResolved,
    registrationError,
    tools: definitions.map((definition) => definition.name),
  };
}

function forwardingHandlers(
  handlersRef: MutableRefObject<ToolHandlers>,
): ToolHandlers {
  return {
    readCanvas: () => handlersRef.current.readCanvas(),
    readSelection: () => handlersRef.current.readSelection(),
    addElements: (input) => handlersRef.current.addElements(input),
    updateElements: (input) => handlersRef.current.updateElements(input),
    deleteElements: (input) => handlersRef.current.deleteElements(input),
    connectElements: (input) => handlersRef.current.connectElements(input),
    moveAgentCursor: (input) => handlersRef.current.moveAgentCursor(input),
    setAgentIdentity: (input) => handlersRef.current.setAgentIdentity(input),
  };
}

function getNativeContext(): NativeModelContext | null {
  const modelContext = (
    document as Document & { modelContext?: NativeModelContext }
  ).modelContext;
  return modelContext && typeof modelContext.registerTool === "function"
    ? modelContext
    : null;
}

declare global {
  interface Window {
    __EXCALIDRAW_WEBMCP_ADAPTER__?: WebMcpAdapterWindow;
  }
}
