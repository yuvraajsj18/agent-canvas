import { useEffect, useMemo, useRef, useState } from "react";
import {
  createToolDefinitions,
  DeveloperToolAdapter,
  type NativeModelContext,
  type ToolHandlers,
} from "./registry";

export type WebMcpCapability = "native" | "adapter" | "registration-error";

export interface WebMcpAdapterWindow {
  listTools: DeveloperToolAdapter["listTools"];
  invoke: DeveloperToolAdapter["invoke"];
}

export function useWebMcp(
  handlers: ToolHandlers,
  state: { hasSelection: boolean },
) {
  const adapterRef = useRef<DeveloperToolAdapter | null>(null);
  if (!adapterRef.current) adapterRef.current = new DeveloperToolAdapter();
  const adapter = adapterRef.current;
  const [capability, setCapability] = useState<WebMcpCapability>(() =>
    getNativeContext() ? "native" : "adapter",
  );
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const hasSelection = state.hasSelection;
  const definitions = useMemo(
    () => createToolDefinitions(handlers, { hasSelection }),
    [handlers, hasSelection],
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
      return;
    }

    const lifecycle = adapter.registerNative(context);
    let active = true;
    lifecycle.ready
      .then(() => {
        if (!active) return;
        setCapability("native");
        setRegistrationError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCapability("registration-error");
        setRegistrationError(
          error instanceof Error ? error.message : "Native registration failed.",
        );
      });

    return () => {
      active = false;
      lifecycle.cleanup();
    };
  }, [adapter, definitions]);

  return {
    adapter,
    capability,
    registrationError,
    tools: definitions.map((definition) => definition.name),
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
