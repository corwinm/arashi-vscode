import type { CommandInvocation, CommandResult } from "./cli/runner";

export interface OutputSink {
  appendLine(value: string): void;
  show?(preserveFocus?: boolean): void;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function logCommandInvocation(output: OutputSink, invocation: CommandInvocation): void {
  const args = invocation.builtArgs.join(" ");
  output.appendLine(`[${timestamp()}] $ ${invocation.binaryPath} ${args}`);
  output.appendLine(`[${timestamp()}] cwd: ${invocation.cwd}`);
}

export function logCommandResult(output: OutputSink, result: CommandResult): void {
  if (result.ok) {
    output.appendLine(
      `[${timestamp()}] exit=0 duration=${result.durationMs}ms stdout=${result.stdout.length}B stderr=${result.stderr.length}B`,
    );
    if (result.stdout.trim()) {
      output.appendLine("[stdout]");
      output.appendLine(result.stdout.trim());
    }
    if (result.stderr.trim()) {
      output.appendLine("[stderr]");
      output.appendLine(result.stderr.trim());
    }
    return;
  }

  output.appendLine(
    `[${timestamp()}] failure reason=${result.reason} exit=${result.exitCode ?? "n/a"} duration=${result.durationMs}ms`,
  );
  if (result.stdout.trim()) {
    output.appendLine("[stdout]");
    output.appendLine(result.stdout.trim());
  }
  if (result.stderr.trim()) {
    output.appendLine("[stderr]");
    output.appendLine(result.stderr.trim());
  }
  if (result.errorMessage) {
    output.appendLine(`[error] ${result.errorMessage}`);
  }
}

export function logDiagnostic(output: OutputSink, label: string, details: string): void {
  output.appendLine(`[${timestamp()}] ${label}`);
  output.appendLine(details);
}
