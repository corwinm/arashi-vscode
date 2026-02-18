export interface DisposableLike {
  dispose(): unknown;
}

export interface CommandRegistrar {
  registerCommand(commandId: string, handler: (...args: unknown[]) => unknown): DisposableLike;
}

export type HandlerMap = Record<string, (...args: unknown[]) => unknown>;

export function registerCommandHandlers(
  registrar: CommandRegistrar,
  handlers: HandlerMap,
): DisposableLike[] {
  return Object.entries(handlers).map(([commandId, handler]) =>
    registrar.registerCommand(commandId, handler),
  );
}
