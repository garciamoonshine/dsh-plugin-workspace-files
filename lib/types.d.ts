import type { Context } from "@deepseek-ai/cordis";

export interface WorkspaceFilesConfig {
  fileBrowserPort?: number;
  fileBrowserHost?: string;
  prefixPath?: string;
  documentsDirName?: string;
  maxFilesPerTurn?: number;
  maxPdfChars?: number;
  renderPdfPages?: number;
}

export interface WorkspaceFilesService {
  resolveWorkspacePath(sessionId?: string, requestedWsPath?: string, dshHome?: string): Promise<string>;
  expandDocumentReferences(content: any[], options?: Partial<WorkspaceFilesConfig & { workspacePath?: string; supportsImage?: boolean }>): Promise<any[]>;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    workspaceFiles: WorkspaceFilesService;
  }
}

export declare const name = "workspace-files";
export declare function apply(ctx: Context, config: WorkspaceFilesConfig): void;
