"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  extensionId: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps a faulty extension panel from taking down the whole editor workspace. */
export class ExtensionUiBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(`[extension-ui:${this.props.extensionId}]`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid justify-items-center gap-2 p-6 text-center" role="alert">
        <HugeiconsIcon icon={Alert02Icon} className="size-5 text-destructive" />
        <p className="text-sm font-medium">This extension panel ran into a problem.</p>
        <p className="text-xs text-muted-foreground">The rest of the editor is still available.</p>
        <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    );
  }
}
